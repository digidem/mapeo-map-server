import { getTileBBox } from '@mapbox/whoots-js'

import { TileJSON } from './tilejson'

export interface TileHeaders {
  'Content-Type'?: string
  'Content-Encoding'?: string
}

// https://github.com/mapbox/tiletype/blob/0632405c008302c15dfdefb104789baac1c10d30/index.js#L45-L78
export function getTileHeaders(data: Buffer): TileHeaders {
  const head: TileHeaders = {}
  if (
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    head['Content-Type'] = 'image/png'
  } else if (
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[data.length - 2] === 0xff &&
    data[data.length - 1] === 0xd9
  ) {
    head['Content-Type'] = 'image/jpeg'
  } else if (
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x39 || data[4] === 0x37) &&
    data[5] === 0x61
  ) {
    head['Content-Type'] = 'image/gif'
  } else if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    head['Content-Type'] = 'image/webp'
    // deflate: recklessly assumes contents are PBF.
  } else if (data[0] === 0x78 && data[1] === 0x9c) {
    head['Content-Type'] = 'application/x-protobuf'
    head['Content-Encoding'] = 'deflate'
    // gzip: recklessly assumes contents are PBF.
  } else if (data[0] === 0x1f && data[1] === 0x8b) {
    head['Content-Type'] = 'application/x-protobuf'
    head['Content-Encoding'] = 'gzip'
  }
  return head
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

/**
 * Get the upstream tile URL for a particular tile
 * The provided tile coordinates should be based on the XYZ scheme,
 * which will then be converted to TMS if necessary based on the `upstreamScheme` that is provided
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

  // getTileBBox expects XYZ scheme and does the TMS conversion internally
  // https://github.com/mapbox/whoots-js#what-is-it
  // https://github.com/mapbox/whoots-js/blob/63b423ee084d47713256f9b0e310a0d3bbeeba64/index.mjs#L55
  const bbox = getTileBBox(x, y, zoom)

  const upstreamY =
    upstreamScheme === 'tms'
      ? convertTileFromScheme({ x, y, zoom }, 'xyz')[0].y
      : y

  const quadkey = tileToQuadKey({ x, y: upstreamY, zoom })

  const url = new URL(
    templateUrls[(x + upstreamY) % templateUrls.length]
      .replace(
        '{prefix}',
        (x % 16).toString(16) + (upstreamY % 16).toString(16)
      )
      .replace('{z}', String(zoom))
      .replace('{x}', String(x))
      .replace('{y}', String(upstreamY))
      .replace('{quadkey}', quadkey)
      .replace('{bbox-epsg-3857}', bbox)
      .replace('{ratio}', ratio ? `@${ratio}x` : '')
  )

  return url.toString()
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((d) => typeof d === 'string')
  )
}

/**
 * Returns tuple of [convertedTile, toScheme], where `toScheme` is mostly just useful for keeping track of what convertedTile represents
 **/
function convertTileFromScheme(
  tile: {
    x: number
    y: number
    zoom: number
  },
  fromScheme: NonNullable<TileJSON['scheme']>
): [
  {
    x: number
    y: number
    zoom: number
  },
  NonNullable<TileJSON['scheme']>
] {
  return [
    {
      ...tile,
      y: Math.pow(2, tile.zoom) - tile.y - 1,
    },
    fromScheme === 'tms' ? 'xyz' : 'tms',
  ]
}
