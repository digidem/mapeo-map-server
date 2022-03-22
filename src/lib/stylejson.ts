/* eslint-disable @typescript-eslint/ban-types */
import {
  validate as validateStyleJSON,
  StyleSpecification as StyleJSON,
} from '@maplibre/maplibre-gl-style-spec'

import { encodeBase32, generateId, hash } from './utils'

type OfflineStyle = StyleJSON & {
  id: string
  upstreamUrl?: string
  sources: StyleJSON['sources'] & {
    [_: string]: {
      tilesetId: string
    }
  }
}

function isOfflineStyle(style: unknown): style is OfflineStyle {
  return !!(style as OfflineStyle).id
}

/**
 * Try to get an idempotent ID for a given style.json, fallback to random ID
 */
function getStyleId(style: StyleJSON | OfflineStyle): string {
  // If the style has an `upstreamUrl` property, indicating where it was
  // downloaded from, then use that as the id (this way two clients that
  // download the same style do not result in duplicates)
  if (isOfflineStyle(style) && style.upstreamUrl) {
    return encodeBase32(hash(style.upstreamUrl))
  } else {
    return generateId()
  }
}

/**
 * TODO: Mapbox styles are sometimes served with sources combined into a single
 * "composite" source. Since core Mapbox sources (e.g. streets, satellite,
 * outdoors etc) can appear in several different styles, this function should
 * extract them from the composite style and adjust the style layers to point to
 * the original source, not the composite. This will save downloading Mapbox
 * sources multiple times for each style they appear in.
 */
async function uncompositeStyle(style: StyleJSON): Promise<StyleJSON> {
  // TODO:
  // 1. Check if style.sources includes source named "composite"
  // 2. Check in "composite" includes a source id that starts with 'mapbox.'
  // 3. Download the composite source tilejson and check vector_layers for
  //    source_layer ids that from from the 'mapbox.' source
  // 4. Add any 'mapbox.' sources from 'composite' as separate sources
  // 5. Re-write style.layers for layers to use 'mapbox.' sources rather than
  //    the composite source
  // 6. Re-write the composite source to not include 'mapbox.' source ids
  return style
}

export {
  OfflineStyle,
  StyleJSON,
  getStyleId,
  uncompositeStyle,
  validateStyleJSON,
}
