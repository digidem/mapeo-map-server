// @ts-check
const process = require('process')
const { parentPort, workerData } = require('worker_threads')
const Database = require('better-sqlite3')

const { hash, tileToQuadKey } = require('./utils')

/**
 * @typedef {Object} WorkerData
 * @property {string} dbPath
 */

/** @typedef {import('better-sqlite3').Database} Database */

/**
 * @template P
 * @typedef {import('better-sqlite3').Statement<P>} Statement
 */

/**
 * @typedef {Object} ImportAction
 * @property {'importMbTiles'} type
 * @property {string} importId
 * @property {string} mbTilesDbPath
 * @property {string} tilesetId
 */

/**
 * @typedef {Object} ImportSubscribeAction
 * @property {'importEventSubscription'} type
 * @property {string[]} importIds
 */

/** @type {Set<string>} */
const subscriptions = new Set()

/** @type {Database} */
const db = new Database(workerData.dbPath)

/** @type {Statement<{ id: string, zoomLevel: string, boundingBox: string, name: string, styleId: string }>} */
const insertOfflineArea = db.prepare(
  'INSERT INTO OfflineArea (id, zoomLevel, boundingBox, name, styleId) ' +
    'VALUES (:id, :zoomLevel, :boundingBox, :name, :styleId)'
)

/** @type {Statement<{ id: string, downloadedResources: number, totalResources: number, isComplete: boolean, finished: number, areaId: string }>} */
const insertImport = db.prepare(
  'INSERT INTO Import (id, downloadedResources, totalResources, isComplete, finished, areaId) ' +
    "VALUES (:id, :downloadedResources, :totalResources, :isComplete, :finished, 'unixepoch'), :areaId)"
)

/** @type {Statement<{ data: buffer, tileHash: string, tilesetId: string }>} */
const insertTileData = db.prepare(
  'INSERT INTO TileData (tileHash, data, tilesetId) VALUES (:tileHash, :data, :tilesetId)'
)

/** @type {Statement<{ quadKey: string, tileHash: string, tilesetId: string }>} */
const insertTile = db.prepare(
  'INSERT INTO Tile (quadKey, tileHash, tilesetId) VALUES (:quadKey, :tileHash, :tilesetId)'
)

parentPort.on('message', handleMessage)

/** @param {ImportAction | ImportSubscribeAction} action */
function handleMessage(action) {
  switch (action.type) {
    case 'importMbTiles': {
      const { type, ...params } = action
      importMbTiles(params)
      break
    }
    case 'importEventSubscription': {
      handleEventSubscription(action.importIds)
      break
    }
  }
}

/** @param {string[]} importIds */
function handleEventSubscription(importIds) {
  importIds.forEach(subscriptions.add)
}

/** @param {{ importId: string, mbTilesDbPath: string, tilesetId: string }} params */
function importMbTiles({ importId, mbTilesDbPath, tilesetId }) {
  /** @type {Database} */
  const mbTilesDb = new Database(mbTilesDbPath, {
    // Ideally would set `readOnly` to `true` here but causes `fileMustExist` to be ignored:
    // https://github.com/JoshuaWise/better-sqlite3/blob/230ea65ed0d7566e32d41c3d13a90fb32ccdbee6/docs/api.md#new-databasepath-options
    fileMustExist: true,
  })

  let bytesSoFar = 0

  /** @type {number} */
  const approximateTotalBytes = mbTilesDb
    .prepare('SELECT SUM(LENGTH(tile_data)) AS total FROM tiles;')
    .get().total

  /** @type {IterableIterator<{ data: Buffer, x: number, y: number, z: number }>} */
  const iterableQuery = mbTilesDb
    .prepare(
      'SELECT zoom_level AS z, tile_column AS y, tile_row AS x, tile_data AS data FROM tiles'
    )
    .iterate()

  // TODO: Create an offline area in the db here

  // TODO: Create import in db here

  for (const { data, x, y, z } of iterableQuery) {
    const quadKey = tileToQuadKey({ zoom: z, x, y })

    const tileHash = hash(data).toString('hex')

    const tilesImportTransaction = db.transaction(() => {
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

      bytesSoFar += data.byteLength

      // TODO: Update import in db here
    })

    tilesImportTransaction()
  }

  mbTilesDb.close()

  if (subscriptions.has(importId)) {
    parentPort.postMessage({
      type: 'importProgress',
      importId,
      soFar: bytesSoFar,
      total: approximateTotalBytes,
    })
  }
}
