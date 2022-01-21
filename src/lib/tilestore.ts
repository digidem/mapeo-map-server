import path from 'path'
import { promisify } from 'util'

import MBTiles, { Headers, Metadata, MetadataGet } from '@mapbox/mbtiles'
import { tileToQuadkey } from '@mapbox/tilebelt'
import tiletype from '@mapbox/tiletype'
import { getTileBBox } from '@mapbox/whoots-js'
import pick from 'lodash/pick'
import omit from 'lodash/omit'

import SWRCache, { SWRCacheV2 } from './swr_cache'
import { TileJSON } from './tilejson'
import { hash, generateId, encodeBase32 } from './utils'
import { Database } from 'better-sqlite3'

type Mode = 'ro' | 'rw' | 'rwc'

/**
 * A wrapper around node-mbtiles that does not rely on a callback from the
 * constructor (no need to wait before calling methods) and promisifies all
 * methods
 */
class Tilestore {
  #mbtiles: Promise<MBTiles>
  // Cached metadata from mbtiles, for faster lookups
  #metadata: Promise<MetadataGet>
  #swrCache: SWRCache

  constructor({
    id,
    mode,
    dir,
    swrCache,
  }: {
    /** Tilestore ID */
    id: string
    /** Whether to open in read-only, read-write, or read-write + create if missing */
    mode: Mode
    /** Path to folder to store mbtiles file */
    dir: string
    /** Stale-While-Revalidate cache instance */
    swrCache: SWRCache
  }) {
    this.#swrCache = swrCache
    this.#mbtiles = new Promise<MBTiles>((resolve, reject) => {
      // Create with batch=1 so that writes are committed immediately TODO: This
      // is not efficient, but it ensures writes always happen without needing
      // to call stopWriting()
      const uri = path.join(dir, id) + '.mbtiles?batch=1&mode=' + mode
      new MBTiles(uri, (err, mbtiles) => {
        if (err) return reject(err)
        // Leave in write mode, since we will be writing to this frequently, all
        // this does is turn off synchronous mode for writes, it makes no
        // difference to reads
        mbtiles.startWriting((err) => {
          if (err) reject(err)
          else resolve(mbtiles)
        })
      })
    })
    this.#metadata = this.#mbtiles.then((mbtiles) =>
      promisify(mbtiles.getInfo.bind(mbtiles))()
    )
    // Swallow unhandled rejections in constructor. If these do reject, then the
    // other methods will throw, but we don't want to them to throw here.
    this.#mbtiles.catch(() => {})
    this.#metadata.catch(() => {})
  }

  async ready(): Promise<void> {
    await this.#mbtiles
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
  ): Promise<{ data: Buffer; headers: Headers }> {
    const tileUrl = await this.getTileUrl(z, x, y)
    if (tileUrl && !forceOffline) {
      const data = await this.#swrCache.get(tileUrl, {
        cacheGet: () => this.getMBTilesTile(z, x, y).then(({ data }) => data),
        cachePut: (buf) => this.putTile(z, x, y, buf),
      })
      const headers = tiletype.headers(data)
      return { data, headers }
    } else {
      return this.getMBTilesTile(z, x, y)
    }
  }

  /**
   * Get the upstream tile URL for a particular tile
   */
  async getTileUrl(z: number, x: number, y: number): Promise<string | void> {
    // TODO: Support {ratio} in template URLs, not used in mapbox-gl-js, only in
    // the mobile SDKs
    const ratio = ''
    const { upstreamScheme = 'xyz', tiles: templateUrls } = await this.#metadata
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

  async getMBTilesTile(
    z: number,
    x: number,
    y: number
  ): Promise<{ data: Buffer; headers: Headers }> {
    const mbtiles = await this.#mbtiles
    // Can't promisify because callback has two arguments
    return new Promise((resolve, reject) => {
      mbtiles.getTile(z, x, y, (err, data, headers) => {
        if (err) return reject(err)
        resolve({ data, headers })
      })
    })
  }

  async getTileJSON(): Promise<TileJSON> {
    const metadata = await this.#metadata
    return {
      // tiles will be overwritten if it exists in the metadata, this is just a
      // fallback, since this is a required prop on TileJSON
      tiles: [],
      ...metadata,
      tilejson: '2.2.0',
    }
  }

  async putTile(
    z: number,
    x: number,
    y: number,
    buffer: Buffer
  ): Promise<void> {
    const mbtiles = await this.#mbtiles
    return promisify(mbtiles.putTile.bind(mbtiles))(z, x, y, buffer)
  }

  async putTileJSON(tilejson: TileJSON): Promise<void> {
    const mbtiles = await this.#mbtiles
    const metadata: Metadata = {
      name: 'mbtiles',
      ...pick(tilejson, METADATA_KEYS),
    }
    const other = omit(tilejson, METADATA_KEYS)

    if (tilejson.scheme) other.upstreamScheme = tilejson.scheme
    if (Object.keys(other).length) metadata.json = JSON.stringify(other)

    await promisify(mbtiles.putInfo.bind(mbtiles))(metadata)
    // Update metadata cache
    this.#metadata = promisify(mbtiles.getInfo.bind(mbtiles))()
    await this.#metadata
  }
}

export default Tilestore

const METADATA_KEYS = [
  'name',
  'format',
  'bounds',
  'minzoom',
  'maxzoom',
  'attribution',
  'description',
  'type',
  'version',
] as const

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

// TODO: my attempt to encapsulate tile-related db interactions for a given tileset id
// Potentially convuluted and unnecessary
export class TilesetManager {
  #tilesetId: string
  #db: Database
  #swrCache: SWRCacheV2

  constructor({
    id,
    db,
    swrCache,
  }: {
    /** Tileset ID */
    id: string
    db: Database
    /** Stale-While-Revalidate cache instance */
    swrCache: SWRCacheV2
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
  ): Promise<{ data: Buffer; headers: Headers }> {
    const tileUrl = await this.getTileUrl(z, x, y)
    if (tileUrl && !forceOffline) {
      // TODO: does the etag come into play here?
      const { data } = await this.#swrCache.get(tileUrl)
      const headers = tiletype.headers(data)
      return { data, headers }
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

      // TODO: what to do here?
      if (!tile) throw new Error()

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
