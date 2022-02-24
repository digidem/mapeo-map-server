import path from 'path'
import { Headers } from '@mapbox/mbtiles'
import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import createError from 'fastify-error'
import fp from 'fastify-plugin'
import got from 'got'
import { headers } from '@mapbox/tiletype'
import Database, { Database as DatabaseInstance } from 'better-sqlite3'
import mem from 'mem'
import QuickLRU from 'quick-lru'

import { TileJSON, validateTileJSON } from './lib/tilejson'
import { isValidMBTilesFormat, mbTilesToTileJSON } from './lib/mbtiles'
import {
  encodeBase32,
  generateId,
  getInterpolatedUpstreamTileUrl,
  getTilesetId,
  tileToQuadKey,
  hash,
} from './lib/utils'
import { migrate } from './lib/migrations'
import { UpstreamRequestsManager } from './lib/upstream_requests_manager'
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

// TODO: Fix naming and description here
const ParseError = createError('PARSE_ERROR', 'Cannot properly parse data', 500)

const UnsupportedMBTilesFormatError = createError(
  'FST_UNSUPPORTED_MBTILES_FORMAT',
  '`format` must be `jpg`, `png`, `pbf`, or `webp`',
  400
)

const MBTilesImportTargetMissingError = createError(
  'FST_MBTILES_IMPORT_TARGET_MISSING',
  'mbtiles file at `%s` could not be read',
  400
)

const MBTilesInvalidMetadataError = createError(
  'FST_MBTILES_INVALID_METADATA',
  'mbtiles file has invalid metadata schema',
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
  dbPath: string
}

interface Context {
  db: DatabaseInstance
  upstreamRequestsManager: UpstreamRequestsManager
}

// Any resource returned by the API will always have an `id` property
export interface IdResource {
  id: string
}

export interface Api {
  importMBTiles(filePath: string): Promise<TileJSON & IdResource>
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
  putTile(opts: {
    tilesetId: string
    zoom: number
    x: number
    y: number
    data: Buffer
    etag?: string
  }): Promise<void>
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
  const { db, upstreamRequestsManager } = context
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

  function tilesetExists(tilesetId: string) {
    return (
      db
        .prepare('SELECT COUNT(*) as count FROM Tileset WHERE id = ?')
        .get(tilesetId).count > 0
    )
  }

  function getTilesetInfo(tilesetId: string) {
    const tilesetRow:
      | { tilejson: string; upstreamTileUrls?: string }
      | undefined = db
      .prepare('SELECT tilejson, upstreamTileUrls FROM Tileset where id = ?')
      .get(tilesetId)

    if (!tilesetRow) {
      // TODO: Is this the appropriate error?
      throw new NotFoundError(`Tileset id = ${tilesetId}`)
    }

    const upstreamTileUrls: TileJSON['tiles'] | undefined =
      tilesetRow.upstreamTileUrls && JSON.parse(tilesetRow.upstreamTileUrls)

    try {
      return {
        tilejson: JSON.parse(tilesetRow.tilejson) as TileJSON,
        upstreamTileUrls,
      }
    } catch (err) {
      throw new ParseError(err)
    }
  }

  const memoizedGetTilesetInfo = mem(getTilesetInfo, {
    cache: new QuickLRU({ maxSize: 10 }),
  })

