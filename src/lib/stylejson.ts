/* eslint-disable @typescript-eslint/ban-types */
import { URL } from 'url'
// @ts-ignore
import { validate as validateStyleJSON } from '@maplibre/maplibre-gl-style-spec'

import { StyleSpecification as StyleJSON } from './style-spec'
import { encodeBase32, hash } from './utils'

// If the style has an `upstreamUrl` property, indicating where it was
// downloaded from, then use that as the id (this way two clients that
// download the same style do not result in duplicates)s
function createIdFromStyleUrl(url: string) {
  const u = new URL(url)
  u.searchParams.delete('access_token')
  return encodeBase32(hash(u.toString()))
}

/**
 * TODO: Mapbox styles are sometimes served with sources combined into a single
 * "composite" source. Since core Mapbox sources (e.g. streets, satellite,
 * outdoors etc) can appear in several different styles, this function should
 * extract them from the composite style and adjust the style layers to point to
 * the original source, not the composite. This will save downloading Mapbox
 * sources multiple times for each style they appear in.
 *
 * https://docs.mapbox.com/api/maps/styles/
 */
async function uncompositeStyle(style: StyleJSON): Promise<StyleJSON> {
  // 1. Check if style.sources includes source named "composite"
  // 2. Check if "composite" includes a source id that starts with 'mapbox.'
  // 3. Download the composite source tilejson and check vector_layers for
  // 4. Add any 'mapbox.' sources from 'composite' as separate sources
  // 5. Re-write style.layers for layers to use 'mapbox.' sources rather than
  // 6. Re-write the composite source to not include 'mapbox.' source ids
  return style
}

function validate(style: unknown): asserts style is StyleJSON {
  const errors = validateStyleJSON(style)

  if (errors.length > 0) {
    // TODO: not sure what the best thing to throw here is
    throw new Error(errors.map((err: Error) => err.message).join('\n'))
  }
}

const DEFAULT_RASTER_SOURCE_ID = 'raster-source'
const DEFAULT_RASTER_LAYER_ID = 'raster-layer'

function createRasterStyle({
  name,
  url,
  tileSize = 256,
}: {
  name: string
  url: string
  tileSize?: 256 | 512
}): StyleJSON {
  return {
    version: 8,
    name,
    sources: {
      [DEFAULT_RASTER_SOURCE_ID]: {
        type: 'raster',
        url,
        tileSize,
      },
    },
    layers: [
      {
        id: DEFAULT_RASTER_LAYER_ID,
        type: 'raster',
        source: DEFAULT_RASTER_SOURCE_ID,
      },
    ],
  }
}

export {
  DEFAULT_RASTER_SOURCE_ID,
  DEFAULT_RASTER_LAYER_ID,
  StyleJSON,
  createIdFromStyleUrl,
  createRasterStyle,
  uncompositeStyle,
  validate,
}
