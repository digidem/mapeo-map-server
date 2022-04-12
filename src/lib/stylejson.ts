/* eslint-disable @typescript-eslint/ban-types */
import {
  validate as validateStyleJSON,
  StyleSpecification as StyleJSON,
  SourceSpecification,
} from '@maplibre/maplibre-gl-style-spec'

import { encodeBase32, generateId, hash } from './utils'

type OfflineSource = SourceSpecification & {
  tilesetId: string
}

type OfflineStyle = StyleJSON & {
  id: string
  upstreamUrl?: string
  sources: {
    [_: string]: OfflineSource
  }
}

function isOfflineStyle(
  style: StyleJSON | OfflineStyle
): style is OfflineStyle {
  // TODO: Should we also check that each source is an offline source? What if sources are updated via PUT where new ones are defined?
  return !!(style as OfflineStyle).id
}

function isOfflineSource(source: unknown): source is OfflineSource {
  return !!(source as OfflineSource).tilesetId
}

function createIdFromStyleUrl(url: string) {
  return encodeBase32(hash(url))
}

/**
 * Try to get an idempotent ID for a given style.json, fallback to random ID
 */
function getStyleId(style: StyleJSON | OfflineStyle): string {
  if (isOfflineStyle(style)) {
    // If the style has an `upstreamUrl` property, indicating where it was
    // downloaded from, then use that as the id (this way two clients that
    // download the same style do not result in duplicates)s
    if (style.upstreamUrl) {
      return createIdFromStyleUrl(style.upstreamUrl)
    }

    return style.id
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
    throw new Error(errors.map((err) => err.message).join('\n'))
  }
}

export {
  OfflineSource,
  OfflineStyle,
  StyleJSON,
  createIdFromStyleUrl,
  getStyleId,
  isOfflineSource,
  isOfflineStyle,
  uncompositeStyle,
  validate,
}
