import { EventEmitter } from 'events'
import path from 'path'
import { MessageChannel, MessagePort } from 'worker_threads'
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
  isSupportedMBTilesFormat,
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
import {
  UpstreamRequestsManager,
  UpstreamResponse,
} from './lib/upstream_requests_manager'
import {
  isMapboxURL,
  normalizeSourceURL,
  normalizeSpriteURL,
} from './lib/mapbox_urls'
import { PortMessage } from './lib/mbtiles_import_worker'
import {
  convertActiveToError as convertActiveImportsToErrorImports,
  ImportRecord,
} from './lib/imports'
import {
  Sprite,
  UpstreamSpriteResponse,
  generateSpriteId,
  validateSpriteIndex,
} from './lib/sprites'

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

// Only format that is not supported right now is pbf
const UnsupportedMBTilesFormatError = createError(
  'FST_UNSUPPORTED_MBTILES_FORMAT',
  '`format` must be `jpg`, `png`, or `webp`',
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
  activeImports: Map<string, MessagePort>
  db: DatabaseInstance
  piscina: Piscina
  upstreamRequestsManager: UpstreamRequestsManager
}

// Any resource returned by the API will always have an `id` property
export interface IdResource {
  id: string
}
export interface Api {
  importMBTiles(
    filePath: string
  ): Promise<{ import: IdResource; tileset: TileJSON & IdResource }>
  getImport(importId: string): ImportRecord
  getImportPort(importId: string): MessagePort | undefined
  createTileset(tileset: TileJSON): TileJSON & IdResource
  putTileset(id: string, tileset: TileJSON): TileJSON & IdResource
  listTilesets(): Array<TileJSON & IdResource>
  getTileset(id: string): TileJSON & IdResource
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
  }): void
  createStyleForTileset(
    tilesetId: string,
    nameForStyle?: string
  ): { style: StyleJSON } & IdResource
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
  getStyle(id: string): StyleJSON
  deleteStyle(id: string): void
  listStyles(): Array<
    {
      bytesStored: number
      name: string | null
      url: string
    } & IdResource
  >
  createSprite(info: Sprite): Sprite & IdResource
  getSprite(
    id: string,
    pixelDensity: number,
    allowFallback?: boolean
  ): Sprite & IdResource
  updateSprite(
    id: string,
    pixelDensity: number,
    options: {
      layout: string
      data: Buffer
      etag?: string
      upstreamUrl?: string
    }
  ): Sprite & IdResource
  deleteSprite(id: string, pixelDensity?: number): void
  fetchUpstreamSprites(
    upstreamSpriteUrl: string,
    options?: {
      accessToken?: string
      etag?: string // etag for the 1x image asset
    }
  ): Promise<
    Map<number, UpstreamSpriteResponse> // Map of pixel density to the response result
  >
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
  const { activeImports, db, piscina, upstreamRequestsManager } = context
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

  function getSpriteUrl(styleId: string, spriteId: string): string {
    return `${getStyleUrl(styleId)}/sprites/${spriteId}`
  }

  function getGlyphsUrl(styleId: string): string {
    return `${apiUrl}/fonts/${styleId}/{fontstack}/{range}`
  }

  function addOfflineUrls({
    sourceIdToTilesetId,
    spriteId,
    style,
    styleId,
  }: {
    sourceIdToTilesetId: SourceIdToTilesetId
    spriteId?: string
    style: StyleJSON
    styleId: string
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

    // TODO: Remap glyphs URL to map server
    return {
      ...style,
      sources: updatedSources,
      sprite: spriteId ? getSpriteUrl(styleId, spriteId) : undefined,
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

  function spriteExists(spriteId: string, pixelDensity?: number) {
    const query =
      pixelDensity === undefined
        ? db
            .prepare('SELECT COUNT(*) AS count FROM Sprite WHERE id = ?')
            .bind(spriteId)
        : db
            .prepare<{ spriteId: string; pixelDensity: number }>(
              'SELECT COUNT(*) AS count FROM Sprite WHERE id = :spriteId AND pixelDensity = :pixelDensity'
            )
            .bind({ spriteId, pixelDensity })

    return query.get().count > 0
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
        api.createTileset(tilejson)
      } else {
        // TODO: Should we update an existing tileset here?
        // api.putTileset(tilesetId, tilejson)
      }
      sourceIdToTilesetId[sourceId] = tilesetId
    }

    return sourceIdToTilesetId
  }

  const api: Api = {
    importMBTiles(filePath: string) {
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
      const formatSupported =
        tilejson.format &&
        isValidMBTilesFormat(tilejson.format) &&
        isSupportedMBTilesFormat(tilejson.format)

      if (!formatSupported) {
        throw new UnsupportedMBTilesFormatError()
      }

      if (!validateTileJSON(tilejson)) {
        throw new MBTilesInvalidMetadataError()
      }

      const tilesetId = getTilesetId(tilejson)

      const tileset = api.createTileset(tilejson)

      const { id: styleId } = api.createStyleForTileset(
        tileset.id,
        tileset.name
      )

      const importId = generateId()

      const { port1, port2 } = new MessageChannel()

      activeImports.set(importId, port2)

      return new Promise((res, rej) => {
        let workerDone = false
        // Initially use a longer duration to account for worker startup
        let timeoutId = createTimeout(10000)

        port2.on('message', handleFirstProgressMessage)
        port2.on('message', resetTimeout)

        // Can use a normal event emitter that emits an `abort` event as the abort signaler for Piscina,
        // which allows us to not have to worry about globals or relying on polyfills
        // https://github.com/piscinajs/piscina#cancelable-tasks
        const abortSignaler = new EventEmitter()

        piscina
          .run(
            {
              dbPath: db.name,
              importId,
              mbTilesDbPath: mbTilesDb.name,
              styleId,
              tilesetId,
              port: port1,
            },
            { signal: abortSignaler, transferList: [port1] }
          )
          .catch((err) => {
            // FYI this will be called when piscina.destroy() in the onClose hook
            rej(err)
          })
          .finally(() => {
            cleanup()
            workerDone = true
          })

        function handleFirstProgressMessage(message: PortMessage) {
          if (message.type === 'progress') {
            port2.off('message', handleFirstProgressMessage)
            res({ import: { id: message.importId }, tileset })
          }
        }

        function cleanup() {
          clearTimeout(timeoutId)
          port2.off('message', resetTimeout)
          port2.close()
          activeImports.delete(importId)
        }

        function onMessageTimeout() {
          if (workerDone) return

          cleanup()

          abortSignaler.emit('abort')

          try {
            db.prepare(
              "UPDATE Import SET state = 'error', finished = CURRENT_TIMESTAMP, error = 'TIMEOUT' WHERE id = ?"
            ).run(importId)
          } catch (err) {
            // TODO: This could potentially throw when the db is closed already. Need to properly handle/report
            console.error(err)
          }

          rej(new Error('Timeout reached while waiting for worker message'))
        }

        function createTimeout(durationMs: number) {
          return setTimeout(onMessageTimeout, durationMs)
        }

        function resetTimeout() {
          clearTimeout(timeoutId)
          // Use shorter duration since worker should be up and running at this point
          timeoutId = createTimeout(5000)
        }
      })
    },
    getImport(importId) {
      const row: ImportRecord | undefined = db
        .prepare(
          'SELECT state, error, importedResources, totalResources, importedBytes, totalBytes, ' +
            'started, finished, lastUpdated FROM Import WHERE id = ?'
        )
        .get(importId)

      if (!row) {
        throw NotFoundError(importId)
      }

      return row
    },
    getImportPort(importId) {
      return activeImports.get(importId)
    },
    createTileset(tilejson) {
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

    putTileset(id, tilejson) {
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

    listTilesets() {
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

    getTileset(id) {
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
            try {
              api.putTile({
                tilesetId,
                zoom,
                x,
                y,
                data: response.data,
                etag: response.etag,
              })
            } catch (_err) {
              // TODO: Handle error here?
              noop()
            }

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

    putTile({ tilesetId, zoom, x, y, data, etag }) {
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
    createStyleForTileset(tilesetId, nameForStyle) {
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

      const spriteId = style.sprite ? generateSpriteId(style.sprite) : undefined

      const sourceIdToTilesetId = await createOfflineSources({
        accessToken,
        sources: style.sources,
      })

      const styleToSave: StyleJSON = await uncompositeStyle(style)

      db.prepare<{
        id: string
        stylejson: string
        spriteId?: string
        etag?: string
        upstreamUrl?: string
        sourceIdToTilesetId: string
      }>(
        'INSERT INTO Style (id, stylejson, spriteId, etag, upstreamUrl, sourceIdToTilesetId) ' +
          'VALUES (:id, :stylejson, :spriteId, :etag, :upstreamUrl, :sourceIdToTilesetId)'
      ).run({
        id: styleId,
        stylejson: JSON.stringify(styleToSave),
        spriteId,
        etag,
        upstreamUrl,
        sourceIdToTilesetId: JSON.stringify(sourceIdToTilesetId),
      })

      return {
        id: styleId,
        style: addOfflineUrls({
          sourceIdToTilesetId,
          spriteId,
          style: styleToSave,
          styleId,
        }),
      }
    },
    async updateStyle(id, style) {
      if (!styleExists(id)) {
        throw new NotFoundError(id)
      }

      const sourceIdToTilesetId = await createOfflineSources({
        sources: style.sources,
      })

      const spriteId = style.sprite ? generateSpriteId(style.sprite) : undefined

      const styleToSave: StyleJSON = await uncompositeStyle(style)

      db.prepare<{
        id: string
        sourceIdToTilesetId: string
        spriteId?: string
        stylejson: string
      }>(
        'UPDATE Style SET stylejson = :stylejson, sourceIdToTilesetId = :sourceIdToTilesetId, spriteId = :spriteId ' +
          'WHERE id = :id'
      ).run({
        id,
        sourceIdToTilesetId: JSON.stringify(sourceIdToTilesetId),
        spriteId,
        stylejson: JSON.stringify(styleToSave),
      })

      return addOfflineUrls({
        sourceIdToTilesetId,
        spriteId,
        style: styleToSave,
        styleId: id,
      })
    },
    listStyles() {
      // `bytesStored` calculates the total bytes stored by tiles that the style references
      // Eventually we want to get storage taken up by other resources like sprites and glyphs
      return db
        .prepare(
          `SELECT Style.id,
            json_extract(Style.stylejson, '$.name') as name,
            (
              SELECT sum(length(TileData.data))
              FROM TileData
              WHERE TileData.tilesetId IN (
                SELECT DISTINCT json_each.value
                FROM Style S2, json_each(S2.sourceIdToTilesetId, '$')
                WHERE S2.id = Style.id)
            ) AS bytesStored
          FROM Style;`
        )
        .all()
        .map(
          (row: {
            id: string
            bytesStored: number | null
            name: string | null
          }) => ({
            ...row,
            bytesStored: row.bytesStored || 0,
            url: getStyleUrl(row.id),
          })
        )
    },

    getStyle(id) {
      const row:
        | {
            id: string
            stylejson: string
            sourceIdToTilesetId: string
            spriteId: string | null
          }
        | undefined = db
        .prepare(
          'SELECT id, stylejson, sourceIdToTilesetId, spriteId FROM Style WHERE id = ?'
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
        spriteId: row.spriteId || undefined,
        style,
        styleId: id,
      })
    },
    deleteStyle(id: string) {
      if (!styleExists(id)) {
        throw new NotFoundError(id)
      }

      // TODO Delete any orphaned tilesets. Also how do we handle glyphs here?
      const deleteStyleTransaction = db.transaction(() => {
        db.prepare(
          'DELETE FROM Import WHERE areaId IN (SELECT id FROM OfflineArea WHERE styleId = ?)'
        ).run(id)
        db.prepare('DELETE FROM OfflineArea WHERE styleId = ?').run(id)
        db.prepare(
          'DELETE FROM Sprite WHERE Sprite.id IN (SELECT spriteId FROM Style WHERE Style.id = ?)'
        ).run(id)
        db.prepare('DELETE FROM Style WHERE id = ?').run(id)
      })

      deleteStyleTransaction()
    },
    createSprite(info: Sprite) {
      if (spriteExists(info.id, info.pixelDensity)) {
        throw new AlreadyExistsError(info.id)
      }

      db.prepare<Sprite>(
        'INSERT INTO Sprite (id, pixelDensity, data, layout, etag, upstreamUrl) ' +
          'VALUES (:id, :pixelDensity, :data, :layout, :etag, :upstreamUrl)'
      ).run(info)

      return info
    },
    // if `allowFallback` is true, may return highest available pixel density that's less than the requested one
    getSprite(id, pixelDensity, allowFallback = false) {
      const row: Sprite | undefined = db
        .prepare<{ id: string; pixelDensity: number }>(
          `SELECT * FROM Sprite WHERE id = :id AND pixelDensity ${
            allowFallback ? '<=' : '='
          } :pixelDensity LIMIT 1`
        )
        .get({
          id,
          pixelDensity,
        })

      if (!row) {
        throw new NotFoundError(id)
      }

      return row
    },
    deleteSprite(id, pixelDensity) {
      if (!spriteExists(id, pixelDensity)) {
        throw new NotFoundError(id)
      }

      const query =
        pixelDensity === undefined
          ? db.prepare('DELETE FROM Sprite WHERE id = :id').bind(id)
          : db
              .prepare<{ id: string; pixelDensity: number }>(
                'DELETE FROM Sprite WHERE id = :id AND pixelDensity = :pixelDensity'
              )
              .bind({
                id,
                pixelDensity,
              })

      query.run()
    },
    updateSprite(id, pixelDensity, options) {
      if (!spriteExists(id, pixelDensity)) {
        throw new NotFoundError(id)
      }

      const spriteToSave: Sprite = {
        ...options,
        etag: options.etag || null,
        upstreamUrl: options.upstreamUrl || null,
        id,
        pixelDensity,
      }

      db.prepare<Sprite>(
        'UPDATE Sprite SET data = :data, layout = :layout, etag = :etag, upstreamUrl = :upstreamUrl ' +
          'WHERE id = :id AND pixelDensity = :pixelDensity'
      ).run(spriteToSave)

      return spriteToSave
    },
    async fetchUpstreamSprites(upstreamSpriteUrl, { accessToken, etag } = {}) {
      if (isMapboxURL(upstreamSpriteUrl) && !accessToken) {
        throw new MBAccessTokenRequiredError()
      }

      // Download the sprite layout and image for both 1x and 2x pixel densities
      const upstreamRequests1x = Promise.all([
        upstreamRequestsManager.getUpstream({
          url: normalizeSpriteURL(upstreamSpriteUrl, '', '.json', accessToken),
          responseType: 'json',
        }),
        upstreamRequestsManager.getUpstream({
          url: normalizeSpriteURL(upstreamSpriteUrl, '', '.png', accessToken),
          responseType: 'buffer',
          // We only keep track of the etag for the 1x image asset
          etag,
        }),
      ])

      const upstreamRequests2x = Promise.all([
        upstreamRequestsManager.getUpstream({
          url: normalizeSpriteURL(
            upstreamSpriteUrl,
            '@2x',
            '.json',
            accessToken
          ),
          responseType: 'json',
        }),
        upstreamRequestsManager.getUpstream({
          url: normalizeSpriteURL(
            upstreamSpriteUrl,
            '@2x',
            '.png',
            accessToken
          ),
          responseType: 'buffer',
        }),
      ])

      const [responses1x, responses2x] = await Promise.allSettled([
        upstreamRequests1x,
        upstreamRequests2x,
      ])

      const extractedSprite1x = processUpstreamSpriteResponse(responses1x)
      const extractedSprite2x = processUpstreamSpriteResponse(responses2x)

      const upstreamSprites: Awaited<ReturnType<Api['fetchUpstreamSprites']>> =
        new Map()

      if (extractedSprite1x) {
        upstreamSprites.set(1, extractedSprite1x)
      }

      if (extractedSprite2x) {
        upstreamSprites.set(2, extractedSprite2x)
      }

      return upstreamSprites

      function processUpstreamSpriteResponse(
        settledResponseResult: PromiseSettledResult<
          [UpstreamResponse<'json'>, UpstreamResponse<'buffer'>]
        >
      ): UpstreamSpriteResponse | null {
        // This means that the asset was not modified upstream
        if (settledResponseResult.status === 'rejected') return null

        const [layoutAssetResponse, imageAssetResponse] =
          settledResponseResult.value

        if (!validateSpriteIndex(layoutAssetResponse.data)) {
          return new UpstreamJsonValidationError(
            upstreamSpriteUrl,
            validateSpriteIndex.errors
          )
        }

        return {
          layout: layoutAssetResponse.data,
          data: imageAssetResponse.data,
          etag: imageAssetResponse.etag,
        }
      }
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

  // Any import with an `active` state on startup most likely failed due to the server process stopping
  // so we update these import records to have an error state
  convertActiveImportsToErrorImports(db)

  const piscina = new Piscina({
    filename: path.resolve(__dirname, './lib/mbtiles_import_worker.js'),
  })
  piscina.on('error', (error) => {
    // TODO: Do something with this error https://github.com/piscinajs/piscina#event-error
    console.error(error)
  })
  return {
    activeImports: new Map(),
    db,
    piscina,
    upstreamRequestsManager: new UpstreamRequestsManager(),
  }
}

function noop() {}
