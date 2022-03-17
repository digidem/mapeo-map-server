// @ts-check
const process = require('process')
const { parentPort, workerData } = require('worker_threads')
const Database = require('better-sqlite3')

const { hash, tileToQuadKey } = require('./utils')
const { extractMBTilesMetadata } = require('./mbtiles')

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
const upsertOfflineArea = db.prepare(
  'INSERT INTO OfflineArea (id, zoomLevel, boundingBox, name, styleId) ' +
    'VALUES (:id, :zoomLevel, :boundingBox, :name, :styleId) ' +
    'ON CONFLICT (id) DO UPDATE SET ' +
    'zoomLevel = excluded.zoomLevel, boundingBox = excluded.boundingBox, name = excluded.name, styleId = excluded.styleId'
)

/** @type {Statement<{ id: string, totalResources: number, areaId: string, tilesetId?: string}>} */
const insertImport = db.prepare(
  'INSERT INTO Import (id, importedResources, totalResources, isComplete, finished, areaId, tilesetId, importType) ' +
    'VALUES (:id, 0, :totalResources, false, :areaId, :tilesetID, "tileset")'
)

/** @type {Statement<{ id: string, importedResources: number, isComplete: boolean}>} */
const updateImport = db.prepare(
  'UPDATE Import SET importedResources = :importedResources, isComplete = :isComplete, finished = CURRENT_TIMESTAMP WHERE id = :id'
)

/** @type {Statement<{ data: buffer, tileHash: string, tilesetId: string }>} */
const upsertTileData = db.prepare(
  'INSERT INTO TileData (tileHash, data, tilesetId) VALUES (:tileHash, :data, :tilesetId) ' +
    'ON CONFLICT (tileHash, tilesetId) DO UPDATE SET data = excluded.data'
)

/** @type {Statement<{ quadKey: string, tileHash: string, tilesetId: string }>} */
const upsertTile = db.prepare(
  'INSERT INTO Tile (quadKey, tileHash, tilesetId) VALUES (:quadKey, :tileHash, :tilesetId) ' +
    'ON CONFLICT (quadkey, tilesetId) DO UPDATE SET tilehash = excluded.tileHash'
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
  const totalBytesToImport = mbTilesDb
    .prepare('SELECT SUM(LENGTH(tile_data)) AS total FROM tiles;')
    .get().total

  const mbTilesMetadata = extractMBTilesMetadata(mbTilesDb)

  /** @type {IterableIterator<{ data: Buffer, x: number, y: number, z: number }>} */
  const iterableQuery = mbTilesDb
    .prepare(
      'SELECT zoom_level AS z, tile_column AS y, tile_row AS x, tile_data AS data FROM tiles'
    )
    .iterate()

  // TODO: Derive from mb tiles tileset id `area-${id}`
  const areaId = generateId()

  upsertOfflineArea.run({
    id: areadId,
    boundingBox: JSON.stringify(mbTilesMetadata.bounds),
    name: mbTilesMetadata.name,
    zoomLevel: mbTilesMetadata.maxzoom,
    // TODO: need to provide the style id to the worker too
    // styleId:
  })

  insertImport.run({
    id: importId,
    totalResources: totalBytesToImport,
    tilesetId,
    areaId,
  })

  for (const { data, x, y, z } of iterableQuery) {
    const quadKey = tileToQuadKey({ zoom: z, x, y })

    const tileHash = hash(data).toString('hex')

    const tilesImportTransaction = db.transaction(() => {
      upsertTileData.run({
        tileHash,
        data,
        tilesetId,
      })

      upsertTile.run({
        quadKey,
        tileHash,
        tilesetId,
      })

      bytesSoFar += data.byteLength

      updateImport.run({
        id: importId,
        importedResources: bytesSoFar,
        isComplete: bytesSoFar === totalBytesToImport,
      })
    })

    tilesImportTransaction()
  }

  mbTilesDb.close()

  if (subscriptions.has(importId)) {
    parentPort.postMessage({
      type: 'progress',
      importId,
      soFar: bytesSoFar,
      total: totalBytesToImport,
    })
  }
}
