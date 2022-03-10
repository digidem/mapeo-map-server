/* eslint-disable @typescript-eslint/ban-types */
import {
  ArrayOptions,
  ObjectOptions,
  Static,
  StringOptions,
  TSchema,
  Type as T,
} from '@sinclair/typebox'
import Ajv from 'ajv/dist/2019'
import isUrl from 'is-url'

const ColorSpecificationSchema = (options?: StringOptions<string>) =>
  T.String(options)

const ExpressionSpecificationSchema = (options?: ArrayOptions) =>
  T.Array(T.Unknown(), options)

const ResolvedImageSpecificationSchema = (options?: StringOptions<string>) =>
  T.String(options)

const FormattedSpecificationSchema = (options?: StringOptions<string>) =>
  T.String(options)

const TransitionSpecificationSchema = (options?: ObjectOptions) =>
  T.Object(
    {
      duration: T.Optional(T.Number({ minimum: 0, default: 300 })),
      delay: T.Optional(T.Number({ minimum: 0, default: 0 })),
    },
    options
  )

const CameraFunctionSpecificationSchema = <T extends TSchema>(type: T) =>
  T.Union([
    T.Object({
      type: T.Literal('exponential'),
      stops: T.Array(T.Tuple([T.Number(), type])),
    }),
    T.Object({
      type: T.Literal('interval'),
      stops: T.Array(T.Tuple([T.Number(), type])),
    }),
  ])

const SourceFunctionSpecificationSchema = <T extends TSchema>(type: T) =>
  T.Union([
    T.Object({
      type: T.Literal('exponential'),
      stops: T.Array(T.Tuple([T.Number(), type])),
      property: T.String(),
      default: T.Optional(type),
    }),
    T.Object({
      type: T.Literal('interval'),
      stops: T.Array(T.Tuple([T.Number(), type])),
      property: T.String(),
      default: T.Optional(type),
    }),
    T.Object({
      type: T.Literal('categorical'),
      stops: T.Array(
        T.Tuple([T.Union([T.String(), T.Number(), T.Boolean()]), type])
      ),
      property: T.String(),
      default: T.Optional(type),
    }),
    T.Object({
      type: T.Literal('identity'),
      property: T.String(),
      default: T.Optional(type),
    }),
  ])

const CompositeFunctionSpecificationSchema = <T extends TSchema>(type: T) =>
  T.Union([
    T.Object({
      type: T.Literal('exponential'),
      stops: T.Array(
        T.Tuple([
          T.Object({
            zoom: T.Number(),
            value: T.Number(),
          }),
          type,
        ])
      ),
      property: T.String(),
      default: T.Optional(type),
    }),
    T.Object({
      type: T.Literal('interval'),
      stops: T.Array(
        T.Tuple([
          T.Object({
            zoom: T.Number(),
            value: T.Number(),
          }),
          type,
        ])
      ),
      property: T.String(),
      default: T.Optional(type),
    }),
    T.Object({
      type: T.Literal('categorical'),
      stops: T.Array(
        T.Tuple([
          T.Object({
            zoom: T.Number(),
            value: T.Union([T.String(), T.Number(), T.Boolean()]),
          }),
          type,
        ])
      ),
      property: T.String(),
      default: T.Optional(type),
    }),
  ])

const PropertyValueSpecificationSchema = <T extends TSchema>(type: T) =>
  T.Union([
    type,
    CameraFunctionSpecificationSchema(type),
    ExpressionSpecificationSchema(),
  ])

const DataDrivenPropertyValueSpecificationSchema = <T extends TSchema>(
  type: T
) =>
  T.Union([
    type,
    CameraFunctionSpecificationSchema(type),
    SourceFunctionSpecificationSchema(type),
    CompositeFunctionSpecificationSchema(type),
    ExpressionSpecificationSchema(),
  ])

const LightSpecificationSchema = T.Object({
  anchor: T.Optional(
    PropertyValueSpecificationSchema(
      T.Union([T.Literal('map'), T.Literal('viewport')], {
        default: 'viewport',
      })
    )
  ),
  position: T.Optional(
    T.Tuple([T.Number(), T.Number(), T.Number()], { default: [1.15, 210, 30] })
  ),
  color: T.Optional(
    PropertyValueSpecificationSchema(
      ColorSpecificationSchema({ default: '#ffffff' })
    )
  ),
  intesity: T.Optional(
    PropertyValueSpecificationSchema(
      T.Number({ minimum: 0, maximum: 1, default: 0.5 })
    )
  ),
})
type LightSpecification = Static<typeof LightSpecificationSchema>

