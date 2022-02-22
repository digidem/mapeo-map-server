import { createHash, randomBytes } from 'crypto'
import path from 'path'
import { URL } from 'url'
import { getTileBBox } from '@mapbox/whoots-js'
import base32 from 'base32.js'

import { TileJSON } from './tilejson'

export function getTilesetFormat(tileset: TileJSON): TileJSON['format'] {
  if (tileset.format) return tileset.format
  // attempt to parse format from tile url
  const url = new URL(tileset.tiles[0])
  const ext = path.extname(url.pathname).slice(1)
  // See https://docs.mapbox.com/api/maps/#raster-tiles for extensions
  // TODO: Common options for other tile services?
  if (ext.match(/^png\d{0,3}$/)) {
    return 'png'
  } else if (ext.match(/^je?pg\d{0,2}$/)) {
    return 'jpg'
  } else if (ext === 'webp') {
    return 'webp'
  } else {
    return 'png'
  }
}

// Not cryptographically secure, but sha1 results in shorter / more manageable
// ids for filenames and in the URL, should be fine for our use-case
export function hash(data: string | Buffer): Buffer {
  return createHash('sha1').update(data).digest()
}

/**
 * Generate a random ID
 */
export function generateId(): string {
  return encodeBase32(randomBytes(16))
}

/**
 * Encode a buffer to base32
 */
export function encodeBase32(buf: Buffer): string {
  const encoder = new base32.Encoder({ type: 'crockford', lc: true })
  return encoder.write(buf).finalize()
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

/**
 * Get the upstream tile URL for a particular tile
 */
export function getInterpolatedUpstreamTileUrl({
  tiles: templateUrls,
  scheme: upstreamScheme = 'xyz',
  zoom,
  x,
  y,
}: {
  tiles: TileJSON['tiles']
  scheme: TileJSON['scheme']
  zoom: number
  x: number
  y: number
}): string | undefined {
  // TODO: Support {ratio} in template URLs, not used in mapbox-gl-js, only in
  // the mobile SDKs
  const ratio = ''

  if (!isStringArray(templateUrls)) {
    console.log('templateUrls', templateUrls)
    return
  }

  const bbox = getTileBBox(x, y, zoom)
  const quadkey = tileToQuadKey({ x, y, zoom })

  return templateUrls[(x + y) % templateUrls.length]
    .replace('{prefix}', (x % 16).toString(16) + (y % 16).toString(16))
    .replace('{z}', String(zoom))
    .replace('{x}', String(x))
    .replace(
      '{y}',
      String(upstreamScheme === 'tms' ? Math.pow(2, zoom) - y - 1 : y)
    )
    .replace('{quadkey}', quadkey)
    .replace('{bbox-epsg-3857}', bbox)
    .replace('{ratio}', ratio ? `@${ratio}x` : '')
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((d) => typeof d === 'string')
  )
}

// Roughly identical implementation as https://github.com/mapbox/tilebelt/blob/876af65cfc68f152aeed2e514289e401c5d95196/index.js#L175-L195
export function tileToQuadKey({
  x,
  y,
  zoom,
}: {
  x: number
  y: number
  zoom: number
}) {
  let index = ''
  for (let z = zoom; z > 0; z--) {
    let b = 0
    const mask = 1 << (z - 1)
    if ((x & mask) !== 0) b++
    if ((y & mask) !== 0) b += 2
    index += b.toString()
  }
  return index
}
