import { rest } from 'msw'
import { createHash } from 'crypto'

export const handlers = [
  rest.get(
    // based on fixtures/good-tilejson/mapbox_raster_tilejson.json
    'http://*.tiles.mapbox.com/v3/aj.1x1-degrees/:zoom/:x/:y',
    async (req, res, ctx) => {
      const { x, y: tempY, zoom } = req.params

      const y = (tempY as string).replace('.png', '')

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
]

// An adjusted version of https://github.com/jshttp/etag/blob/4664b6e53c85a56521076f9c5004dd9626ae10c8/index.js#L39
function createETag(entity: string | Buffer): string {
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

function convertParamToNumber(param: string | readonly string[]): number {
  return Number.parseInt(Array.isArray(param) ? param[0] : param, 10)
}
