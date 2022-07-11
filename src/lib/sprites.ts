import { Static, Type as T } from '@sinclair/typebox'

// This is the 1-to-1 representation of the database schema record as defined in schema.prisma
export interface Sprite {
  id: string
  data: Buffer
  pixelDensity: number
  layout: string
  etag: string | null
  upstreamUrl: string | null
}

// https://docs.mapbox.com/mapbox-gl-js/style-spec/sprite/#index-file
export const SpriteIndexSchema = T.Record(
  T.String(),
  T.Object({
    width: T.Number(),
    height: T.Number(),
    x: T.Number(),
    y: T.Number(),
    pixelRatio: T.Number(),
    content: T.Optional(
      T.Tuple([T.Number(), T.Number(), T.Number(), T.Number()])
    ),
    stretchX: T.Optional(
      T.Array(T.Tuple([T.Number(), T.Number()]), { maxItems: 2 })
    ),
    stretchY: T.Optional(
      T.Array(T.Tuple([T.Number(), T.Number()]), { maxItems: 2 })
    ),
  })
)

export type SpriteIndex = Static<typeof SpriteIndexSchema>

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