const FilterSpecificationSchema = T.Rec((Self) =>
  T.Union([
    T.Tuple([T.Literal('has'), T.String()]),
    T.Tuple([T.Literal('!has'), T.String()]),
    T.Tuple([
      T.Literal('=='),
      T.String(),
      T.Union([T.String(), T.Number(), T.Boolean()]),
    ]),
    T.Tuple([
      T.Literal('!='),
      T.String(),
      T.Union([T.String(), T.Number(), T.Boolean()]),
    ]),
    T.Tuple([
      T.Literal('>'),
      T.String(),
      T.Union([T.String(), T.Number(), T.Boolean()]),
    ]),
    T.Tuple([
      T.Literal('>='),
      T.String(),
      T.Union([T.String(), T.Number(), T.Boolean()]),
    ]),
    T.Tuple([
      T.Literal('<'),
      T.String(),
      T.Union([T.String(), T.Number(), T.Boolean()]),
    ]),
    T.Tuple([
      T.Literal('<='),
      T.String(),
      T.Union([T.String(), T.Number(), T.Boolean()]),
    ]),
    T.Array(T.Union([T.String(), Self])),
  ])
)
type FilterSpecification = Static<typeof FilterSpecificationSchema>

/**
 * Layers
 */
const FillLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('fill'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      'fill-sort-key': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')], {
          default: 'visible',
        })
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'fill-antialias': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean({ default: true }))
      ),
      'fill-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 1, default: 1 })
        )
      ),
      'fill-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: '#000000' })
        )
      ),
      'fill-outline-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema())
      ),
      'fill-translate': T.Optional(
        PropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number()], { default: [0, 0] })
        )
      ),
      'fill-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')], { default: 'map' })
        )
      ),
      'fill-pattern': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ResolvedImageSpecificationSchema()
        )
      ),
    })
  ),
})
type FillLayerSpecification = Static<typeof FillLayerSpecificationSchema>

const LineLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('line'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      'line-cap': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union(
            [T.Literal('butt'), T.Literal('round'), T.Literal('square')],
            { default: 'butt' }
          )
        )
      ),
      'line-join': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Union(
            [T.Literal('bevel'), T.Literal('round'), T.Literal('miter')],
            { default: 'miter' }
          )
        )
      ),
      'line-miter-limit': T.Optional(
        PropertyValueSpecificationSchema(T.Number({ default: 2 }))
      ),
      'line-round-limit': T.Optional(
        PropertyValueSpecificationSchema(T.Number({ default: 1.05 }))
      ),
      'line-sort-key': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')], {
          default: 'visible',
        })
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'line-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 1, default: 1 })
        )
      ),
      'line-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: '#000000' })
        )
      ),
      'line-translate': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number()], { default: [0, 0] })
        )
      ),
      'line-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')], { default: 'map' })
        )
      ),
      'line-width': T.Optional(
        PropertyValueSpecificationSchema(T.Number({ minimum: 0, default: 1 }))
      ),
      'line-gap-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 0 })
        )
      ),
      'line-offset': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number({ default: 0 }))
      ),
      'line-blur': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 0 })
        )
      ),
      'line-dasharray': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number({ minimum: 0 }))
      ),
      'line-pattern': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ResolvedImageSpecificationSchema()
        )
      ),
      'line-gradient': T.Optional(ExpressionSpecificationSchema()),
    })
  ),
})
type LineLayerSpecification = Static<typeof LineLayerSpecificationSchema>

const SymbolLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('line'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      'symbol-placement': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union(
            [T.Literal('point'), T.Literal('line'), T.Literal('line-center')],
            { default: 'point' }
          )
        )
      ),
      'symbol-spacing': T.Optional(
        PropertyValueSpecificationSchema(T.Number({ default: 250 }))
      ),
      'symbol-avoid-edges': PropertyValueSpecificationSchema(
        T.Boolean({ default: false })
      ),
      'symbol-sort-key': DataDrivenPropertyValueSpecificationSchema(T.Number()),
      'symbol-z-order': PropertyValueSpecificationSchema(
        T.Union(
          [T.Literal('auto'), T.Literal('viewport-y'), T.Literal('source')],
          { default: 'auto' }
        )
      ),
      'icon-allow-overlap': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean({ default: false }))
      ),
      'icon-ignore-placement': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean({ default: false }))
      ),
      'icon-optional': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean({ default: false }))
      ),
      'icon-rotation-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union(
            [T.Literal('map'), T.Literal('viewport'), T.Literal('auto')],
            { default: 'auto' }
          )
        )
      ),
      'icon-size': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 1 })
        )
      ),
      'icon-text-fit': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union(
            [
              T.Literal('none'),
              T.Literal('width'),
              T.Literal('height'),
              T.Literal('both'),
            ],
            { default: 'none' }
          )
        )
      ),
      'icon-text-fit-padding': T.Optional(
        PropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number(), T.Number(), T.Number()], {
            default: [0, 0, 0, 0],
          })
        )
      ),
      'icon-image': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ResolvedImageSpecificationSchema()
        )
      ),
      'icon-rotate': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number({ default: 0 }))
      ),
      'icon-padding': T.Optional(
        PropertyValueSpecificationSchema(T.Number({ minimum: 0, default: 2 }))
      ),
      'icon-keep-upright': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean({ default: false }))
      ),
      'icon-offset': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number()], { default: [0, 0] })
        )
      ),
      'icon-anchor': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Union(
            [
              T.Literal('center'),
              T.Literal('left'),
              T.Literal('right'),
              T.Literal('top'),
              T.Literal('bottom'),
              T.Literal('top-left'),
              T.Literal('top-right'),
              T.Literal('bottom-left'),
              T.Literal('bottom-right'),
            ],
            { default: 'center' }
          )
        )
      ),
      'icon-pitch-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union(
            [T.Literal('map'), T.Literal('viewport'), T.Literal('auto')],
            { default: 'auto' }
          )
        )
      ),
      'text-pitch-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union(
            [T.Literal('map'), T.Literal('viewport'), T.Literal('auto')],
            { default: 'auto' }
          )
        )
      ),
      'text-rotation-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union(
            [T.Literal('map'), T.Literal('viewport'), T.Literal('auto')],
            { default: 'auto' }
          )
        )
      ),
      'text-field': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          FormattedSpecificationSchema({ default: '' })
        )
      ),
      'text-font': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Array(T.String(), {
            default: ['Open Sans Regular', 'Arial Unicode MS Regular'],
          })
        )
      ),
      'text-size': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({
            minimum: 0,
            default: 16,
          })
        )
      ),
      'text-max-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 10 })
        )
      ),
      'text-line-height': T.Optional(
        PropertyValueSpecificationSchema(T.Number({ default: 1.2 }))
      ),
      'text-letter-spacing': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number({ default: 0 }))
      ),
      'text-justify': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Union(
            [
              T.Literal('auto'),
              T.Literal('left'),
              T.Literal('center'),
              T.Literal('right'),
            ],
            { default: 'center' }
          )
        )
      ),
      'text-radial-offset': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number({ default: 0 }))
      ),
      'text-variable-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Array(
            T.Union([
              T.Literal('center'),
              T.Literal('left'),
              T.Literal('right'),
              T.Literal('top'),
              T.Literal('bottom'),
              T.Literal('top-left'),
              T.Literal('top-right'),
              T.Literal('bottom-left'),
              T.Literal('bottom-right'),
            ])
          )
        )
      ),
      'text-anchor': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Union(
            [
              T.Literal('center'),
              T.Literal('left'),
              T.Literal('right'),
              T.Literal('top'),
              T.Literal('bottom'),
              T.Literal('top-left'),
              T.Literal('top-right'),
              T.Literal('bottom-left'),
              T.Literal('bottom-right'),
            ],
            { default: 'center' }
          )
        )
      ),
      'text-max-angle': T.Optional(
        PropertyValueSpecificationSchema(T.Number({ default: 45 }))
      ),
      'text-writing-mode': T.Optional(
        PropertyValueSpecificationSchema(
          T.Array(T.Union([T.Literal('horizontal'), T.Literal('vertical')]))
        )
      ),
      'text-rotate': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number({ default: 0 }))
      ),
      'text-padding': T.Optional(
        PropertyValueSpecificationSchema(T.Number({ minimum: 0, default: 2 }))
      ),
      'text-keep-upright': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean({ default: true }))
      ),
      'text-transform': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Union(
            [T.Literal('none'), T.Literal('uppercase'), T.Literal('lowercase')],
            { default: 'none' }
          )
        )
      ),
      'text-offset': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number()], { default: [0, 0] })
        )
      ),
      'text-allow-overlap': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Boolean({ default: false })
        )
      ),
      'text-ignore-placement': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Boolean({ default: false })
        )
      ),
      'text-optional': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean({ default: false }))
      ),
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')], {
          default: 'visible',
        })
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'icon-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 1, default: 1 })
        )
      ),
      'icon-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: '#000000' })
        )
      ),
      'icon-halo-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: 'rgba(0, 0, 0, 0)' })
        )
      ),
      'icon-halo-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 0 })
        )
      ),
      'icon-halo-blur': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 0 })
        )
      ),
      'icon-translate': T.Optional(
        PropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number()], { default: [0, 0] })
        )
      ),
      'icon-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')], { default: 'map' })
        )
      ),
      'text-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 1, default: 1 })
        )
      ),
      'text-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: '#000000' })
        )
      ),
      'text-halo-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: 'rgba(0, 0, 0, 0)' })
        )
      ),
      'text-halo-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 0 })
        )
      ),
      'text-halo-blur': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 0 })
        )
      ),
      'text-translate': T.Optional(
        PropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number()], { default: [0, 0] })
        )
      ),
      'text-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')], { default: 'map' })
        )
      ),
    })
  ),
})
type SymbolLayerSpecification = Static<typeof SymbolLayerSpecificationSchema>

const CircleLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('circle'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      'circle-sort-key': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')], {
          default: 'visible',
        })
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'circle-radius': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 5 })
        )
      ),
      'circle-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: '#000000' })
        )
      ),
      'circle-blur': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number({ default: 0 }))
      ),
      'circle-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 1, default: 1 })
        )
      ),
      'circle-translate': T.Optional(
        PropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number()], { default: [0, 0] })
        )
      ),
      'circle-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')], { default: 'map' })
        )
      ),
      'circle-pitch-scale': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')], { default: 'map' })
        )
      ),
      'circle-pitch-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')], {
            default: 'viewport',
          })
        )
      ),
      'circle-stroke-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 0 })
        )
      ),
      'circle-stroke-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: '#000000' })
        )
      ),
      'circle-stroke-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 0, default: 1 })
        )
      ),
    })
  ),
})
type CircleLayerSpecification = Static<typeof CircleLayerSpecificationSchema>

const HeatmapLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('heatmap'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')], {
          default: 'visible',
        })
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'heatmap-radius': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 1, default: 30 })
        )
      ),
      'heatmap-weight': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 1 })
        )
      ),
      'heatmap-intensity': T.Optional(
        PropertyValueSpecificationSchema(T.Number({ minimum: 0, default: 1 }))
      ),
      'heatmap-color': T.Optional(
        ExpressionSpecificationSchema({
          default: [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(0, 0, 255, 0)',
            0.1,
            'royalblue',
            0.3,
            'cyan',
            0.5,
            'lime',
            0.7,
            'yellow',
            1,
            'red',
          ],
        })
      ),
      'heatmap-opacity': T.Optional(
        PropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 1, default: 1 })
        )
      ),
    })
  ),
})
type HeatmapLayerSpecification = Static<typeof HeatmapLayerSpecificationSchema>

const FillExtrusionLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('fill-extrusion'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')], {
          default: 'visible',
        })
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'fill-extrusion-opacity': T.Optional(
        PropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 1, default: 1 })
        )
      ),
      'fill-extrusion-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: '#000000' })
        )
      ),
      'fill-extrusion-translate': T.Optional(
        PropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number()], { default: [0, 0] })
        )
      ),
      'fill-extrusion-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')], { default: 'map' })
        )
      ),
      'fill-extrusion-pattern': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ResolvedImageSpecificationSchema()
        )
      ),
      'fill-extrusion-height': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 0 })
        )
      ),
      'fill-extrusion-base': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Number({ minimum: 0, default: 0 })
        )
      ),
      'fill-extrusion-vertical-gradient': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean({ default: true }))
      ),
    })
  ),
})
type FillExtrusionLayerSpecification = Static<
  typeof FillExtrusionLayerSpecificationSchema
>

const RasterLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('raster'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')], {
          default: 'visible',
        })
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'raster-opacity': T.Optional(
        PropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 1, default: 1 })
        )
      ),
      'raster-hue-rotate': T.Optional(
        PropertyValueSpecificationSchema(T.Number({ default: 0 }))
      ),
      'raster-brightness-min': T.Optional(
        PropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 1, default: 0 })
        )
      ),
      'raster-brightness-max': T.Optional(
        PropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 1, default: 1 })
        )
      ),
      'raster-saturation': T.Optional(
        PropertyValueSpecificationSchema(
          T.Number({ minimum: -1, maximum: 1, default: 0 })
        )
      ),
      'raster-contrast': T.Optional(
        PropertyValueSpecificationSchema(
          T.Number({ minimum: -1, maximum: 1, default: 0 })
        )
      ),
      'raster-resampling': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('linear'), T.Literal('nearest')], {
            default: 'linear',
          })
        )
      ),
      'raster-fade-duration': T.Optional(
        PropertyValueSpecificationSchema(T.Number({ minimum: 0, default: 300 }))
      ),
    })
  ),
})
type RasterLayerSpecification = Static<typeof RasterLayerSpecificationSchema>

const HillshadeLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('hillshade'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')], {
          default: 'visible',
        })
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'hillshade-illumination-direction': T.Optional(
        PropertyValueSpecificationSchema(
          T.Number({ minimum: 0, maximum: 359, default: 335 })
        )
      ),
      'hillshade-illumination-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')], {
            default: 'viewport',
          })
        )
      ),
      'hillshade-exaggeration': T.Optional(
        PropertyValueSpecificationSchema(
          T.Number({
            minimum: 0,
            maximum: 1,
            default: 0.5,
          })
        )
      ),
      'hillshade-shadow-color': T.Optional(
        PropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: '#000000' })
        )
      ),
      'hillshade-highlight-color': T.Optional(
        PropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: '#ffffff' })
        )
      ),
      'hillshade-accent-color': T.Optional(
        PropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: '#000000' })
        )
      ),
    })
  ),
})
type HillshadeLayerSpecification = Static<
  typeof HillshadeLayerSpecificationSchema
>

const BackgroundLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('background'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')], {
          default: 'visible',
        })
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'background-color': T.Optional(
        PropertyValueSpecificationSchema(
          ColorSpecificationSchema({ default: '#000000' })
        )
      ),
      'background-pattern': T.Optional(
        PropertyValueSpecificationSchema(ResolvedImageSpecificationSchema())
      ),
      'background-opacity': T.Optional(
        PropertyValueSpecificationSchema(
          T.Number({
            minimum: 0,
            maximum: 1,
            default: 1,
          })
        )
      ),
    })
  ),
})
type BackgroundLayerSpecification = Static<
  typeof BackgroundLayerSpecificationSchema
>

const LayerSpecificationSchema = T.Union([
  FillLayerSpecificationSchema,
  LineLayerSpecificationSchema,
  SymbolLayerSpecificationSchema,
  CircleLayerSpecificationSchema,
  HeatmapLayerSpecificationSchema,
  FillExtrusionLayerSpecificationSchema,
  RasterLayerSpecificationSchema,
  HillshadeLayerSpecificationSchema,
  BackgroundLayerSpecificationSchema,
])
type LayerSpecification = Static<typeof LayerSpecificationSchema>

/**
 * Sources
 */
const PromoteIdSpecificationSchema = T.Union([
  T.Record(T.String(), T.String()),
  T.String(),
])
type PromoteIdSpecification = Static<typeof PromoteIdSpecificationSchema>

