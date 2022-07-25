const fs = require('fs')
const path = require('path')
const { setupServer } = require('msw/node')
const { rest } = require('msw')
const { createHash } = require('crypto')

const handlers = [
  rest.get(
    // based on fixtures/good-tilejson/mapbox_raster_tilejson.json
    'http://*.tiles.mapbox.com/v3/aj.1x1-degrees/:zoom/:x/:y',
    async (req, res, ctx) => {
      const { x, y: tempY, zoom } = req.params

      const y = /** @type {string} */ (tempY).split('.')[0]

      // First 8 bytes identify a PNG datastream: https://www.w3.org/TR/PNG/#5PNG-file-signature
      const body = Buffer.from([
        137,
        80,
        78,
        71,
        13,
        10,
        26,
        10,
        convertParamToNumber(zoom),
        convertParamToNumber(x),
        convertParamToNumber(y),
      ])

      const etag = createETag(body)

      return res(
        ctx.set({
          'Content-Type': 'image/png',
          'Last-Modified': new Date().toUTCString(),
          'Content-Length': body.byteLength.toString(),
          ETag: etag,
        }),
        ctx.body(body)
      )
    }
  ),
  // TODO: Make this more flexible so it can handle other formats e.g. png, jpg, etc
  rest.get('https://api.mapbox.com/v4/:tileset', async (req, res, ctx) => {
    const { tileset } = req.params

    const mbTilesetId = /** @type {string} */ (tileset).replace('.json', '')

    const tilejson = {
      id: mbTilesetId,
      tilejson: '2.2.0',
      format: 'pbf',
      tiles: [
        `http://a.tiles.mapbox.com/v4/${mbTilesetId}/{z}/{x}/{y}.vector.png`,
        `http://b.tiles.mapbox.com/v4/${mbTilesetId}/{z}/{x}/{y}.vector.png`,
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
          source: mbTilesetId,
          source_name: 'test-vector-layer',
        },
      ],
    }

    return res(
      ctx.set({
        'Content-Type': 'application/json',
      }),
      ctx.body(JSON.stringify(tilejson))
    )
  }),
  rest.get(
    'https://api.mapbox.com/styles/v1/:username/:styleId/:name.:format',
    async (req, res, ctx) => {
      const { username, name, format } = req.params

      const pixelDensity = parseInt(name.split('@')[1], 10) || 1

      const densitySuffix = pixelDensity === 1 ? '' : `@${pixelDensity}x`

      const relativeFixturePathWithoutExtension = `../fixtures/sprites/${username}/sprite${densitySuffix}`

      if (format === 'json') {
        const spritejson = fs.readFileSync(
          path.join(__dirname, `${relativeFixturePathWithoutExtension}.json`),
          'utf8'
        )

        const etag = createETag(spritejson)

        return res(
          ctx.set({ 'Content-Type': 'application/json', Etag: etag }),
          ctx.body(spritejson)
        )
      }

      if (format === 'png') {
        const imageBuffer = fs.readFileSync(
          path.resolve(__dirname, `${relativeFixturePathWithoutExtension}.png`)
        )

        const etag = createETag(imageBuffer)

        return res(
          ctx.set({
            'Content-Type': 'image/png',
            'Last-Modified': new Date().toUTCString(),
            'Content-Length': imageBuffer.byteLength.toString(),
            ETag: etag,
          }),
          ctx.body(imageBuffer)
        )
      }
    }
  ),
]

//
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

/**
 * @param {string | readonly string[]} param
 * @returns number
 */
function convertParamToNumber(param) {
  return Number.parseInt(Array.isArray(param) ? param[0] : param, 10)
}

// This configures a request mocking server with the given request handlers.
module.exports = setupServer(...handlers)
