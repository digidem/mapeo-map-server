import { createHash, randomBytes } from 'crypto'
import base32 from 'base32.js'

import { TileJSON } from './tilejson'
import { FastifyRequest } from 'fastify'

// TODO: Probably not the safest to use ENOTFOUND to indicate no internet access
export const OFFLINE_ERROR_CODES = ['ENOTFOUND', 'ENETUNREACH']

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

export function isFulfilledPromiseResult<T>(
  result: PromiseSettledResult<T>
): result is PromiseFulfilledResult<T> {
  return result.status === 'fulfilled'
}

export function isRejectedPromiseResult(
  result: PromiseSettledResult<unknown>
): result is PromiseRejectedResult {
  return result.status === 'rejected'
}

export function getBaseApiUrl(request: FastifyRequest) {
  const { hostname, protocol } = request
  return `${protocol}://${hostname}`
}