  function getUpstreamTileUrl({
    tilesetId,
    zoom,
    x,
    y,
  }: {
    tilesetId: string
    zoom: number
    x: number
    y: number
  }) {
    const { tilejson, upstreamTileUrls } = memoizedGetTilesetInfo(tilesetId)

    if (!upstreamTileUrls) return

    const upstreamTileUrl = getInterpolatedUpstreamTileUrl({
      tiles: upstreamTileUrls,
      scheme: tilejson.scheme,
      zoom,
      x,
      y,
    })

    return upstreamTileUrl
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

      if (!tilesetExists(tilesetId)) {
        await api.createTileset(tilejson)
      } else {
        // TODO: Should we update an existing tileset here?
      }
      offlineSources[sourceId] = { ...source, tilesetId }
    }
    return offlineSources
  }

  const api: Api = {
    async importMBTiles(filePath: string) {
      const filePathWithExtension =
        path.extname(filePath) === '.mbtiles' ? filePath : filePath + '.mbtiles'

      let mbTilesDb: DatabaseInstance

      try {
        mbTilesDb = new Database(filePathWithExtension, {
          // Ideally would set `readOnly` to `true` here but causes `fileMustExist` to be ignored:
          // https://github.com/JoshuaWise/better-sqlite3/blob/230ea65ed0d7566e32d41c3d13a90fb32ccdbee6/docs/api.md#new-databasepath-options
          fileMustExist: true,
        })
      } catch (_err) {
        throw new MBTilesImportTargetMissingError(filePath)
      }

      const tilejson = mbTilesToTileJSON(mbTilesDb, apiUrl)

      // TODO: Should this be handled in extractMBTilesMetadata?
      if (!(tilejson.format && isValidMBTilesFormat(tilejson.format))) {
        throw new UnsupportedMBTilesFormatError()
      }

      if (!validateTileJSON(tilejson)) {
        mbTilesDb.close()
        throw new MBTilesInvalidMetadataError()
      }

      const insertTileData = db.prepare<{
        data: Buffer
        tileHash: string
        tilesetId: string
      }>(
        'INSERT INTO TileData (tileHash, data, tilesetId) VALUES (:tileHash, :data, :tilesetId)'
      )

      const insertTile = db.prepare<{
        quadKey: string
        tileHash: string
        tilesetId: string
      }>(
        'INSERT INTO Tile (quadKey, tileHash, tilesetId) VALUES (:quadKey, :tileHash, :tilesetId)'
      )

      const tilesetId = getTilesetId(tilejson)

      // TODO: Look into whether we need to have a transaction for this
      // Concerns regarding memory due to tile data size
      const tilesImportTransaction = db.transaction(async () => {
        const getMBTilesQuery = mbTilesDb.prepare(
          'SELECT zoom_level as z, tile_column as y, tile_row as x, tile_data as data FROM tiles'
        )

        // TODO: See comment about transaction above. This would be the area of concern.
        for (const { data, x, y, z } of getMBTilesQuery.iterate() as Iterable<{
          data: Buffer
          x: number
          y: number
          z: number
        }>) {
          const quadKey = tileToQuadKey({ zoom: z, x, y })

          const tileHash = hash(data).toString('hex')

          insertTileData.run({
            tileHash,
            data,
            tilesetId,
          })

          insertTile.run({
            quadKey,
            tileHash,
            tilesetId,
          })
        }
      })

      const tileset = await api.createTileset(tilejson)

      tilesImportTransaction()

      mbTilesDb.close()

      return tileset
    },
    async createTileset(tilejson) {
      const id = getTilesetId(tilejson)

      if (tilesetExists(id)) {
        throw new AlreadyExistsError(
          `A tileset based on tiles ${tilejson.tiles[0]} already exists. PUT changes to ${fastify.prefix}/${id} to modify this tileset`
        )
      }

      const { mbTilesImport, ...tileset } = tilejson

      db.prepare<{
        id: string
        format: TileJSON['format']
        tilejson: string
        upstreamTileUrls?: string
      }>(
        'INSERT INTO Tileset (id, tilejson, format, upstreamTileUrls) ' +
          'VALUES (:id, :tilejson, :format, :upstreamTileUrls)'
      ).run({
        id,
        format: tilejson.format,
        tilejson: JSON.stringify(tileset),
        upstreamTileUrls: !!mbTilesImport
          ? undefined
          : JSON.stringify(tilejson.tiles),
      })

      const result = {
        ...tileset,
        tiles: [getTileUrl(id)],
        id,
      }

      return result
    },

    async putTileset(id, tilejson) {
      if (id !== tilejson.id) {
        throw new MismatchedIdError(id, tilejson.id)
      }

      if (!tilesetExists(id)) {
        throw new NotFoundError(id)
      }

      const { mbTilesImport, ...tileset } = tilejson

      db.prepare<{
        id: string
        format: TileJSON['format']
        tilejson: string
        upstreamTileUrls?: string
      }>(
        'UPDATE Tileset SET ' +
          'tilejson = :tilejson, ' +
          'format = :format, ' +
          'upstreamTileUrls = :upstreamTileUrls ' +
          'WHERE id = :id'
      ).run({
        id,
        format: tilejson.format,
        tilejson: JSON.stringify(tileset),
        upstreamTileUrls: !!mbTilesImport
          ? undefined
          : JSON.stringify(tilejson.tiles),
      })

      mem.clear(memoizedGetTilesetInfo)

      const result = {
        ...tileset,
        tiles: [getTileUrl(id)],
        id,
      }

      return result
    },

    async listTilesets() {
      const tilesets: (TileJSON & IdResource)[] = []

      db.prepare('SELECT id, tilejson FROM Tileset')
        .all()
        .forEach(({ id, tilejson }: { id: string; tilejson: string }) => {
          try {
            const tileset: TileJSON = JSON.parse(tilejson)

            tilesets.push({
              ...tileset,
              tiles: [getTileUrl(id)],
              id,
            })
          } catch (err) {
            // TODO: What should we do here? e.g. omit or throw?
          }
        })

      return tilesets
    },

    async getTileset(id) {
      const row:
        | { tilejson: string; etag?: string; upstreamUrl?: string }
        | undefined = db
        .prepare('SELECT tilejson, etag, upstreamUrl FROM Tileset WHERE id = ?')
        .get(id)

      if (!row) {
        throw new NotFoundError(id)
      }

      let tileset: TileJSON
      let allowUpstreamRequest = true

      try {
        const { mbTilesImport, ...tilejson } = JSON.parse(row.tilejson)

        tileset = tilejson

        // We want to disable the upstream request if the tileset was created via MB Tiles import
        allowUpstreamRequest = !mbTilesImport
      } catch (err) {
        throw new ParseError(err)
      }

      async function fetchOnlineResource(url: string, etag?: string) {
        const { data } = await upstreamRequestsManager.getUpstream({
          url,
          etag,
          responseType: 'json',
        })

        if (data) api.putTileset(id, data)
      }

      if (row.upstreamUrl && allowUpstreamRequest) {
        fetchOnlineResource(row.upstreamUrl, row.etag).catch(noop)
      }

      return { ...tileset, tiles: [getTileUrl(id)], id }
    },

    async getTile({ tilesetId, zoom, x, y }) {
      const quadKey = tileToQuadKey({ x, y, zoom })

      const row:
        | {
            data: Buffer
            etag?: string
            tilejson: string
          }
        | undefined = db
        .prepare<{
          tilesetId: string
          quadKey: string
        }>(
          'SELECT TileData.data as data, Tile.etag as etag FROM TileData ' +
            'JOIN Tile ON TileData.tileHash = Tile.tileHash ' +
            'JOIN Tileset ON Tile.tilesetId = Tileset.id ' +
            'WHERE Tileset.id = :tilesetId AND Tile.quadKey = :quadKey'
        )
        .get({ tilesetId, quadKey })

      async function fetchOnlineResource(): Promise<
        | {
            data: Buffer
            etag?: string
          }
        | undefined
      > {
        const upstreamTileUrl = getUpstreamTileUrl({
          tilesetId,
          zoom,
          x,
          y,
        })

        // TODO: Need to check if we can make online requests too
        if (upstreamTileUrl) {
          const response = await upstreamRequestsManager.getUpstream({
            url: upstreamTileUrl,
            etag: row?.etag,
            responseType: 'buffer',
          })

          if (response) {
            api
              .putTile({
                tilesetId,
                zoom,
                x,
                y,
                data: response.data,
                etag: response.etag,
              })
              .catch(noop)

            return { data: response.data, etag: response.etag }
          }
        }
      }

      let tile: { data: Buffer; etag?: string } | undefined

      if (row) {
        tile = { data: row.data, etag: row.etag }
        fetchOnlineResource().catch(noop)
      } else {
        tile = await fetchOnlineResource()
      }

      if (!tile) {
        // TODO: Improve error handling here?
        throw new NotFoundError(
          `Tileset id = ${tilesetId}, [${zoom}, ${x}, ${y}]`
        )
      }

      return {
        data: tile.data,
        // TODO: This never returns a Last-Modified header but seems like the endpoint would want it to if possible?
        // Would require changing the return type of UpstreamRequestsManager.getUpstream
        headers: { ...headers(tile.data), Etag: tile.etag },
      }
    },

    async putTile({ tilesetId, zoom, x, y, data, etag }) {
      const upstreamTileUrl = getUpstreamTileUrl({
        tilesetId,
        zoom,
        x,
        y,
      })

      const quadKey = tileToQuadKey({ x, y, zoom })

      const transaction = db.transaction(() => {
        const tileHash = hash(data).toString('hex')

        db.prepare<{
          tileHash: string
          tilesetId: string
          data: Buffer
        }>(
          'INSERT INTO TileData (tileHash, tilesetId, data) VALUES (:tileHash, :tilesetId, :data)'
        ).run({ tileHash, tilesetId, data })

        // TODO: Is this still necessary?
        db.prepare<{
          etag?: string
          tilesetId: string
          upstreamUrl?: string
        }>(
          'UPDATE Tileset SET (upstreamUrl) = (:upstreamUrl) WHERE id = :tilesetId'
        ).run({
          tilesetId,
          upstreamUrl: upstreamTileUrl,
        })

        db.prepare<{
          etag?: string
          quadKey: string
          tileHash: string
          tilesetId: string
        }>(
          'INSERT INTO Tile (etag, quadKey, tileHash, tilesetId) VALUES (:etag, :quadKey, :tileHash, :tilesetId)'
        ).run({
          etag,
          quadKey,
          tileHash,
          tilesetId,
        })
      })

      transaction()
    },

    async createStyle(style) {
      const styleId = getStyleId(style)

      const styleExists =
        db
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

      db.prepare(
        'INSERT INTO Style (id, stylejson) VALUES (:id, :stylejson)'
      ).run({ id: styleId, stylejson: JSON.stringify(offlineStyle) })

      return addOfflineUrls(offlineStyle)
    },

    async putStyle(id, style) {
      db.prepare(
        'INSERT INTO Style (id, stylejson) VALUES (:id, :stylejson)'
      ).run({ id, stylejson: style })
      return { ...style, id }
    },

    async listStyles(limit?: number) {
      const baseQuery = 'SELECT stylejson FROM Style'
      const stmt =
        limit !== undefined
          ? db.prepare(`${baseQuery} LIMIT ?`).bind(limit)
          : db.prepare(baseQuery)

      return stmt
        .all()
        .map((row: { stylejson: string }) => JSON.parse(row.stylejson))
    },

    async getStyle(id) {
      const row = db.prepare('SELECT stylejson FROM Style WHERE id = ?').get(id)

      return JSON.parse(row.stylejson)
    },
  }
  return api
}

const ApiPlugin: FastifyPluginAsync<PluginOptions> = async (
  fastify,
  { dbPath }
) => {
  // Create context once for each fastify instance
  const context = init(dbPath)
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

function init(dbPath: string): Context {
  const db = new Database(dbPath)

  migrate(db, path.resolve(__dirname, '../prisma/migrations'))

  return {
    db,
    upstreamRequestsManager: new UpstreamRequestsManager(),
  }
}

function noop() {}
