// @ts-check
const process = require('process')
const { parentPort, workerData } = require('worker_threads')
const Database = require('better-sqlite3')

const { extractMBTilesMetadata } = require('./mbtiles')
const { tileToQuadKey } = require('./tiles')
const { hash, encodeBase32 } = require('./utils')

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
 * @property {string} styleId
 * @property {string} tilesetId
 */

/**
 * @typedef {Object} ImportSubscribeAction
 * @property {'importEventSubscription'} type
 * @property {string[]} importIds
 */

/**
 * @typedef {Object} ImportTerminateAction
 * @property {'importTerminate'} type
 */

const queries = {
  /**
   *
   * @param {{ id: string, zoomLevel: string, boundingBox: string, name: string, styleId: string }} params
   * @returns {Database.RunResult}
   */
  upsertOfflineArea: (params) =>
    db
      .prepare(
        'INSERT INTO OfflineArea (id, zoomLevel, boundingBox, name, styleId) ' +
          'VALUES (:id, :zoomLevel, :boundingBox, :name, :styleId) ' +
          'ON CONFLICT (id) DO UPDATE SET ' +
          'zoomLevel = excluded.zoomLevel, boundingBox = excluded.boundingBox, name = excluded.name, styleId = excluded.styleId'
      )
      .run(params),
  /**
   *
   * @param {{ id: string, totalResources: number, areaId: string, tilesetId?: string }} params
   * @returns {Database.RunResult}
   */
  insertImport: (params) =>
    db
      .prepare(
        'INSERT INTO Import (id, totalResources, areaId, tilesetId, importedResources, isComplete, importType) ' +
          "VALUES (:id, :totalResources, :areaId, :tilesetId, 0, 0, 'tileset')"
      )
      .run(params),
  /**
   *
   * @param {{ id: string, importedResources: number, isComplete: number }} params
   * @returns {Database.RunResult}
   */
  updateImport: (params) =>
    db
      .prepare(
        'UPDATE Import SET importedResources = :importedResources, isComplete = :isComplete, finished = CURRENT_TIMESTAMP WHERE id = :id'
      )
      .run(params),
  /**
   *
   * @param {{ data: Buffer, tileHash: string, tilesetId: string }} params
   * @returns {Database.RunResult}
   */
  upsertTileData: (params) =>
    db
      .prepare(
        'INSERT INTO TileData (tileHash, data, tilesetId) VALUES (:tileHash, :data, :tilesetId) ' +
          'ON CONFLICT (tileHash, tilesetId) DO UPDATE SET data = excluded.data'
      )
      .run(params),
  /**
   *
   * @param {{ quadKey: string, tileHash: string, tilesetId: string }} params
   * @returns {Database.RunResult}
   */
  upsertTile: (params) =>
    db
      .prepare(
        'INSERT INTO Tile (quadKey, tileHash, tilesetId) VALUES (:quadKey, :tileHash, :tilesetId) ' +
          'ON CONFLICT (quadkey, tilesetId) DO UPDATE SET tilehash = excluded.tileHash'
      )
      .run(params),
}

/** @type {Set<string>} */
const subscriptions = new Set()

/** @type {Database} */
const db = new Database(workerData.dbPath)

if (!parentPort) throw new Error('No parent port found')

parentPort.on('message', handleMessage)

/** @param {ImportAction | ImportSubscribeAction | ImportTerminateAction} action */
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
    case 'importTerminate': {
      process.exit(0)
      break
    }
  }
}

/** @param {string[]} importIds */
function handleEventSubscription(importIds) {
  importIds.forEach((id) => subscriptions.add(id))
}

/** @param {{ importId: string, mbTilesDbPath: string, styleId: string, tilesetId: string }} params */
function importMbTiles({ importId, mbTilesDbPath, tilesetId, styleId }) {
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

  const areaId = encodeBase32(hash(`area:${tilesetId}`))

  queries.upsertOfflineArea({
    id: areaId,
    boundingBox: JSON.stringify(mbTilesMetadata.bounds),
    name: mbTilesMetadata.name,
    // TODO: The spec says that the maxzoom should be defined but we don't fully guarantee at this point.
    // Might be worth throwing a validation error if the zoom levels are not specified when reading the metadata
    // @ts-expect-error
    zoomLevel: mbTilesMetadata.maxzoom,
    styleId,
  })

  queries.insertImport({
    id: importId,
    totalResources: totalBytesToImport,
    tilesetId,
    areaId,
  })

  subscriptions.add(importId)

  for (const { data, x, y, z } of iterableQuery) {
    const quadKey = tileToQuadKey({ zoom: z, x, y })

    const tileHash = hash(data).toString('hex')

    const tilesImportTransaction = db.transaction(() => {
      queries.upsertTileData({
        tileHash,
        data,
        tilesetId,
      })

      queries.upsertTile({
        quadKey,
        tileHash,
        tilesetId,
      })

      bytesSoFar += data.byteLength

      queries.updateImport({
        id: importId,
        importedResources: bytesSoFar,
        isComplete: bytesSoFar === totalBytesToImport ? 1 : 0,
      })
    })

    tilesImportTransaction()

    if (parentPort && subscriptions.has(importId)) {
      parentPort.postMessage({
        type: 'progress',
        importId,
        soFar: bytesSoFar,
        total: totalBytesToImport,
      })
    }
  }

  subscriptions.delete(importId)

  mbTilesDb.close()
}
