import path from 'path'
import { MessageChannel } from 'worker_threads'
import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import createError from '@fastify/error'
import fp from 'fastify-plugin'
import got from 'got'
import Database, { Database as DatabaseInstance } from 'better-sqlite3'
import mem from 'mem'
import QuickLRU from 'quick-lru'
import Piscina from 'piscina'

import {
  Headers as MbTilesHeaders,
  isValidMBTilesFormat,
  mbTilesToTileJSON,
} from './lib/mbtiles'
import { TileJSON, validateTileJSON } from './lib/tilejson'
import {
  getInterpolatedUpstreamTileUrl,
  getTileHeaders,
  tileToQuadKey,
} from './lib/tiles'
import {
  DEFAULT_RASTER_SOURCE_ID,
  StyleJSON,
  createIdFromStyleUrl,
  createRasterStyle,
  uncompositeStyle,
} from './lib/stylejson'
import { getTilesetId, hash, encodeBase32, generateId } from './lib/utils'
import { migrate } from './lib/migrations'
import { UpstreamRequestsManager } from './lib/upstream_requests_manager'
// import { ImportProgressEmitter } from './lib/import_progress_emitter'
import { isMapboxURL, normalizeSourceURL } from './lib/mapbox_urls'

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

const MBAccessTokenRequiredError = createError(
  'FST_ACCESS_TOKEN',
  'A Mapbox API access token is required for styles that use Mapbox-hosted sources',
  400
)

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

const UpstreamJsonValidationError = createError(
  'FST_UPSTREAM_VALIDATION',
  'JSON validation failed for upstream resource from %s: %s',
  500
)

const ParseError = createError('PARSE_ERROR', 'Cannot properly parse data', 500)

export interface MapServerOptions {
  dbPath: string
}

interface SourceIdToTilesetId {
  [sourceId: keyof StyleJSON['sources']]: string
}

interface Context {
  piscina: Piscina
  db: DatabaseInstance
  upstreamRequestsManager: UpstreamRequestsManager
}

// Any resource returned by the API will always have an `id` property
export interface IdResource {
  id: string
}
export interface Api {
  importMBTiles(filePath: string): Promise<TileJSON & IdResource>
  // getImportProgress(tilesetId: string): Promise<ImportProgressEmitter>
  createTileset(tileset: TileJSON): Promise<TileJSON & IdResource>
  putTileset(id: string, tileset: TileJSON): Promise<TileJSON & IdResource>
  listTilesets(): Promise<Array<TileJSON & IdResource>>
  getTileset(id: string): Promise<TileJSON & IdResource>
  getTile(opts: {
    tilesetId: string
    zoom: number
    x: number
    y: number
  }): Promise<{ data: Buffer; headers: MbTilesHeaders }>
  putTile(opts: {
    tilesetId: string
    zoom: number
    x: number
    y: number
    data: Buffer
    etag?: string
  }): Promise<void>
  createStyleForTileset(
    tilesetId: string,
    nameForStyle?: string
  ): Promise<{ id: string; style: StyleJSON }>
  createStyle(
    style: StyleJSON,
    options?: {
      accessToken?: string
      etag?: string
      id?: string
      upstreamUrl?: string
    }
  ): Promise<{ style: StyleJSON } & IdResource>
  updateStyle(id: string, style: StyleJSON): Promise<StyleJSON>
  getStyle(id: string): Promise<StyleJSON>
  deleteStyle(id: string): Promise<void>
  listStyles(): Promise<Array<{ name?: string; url: string } & IdResource>>
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
  const { piscina, db, upstreamRequestsManager } = context
  const apiUrl = `${protocol}://${hostname}`

  function getTileUrl(tilesetId: string): string {
    return `${apiUrl}/tilesets/${tilesetId}/{z}/{x}/{y}`
  }

  function getTilesetUrl(tilesetId: string): string {
    return `${apiUrl}/tilesets/${tilesetId}`
  }

  function getStyleUrl(styleId: string): string {
    return `${apiUrl}/styles/${styleId}`
  }

  function getSpriteUrl(styleId: string): string {
    return `${apiUrl}/sprites/${styleId}`
  }

  function getGlyphsUrl(styleId: string): string {
    return `${apiUrl}/fonts/${styleId}/{fontstack}/{range}`
  }

