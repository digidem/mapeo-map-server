import path from 'path'

import { StyleJSON } from './stylejson'

const SPACE_REGEX = / /g
export const DEFAULT_STATIC_FONT = 'Open Sans Regular'
export const SDF_STATIC_DIR = path.resolve(__dirname, '../../sdf')

// Returns an array of values where each value is a comma-separated string of font names
// Adapted version of https://github.com/digidem/mapbox-style-downloader/blob/695ed8a981efb9f0ece80cba8c81d075f9a0cdda/lib/glyphs.js#L21-L53
export function getFontStacks(style: StyleJSON): string[] {
  const fontStacks = new Set<string>()

  style.layers.forEach((layer) => {
    if (
      layer.layout &&
      'text-font' in layer.layout &&
      layer.layout['text-font']
    ) {
      const textFontValue = layer.layout['text-font']
      if (Array.isArray(textFontValue)) {
        if (
          textFontValue[0] === 'step' &&
          textFontValue[2] &&
          Array.isArray(textFontValue[2]) &&
          textFontValue[2][0] === 'literal'
        ) {
          if (Array.isArray(textFontValue[2][1])) {
            fontStacks.add(textFontValue[2][1].join(','))
          } else {
            fontStacks.add(textFontValue[2][1])
          }
        } else if (textFontValue[0] === 'literal') {
          if (Array.isArray(textFontValue[1])) {
            fontStacks.add(textFontValue[1].join(','))
          } else if (typeof textFontValue[1] === 'string') {
            fontStacks.add(textFontValue[1])
          }
        } else {
          fontStacks.add(textFontValue.join(','))
        }
      } else if (typeof textFontValue === 'string') {
        fontStacks.add(textFontValue)
      } else if ('stops' in textFontValue && textFontValue.stops) {
        textFontValue.stops.forEach((stop) => {
          const stack = Array.isArray(stop[1]) ? stop[1].join(',') : stop[1]
          fontStacks.add(stack)
        })
      }
    }
  })

  return [...fontStacks]
}

export function createStaticGlyphPath(
  font: string,
  start: number,
  end: number
) {
  // We replace the space character with a hyphen when saved in the filesystem
  const convertedFontName = font.replace(SPACE_REGEX, '-')
  return `${convertedFontName}/${start}-${end}.pbf`
}
