import { normalizeTileURL } from '../lib/mapbox_urls'
import { Headers } from '../lib/mbtiles'
import {
  getInterpolatedUpstreamTileUrl,
  getTileHeaders,
  tileToQuadKey,
} from '../lib/tiles'
import { hash, noop } from '../lib/utils'
import { Api, Context } from '.'
import { NotFoundError } from './errors'

interface SharedTileParams {
  tilesetId: string
  zoom: number
  x: number
  y: number
}

export interface TilesApi {
  getTile(
    opts: SharedTileParams & { accessToken?: string }
  ): Promise<{ data: Buffer; headers: Headers }>
  putTile(
    opts: SharedTileParams & {
      data: Buffer
      etag?: string
    }
  ): void
}

function createTilesApi({
  api,
  context,
}: {
  api: Pick<Api, 'getTilesetInfo'>
  context: Context
}): TilesApi {
  const { db, upstreamRequestsManager } = context

  function createUpstreamTileUrl({
    tilesetId,
    zoom,
    x,
    y,
    accessToken,
  }: SharedTileParams & { accessToken?: string }) {
    const { tilejson, upstreamTileUrls } = api.getTilesetInfo(tilesetId)

    if (!upstreamTileUrls) return

    return getInterpolatedUpstreamTileUrl({
      tiles: upstreamTileUrls,
      scheme: tilejson.scheme,
      zoom,
      x,
      y,
      accessToken,
    })
  }

  async function getUpstreamTile({
    accessToken,
    etag,
    ...tileParams
  }: SharedTileParams & {
    accessToken?: string
    etag?: string
  }): Promise<
    | {
        data: Buffer
        etag?: string
      }
    | undefined
  > {
    const upstreamTileUrl = createUpstreamTileUrl({
      ...tileParams,
      accessToken,
    })

    // TODO: Should we throw here instead?
    if (!upstreamTileUrl) return

    // We may want to check if an access token is needed before making the request
    // but it seems that for some external tile APIs, the access token isn't needed
    // so we don't want to throw an error too early if that's the case

    const normalizedUpstreamUrl = normalizeTileURL(upstreamTileUrl)

    const response = await upstreamRequestsManager.getUpstream({
      url: normalizedUpstreamUrl,
      etag,
      responseType: 'buffer',
    })

    return { data: response.data, etag: response.etag }
  }

  const tilesApi: TilesApi = {
    async getTile({ tilesetId, zoom, x, y, accessToken }) {
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

      let tile: { data: Buffer; etag?: string } | undefined

      if (row) {
        tile = { data: row.data, etag: row.etag }
        getUpstreamTile({ tilesetId, zoom, x, y, etag: row.etag, accessToken })
          .then((resp) => {
            if (resp) {
              tilesApi.putTile({
                tilesetId,
                zoom,
                x,
                y,
                data: resp.data,
                etag: resp.etag,
              })
            }
          })
          // TODO: Log error
          .catch(noop)
      } else {
        tile = await getUpstreamTile({ tilesetId, zoom, x, y, accessToken })

        if (tile) {
          tilesApi.putTile({
            tilesetId,
            zoom,
            x,
            y,
            data: tile.data,
            etag: tile.etag,
          })
        } else {
          throw new NotFoundError(
            `Tileset id = ${tilesetId}, [${zoom}, ${x}, ${y}]`
          )
        }
      }

      return {
        data: tile.data,
        // TODO: This never returns a Last-Modified header but seems like the endpoint would want it to if possible?
        // Would require changing the return type of UpstreamRequestsManager.getUpstream
        headers: { ...getTileHeaders(tile.data), Etag: tile.etag },
      }
    },
    putTile({ tilesetId, zoom, x, y, data, etag }) {
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
  }

  return tilesApi
}

export default createTilesApi
