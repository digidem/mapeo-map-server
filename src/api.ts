import { promises as fsPromises } from 'fs'
import path from 'path'

import { Headers } from '@mapbox/mbtiles'
import { AbstractLevelDOWN } from 'abstract-leveldown'
import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import createError from 'fastify-error'
import fp from 'fastify-plugin'
import getStream from 'get-stream'
import got from 'got'
import Level from 'level'
import { LevelUp } from 'levelup'
import mkdirp from 'mkdirp'
import SubLevel from 'subleveldown'

import SWRCache from './lib/swr_cache'
import { TileJSON, validateTileJSON } from './lib/tilejson'
import Tilestore, { getTilesetId } from './lib/tilestore'
import { encodeBase32, generateId, hash } from './lib/utils'
import {
  RasterSourceSpecification,
  StyleSpecification,
  VectorSourceSpecification,
} from './types/mapbox_style'

const NotFoundError = createError(
  'FST_RESOURCE_NOT_FOUND',
  'Resource `%s` not found',
  404
)

const AlreadyExistsError = createError(
  'FST_RESOURCE_EXISTS',
  'Resource with id `%s` already exists',
  409
)

const UnsupportedSourceError = createError(
  'FST_UNSUPPORTED_SOURCE',
  'Invalid source: %s',
  400
)

const MismatchedIdError = createError(
  'FST_MISMATCHED_ID',
  '`id` ("%s") in request URL does not match the `id` ("%s") in your tilejson',
  400
)

type OfflineStyle = StyleSpecification & {
  id: string
  sources?: {
    [_: string]: (VectorSourceSpecification | RasterSourceSpecification) & {
      tilesetId: string
    }
  }
}

export interface PluginOptions {
  dataDir?: string
}

interface Context {
  tilestores: Map<string, Tilestore>
  stylesDb: LevelUp<AbstractLevelDOWN<string, OfflineStyle>>
  swrCache: SWRCache
  paths: {
    tilesets: string
    styles: string
    fonts: string
    sprites: string
    db: string
  }
}

// Any resource returned by the API will always have an `id` property
interface IdResource {
  id: string
}

export interface Api {
  createTileset(tileset: TileJSON): Promise<TileJSON & IdResource>
  putTileset(id: string, tileset: TileJSON): Promise<TileJSON & IdResource>
  listTilesets(): Promise<Array<TileJSON & IdResource>>
  getTileset(id: string): Promise<TileJSON & IdResource>
  getTile(opts: {
    tilesetId: string
    zoom: number
    x: number
    y: number
  }): Promise<{ data: Buffer; headers: Headers }>
  createStyle(style: StyleSpecification): Promise<OfflineStyle>
  putStyle(id: string, style: OfflineStyle): Promise<OfflineStyle>
  getStyle(id: string): Promise<OfflineStyle>
  // deleteStyle(id: string): Promise<void>
  listStyles(): Promise<Array<OfflineStyle>>
}

