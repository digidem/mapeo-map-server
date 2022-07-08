export interface Sprite {
  id: string
  data: Buffer
  pixelDensity: number
  layout: string
  etag: string | null
  upstreamUrl: string | null
}

const REQUESTABLE_FORMATS = ['json', 'png']

export function isRequestableFormat(format: string) {
  return REQUESTABLE_FORMATS.includes(format)
}

// TODO: Rename to something clearer
export function parseSpriteUrlName(input: string): {
  id: string
  pixelDensity: number
} {
  // Matches @_x and captures _, where _ is an integer or decimal (to tenth place)
  const [match, pixelDensity] = /@(:?\d+(\.\d{1})?)x$/i.exec(input) || [
    null,
    null,
  ]

  return {
    id: match ? input.split(match, 1)[0] : input,
    pixelDensity: pixelDensity ? parseInt(pixelDensity, 10) : 1,
  }
}