const VectorSourceSpecificationSchema = T.Object({
  type: T.Literal('vector'),
  url: T.Optional(T.String({ format: 'uri' })),
  tiles: T.Optional(T.Array(T.String())),
  bounds: T.Optional(
    T.Tuple([T.Number(), T.Number(), T.Number(), T.Number()], {
      default: [-180, -85.051129, 180, 85.051129],
    })
  ),
  scheme: T.Optional(
    T.Union([T.Literal('xyz'), T.Literal('tms')], { default: 'xyz' })
  ),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 30, default: 0 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 30, default: 22 })),
  attribution: T.Optional(T.String()),
  promoteId: T.Optional(PromoteIdSpecificationSchema),
  volatile: T.Optional(T.Boolean({ default: false })),
})
type VectorSourceSpecification = Static<typeof VectorSourceSpecificationSchema>

const RasterSourceSpecificationSchema = T.Object({
  type: T.Literal('raster'),
  url: T.Optional(T.String({ format: 'uri' })),
  tiles: T.Optional(T.Array(T.String())),
  bounds: T.Optional(
    T.Tuple([T.Number(), T.Number(), T.Number(), T.Number()], {
      default: [-180, -85.051129, 180, 85.051129],
    })
  ),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 30, default: 0 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 30, default: 22 })),
  tileSize: T.Optional(T.Number({ default: 512 })),
  scheme: T.Optional(
    T.Union([T.Literal('xyz'), T.Literal('tms')], { default: 'xyz' })
  ),
  attribution: T.Optional(T.String()),
  volatile: T.Optional(T.Boolean({ default: false })),
})
type RasterSourceSpecification = Static<typeof RasterSourceSpecificationSchema>

const RasterDEMSourceSpecificationSchema = T.Object({
  type: T.Literal('raster-dem'),
  url: T.Optional(T.String({ format: 'uri' })),
  tiles: T.Optional(T.Array(T.String())),
  bounds: T.Optional(
    T.Tuple([T.Number(), T.Number(), T.Number(), T.Number()], {
      default: [-180, -85.051129, 180, 85.051129],
    })
  ),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 30, default: 0 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 30, default: 22 })),
  tileSize: T.Optional(T.Number({ default: 512 })),
  attribution: T.Optional(T.String()),
  encoding: T.Optional(
    T.Union([T.Literal('terrarium'), T.Literal('mapbox')], {
      default: 'mapbox',
    })
  ),
  volatile: T.Optional(T.Boolean({ default: false })),
})
type RasterDEMSourceSpecification = Static<
  typeof RasterDEMSourceSpecificationSchema
>

const GeoJSONSourceSpecificationSchema = T.Object({
  type: T.Literal('geojson'),
  data: T.Optional(T.Unknown()),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 30, default: 18 })),
  attribution: T.Optional(T.String()),
  buffer: T.Optional(T.Number({ minimum: 0, maximum: 512, default: 128 })),
  filter: T.Optional(T.Unknown()),
  tolerance: T.Optional(T.Number({ default: 0.375 })),
  cluster: T.Optional(T.Boolean({ default: false })),
  clusterRadius: T.Optional(T.Number({ minimum: 0, default: 50 })),
  clusterMaxZoom: T.Optional(T.Number()),
  clusterMinPoints: T.Optional(T.Number()),
  clusterProperties: T.Optional(T.Unknown()),
  lineMetrics: T.Optional(T.Boolean({ default: false })),
  generateId: T.Optional(T.Boolean({ default: false })),
  promoteId: T.Optional(PromoteIdSpecificationSchema),
})
type GeoJSONSourceSpecification = Static<
  typeof GeoJSONSourceSpecificationSchema
>

const VideoSourceSpecificationSchema = T.Object({
  type: T.Literal('video'),
  urls: T.Array(T.String({ format: 'uri' })),
  coordinates: T.Tuple([
    T.Tuple([T.Number(), T.Number()]),
    T.Tuple([T.Number(), T.Number()]),
    T.Tuple([T.Number(), T.Number()]),
    T.Tuple([T.Number(), T.Number()]),
  ]),
})
type VideoSourceSpecification = Static<typeof VideoSourceSpecificationSchema>