  function addOfflineUrls({
    sourceIdToTilesetId,
    style,
  }: {
    sourceIdToTilesetId: SourceIdToTilesetId
    style: StyleJSON
  }): StyleJSON {
    const updatedSources: StyleJSON['sources'] = {}

    for (const sourceId of Object.keys(style.sources)) {
      const source = style.sources[sourceId]

      const tilesetId = sourceIdToTilesetId[sourceId]

      const includeUrlField =
        tilesetId && ['vector', 'raster', 'raster-dem'].includes(source.type)

      updatedSources[sourceId] = {
        ...source,
        ...(includeUrlField ? { url: getTilesetUrl(tilesetId) } : undefined),
      }
    }

    // TODO: Remap glyphs and sprite URLs to map server
    return {
      ...style,
      sources: updatedSources,
    }
  }

  function tilesetExists(tilesetId: string) {
    return (
      db
        .prepare('SELECT COUNT(*) AS count FROM Tileset WHERE id = ?')
        .get(tilesetId).count > 0
    )
  }

  function styleExists(styleId: string) {
    return (
      db
        .prepare('SELECT COUNT(*) AS count FROM Style WHERE id = ?')
        .get(styleId).count > 0
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
   * each source, and return a mapping of source ids to their created tileset ids
   */
  async function createOfflineSources({
    accessToken,
    sources,
  }: {
    accessToken?: string
    sources: StyleJSON['sources']
  }): Promise<SourceIdToTilesetId> {
    const sourceIdToTilesetId: SourceIdToTilesetId = {}

    for (const sourceId of Object.keys(sources)) {
      const source = sources[sourceId]

      // TODO:
      // - Support vector sources
      // - Should we continue instead of throw if the source is vector?
      if (!(source.type === 'raster')) {
        throw new UnsupportedSourceError(
          `Currently only sources of type 'raster' are supported, and this style.json has a source '${sourceId}' of type '${source.type}'`
        )
      }
      if (typeof source.url !== 'string') {
        throw new UnsupportedSourceError(
          `Currently only sources defined with \`source.url\` are supported (referencing a TileJSON), but this style.json has a source '${sourceId}' that does not have a \`url\` property`
        )
      }
      if (isMapboxURL(source.url) && !accessToken) {
        throw new MBAccessTokenRequiredError()
      }

      const upstreamUrl = normalizeSourceURL(source.url, accessToken)

      const tilejson = await got(upstreamUrl).json()

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
        // await api.putTileset(tilesetId, tilejson)
      }
      sourceIdToTilesetId[sourceId] = tilesetId
    }

    return sourceIdToTilesetId
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

      const tilejson = mbTilesToTileJSON(mbTilesDb)

      mbTilesDb.close()

      // TODO: Should this be handled in extractMBTilesMetadata?
      if (!(tilejson.format && isValidMBTilesFormat(tilejson.format))) {
        throw new UnsupportedMBTilesFormatError()
      }

      if (!validateTileJSON(tilejson)) {
        throw new MBTilesInvalidMetadataError()
      }

      const tilesetId = getTilesetId(tilejson)

      const tileset = await api.createTileset(tilejson)

      const { id: styleId } = await api.createStyleForTileset(
        tileset.id,
        tileset.name
      )

      const importId = generateId()

      const { port1, port2 } = new MessageChannel()

      port2.on('message', (/** message: PortMessage */) => {
        // TODO: do something with progress messages
      })

      await piscina.run(
        {
          dbPath: db.name,
          importId,
          mbTilesDbPath: mbTilesDb.name,
          // TODO: `style` is not guaranteed to exist since the tileset could be a vector tileset
          // and we don't generate a style for those on tileset creation yet.
          // Absence presents various complications when creating and updating offline area and imports in db
          styleId,
          tilesetId,
          port: port1,
        },
        { transferList: [port1] }
      )

      port2.close()

      return tileset
    },
    // async getImportProgress(offlineAreaId) {
    //   const importIds: string[] = db
    //     .prepare('SELECT id FROM Import WHERE areaId = ?')
    //     .all(offlineAreaId)
    //     .map((row: { id: string }) => row.id)

    //   return new ImportProgressEmitter(tilesetImportWorker, importIds)
    // },
    async createTileset(tilejson) {
      const tilesetId = getTilesetId(tilejson)

      if (tilesetExists(tilesetId)) {
        throw new AlreadyExistsError(
          `A tileset based on tiles ${tilejson.tiles[0]} already exists. PUT changes to ${fastify.prefix}/${tilesetId} to modify this tileset`
        )
      }

      const upstreamTileUrls =
        tilejson.tiles.length === 0 ? undefined : JSON.stringify(tilejson.tiles)

      db.prepare<{
        id: string
        format: TileJSON['format']
        tilejson: string
        upstreamTileUrls?: string
      }>(
        'INSERT INTO Tileset (id, tilejson, format, upstreamTileUrls) ' +
          'VALUES (:id, :tilejson, :format, :upstreamTileUrls)'
      ).run({
        id: tilesetId,
        format: tilejson.format,
        tilejson: JSON.stringify(tilejson),
        upstreamTileUrls,
      })

      return {
        ...tilejson,
        id: tilesetId,
        tiles: [getTileUrl(tilesetId)],
      }
    },

    async putTileset(id, tilejson) {
      if (id !== tilejson.id) {
        throw new MismatchedIdError(id, tilejson.id)
      }

      if (!tilesetExists(id)) {
        throw new NotFoundError(id)
      }

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
        tilejson: JSON.stringify(tilejson),
        upstreamTileUrls:
          tilejson.tiles.length === 0
            ? undefined
            : JSON.stringify(tilejson.tiles),
      })