function createApi({
  request,
  context,
  fastify,
}: {
  request: FastifyRequest
  context: Context
  fastify: FastifyInstance
}): Api {
  const { hostname, protocol } = request
  const { swrCache } = context
  const apiUrl = `${protocol}://${hostname}`

  function getTileUrl(tilesetId: string): string {
    return `${apiUrl}/tilesets/${tilesetId}/{z}/{x}/{y}`
  }

  function getTilesetUrl(tilesetId: string): string {
    return `${apiUrl}/tilesets/${tilesetId}`
  }

  function getSpriteUrl(styleId: string): string {
    return `${apiUrl}/sprites/${styleId}`
  }

  function getGlyphsUrl(styleId: string): string {
    return `${apiUrl}/fonts/${styleId}/{fontstack}/{range}`
  }

  function addOfflineUrls(style: OfflineStyle): OfflineStyle {
    const sources: OfflineStyle['sources'] = {}
    for (const sourceId of Object.keys(style.sources)) {
      sources[sourceId] = {
        ...style.sources[sourceId],
        url: getTilesetUrl(sources[sourceId].tilesetId),
      }
    }
    return {
      ...style,
      sources,
      glyphs: style.glyphs && getGlyphsUrl(style.id),
      sprite: style.sprite && getSpriteUrl(style.id),
    }
  }

  /**
   * Given a map of sources from a style, this will create offline tilesets for
   * each source, and update the source to reference the offline tileset
   */
  async function createOfflineSources(
    sources: StyleSpecification['sources']
  ): Promise<OfflineStyle['sources']> {
    const offlineSources: OfflineStyle['sources'] = {}

    for (const sourceId of Object.keys(sources)) {
      const source = sources[sourceId]

      if (!(source.type === 'raster' || source.type === 'vector')) {
        throw new UnsupportedSourceError(
          `Currently only sources of type 'vector' or 'raster' are supported, and this style.json has a source '${sourceId}' of type '${source.type}'`
        )
      }
      if (typeof source.url !== 'string') {
        throw new UnsupportedSourceError(
          `Currently only sources defined with \`source.url\` are supported (referencing a TileJSON), but this style.json has a source '${sourceId}' that does not have a \`url\` property`
        )
      }

      const tilejson = await got(source.url).json()
      if (!validateTileJSON(tilejson)) {
        // TODO: Write these errors to UnsupportedSourceError.message rather
        // than just log them
        request.log.info(
          validateTileJSON.errors as NonNullable<typeof validateTileJSON.errors>
        )
        throw new UnsupportedSourceError(
          `Invalid TileJSON at '${source.url}' for source '${sourceId}'`
        )
      }

      // We try to get an idempotent ID for each source, so that we only create
      // one offline copy of sources that are referenced from multiple styles,
      // e.g. lots of styles created on Mapbox will use the
      // mapbox.mapbox-streets-v7 source
      const tilesetId = getTilesetId(tilejson)
      const tilestore = context.tilestores.get(tilesetId)
      if (!tilestore) {
        await api.createTileset(tilejson)
      } else {
        // TODO: Should we update an existing tileset here?
      }
      offlineSources[sourceId] = { ...source, tilesetId }
    }
    return offlineSources
  }

  const api: Api = {
    async createTileset(tilejson) {
      const id = getTilesetId(tilejson)
      if (context.tilestores.has(id)) {
        throw new AlreadyExistsError(
          `A tileset based on tiles ${tilejson.tiles[0]} already exists. PUT changes to ${fastify.prefix}/${id} to modify this tileset`
        )
      }
      const tilestore = new Tilestore({
        id,
        mode: 'rwc',
        dir: context.paths.tilesets,
        swrCache,
      })
      context.tilestores.set(id, tilestore)
      await tilestore.putTileJSON(tilejson)
      return { ...tilejson, id, tiles: [getTileUrl(id)] }
    },

    async putTileset(id, tilejson) {
      if (id !== tilejson.id) {
        throw new MismatchedIdError(id, tilejson.id)
      }
      const tilestore = context.tilestores.get(id)
      if (!tilestore) {
        throw new NotFoundError(id)
      }
      await tilestore.putTileJSON(tilejson)
      return { ...tilejson, id, tiles: [getTileUrl(id)] }
    },

    async listTilesets() {
      const tilesetIds = Array.from(context.tilestores.keys())
      return Promise.all(tilesetIds.map((id) => api.getTileset(id)))
    },

    async getTileset(id) {
      const tilestore = context.tilestores.get(id)
      if (!tilestore) {
        throw new NotFoundError(id)
      }
      return {
        ...(await tilestore.getTileJSON()),
        id,
      }
    },

    async getTile({ tilesetId, zoom, x, y }) {
      const tilestore = context.tilestores.get(tilesetId)
      if (!tilestore) {
        throw new NotFoundError(tilesetId)
      }
      return tilestore.getTile(zoom, x, y)
    },

    async createStyle(style) {
      const styleId = getStyleId(style)

      // Round-about, because level does not have a has() function
      let existingStyle: OfflineStyle | void
      try {
        existingStyle = await context.stylesDb.get(styleId)
      } catch (e) {
        // Treat error as "not found"
      }
      if (existingStyle) {
        throw new AlreadyExistsError(
          `Style already exists. PUT changes to ${fastify.prefix}/${styleId} to modify this style`
        )
      }

      const offlineStyle: OfflineStyle = {
        ...(await uncompositeStyle(style)),
        id: styleId,
        sources: await createOfflineSources(style.sources),
      }

      await context.stylesDb.put(styleId, offlineStyle)
      return addOfflineUrls(offlineStyle)
    },

    async putStyle(id, style) {
      await context.stylesDb.put(id, style)
      return { ...style, id }
    },

    async listStyles() {
      // TODO: Limit number of returned entries with getStream options.maxBuffer
      return await getStream.array<OfflineStyle>(
        context.stylesDb.createValueStream()
      )
    },

    async getStyle(id) {
      return await context.stylesDb.get(id)
    },
  }
  return api
}

