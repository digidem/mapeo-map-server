import path from 'path'
import { Headers } from '@mapbox/mbtiles'
import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import createError from 'fastify-error'
import fp from 'fastify-plugin'
import got from 'got'

import { SWRCacheV2 } from './lib/swr_cache'
import { TileJSON, validateTileJSON } from './lib/tilejson'
import { TilesetManager, getTilesetId } from './lib/tileset_manager'
import { encodeBase32, generateId, hash } from './lib/utils'
import {
  RasterSourceSpecification,
  StyleSpecification,
  VectorSourceSpecification,
} from './types/mapbox_style'
import Database, { Database as DatabaseInstance } from 'better-sqlite3'
import { migrate } from './lib/migrations'

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
  db: DatabaseInstance
  tileCache: SWRCacheV2<Buffer>
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
  const { db, tileCache } = context
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

  function createTilesetManager(id: string) {
    return new TilesetManager({ id, db, swrCache: tileCache })
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
      const tilesetManager = createTilesetManager(tilesetId)
      if (!tilesetManager.hasExistingTileset) {
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

      const tilesetManager = createTilesetManager(id)

      if (tilesetManager.hasExistingTileset) {
        throw new AlreadyExistsError(
          `A tileset based on tiles ${tilejson.tiles[0]} already exists. PUT changes to ${fastify.prefix}/${id} to modify this tileset`
        )
      }

      const result = {
        ...tilejson,
        id,
        // TODO: is this what we want to do with `tiles` field?
        tiles: [getTileUrl(id)],
      }

      await tilesetManager.putTileJSON(result)

      return result
    },

    // TODO: this is basically the same as createTileset at the moment since TileManager.putTileJSON is an upsert for now
    async putTileset(id, tilejson) {
      if (id !== tilejson.id) {
        throw new MismatchedIdError(id, tilejson.id)
      }

      const tilesetManager = createTilesetManager(id)

      if (!tilesetManager.hasExistingTileset) {
        throw new NotFoundError(id)
      }

      const result = {
        ...tilejson,
        id,
        tiles: [getTileUrl(id)],
      }

      await tilesetManager.putTileJSON(result)

      return result
    },

    async listTilesets() {
      return db
        .prepare('SELECT id, tilejson FROM Tileset')
        .all()
        .map(({ id, tilejson }: { id: string; tilejson: string }) => ({
          ...JSON.parse(tilejson),
          id,
        }))
    },

    async getTileset(id) {
      return {
        ...(await createTilesetManager(id).getTileJSON()),
        id,
      }
    },

    async getTile({ tilesetId, zoom, x, y }) {
      const tilesetManager = createTilesetManager(tilesetId)

      if (!tilesetManager.hasExistingTileset) {
        throw new NotFoundError(tilesetId)
      }

      const tile = await tilesetManager.getTile(zoom, x, y)

      if (!tile) {
        // TODO: Improve error handling here?
        throw new NotFoundError(`[${zoom}, ${x}, ${y}]`)
      }

      return tile
    },

    async createStyle(style) {
      const styleId = getStyleId(style)

      const styleExists =
        context.db
          .prepare('SELECT COUNT(*) as count FROM Style WHERE id = ?')
          .get(styleId).count > 0

      if (styleExists) {
        throw new AlreadyExistsError(
          `Style already exists. PUT changes to ${fastify.prefix}/${styleId} to modify this style`
        )
      }

      const offlineStyle: OfflineStyle = {
        ...(await uncompositeStyle(style)),
        id: styleId,
        sources: await createOfflineSources(style.sources),
      }

      context.db
        .prepare('INSERT INTO Style (id, stylejson) VALUES (:id, :stylejson)')
        .run({ id: styleId, stylejson: JSON.stringify(offlineStyle) })

      return addOfflineUrls(offlineStyle)
    },

    async putStyle(id, style) {
      context.db
        .prepare('INSERT INTO Style (id, stylejson) VALUES (:id, :stylejson)')
        .run({ id, stylejson: style })
      return { ...style, id }
    },

    async listStyles(limit?: number) {
      const baseQuery = 'SELECT stylejson FROM Style'
      const stmt =
        limit !== undefined
          ? context.db.prepare(`${baseQuery} LIMIT ?`).bind(limit)
          : context.db.prepare(baseQuery)

      return stmt
        .all()
        .map((row: { stylejson: string }) => JSON.parse(row.stylejson))
    },

    async getStyle(id) {
      const row = context.db
        .prepare('SELECT stylejson FROM Style WHERE id = ?')
        .get(id)

      return JSON.parse(row.stylejson)
    },
  }
  return api
}

const ApiPlugin: FastifyPluginAsync<PluginOptions> = async (
  fastify,
  { dataDir = 'data' }
) => {
  // Create context once for each fastify instance
  const context = init(dataDir)
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

function init(dataDir: string): Context {
  const db = new Database(path.resolve(dataDir, 'mapeo-map-server.db'))

  migrate(db)

  // TODO: We need caches for various types of entities (starting with tiles)
  const tileCache = new SWRCacheV2<Buffer>()

  return { db, tileCache }
}
