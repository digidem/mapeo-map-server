import { FastifyInstance } from 'fastify'
import mem from 'mem'
import QuickLRU from 'quick-lru'

import { TileJSON, validateTileJSON } from '../lib/tilejson'
import { getTilesetId } from '../lib/utils'
import { Context, IdResource } from '.'
import {
  AlreadyExistsError,
  MismatchedIdError,
  NotFoundError,
  ParseError,
  UpstreamJsonValidationError,
} from './errors'

function noop() {}

export interface TilesetsApi {
  createTileset(tileset: TileJSON): TileJSON & IdResource
  getTileset(id: string): TileJSON & IdResource
  getTilesetInfo(id: string): {
    tilejson: TileJSON
    upstreamTileUrls: TileJSON['tiles'] | undefined
  }
  listTilesets(): Array<TileJSON & IdResource>
  putTileset(id: string, tileset: TileJSON): TileJSON & IdResource
}

function createTilesetsApi({
  apiUrl,
  context,
  fastify,
}: {
  apiUrl: string
  context: Context
  fastify: FastifyInstance
}): TilesetsApi {
  const { db, upstreamRequestsManager } = context

  function getTileUrl(tilesetId: string): string {
    return `${apiUrl}/tilesets/${tilesetId}/{z}/{x}/{y}`
  }

  function tilesetExists(tilesetId: string) {
    return (
      db
        .prepare('SELECT COUNT(*) AS count FROM Tileset WHERE id = ?')
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

  const tilesetsApi: TilesetsApi = {
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

        if (data) tilesetsApi.putTileset(id, data)
      }

      if (row.upstreamUrl) {
        fetchOnlineResource(row.upstreamUrl, row.etag).catch(noop)
      }

      return { ...tilejson, tiles: [getTileUrl(id)], id }
    },
    getTilesetInfo: memoizedGetTilesetInfo,
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
  }

  return tilesetsApi
}

export default createTilesetsApi
