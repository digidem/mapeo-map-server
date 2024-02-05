import SphericalMercator from '@mapbox/sphericalmercator'
import { Database as DatabaseInstance } from 'better-sqlite3'

import {
  type TileJSON,
  type VectorLayer,
  validateVectorLayerSchema,
} from './tilejson'
import { TileHeaders } from './tiles'
import { generateId } from './utils'
import { UnsupportedMBTilesFormatError } from '../api/errors'

type ValidMBTilesFormat = TileJSON['format']

export interface Headers extends TileHeaders {
  'Last-Modified'?: string
  Etag?: string
}

/**
 * MBTiles metadata
 * See https://github.com/mapbox/mbtiles-spec/blob/master/1.3/spec.md
 */
export interface Metadata {
  /** The human-readable name of the tileset */
  name: string
  /** The file format of the tile data: `pbf`, `jpg`, `png`, `webp`, or an
   * [IETF media
   * type](https://www.iana.org/assignments/media-types/media-types.xhtml) for
   * other formats */
  format: 'pbf' | 'jpg' | 'png' | 'webp' // TODO: IETF media types
  /** The maximum extent of the rendered map area. Bounds must define an area
   * covered by all zoom levels. The bounds are represented as `WGS 84`
   * latitude and longitude values, in the OpenLayers Bounds format (left,
   * bottom, right, top). For example, the `bounds` of the full Earth, minus
   * the poles, would be: `-180.0,-85,180,85` */
  bounds?: [number, number, number, number]
  /** The longitude, latitude, and zoom level of the default view of the map. */
  center?: [number, number, number]
  /** The lowest zoom level for which the tileset provides data */
  minzoom?: number
  /** The highest zoom level for which the tileset provides data */
  maxzoom?: number
  /** An attribution string, which explains the sources of data and/or style for the map */
  attribution?: string
  /** A description of the tileset's content */
  description?: string
  type?: 'overlay' | 'baselayer'
  /** The version of the tileset. This refers to a revision of the tileset
   * itself, not of the MBTiles specification. The MBTiles Spec says this
   * should be a number, but node-mbtiles implements this as a string, which
   * is the same as TileJSON */
  version?: string
  /** Vector layers describe layers of vector tile data */
  vector_layers?: VectorLayer[]
  /** Nonstandard tiling scheme added in reference implementation */
  scheme?: 'xyz' | 'tms'
}

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

export function mbTilesToTileJSON(
  mbTilesDb: DatabaseInstance,
  fallbackName: string
): TileJSON {
  const metadata = extractMBTilesMetadata(mbTilesDb, fallbackName)

  return {
    ...metadata,
    id: generateId(),
    // TODO: are we strictly supporting this version of the tilejson spec?
    tilejson: '2.2.0',
    // Technically not compliant with spec (should have at least one url),
    // but we use this to indicate that there are no upstream urls for a tileset to fetch from,
    // which applies to cases like mbtiles imports
    tiles: [],
  }
}

/**
 * Extract the metadata from an MBTiles database.
 *
 * `format` is required. `fallbackName` is provided as a fallback for `name` if the file is invalid and lacks one. Other fields are ignored if they are invalid.
 *
 * References [node-mbtiles's implementation][0].
 *
 * @throws {UnsupportedMBTilesFormatError} when the format is missing or invalid
 *
 * [0]: https://github.com/mapbox/node-mbtiles/blob/03220bc2fade2ba197ea2bab9cc44033f3a0b37e/lib/mbtiles.js#L256-L387
 */
export function extractMBTilesMetadata(
  mbTilesDb: DatabaseInstance,
  fallbackName: string
): Metadata {
  const rawMetadata: Map<string, string> = mbTilesDb
    .prepare('SELECT name, value FROM metadata')
    .all()
    .reduce((result, { name, value }: { name: unknown; value: unknown }) => {
      if (typeof name === 'string' && typeof value === 'string') {
        result.set(name, value)
      } else {
        console.warn('MBTiles extractor received a non-string metadata row', {
          name,
          value,
        })
      }
      return result
    }, new Map())

  const metadata: Metadata = {
    name: rawMetadata.get('name') || fallbackName,

    format: (() => {
      const format = rawMetadata.get('format')
      if (format && isValidMBTilesFormat(format)) return format
      console.warn('MBTiles has an invalid (or missing) format')
      throw new UnsupportedMBTilesFormatError()
    })(),

    bounds: parseFloatList(rawMetadata.get('bounds'), 4),

    center: parseFloatList(rawMetadata.get('center'), 3),

    minzoom: parseSafeInt(rawMetadata.get('minzoom')),

    maxzoom: parseSafeInt(rawMetadata.get('maxzoom')),

    attribution: rawMetadata.get('attribution'),

    description: rawMetadata.get('description'),

    type: (() => {
      const rawType = rawMetadata.get('type')
      return rawType === 'overlay' || rawType === 'baselayer'
        ? rawType
        : undefined
    })(),

    version: rawMetadata.get('version'),

    vector_layers: (() => {
      const rawVectorLayers = parseJsonObject(
        rawMetadata.get('json')
      )?.vector_layers
      return Array.isArray(rawVectorLayers) &&
        rawVectorLayers.every((layer) => validateVectorLayerSchema(layer))
        ? rawVectorLayers
        : undefined
    })(),

    // TODO: Extracted from reference implementation but not sure if it applies for us
    // https://github.com/mapbox/node-mbtiles/blob/03220bc2fade2ba197ea2bab9cc44033f3a0b37e/lib/mbtiles.js#L300
    scheme: 'xyz',
  }

  return ensureCenter(ensureBounds(ensureZooms(metadata, mbTilesDb), mbTilesDb))
}

function parseFloatList(
  s: unknown,
  size: 3
): undefined | [number, number, number]
function parseFloatList(
  s: unknown,
  size: 4
): undefined | [number, number, number, number]
function parseFloatList(s: unknown, size: number): undefined | number[] {
  if (typeof s !== 'string') return
  const result = s.split(',', size + 1).map(parseFloat)
  const isValid = result.length === size && result.every(Number.isFinite)
  return isValid ? result : undefined
}

function parseSafeInt(s: unknown): undefined | number {
  if (typeof s !== 'string') return
  const result = parseInt(s, 10)
  return Number.isSafeInteger(result) ? result : undefined
}

function parseJsonObject(s: unknown): undefined | Record<string, unknown> {
  if (typeof s !== 'string') return
  let result: unknown
  try {
    result = JSON.parse(s)
  } catch (_) {
    return undefined
  }
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>
  }
  return
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