const ApiPlugin: FastifyPluginAsync<PluginOptions> = async (
  fastify,
  { dataDir = 'data' }
) => {
  // Create context once for each fastify instance
  const context = await init(dataDir)
  fastify.decorateRequest('api', {
    getter(this: FastifyRequest) {
      return createApi({ context, request: this, fastify })
    },
  })
}

export default fp(ApiPlugin, {
  fastify: '3.x',
  name: 'api',
})

/**
 * Try to get an idempotent ID for a given style.json, fallback to random ID
 */
function getStyleId(style: StyleSpecification): string {
  // If the style has an `upstreamUrl` property, indicating where it was
  // downloaded from, then use that as the id (this way two clients that
  // download the same style do not result in duplicates)
  if (style.upstreamUrl) {
    return encodeBase32(hash(style.upstreamUrl))
  } else {
    return generateId()
  }
}

/**
 * TODO: Mapbox styles are sometimes served with sources combined into a single
 * "composite" source. Since core Mapbox sources (e.g. streets, satellite,
 * outdoors etc) can appear in several different styles, this function should
 * extract them from the composite style and adjust the style layers to point to
 * the original source, not the composite. This will save downloading Mapbox
 * sources multiple times for each style they appear in.
 */
async function uncompositeStyle(
  style: StyleSpecification
): Promise<StyleSpecification> {
  // TODO:
  // 1. Check if style.sources includes source named "composite"
  // 2. Check in "composite" includes a source id that starts with 'mapbox.'
  // 3. Download the composite source tilejson and check vector_layers for
  //    source_layer ids that from from the 'mapbox.' source
  // 4. Add any 'mapbox.' sources from 'composite' as separate sources
  // 5. Re-write style.layers for layers to use 'mapbox.' sources rather than
  //    the composite source
  // 6. Re-write the composite source to not include 'mapbox.' source ids
  return style
}

/**
 * Setup data storage paths and create Tilestore instances for existing mbtiles.
 * TODO: Watch dirs for user-added files? Maybe separate user dir from these
 * data dirs, to avoid users moving mbtiles internally managed here.
 */
async function init(dataDir: string): Promise<Context> {
  const paths = { tilesets: '', styles: '', sprites: '', fonts: '', db: '' }
  for (const pathName of Object.keys(paths) as Array<keyof typeof paths>) {
    paths[pathName] = path.join(process.cwd(), dataDir, pathName)
    await mkdirp(paths[pathName])
  }

  const db = Level(paths.db)
  const stylesDb = SubLevel<string, OfflineStyle>(db, 'styles')
  const etagDb = SubLevel<string, string>(db, 'etag', {
    valueEncoding: 'string',
  })
  const cacheDb = SubLevel<string, Buffer>(db, 'urlCache', {
    valueEncoding: 'binary',
  })
  const swrCache = new SWRCache({ etagDb, cacheDb })

  const tilesetIds = (await fsPromises.readdir(paths.tilesets))
    .filter((fname) => fname.endsWith('.mbtiles'))
    .map((fname) => path.basename(fname, '.mbtiles'))

  const tilestores = new Map(
    tilesetIds.map((id) => [
      id,
      new Tilestore({ id, mode: 'rw', dir: paths.tilesets, swrCache }),
    ])
  )

  return { tilestores, paths, stylesDb, swrCache }
}
