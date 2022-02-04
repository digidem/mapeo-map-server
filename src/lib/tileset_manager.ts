/**
 * A sort of Data Access Object for tilesets
 * https://en.wikipedia.org/wiki/Data_access_object
 * https://www.oracle.com/java/technologies/data-access-object.html
 */
import { Headers } from '@mapbox/mbtiles'
import { tileToQuadkey } from '@mapbox/tilebelt'
import tiletype from '@mapbox/tiletype'
import { getTileBBox } from '@mapbox/whoots-js'
import { Database } from 'better-sqlite3'

import { SWRCacheV2 } from './swr_cache'
import { TileJSON } from './tilejson'
import { encodeBase32, hash } from './utils'

export class TilesetManager {
  #tilesetId: string
  #db: Database
  #swrCache: SWRCacheV2<Buffer>

  constructor({
    id,
    db,
    swrCache,
  }: {
    /** Tileset ID */
    id: string
    db: Database
    /** Stale-While-Revalidate cache instance */
    swrCache: SWRCacheV2<Buffer>
  }) {
    this.#tilesetId = id
    this.#swrCache = swrCache
    this.#db = db
  }

  get hasExistingTileset() {
    return (
      this.#db
        .prepare('SELECT COUNT(*) as count FROM Tileset WHERE id = ?')
        .get(this.#tilesetId).count > 0
    )
  }

  async getTile(
    z: number,
    x: number,
    y: number,
    {
      forceOffline,
    }: {
      forceOffline?: boolean
    } = {}
  ): Promise<{ data: Buffer; headers: Headers } | void> {
    const tileUrl = await this.getTileUrl(z, x, y)
    const quadKey = tileToQuadkey([x, y, z])

    if (tileUrl && !forceOffline) {
      // TODO: does the etag come into play here?
      const cacheResult = await this.#swrCache.get(tileUrl, {
        upstreamResponseType: 'buffer',
        get: async () => {
          const tile: { data: Buffer } = this.#db
            .prepare<{
              tilesetId: string
              quadKey: string
            }>(
              'SELECT data FROM TileData ' +
                'JOIN Tile ON TileData.tileHash = Tile.tileHash ' +
                'JOIN Tileset ON Tile.tilesetId = Tileset.id ' +
                'WHERE Tileset.id = :tilesetId AND Tile.quadKey = :quadKey'
            )
            .get({ tilesetId: this.#tilesetId, quadKey })

          // TODO: Need to throw more specific error here?
          if (!tile) {
            throw new Error('Tile not found in cache')
          }

          return { data: tile.data }
        },
        put: async ({ data, etag, url }) => {
          const transaction = this.#db.transaction(() => {
            const tileHash = hash(data).toString('hex')

            this.#db
              .prepare<{
                tileHash: string
                tilesetId: string
                data: Buffer
              }>(
                'INSERT INTO Tile (tileHash, tilesetId, data) VALUES (:tileHash, :tilesetId, :data)'
              )
              .run({ tileHash, tilesetId: this.#tilesetId, data })

            this.#db
              .prepare<{
                etag?: string
                tilesetId: string
                upstreamUrl: string
              }>(
                'UPDATE Tileset SET (etag, upstreamUrl) = (:etag, :upstreamUrl) WHERE id = :tilesetId'
              )
              .run({
                etag,
                tilesetId: this.#tilesetId,
                upstreamUrl: url,
              })

            this.#db
              .prepare<{
                quadKey: string
                tileHash: string
                tilesetId: string
              }>(
                'INSERT INTO Tile VALUES (quadKey, tileHash, tilesetId) VALUES (:quadKey, :tileHash, :tilesetId)'
              )
              .run({
                quadKey,
                tileHash,
                tilesetId: this.#tilesetId,
              })
          })

          transaction()
        },
      })

      return cacheResult
        ? {
            data: cacheResult.data,
            headers: tiletype.headers(cacheResult.data),
          }
        : undefined
    } else {
      const quadKey = tileToQuadkey([x, y, z])

      const tile: { data: Buffer } | undefined = this.#db
        .prepare<{
          tilesetId: string
          quadKey: string
        }>(
          'SELECT data FROM TileData ' +
            'JOIN Tile ON TileData.tileHash = Tile.tileHash ' +
            'JOIN Tileset ON Tile.tilesetId = Tileset.id ' +
            'WHERE Tileset.id = :tilesetId AND Tile.quadKey = :quadKey'
        )
        .get({ tilesetId: this.#tilesetId, quadKey })

      // TODO: Need to throw more specific error here?
      if (!tile) {
        throw new Error('Tile not found in cache')
      }

      return { data: tile.data, headers: tiletype.headers(tile.data) }
    }
  }

  /**
   * Get the upstream tile URL for a particular tile
   */
  async getTileUrl(z: number, x: number, y: number): Promise<string | void> {
    // TODO: Support {ratio} in template URLs, not used in mapbox-gl-js, only in
    // the mobile SDKs
    const ratio = ''

    const tileset: { tilejson: string } | undefined = this.#db
      .prepare('SELECT tilejson FROM Tileset WHERE id = ?')
      .get(this.#tilesetId)

    // TODO: throw error about resource missing?
    if (!tileset) return

    const tilejson: TileJSON = JSON.parse(tileset.tilejson)

    const { scheme: upstreamScheme = 'xyz', tiles: templateUrls } = tilejson

    if (!isStringArray(templateUrls))
      return console.log('templateUrls', templateUrls)

    const bbox = getTileBBox(x, y, z)
    const quadkey = tileToQuadkey([x, y, z])

    return templateUrls[(x + y) % templateUrls.length]
      .replace('{prefix}', (x % 16).toString(16) + (y % 16).toString(16))
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace(
        '{y}',
        String(upstreamScheme === 'tms' ? Math.pow(2, z) - y - 1 : y)
      )
      .replace('{quadkey}', quadkey)
      .replace('{bbox-epsg-3857}', bbox)
      .replace('{ratio}', ratio ? `@${ratio}x` : '')
  }

  async getTileJSON(): Promise<TileJSON> {
    const row: { tilejson: string } | undefined = this.#db
      .prepare('SELECT tilejson FROM Tileset WHERE id = ?')
      .get(this.#tilesetId)

    if (!row) {
      throw new Error()
    }

    return {
      // tiles will be overwritten if it exists in the metadata, this is just a
      // fallback, since this is a required prop on TileJSON
      tiles: [],
      ...JSON.parse(row.tilejson),
      tilejson: '2.2.0',
    }
  }

  // TODO: is it okay for this to be an upsert?
  async putTileJSON(tilejson: TileJSON): Promise<void> {
    this.#db
      .prepare<{
        id: string
        format: TileJSON['format']
        tilejson: string
        upstreamTileUrls: string
      }>(
        'INSERT INTO Tileset (id, tilejson, format, upstreamTileUrls) ' +
          'VALUES (:id, :tilejson, :format, :upstreamTileUrls) ' +
          'ON CONFLICT DO UPDATE SET (tilejson, format, upstreamTileUrls) = (excluded.tilejson, excluded.format, excluded.upstreamTileUrls)'
      )
      .run({
        id: this.#tilesetId,
        format: tilejson.format,
        tilejson: JSON.stringify(tilejson),
        upstreamTileUrls: JSON.stringify(tilejson.tiles),
      })
  }
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((d) => typeof d === 'string')
  )
}

/**
 * Generate an idempotent unique id for a given tilejson. Not all tilejson has
 * an id field, so we use the tile URL as an identifier (assumes two tilejsons
 * refering to the same tile URL are the same)
 */
export function getTilesetId(tilejson: TileJSON): string {
  // If the tilejson has no id, use the tile URL as the id
  const id = tilejson.id || tilejson.tiles.sort()[0]
  return encodeBase32(hash(id))
}
