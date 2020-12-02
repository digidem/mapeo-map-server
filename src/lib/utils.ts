import { createHash, randomBytes } from 'crypto'
import path from 'path'
import { URL } from 'url'

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
export function hash(string: string): Buffer {
  return createHash('sha1').update(string).digest()
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
