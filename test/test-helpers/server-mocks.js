const nock = require('nock')
const { createHash } = require('crypto')

// Block all outgoing requests apart from to localhost
// This file needs to be required at the top of all e2e tests, to ensure that
// this is setup before any tests run. It ensures that we're not making any
// upstream requests that we don't know about
nock.disableNetConnect()
nock.enableNetConnect(
  (host) => host.includes('localhost') || host.includes('127.0.0.1')
)

/** @type {nock.ReplyHeaders} */
const defaultMockHeaders = {
  'content-length': (req, res, body) => body.length,
  etag: (req, res, body) => createETag(body),
  'last-modified': () => new Date().toUTCString(),
}

module.exports = {
  tileMockBody,
  tilesetMockBody,
  createETag,
  defaultMockHeaders,
  createFakeTile,
}

/** @param {string} uri */
function tileMockBody(uri) {
  const match = uri.match(
    /\/v3\/(?<tilesetId>.*)\/(?<z>.*)\/(?<x>.*)\/(?<y>.*)\.png/
  )
  if (!match) throw new Error('Unexpected URI')
  const { x, y, z } = match.groups
  console.log({ x, y, z })

  // First 8 bytes identify a PNG datastream: https://www.w3.org/TR/PNG/#5PNG-file-signature
  return createFakeTile(Number(z), Number(x), Number(y))
}

const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * @param {number} z
 * @param {number} x
 * @param {number} y
 */
function createFakeTile(z, x, y) {
  const tileBuf = Buffer.alloc(pngHeader.byteLength + 4 * 3)
  pngHeader.copy(tileBuf)
  tileBuf.writeUInt32BE(z, pngHeader.byteLength)
  tileBuf.writeUInt32BE(x, pngHeader.byteLength + 4)
  tileBuf.writeUInt32BE(y, pngHeader.byteLength + 8)
  return tileBuf
}

/** @param {string} uri */
function tilesetMockBody(uri) {
  const match = uri.match(/\/v4\/(?<tilesetId>.*)\.json/)
  console.log(uri)
  if (!match) throw new Error('Unexpected URI')
  const { tilesetId } = match.groups
  const tileset = {
    id: tilesetId,
    tilejson: '2.2.0',
    format: 'pbf',
    tiles: [
      `http://a.tiles.mapbox.com/v4/${tilesetId}/{z}/{x}/{y}.vector.png`,
      `http://b.tiles.mapbox.com/v4/${tilesetId}/{z}/{x}/{y}.vector.png`,
    ],
    vector_layers: [
      {
        description: '',
        fields: {
          description: 'String',
          id: 'String',
          'marker-color': 'String',
          'marker-size': 'String',
          'marker-symbol': 'String',
          title: 'String',
        },
        id: 'test-vector-layer',
        maxzoom: 22,
        minzoom: 0,
        source: tilesetId,
        source_name: 'test-vector-layer',
      },
    ],
  }
  return JSON.stringify(tileset, null, 2)
}

/**
 * An adjusted version of
 * https://github.com/jshttp/etag/blob/4664b6e53c85a56521076f9c5004dd9626ae10c8/index.js#L39
 *
 * @param {string | Buffer} entity
 * @returns {string}
 */
function createETag(entity) {
  const hash = createHash('sha1')
    .update(entity.toString('utf8'), 'utf8')
    .digest('base64')
    .substring(0, 27)

  const len =
    typeof entity === 'string'
      ? Buffer.byteLength(entity, 'utf8')
      : entity.length

  return `"${len.toString(16)}-${hash}"`
}
