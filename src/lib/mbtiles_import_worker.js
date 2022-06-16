// @ts-check
const process = require('process')
const { parentPort, workerData } = require('worker_threads')
const Database = require('better-sqlite3')

const { extractMBTilesMetadata } = require('./mbtiles')
const { tileToQuadKey } = require('./tiles')
const { hash, encodeBase32 } = require('./utils')

/** @typedef {import('better-sqlite3').Database} Database */

/**
 * @template P
 * @typedef {import('better-sqlite3').Statement<P>} Statement
 */

/** @type {import('./mbtiles_import_worker').WorkerData} */
const { dbPath, importId, mbTilesDbPath, tilesetId, styleId } = workerData

/** @type {Database} */
const db = new Database(dbPath)

/** @type {Database} */
const mbTilesDb = new Database(mbTilesDbPath, {
  // Ideally would set `readOnly` to `true` here but causes `fileMustExist` to be ignored:
  // https://github.com/JoshuaWise/better-sqlite3/blob/230ea65ed0d7566e32d41c3d13a90fb32ccdbee6/docs/api.md#new-databasepath-options
  fileMustExist: true,
})

/** @type {import('./mbtiles_import_worker').Queries} */
const queries = {
  getMbTilesTotalByteSize: () =>
    mbTilesDb
      .prepare('SELECT SUM(LENGTH(tile_data)) AS total FROM tiles;')
      .get().total,
  getMbTilesData: () =>
    mbTilesDb
      .prepare(
        'SELECT zoom_level AS z, tile_column AS x, tile_row AS y, tile_data AS data FROM tiles'
      )
      .iterate(),
  upsertOfflineArea: (params) =>
    db
      .prepare(
        'INSERT INTO OfflineArea (id, zoomLevel, boundingBox, name, styleId) ' +
          'VALUES (:id, :zoomLevel, :boundingBox, :name, :styleId) ' +
          'ON CONFLICT (id) DO UPDATE SET ' +
          'zoomLevel = excluded.zoomLevel, boundingBox = excluded.boundingBox, name = excluded.name, styleId = excluded.styleId'
      )
      .run(params),
  insertImport: (params) =>
    db
      .prepare(
        'INSERT INTO Import (id, totalResources, areaId, tilesetId, importedResources, isComplete, importType) ' +
          "VALUES (:id, :totalResources, :areaId, :tilesetId, 0, 0, 'tileset')"
      )
      .run(params),
  updateImport: (params) =>
    db
      .prepare(
        'UPDATE Import SET importedResources = :importedResources, isComplete = :isComplete, finished = CURRENT_TIMESTAMP WHERE id = :id'
      )
      .run(params),
  upsertTileData: (params) =>
    db
      .prepare(
        'INSERT INTO TileData (tileHash, data, tilesetId) VALUES (:tileHash, :data, :tilesetId) ' +
          'ON CONFLICT (tileHash, tilesetId) DO UPDATE SET data = excluded.data'
      )
      .run(params),
  upsertTile: (params) =>
    db
      .prepare(
        'INSERT INTO Tile (quadKey, tileHash, tilesetId) VALUES (:quadKey, :tileHash, :tilesetId) ' +
          'ON CONFLICT (quadkey, tilesetId) DO UPDATE SET tilehash = excluded.tileHash'
      )
      .run(params),
}

process.on('exit', () => {
  db.close()
  mbTilesDb.close()
})

if (!parentPort) throw new Error('No parent port found')

parentPort.on('message', handleMessage)

/** @param {import('./mbtiles_import_worker').WorkerMessage} message*/
function handleMessage(message) {
  switch (message.type) {
    case 'start': {
      importMbTiles()
      break
    }
  }
}

function importMbTiles() {
  let bytesSoFar = 0

  const totalBytesToImport = queries.getMbTilesTotalByteSize()

  const mbTilesMetadata = extractMBTilesMetadata(mbTilesDb)

  const iterableQuery = queries.getMbTilesData()

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

  for (const { data, x, y, z } of iterableQuery) {
    const quadKey = tileToQuadKey({ zoom: z, x, y: (1 << z) - 1 - y })

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

    if (parentPort) {
      parentPort.postMessage({
        type: 'progress',
        importId,
        soFar: bytesSoFar,
        total: totalBytesToImport,
      })
    }
  }

  db.close()
  mbTilesDb.close()

  if (parentPort) {
    parentPort.postMessage({
      type: 'complete',
      importId,
    })
  }
}
