const process = require('process')
const { parentPort } = require('worker_threads')
const Database = require('better-sqlite3')

const { hash, tileToQuadKey } = require('./utils')

/**
 * @typedef {Object} WorkerData
 * @property {string} dbPath
 * @property {string} mbTilesDbPath - The artist
 */

/**
 * @typedef { import('better-sqlite3').Database } Database
 **/

/**
 * @type {Database | null} db
 */
let db = null

/**
 * @type {Database | null} mbTilesDb
 */
let mbTilesDb = null

parentPort.on('message', ({ dbPath, mbTilesDbPath, tilesetId }) => {
  if (!db) {
    db = new Database(dbPath)
  }

  if (!mbTilesDb) {
    // Ideally would set `readOnly` to `true` here but causes `fileMustExist` to be ignored:
    // https://github.com/JoshuaWise/better-sqlite3/blob/230ea65ed0d7566e32d41c3d13a90fb32ccdbee6/docs/api.md#new-databasepath-options
    mbTilesDb = new Database(mbTilesDbPath, {
      fileMustExist: true,
    })
  }

  /**
   * @type { import('better-sqlite3').Statement<{ data: buffer, tileHash: string, tilesetId: string }> }
   */
  const insertTileData = db.prepare(
    'INSERT INTO TileData (tileHash, data, tilesetId) VALUES (:tileHash, :data, :tilesetId)'
  )

  /**
   * @type { import('better-sqlite3').Statement<{ quadKey: string, tileHash: string, tilesetId: string }> }
   */
  const insertTile = db.prepare(
    'INSERT INTO Tile (quadKey, tileHash, tilesetId) VALUES (:quadKey, :tileHash, :tilesetId)'
  )

  let bytesSoFar = 0

  /** @type {number} */
  const approximateTotalBytes = mbTilesDb
    .prepare('SELECT SUM(LENGTH(tile_data)) AS total FROM tiles;')
    .get().total

  /**
   * @type {IterableIterator<{ data: Buffer, x: number, y: number, z: number }>}
   */
  const iterableQuery = mbTilesDb
    .prepare(
      'SELECT zoom_level AS z, tile_column AS y, tile_row AS x, tile_data AS data FROM tiles'
    )
    .iterate()

  for (const { data, x, y, z } of iterableQuery) {
    const quadKey = tileToQuadKey({ zoom: z, x, y })

    const tileHash = hash(data).toString('hex')

    const tilesImportTransaction = () => {
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

      // TODO: Create an offline area in the db here
    }

    tilesImportTransaction()

    parentPort.postMessage({
      soFar: (bytesSoFar += data.byteLength),
      total: approximateTotalBytes,
    })
  }

  onDone()
})

function onDone() {
  db.close()
  mbTilesDb.close()

  // TODO: Are these necessary?
  db = null
  mbTilesDb = null

  process.exit(0)
}