      mem.clear(memoizedGetTilesetInfo)

      const result = {
        ...tilejson,
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

      let tilejson: TileJSON

      try {
        tilejson = JSON.parse(row.tilejson)
      } catch (err) {
        throw new ParseError(err)
      }

      async function fetchOnlineResource(url: string, etag?: string) {
        const { data } = await upstreamRequestsManager.getUpstream({
          url,
          etag,
          responseType: 'json',
        })

        if (!validateTileJSON(data)) {
          // TODO: Do we want to throw here?
          throw new UpstreamJsonValidationError(url, validateTileJSON.errors)
        }

        if (data) api.putTileset(id, data)
      }

      if (row.upstreamUrl) {
        fetchOnlineResource(row.upstreamUrl, row.etag).catch(noop)
      }

      return { ...tilejson, tiles: [getTileUrl(id)], id }
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
        headers: { ...getTileHeaders(tile.data), Etag: tile.etag },
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
    // TODO: Ideally could consolidate with createStyle
    async createStyleForTileset(tilesetId, nameForStyle) {
      const styleId = encodeBase32(hash(`style:${tilesetId}`))

      // TODO: Come up with better default name?
      const styleName = nameForStyle || `Style ${tilesetId.slice(-4)}`

      const style = createRasterStyle({
        name: styleName,
        url: `mapeo://tilesets/${tilesetId}`,
      })

      db.prepare<{
        id: string
        sourceIdToTilesetId: string
        stylejson: string
      }>(
        'INSERT INTO Style (id, sourceIdToTilesetId, stylejson) VALUES (:id, :sourceIdToTilesetId, :stylejson)'
      ).run({
        id: styleId,
        sourceIdToTilesetId: JSON.stringify({
          [DEFAULT_RASTER_SOURCE_ID]: tilesetId,
        }),
        stylejson: JSON.stringify(style),
      })

      return { id: styleId, style }
    },
    async createStyle(style, { accessToken, etag, id, upstreamUrl } = {}) {
      const styleId =
        id || (upstreamUrl ? createIdFromStyleUrl(upstreamUrl) : generateId())

      if (styleExists(styleId)) {
        throw new AlreadyExistsError(
          `Style already exists. PUT changes to ${fastify.prefix}/${styleId} to modify this style`
        )
      }

      const sourceIdToTilesetId = await createOfflineSources({
        accessToken,
        sources: style.sources,
      })

      const styleToSave: StyleJSON = await uncompositeStyle(style)

      db.prepare<{
        id: string
        stylejson: string
        etag?: string
        upstreamUrl?: string
        sourceIdToTilesetId: string
      }>(
        'INSERT INTO Style (id, stylejson, etag, upstreamUrl, sourceIdToTilesetId) VALUES (:id, :stylejson, :etag, :upstreamUrl, :sourceIdToTilesetId)'
      ).run({
        id: styleId,
        stylejson: JSON.stringify(styleToSave),
        etag,
        upstreamUrl,
        sourceIdToTilesetId: JSON.stringify(sourceIdToTilesetId),
      })

      return {
        style: addOfflineUrls({
          sourceIdToTilesetId,
          style: styleToSave,
        }),
        id: styleId,
      }
    },

    // TODO: May need to accept an access token
    async updateStyle(id, style) {
      if (!styleExists(id)) {
        throw new NotFoundError(id)
      }

      const sourceIdToTilesetId = await createOfflineSources({
        sources: style.sources,
      })

      const styleToSave: StyleJSON = await uncompositeStyle(style)

      db.prepare<{
        id: string
        sourceIdToTilesetId: string
        stylejson: string
      }>(
        'UPDATE Style SET stylejson = :stylejson, sourceIdToTilesetId = :sourceIdToTilesetId WHERE id = :id'
      ).run({
        id,
        sourceIdToTilesetId: JSON.stringify(sourceIdToTilesetId),
        stylejson: JSON.stringify(styleToSave),
      })

      return addOfflineUrls({
        sourceIdToTilesetId,
        style: styleToSave,
      })
    },

    async listStyles() {
      return db
        .prepare(
          "SELECT Style.id, json_extract(stylejson, '$.name') as name FROM Style"
        )
        .all()
        .map((row: { id: string; name?: string }) => ({
          ...row,
          url: getStyleUrl(row.id),
        }))
    },

    async getStyle(id) {
      const row:
        | {
            id: string
            stylejson: string
            sourceIdToTilesetId: string
          }
        | undefined = db
        .prepare(
          'SELECT id, stylejson, sourceIdToTilesetId FROM Style WHERE id = ?'
        )
        .get(id)

      if (!row) {
        throw new NotFoundError(id)
      }

      let style: StyleJSON
      let sourceIdToTilesetId: SourceIdToTilesetId

      try {
        style = JSON.parse(row.stylejson)
        sourceIdToTilesetId = JSON.parse(row.sourceIdToTilesetId)
      } catch (err) {
        throw new ParseError(err)
      }

      return addOfflineUrls({
        sourceIdToTilesetId,
        style,
      })
    },
    async deleteStyle(id: string) {
      if (!styleExists(id)) {
        throw new NotFoundError(id)
      }

      // TODO
      // - Delete any orphaned tilesets and sprites
      // - How to handle glpyhs here?
      const deleteStyleTransaction = db.transaction(() => {
        db.prepare(
          'DELETE FROM Import WHERE areaId IN (SELECT id FROM OfflineArea WHERE styleId = ?)'
        ).run(id)
        db.prepare('DELETE FROM OfflineArea WHERE styleId = ?').run(id)
        db.prepare('DELETE FROM Style WHERE id = ?').run(id)
      })

      deleteStyleTransaction()
    },
  }
  return api
}

