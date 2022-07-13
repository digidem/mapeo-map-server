import { Static, Type as T } from '@sinclair/typebox'
import Ajv from 'ajv/dist/2019'

import { encodeBase32, hash } from './utils'

// This is the 1-to-1 representation of the database schema record as defined in schema.prisma
export interface Sprite {
  id: string
  data: Buffer
  pixelDensity: number
  layout: string
  etag: string | null
  upstreamUrl: string | null
}

export type UpstreamSpriteResponse =
  | { data: Buffer; etag?: string; layout: SpriteIndex }
  | Error

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

const ajv = new Ajv()

ajv.addKeyword('kind').addKeyword('modifier')

export const validateSpriteIndex = ajv.compile<SpriteIndex>(SpriteIndexSchema)

export function parseSpriteName(input: string): {
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
    pixelDensity: pixelDensity ? parseFloat(pixelDensity) : 1,
  }
}

export function generateSpriteId(upstreamSpriteUrl: string) {
  return encodeBase32(hash(upstreamSpriteUrl))
}