const ImageSourceSpecificationSchema = T.Object({
  type: T.Literal('image'),
  urls: T.Array(T.String()),
  coordinates: T.Tuple([
    T.Tuple([T.Number(), T.Number()]),
    T.Tuple([T.Number(), T.Number()]),
    T.Tuple([T.Number(), T.Number()]),
    T.Tuple([T.Number(), T.Number()]),
  ]),
})
type ImageSourceSpecification = Static<typeof ImageSourceSpecificationSchema>

const SourceSpecificationSchema = T.Union([
  VectorSourceSpecificationSchema,
  RasterSourceSpecificationSchema,
  RasterDEMSourceSpecificationSchema,
  GeoJSONSourceSpecificationSchema,
  VideoSourceSpecificationSchema,
  ImageSourceSpecificationSchema,
])
type SourceSpecification = Static<typeof SourceSpecificationSchema>

const StyleJSONSchema = T.Object({
  upstreamUrl: T.Optional(T.String()),
  version: T.Literal(8),
  name: T.Optional(T.String()),
  metadata: T.Optional(T.Unknown()),
  center: T.Optional(T.Array(T.Number())),
  zoom: T.Optional(T.Number({ minimum: 0, maximum: 30 })),
  bearing: T.Optional(T.Number({ default: 0 })),
  light: T.Optional(LightSpecificationSchema),
  pitch: T.Optional(T.Number({ default: 0 })),
  sources: T.Record(T.String(), SourceSpecificationSchema),
  sprite: T.Optional(T.String()),
  glyphs: T.Optional(T.String()),
  transition: T.Optional(TransitionSpecificationSchema()),
  layers: T.Array(LayerSpecificationSchema),
})
type StyleJSON = Static<typeof StyleJSONSchema>

const OfflineStyleSchema = T.Intersect([
  StyleJSONSchema,
  T.Object({
    id: T.String(),
    sources: T.Record(
      T.String(),
      T.Object({
        tilesetId: T.String(),
      })
    ),
  }),
])
type OfflineStyle = Static<typeof OfflineStyleSchema>

const ajv = new Ajv({
  removeAdditional: false,
  useDefaults: true,
  coerceTypes: true,
  formats: {
    // Less strict uri validator, since strictly uris cannot have {z},{x},{y}
    uri: isUrl,
  },
})

ajv.addKeyword('kind').addKeyword('modifier')

const validateStyleJSONSchema = ajv.compile<StyleJSON>(StyleJSONSchema)

// TODO: Validation using mapbox-gl-style-spec validator
const validateStyleJSON = (data: unknown) => {}

export {
  // TypeBox Schema Objects
  BackgroundLayerSpecificationSchema,
  CircleLayerSpecificationSchema,
  FillExtrusionLayerSpecificationSchema,
  FillLayerSpecificationSchema,
  FilterSpecificationSchema,
  GeoJSONSourceSpecificationSchema,
  HeatmapLayerSpecificationSchema,
  HillshadeLayerSpecificationSchema,
  ImageSourceSpecificationSchema,
  LayerSpecificationSchema,
  LightSpecificationSchema,
  LineLayerSpecificationSchema,
  PromoteIdSpecificationSchema,
  OfflineStyleSchema,
  RasterDEMSourceSpecificationSchema,
  RasterLayerSpecificationSchema,
  RasterSourceSpecificationSchema,
  SourceSpecificationSchema,
  StyleJSONSchema,
  SymbolLayerSpecificationSchema,
  VectorSourceSpecificationSchema,
  VideoSourceSpecificationSchema,
  // Static TS types
  BackgroundLayerSpecification,
  CircleLayerSpecification,
  FillExtrusionLayerSpecification,
  FillLayerSpecification,
  FilterSpecification,
  GeoJSONSourceSpecification,
  HeatmapLayerSpecification,
  HillshadeLayerSpecification,
  ImageSourceSpecification,
  LayerSpecification,
  LightSpecification,
  LineLayerSpecification,
  OfflineStyle,
  PromoteIdSpecification,
  RasterDEMSourceSpecification,
  RasterLayerSpecification,
  RasterSourceSpecification,
  SourceSpecification,
  StyleJSON,
  SymbolLayerSpecification,
  VectorSourceSpecification,
  VideoSourceSpecification,
  // Validator functions
  validateStyleJSON,
  validateStyleJSONSchema,
}
