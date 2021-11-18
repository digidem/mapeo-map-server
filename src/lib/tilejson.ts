/* eslint-disable @typescript-eslint/ban-types */
import { Static, Type as T } from '@sinclair/typebox'
import { JSONSchema7 } from 'json-schema'
import Ajv, { ValidateFunction, ErrorObject } from 'ajv/dist/2019'
import isUrl from 'is-url'

export enum Scheme {
  xyz = 'xyz',
  tms = 'tms',
}

// Format 'full' ensures that urls are also validated
const ajv = new Ajv({
  removeAdditional: false,
  useDefaults: true,
  coerceTypes: true,
  formats: {
    // Less strict uri validator, since strictly uris cannot have {z},{x},{y}
    uri: isUrl,
  },
})

const Shared = T.Box(
  {
    VectorLayer: T.Object({
      id: T.String(),
      fields: T.Record(
        T.String(),
        T.String()
        // The schema that this should be 'Number', 'Boolean', 'String' does not
        // seem to always be followed T.Union([T.Literal('Number'),
        // T.Literal('Boolean'), T.Literal('String')])
      ),
      description: T.Optional(T.String()),
      minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
      maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
      // These fields appear for Mapbox composite sources
      source: T.Optional(T.String()),
      source_name: T.Optional(T.String()),
    }),
  },
  { $id: 'Shared' }
)

ajv.addKeyword('kind').addKeyword('modifier').addSchema(Shared)

/**
 * This is TileJSON Schema v2.2.0
 * https://github.com/mapbox/tilejson-spec/tree/master/2.2.0
 */
export const TileJSONSchema = T.Intersect([
  T.Object({
    tilejson: T.Union([
      T.Literal('2.2.0'),
      T.Literal('2.1.0'),
      T.Literal('2.0.0'),
    ]),
    tiles: T.Array(T.String({ format: 'uri' })),
    name: T.Optional(T.String()),
    description: T.Optional(T.String()),
    /** The spec says this should be semver, but we allow any string */
    version: T.Optional(T.String()),
    bounds: T.Optional(
      T.Tuple([
        T.Number({ default: -180 }),
        T.Number({ default: -85.051129 }),
        T.Number({ default: 180 }),
        T.Number({ default: 85.051129 }),
      ])
    ),
    scheme: T.Optional(
      T.Union([T.Literal('xyz'), T.Literal('tms')], { default: Scheme.xyz })
    ),
    minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
    maxzoom: T.Optional(T.Number({ default: 30, minimum: 0, maximum: 30 })),
    attribution: T.Optional(T.String()),
    template: T.Optional(T.String()),
    legend: T.Optional(T.String()),
    grids: T.Optional(T.Array(T.String({ format: 'uri' }))),
    data: T.Optional(T.Array(T.String({ format: 'uri' }))),
    // Extended optional props, from the v3 proposal
    // https://github.com/mapbox/tilejson-spec/pull/36
    id: T.Optional(T.String()),
    fillzoom: T.Optional(T.Number()),
    vector_layers: T.Optional(T.Array(T.Ref(Shared, 'VectorLayer'))),
    // NB: This is not a required prop in tilejson v2.2.0, but most tilejson in
    // the wild includes it, and it is necessary for storing vector tiles.
    format: T.Union([
      T.Literal('jpg'),
      T.Literal('png'),
      T.Literal('webp'),
      T.Literal('pbf'),
    ]),
  }),
  T.Record(T.String(), T.Any()),
])

export type TileJSON = Static<typeof TileJSONSchema>

interface ValidateTileJSON {
  (data: unknown): data is TileJSON
  schema?: TileJSON | boolean
  errors?: null | Array<ErrorObject>
  refs?: object
  refVal?: Array<any>
  root?: ValidateFunction | object
  $async?: true
  source?: object
}

const validateTileJSONSchema = ajv.compile(TileJSONSchema) as ValidateTileJSON

export const validateTileJSON: ValidateTileJSON = (
  data: unknown
): data is TileJSON => {
  if (!validateTileJSONSchema(data)) {
    validateTileJSON.errors = validateTileJSONSchema.errors
    return false
  }
  validateTileJSON.errors = validateTileJSONSchema.errors
  // TileJSON in pbf format must have a vector_layers property (which will
  // already have been validated by ajv if it exists)
  if (data.format === 'pbf' && !data.vector_layers) return false
  return true
}
