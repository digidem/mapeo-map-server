/* eslint-disable @typescript-eslint/ban-types */
// @ts-ignore
import { validate as validateStyleJSON } from '@maplibre/maplibre-gl-style-spec'

import {
  LayerSpecification,
  StyleSpecification as StyleJSON,
} from './style-spec'
import { TileJSON } from './tilejson'
import { encodeBase32, hash, removeSearchParams } from './utils'

// If the style has an `upstreamUrl` property, indicating where it was
// downloaded from, then use that as the id (this way two clients that
// download the same style do not result in duplicates)s
function createIdFromStyleUrl(url: string) {
  return encodeBase32(hash(removeSearchParams(url, ['access_token'])))
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
const DEFAULT_VECTOR_SOURCE_ID = 'vector-source'

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

const lightColors = [
  'FC49A3', // pink
  'CC66FF', // purple-ish
  '66CCFF', // sky blue
  '66FFCC', // teal
  '00FF00', // lime green
  'FFCC66', // light orange
  'FF6666', // salmon
  'FF0000', // red
  'FF8000', // orange
  'FFFF66', // yellow
  '00FFFF', // turquoise
]

function randomColor(colors: string[]) {
  const randomNumber = Math.floor(Math.random() * colors.length)
  return colors[randomNumber]
}

export function createVectorStyle({
  name,
  url,
  vectorLayers,
}: {
  name: string
  url: string
  vectorLayers: NonNullable<TileJSON['vector_layers']>
}): StyleJSON {
  const layers: LayerSpecification[] = []
  const sourceId = DEFAULT_VECTOR_SOURCE_ID

  for (const layer of vectorLayers) {
    const layerColor = '#' + randomColor(lightColors)
    layers.push({
      id: `${layer.id}-polygons`,
      type: 'fill',
      source: sourceId,
      'source-layer': layer.id,
      filter: ['==', '$type', 'Polygon'],
      layout: {},
      paint: {
        'fill-opacity': 0.1,
        'fill-color': layerColor,
      },
    })
    layers.push({
      id: `${layer.id}-polygons-outline`,
      type: 'line',
      source: sourceId,
      'source-layer': layer.id,
      filter: ['==', '$type', 'Polygon'],
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': layerColor,
        'line-width': 1,
        'line-opacity': 0.75,
      },
    })
    layers.push({
      id: `${layer.id}-lines`,
      type: 'line',
      source: sourceId,
      'source-layer': layer.id,
      filter: ['==', '$type', 'LineString'],
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': layerColor,
        'line-width': 1,
        'line-opacity': 0.75,
      },
    })
    layers.push({
      id: `${layer.id}-pts`,
      type: 'circle',
      source: sourceId,
      'source-layer': layer.id,
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-color': layerColor,
        'circle-radius': 2.5,
        'circle-opacity': 0.75,
      },
    })
  }

  return {
    version: 8,
    name,
    sources: {
      [sourceId]: {
        type: 'vector',
        url,
      },
    },
    layers,
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
