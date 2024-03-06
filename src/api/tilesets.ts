import mem from 'mem'
import QuickLRU from 'quick-lru'

import { TileJSON, validateTileJSON } from '../lib/tilejson'
import { getTilesetId, noop } from '../lib/utils'
import { Context, IdResource } from '.'
import {
  AlreadyExistsError,
  MismatchedIdError,
  NotFoundError,
  ParseError,
  UpstreamJsonValidationError,
} from './errors'

export interface TilesetsApi {
  createTileset(
    tileset: Readonly<TileJSON>,
    baseApiUrl: string,
    // `upstreamUrl` should be an http-based url
    // e.g. for a mapbox url, it should be "https://api.mapbox.com/..."
    options?: { etag?: string; upstreamUrl?: string }
  ): TileJSON & IdResource
  getTileset(id: string, baseApiUrl: string): TileJSON & IdResource
  getTilesetInfo(id: string): {
    tilejson: TileJSON
    upstreamTileUrls: TileJSON['tiles'] | undefined
  }
  listTilesets(baseApiUrl: string): Array<TileJSON & IdResource>
  putTileset(
    id: string,
    tileset: TileJSON,
    baseApiUrl: string,
    options?: { etag?: string | null }
  ): TileJSON & IdResource
}

function createTilesetsApi({ context }: { context: Context }): TilesetsApi {
  const { db, upstreamRequestsManager } = context

  function getTileUrl(baseApiUrl: string, tilesetId: string): string {
    return `${baseApiUrl}/tilesets/${tilesetId}/{z}/{x}/{y}`
  }

  function tilesetExists(tilesetId: string) {
    return (
      db
        .prepare('SELECT EXISTS (SELECT 1 FROM Tileset WHERE id = ?)')
        .pluck()
        .get(tilesetId) !== 0
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

  async function fetchUpstreamTilejson(
    url: string,
    etag?: string
  ): Promise<{ tilejson: TileJSON; etag?: string }> {
    const response = await upstreamRequestsManager.getUpstream({
      url,
      etag,
      responseType: 'json',
    })

    if (!validateTileJSON(response.data)) {
      throw new UpstreamJsonValidationError(url, validateTileJSON.errors)
    }

    return { tilejson: response.data, etag: response.etag }
  }

  const tilesetsApi: TilesetsApi = {
    createTileset(tilejson, baseApiUrl, { etag, upstreamUrl } = {}) {
      const tilesetId = getTilesetId(tilejson)

      if (tilesetExists(tilesetId)) {
        throw new AlreadyExistsError(
          `A tileset based on tiles ${tilejson.tiles[0]} already exists. PUT changes to /tilesets/${tilesetId} to modify this tileset`
        )
      }

      const upstreamTileUrls =
        tilejson.tiles.length === 0 ? undefined : JSON.stringify(tilejson.tiles)

      db.prepare<{
        id: string
        format: TileJSON['format']
        tilejson: string
        upstreamTileUrls?: string
        upstreamUrl?: string
        etag?: string
      }>(
        'INSERT INTO Tileset (id, tilejson, format, upstreamTileUrls, upstreamUrl, etag) ' +
          'VALUES (:id, :tilejson, :format, :upstreamTileUrls, :upstreamUrl, :etag)'
      ).run({
        id: tilesetId,
        format: tilejson.format,
        tilejson: JSON.stringify(tilejson),
        upstreamTileUrls,
        upstreamUrl,
        etag,
      })

      return {
        ...tilejson,
        id: tilesetId,
        tiles: [getTileUrl(baseApiUrl, tilesetId)],
      }
    },
    getTileset(id, baseApiUrl) {
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

      // The saved upstreamUrl should be the normalized url
      // which will contain an access token if needed
      if (row.upstreamUrl) {
        fetchUpstreamTilejson(row.upstreamUrl, row.etag)
          .then(({ tilejson, etag }) => {
            tilesetsApi.putTileset(id, tilejson, baseApiUrl, { etag })
          })
          // TODO: Log error
          .catch(noop)
      }

      return { ...tilejson, tiles: [getTileUrl(baseApiUrl, id)], id }
    },
    getTilesetInfo: memoizedGetTilesetInfo,
    listTilesets(baseApiUrl: string) {
      const tilesets: (TileJSON & IdResource)[] = []

      db.prepare('SELECT id, tilejson FROM Tileset')
        .all()
        .forEach(({ id, tilejson }: { id: string; tilejson: string }) => {
          try {
            const tileset: TileJSON = JSON.parse(tilejson)

            tilesets.push({
              ...tileset,
              tiles: [getTileUrl(baseApiUrl, id)],
              id,
            })
          } catch (err) {
            // TODO: What should we do here? e.g. omit or throw?
          }
        })

      return tilesets
    },
    putTileset(id, tilejson, baseApiUrl, { etag } = {}) {
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

      // We only update the etag if one is explicitly passed as a string or null value
      if (etag !== undefined) {
        db.prepare<{ id: string; etag: string | null }>(
          'UPDATE Tileset SET etag = :etag WHERE id = :id'
        ).run({ id, etag })
      }

      mem.clear(memoizedGetTilesetInfo)

      const result = {
        ...tilejson,
        tiles: [getTileUrl(baseApiUrl, id)],
        id,
      }

      return result
    },
  }

  return tilesetsApi
}

export default createTilesetsApi
