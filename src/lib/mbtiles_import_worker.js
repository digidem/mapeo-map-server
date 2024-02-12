// @ts-check
const path = require('node:path')
const Database = require('better-sqlite3')

const { IMPORT_ERRORS } = require('./imports')
const { extractMBTilesMetadata } = require('./mbtiles')
const { tileToQuadKey } = require('./tiles')
const { hash, encodeBase32 } = require('./utils')

/** @typedef {import('better-sqlite3').Database} Database */

/**
 * @template P
 * @typedef {import('better-sqlite3').Statement<P>} Statement
 */

const PROGRESS_THROTTLE = 200 // ms

module.exports = importMbTiles

/**
 * @param {import('./mbtiles_import_worker').ImportWorkerOptions} options
 */
function importMbTiles({
  dbPath,
  importId,
  mbTilesDbPath,
  tilesetId,
  styleId,
  port,
}) {
  /** @type {Database} */
  const db = new Database(dbPath)
  db.pragma('auto_vacuum = INCREMENTAL')
  db.pragma('journal_mode = WAL')

  /** @type {Database} */
  const mbTilesDb = new Database(mbTilesDbPath, { readonly: true })

  /** @type {import('./mbtiles_import_worker').Queries} */
  const queries = {
    getMbTilesImportTotals: () =>
      mbTilesDb
        .prepare(
          'SELECT SUM(LENGTH(tile_data)) AS bytes, COUNT(*) AS tiles FROM tiles;'
        )
        .get(),
    getMbTilesTileRows: () =>
      mbTilesDb
        .prepare(
          'SELECT zoom_level AS z, tile_column AS x, tile_row AS y, tile_data AS data FROM tiles'
        )
        .iterate(),
    upsertOfflineArea: db.prepare(
      'INSERT INTO OfflineArea (id, zoomLevel, boundingBox, name, styleId) ' +
        'VALUES (:id, :zoomLevel, :boundingBox, :name, :styleId) ' +
        'ON CONFLICT (id) DO UPDATE SET ' +
        'zoomLevel = excluded.zoomLevel, boundingBox = excluded.boundingBox, name = excluded.name, styleId = excluded.styleId'
    ),
    insertImport: db.prepare(
      'INSERT INTO Import (id, totalResources, totalBytes, areaId, tilesetId, state, importedResources, importedBytes, importType) ' +
        "VALUES (:id, :totalResources, :totalBytes, :areaId, :tilesetId, 'active', 0, 0, 'tileset')"
    ),
    updateImport: db.prepare(
      'UPDATE Import SET importedResources = :importedResources, importedBytes = :importedBytes, ' +
        'lastUpdated = CURRENT_TIMESTAMP WHERE id = :id'
    ),
    setImportError: db.prepare(
      "UPDATE Import SET state = 'error', finished = CURRENT_TIMESTAMP, error = :error WHERE id = :id"
    ),
    completeImport: db.prepare(
      'UPDATE Import SET importedResources = :importedResources, importedBytes = :importedBytes, ' +
        "state = 'complete', lastUpdated = CURRENT_TIMESTAMP, finished = CURRENT_TIMESTAMP WHERE id = :id"
    ),
    upsertTileData: db.prepare(
      'INSERT INTO TileData (tileHash, data, tilesetId) VALUES (:tileHash, :data, :tilesetId) ' +
        'ON CONFLICT (tileHash, tilesetId) DO UPDATE SET data = excluded.data'
    ),
    upsertTile: db.prepare(
      'INSERT INTO Tile (quadKey, tileHash, tilesetId) VALUES (:quadKey, :tileHash, :tilesetId) ' +
        'ON CONFLICT (quadkey, tilesetId) DO UPDATE SET tilehash = excluded.tileHash'
    ),
  }

  const { bytes: totalBytes, tiles: totalTiles } =
    queries.getMbTilesImportTotals()

  const fallbackName = path.parse(dbPath).name

  const mbTilesMetadata = extractMBTilesMetadata(mbTilesDb, fallbackName)

  const areaId = encodeBase32(hash(`area:${tilesetId}`))

  queries.upsertOfflineArea.run({
    id: areaId,
    boundingBox: JSON.stringify(mbTilesMetadata.bounds),
    name: mbTilesMetadata.name,
    // TODO: The spec says that the maxzoom should be defined but we don't fully guarantee at this point.
    // Might be worth throwing a validation error if the zoom levels are not specified when reading the metadata
    // @ts-expect-error
    zoomLevel: mbTilesMetadata.maxzoom,
    styleId,
  })

  queries.insertImport.run({
    id: importId,
    totalBytes: totalBytes,
    totalResources: totalTiles,
    tilesetId,
    areaId,
  })

  const tileRows = queries.getMbTilesTileRows()

  let tilesProcessed = 0
  let bytesSoFar = 0
  let lastProgressEvent = 0

  for (const row of tileRows) {
    const tileRowError = validateTileRow(row)

    if (tileRowError) {
      // TODO: Introduce a new import error type that reflects unexpected row info?
      queries.setImportError.run({ id: importId, error: IMPORT_ERRORS.UNKNOWN })

      const baseMessage = {
        importId,
        soFar: bytesSoFar,
        total: totalBytes,
      }

      // Ensure at least one progress event is emitted before throwing (because of throttle)
      if (!lastProgressEvent) {
        port.postMessage({
          ...baseMessage,
          type: 'progress',
        })
      }

      port.postMessage({
        ...baseMessage,
        type: 'error',
      })

      throw tileRowError
    }

    const { data, x, y, z } = row

    const quadKey = tileToQuadKey({ zoom: z, x, y: (1 << z) - 1 - y })

    const tileHash = hash(data).toString('hex')

    const tilesImportTransaction = db.transaction(() => {
      queries.upsertTileData.run({
        tileHash,
        data,
        tilesetId,
      })

      queries.upsertTile.run({
        quadKey,
        tileHash,
        tilesetId,
      })

      tilesProcessed++
      bytesSoFar += data.byteLength

      const params = {
        id: importId,
        importedResources: tilesProcessed,
        importedBytes: bytesSoFar,
      }

      queries.updateImport.run(params)

      if (tilesProcessed === totalTiles) {
        queries.completeImport.run(params)
      }
    })

    tilesImportTransaction()

    if (Date.now() - lastProgressEvent > PROGRESS_THROTTLE) {
      port.postMessage({
        type: 'progress',
        importId,
        soFar: bytesSoFar,
        total: totalBytes,
      })
      lastProgressEvent = Date.now()
    }
  }

  const baseFinalMessage = {
    importId,
    soFar: bytesSoFar,
    total: totalBytes,
  }

  // Ensure a final progress event is sent (because of throttle)
  port.postMessage({
    ...baseFinalMessage,
    type: 'progress',
  })

  port.postMessage({
    ...baseFinalMessage,
    type: 'complete',
  })

  db.close()
  mbTilesDb.close()
}

/**
 * Creates an error indicating which fields from a tile row are unexpectedly null
 *
 * @param {{[key: string]: *}} row
 * @returns {?Error}
 */
function validateTileRow(row) {
  /** @type {string[]} */
  const invalidFields = []

  Object.entries(row).forEach(([field, value]) => {
    if (value == null) {
      invalidFields.push(field)
    }
  })

  if (invalidFields.length === 0) return null

  return new Error(
    `Tile row has unexpected null fields: ${invalidFields.join(',')}`
  )
}