const ApiPlugin: FastifyPluginAsync<MapServerOptions> = async (
  fastify,
  { dbPath }
) => {
  if (dbPath == null)
    throw new Error('Map server option `dbPath` must be specified')

  // Create context once for each fastify instance
  const context = init(dbPath)

  fastify.addHook('onClose', async () => {
    const { piscina, db } = context
    await piscina.destroy()
    db.close()
  })

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

function init(dbPath: string): Context {
  const db = new Database(dbPath)

  // Enable auto-vacuum by setting it to incremental mode
  // This has to be set before the anything on the db instance is called!
  // https://www.sqlite.org/pragma.html#pragma_auto_vacuum
  // https://www.sqlite.org/pragma.html#pragma_incremental_vacuum
  db.pragma('auto_vacuum = INCREMENTAL')

  // Enable WAL for potential performance benefits
  // https://github.com/JoshuaWise/better-sqlite3/blob/master/docs/performance.md
  db.pragma('journal_mode = WAL')

  migrate(db, path.resolve(__dirname, '../prisma/migrations'))

  const piscina = new Piscina({
    filename: path.resolve(__dirname, './lib/mbtiles_import_worker.js'),
  })
  piscina.on('error', (error) => {
    // TODO: Do something with this error https://github.com/piscinajs/piscina#event-error
    console.error(error)
  })
  return {
    piscina,
    db,
    upstreamRequestsManager: new UpstreamRequestsManager(),
  }
}

function noop() {}
