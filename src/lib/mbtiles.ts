import { Metadata } from '@mapbox/mbtiles'
import SphericalMercator from '@mapbox/sphericalmercator'
import { Database as DatabaseInstance } from 'better-sqlite3'

import { TileJSON } from './tilejson'
import { generateId } from './utils'

type ValidMBTilesFormat = TileJSON['format']

export const VALID_MBTILES_FORMATS: ValidMBTilesFormat[] = [
  'pbf',
  'png',
  'jpg',
  'webp',
]

export function isValidMBTilesFormat(
  format: string
): format is ValidMBTilesFormat {
  return VALID_MBTILES_FORMATS.includes(format as ValidMBTilesFormat)
}

export function mbTilesToTileJSON(mbTilesDb: DatabaseInstance): TileJSON {
  const metadata = extractMBTilesMetadata(mbTilesDb)

  return {
    ...metadata,
    id: generateId(),
    name: metadata.name,
    // TODO: are we strictly supporting this version of the tilejson spec?
    tilejson: '2.2.0',
    // Technically not compliant with spec
    tiles: [],
    mbTilesImport: true,
  }
}

// Reference implementations from:
// https://github.com/mapbox/node-mbtiles/blob/03220bc2fade2ba197ea2bab9cc44033f3a0b37e/lib/mbtiles.js#L256-L387
// https://github.com/yuiseki/mbtiles2tilejson/blob/a21c3fb14502cf2cee73bc6362602ace23fa061b/src/index.ts#L28-L60
function extractMBTilesMetadata(mbTilesDb: DatabaseInstance): Metadata {
  const metadata: any = {}

  mbTilesDb
    .prepare('SELECT name, value FROM metadata')
    .all()
    .forEach((row: { name: string; value: string }) => {
      switch (row.name) {
        case 'json':
          try {
            const jsondata = JSON.parse(row.value)
            Object.keys(jsondata).reduce((result, key) => {
              result[key] = result[key] || jsondata[key]
              return result
            }, metadata)
          } catch (err) {
            // TODO: Throw some error here
          }
          break
        case 'minzoom':
        case 'maxzoom':
          metadata[row.name] = parseInt(row.value, 10)
          break
        case 'center':
        case 'bounds':
          metadata[row.name] = row.value.split(',').map(parseFloat)
          break
        default:
          metadata[row.name] = row.value
          break
      }
    })

  // TODO: Extracted from reference implementation but not sure if it applies for us
  // https://github.com/mapbox/node-mbtiles/blob/03220bc2fade2ba197ea2bab9cc44033f3a0b37e/lib/mbtiles.js#L300
  metadata.scheme = 'xyz'

  return ensureCenter(ensureBounds(ensureZooms(metadata, mbTilesDb), mbTilesDb))
}

function ensureZooms<Metadata extends Partial<TileJSON>>(
  metadata: Metadata,
  mbTilesDb: DatabaseInstance
): Metadata {
  if (metadata['minzoom'] !== undefined && metadata['maxzoom'] !== undefined)
    return metadata
  let remaining = 30
  const zooms = []
  const query = mbTilesDb.prepare(
    'SELECT zoom_level FROM tiles WHERE zoom_level = ? LIMIT 1'
  )

  for (let i = 0; i < remaining; i++) {
    const row:
      | {
          zoom_level: number
        }
      | undefined = query.get(i)

    if (row) zooms.push(row.zoom_level)

    if (--remaining === 0) break
  }

  if (zooms.length === 0) return metadata

  zooms.sort((a, b) => (a < b ? -1 : 1))

  return {
    ...metadata,
    minzoom: zooms[0],
    maxzoom: zooms.pop(),
  }
}

function ensureBounds<Metadata extends Partial<TileJSON>>(
  metadata: Metadata,
  mbTilesDb: DatabaseInstance
): Metadata {
  if (metadata['bounds'] !== undefined) return metadata
  if (metadata['minzoom'] === undefined) return metadata

  const row:
    | {
        maxx: number
        minx: number
        maxy: number
        miny: number
      }
    | undefined = mbTilesDb
    .prepare(
      'SELECT MAX(tile_column) AS maxx, ' +
        'MIN(tile_column) as minx, ' +
        'MAX(tile_row) as maxy, ' +
        'MIN(tile_row) as miny ' +
        'FROM tiles WHERE zoom_level = ?'
    )
    .get(metadata.minzoom)

  if (!row) return metadata

  const sm = new SphericalMercator({})

  // TODO: this breaks a little at zoom level zero
  const urTile = sm.bbox(row.maxx, row.maxy, metadata.minzoom, true)
  const llTile = sm.bbox(row.minx, row.miny, metadata.minzoom, true)

  // TODO: bounds are limited to "sensible" values here
  // as sometimes tilesets are rendered with "negative"
  // and/or other extremity tiles. Revisit this if there
  // are actual use cases for out-of-bounds bounds.
  return {
    ...metadata,
    bounds: [
      llTile[0] > -180 ? llTile[0] : -180,
      llTile[1] > -90 ? llTile[1] : -90,
      urTile[2] < 180 ? urTile[2] : 180,
      urTile[3] < 90 ? urTile[3] : 90,
    ],
  }
}

function ensureCenter<Metadata extends Partial<TileJSON>>(
  metadata: Metadata
): Metadata {
  if (
    metadata['center'] !== undefined ||
    metadata['bounds'] === undefined ||
    metadata['minzoom'] === undefined ||
    metadata['maxzoom'] === undefined
  ) {
    return metadata
  }

  const range = metadata.maxzoom - metadata.minzoom

  return {
    ...metadata,
    center: [
      (metadata.bounds[2] - metadata.bounds[0]) / 2 + metadata.bounds[0],
      (metadata.bounds[3] - metadata.bounds[1]) / 2 + metadata.bounds[1],
      range <= 1
        ? metadata.maxzoom
        : Math.floor(range * 0.5) + metadata.minzoom,
    ],
  }
}
