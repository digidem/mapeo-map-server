/* eslint-disable @typescript-eslint/ban-types */
import {
  ArrayOptions,
  ObjectOptions,
  Static,
  StringOptions,
  TSchema,
  Type as T,
} from '@sinclair/typebox'
import Ajv, { ValidateFunction, ErrorObject } from 'ajv/dist/2019'
import isUrl from 'is-url'
import { Scheme } from './tilejson'

enum Visibility {
  visible = 'visible',
  none = 'none',
}

enum EntityAnchor {
  viewport = 'viewport',
  map = 'map',
}

enum Encoding {
  terrarium = 'terrarium',
  mapbox = 'mapbox',
}

enum Join {
  bevel = 'bevel',
  miter = 'miter',
  round = 'round',
}

enum Cap {
  butt = 'butt',
  round = 'round',
  square = 'square',
}

enum SymbolPlacement {
  point = 'point',
  line = 'line',
  lineCenter = 'line-center',
}

enum SymbolZOrder {
  auto = 'auto',
  viewportY = 'viewport-y',
  source = 'source',
}

enum Alignment {
  auto = 'auto',
  map = 'map',
  viewport = 'viewport',
}

enum IconTextFit {
  none = 'none',
  width = 'width',
  height = 'height',
  both = 'both',
}

enum DirectionalAnchor {
  center = 'center',
  left = 'left',
  right = 'right',
  top = 'top',
  bottom = 'bottom',
  topLeft = 'top-left',
  topRight = 'top-right',
  bottomLeft = 'bottom-left',
  bottomRight = 'bottom-right',
}

enum Justify {
  auto = 'auto',
  left = 'left',
  right = 'right',
  center = 'center',
}

enum WritingMode {
  horizontal = 'horizontal',
  vertical = 'vertical',
}

enum TextTransform {
  none = 'none',
  uppercase = 'uppercase',
  lowercase = 'lowercase',
}

enum Resampling {
  linear = 'linear',
  nearest = 'nearest',
}

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
      // TODO: Specify default: (EntityAnchor.viewport)
      T.Union([T.Literal(EntityAnchor.map), T.Literal(EntityAnchor.viewport)])
    )
  ),
  position: T.Optional(
    T.Tuple([
      T.Number({ default: 1.15 }),
      T.Number({ default: 210 }),
      T.Number({ default: 30 }),
    ])
  ),
  color: T.Optional(
    PropertyValueSpecificationSchema(
      // TODO: Specify default ('#ffffff')
      ColorSpecificationSchema()
    )
  ),
  intesity: T.Optional(
    PropertyValueSpecificationSchema(
      // TODO: Specify default (0.5)
      T.Number({ minimum: 0, maximum: 1 })
    )
  ),
})
type LightSpecification = Static<typeof LightSpecificationSchema>

/**
// Issues with Rec https://github.com/sinclairzx81/typebox/issues/160
const IdealFilterSpecificationSchema = T.Rec(
  (Self) =>
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
    ]),
  { $id: 'Filter' }
)
 */

const FilterSpecificationSchema = T.Union([
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
  // The T.Any should really be a recursive type but typebox has issues with its Rec implementation
  // see IdealFilterSpecificationSchema
  T.Array(T.Union([T.String(), T.Any()])),
])
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
        // TODO: Specify default value (Visibility.visible)
        T.Union([T.Literal(Visibility.visible), T.Literal(Visibility.none)])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'fill-antialias': T.Optional(
        // TODO: Specify default value (true)
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'fill-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({ minimum: 0, maximum: 1 })
        )
      ),
      'fill-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ('#000000')
          ColorSpecificationSchema()
        )
      ),
      'fill-outline-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema())
      ),
      'fill-translate': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value ([0, 0])
          T.Tuple([T.Number(), T.Number()])
        )
      ),
      'fill-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (EntityAnchor.map)
          T.Union([
            T.Literal(EntityAnchor.map),
            T.Literal(EntityAnchor.viewport),
          ])
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
          // TODO: Specify default value (Cap.butt)
          T.Union([
            T.Literal(Cap.butt),
            T.Literal(Cap.round),
            T.Literal(Cap.square),
          ])
        )
      ),
      'line-join': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (Join.miter)
          T.Union([
            T.Literal(Join.bevel),
            T.Literal(Join.round),
            T.Literal(Join.miter),
          ])
        )
      ),
      'line-miter-limit': T.Optional(
        // TODO: Specify default value (2)
        PropertyValueSpecificationSchema(T.Number())
      ),
      'line-round-limit': T.Optional(
        // TODO: Specify default value (1.05)
        PropertyValueSpecificationSchema(T.Number())
      ),
      'line-sort-key': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      visibility: T.Optional(
        // TODO: Specify default value (Visibility.visible)
        T.Union([T.Literal(Visibility.visible), T.Literal(Visibility.none)])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'line-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({ minimum: 0, maximum: 1 })
        )
      ),
      'line-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ('#000000')
          ColorSpecificationSchema()
        )
      ),
      'line-translate': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ([0, 0])
          T.Tuple([T.Number(), T.Number()])
        )
      ),
      'line-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (EntityAnchor.map)
          T.Union([
            T.Literal(EntityAnchor.map),
            T.Literal(EntityAnchor.viewport),
          ])
        )
      ),
      'line-width': T.Optional(
        // TODO: Specify default value (1)
        PropertyValueSpecificationSchema(T.Number({ minimum: 0 }))
      ),
      'line-gap-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: 0 })
        )
      ),
      'line-offset': T.Optional(
        // TODO: Specify default value (0)
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'line-blur': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: 0 })
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
            // TODO: Specify default value (SymbolPlacement.point)
            [
              T.Literal(SymbolPlacement.point),
              T.Literal(SymbolPlacement.line),
              T.Literal(SymbolPlacement.lineCenter),
            ]
          )
        )
      ),
      'symbol-spacing': T.Optional(
        // TODO: Specify default value (250)
        PropertyValueSpecificationSchema(T.Number())
      ),
      'symbol-avoid-edges': PropertyValueSpecificationSchema(
        // TODO: Specify default value (false)
        T.Boolean()
      ),
      'symbol-sort-key': DataDrivenPropertyValueSpecificationSchema(T.Number()),
      'symbol-z-order': PropertyValueSpecificationSchema(
        // TODO: Specify default value (SymbolZOrder.auto)
        T.Union([
          T.Literal(SymbolZOrder.auto),
          T.Literal(SymbolZOrder.viewportY),
          T.Literal(SymbolZOrder.source),
        ])
      ),
      'icon-allow-overlap': T.Optional(
        // TODO: Specify default value (false)
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'icon-ignore-placement': T.Optional(
        // TODO: Specify default value (false)
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'icon-optional': T.Optional(
        // TODO: Specify default value (false)
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'icon-rotation-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (Alignment.auto)
          T.Union([
            T.Literal(Alignment.map),
            T.Literal(Alignment.viewport),
            T.Literal(Alignment.auto),
          ])
        )
      ),
      'icon-size': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({ minimum: 0 })
        )
      ),
      'icon-text-fit': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (IconTextFit.none)
          T.Union([
            T.Literal(IconTextFit.none),
            T.Literal(IconTextFit.width),
            T.Literal(IconTextFit.height),
            T.Literal(IconTextFit.both),
          ])
        )
      ),
      'icon-text-fit-padding': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value ([0,0,0,0])
          T.Tuple([T.Number(), T.Number(), T.Number(), T.Number()])
        )
      ),
      'icon-image': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ResolvedImageSpecificationSchema()
        )
      ),
      'icon-rotate': T.Optional(
        // TODO: Specify default value (0)
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'icon-padding': T.Optional(
        // TODO: Specify default value (2)
        PropertyValueSpecificationSchema(T.Number({ minimum: 0 }))
      ),
      'icon-keep-upright': T.Optional(
        // TODO: Specify default value (false)
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'icon-offset': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ([0, 0])
          T.Tuple([T.Number(), T.Number()])
        )
      ),
      'icon-anchor': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (DirectionalAnchor.center)
          T.Union([
            T.Literal(DirectionalAnchor.center),
            T.Literal(DirectionalAnchor.left),
            T.Literal(DirectionalAnchor.right),
            T.Literal(DirectionalAnchor.top),
            T.Literal(DirectionalAnchor.bottom),
            T.Literal(DirectionalAnchor.topLeft),
            T.Literal(DirectionalAnchor.topRight),
            T.Literal(DirectionalAnchor.bottomLeft),
            T.Literal(DirectionalAnchor.bottomRight),
          ])
        )
      ),
      'icon-pitch-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (Alignment.auto)
          T.Union([
            T.Literal(Alignment.map),
            T.Literal(Alignment.viewport),
            T.Literal(Alignment.auto),
          ])
        )
      ),
      'text-pitch-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (Alignment.auto)
          T.Union([
            T.Literal(Alignment.map),
            T.Literal(Alignment.viewport),
            T.Literal(Alignment.auto),
          ])
        )
      ),
      'text-rotation-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (Alignment.auto)
          T.Union([
            T.Literal(Alignment.map),
            T.Literal(Alignment.viewport),
            T.Literal(Alignment.auto),
          ])
        )
      ),
      'text-field': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ('')
          FormattedSpecificationSchema()
        )
      ),
      'text-font': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (['Open Sans Regular', 'Arial Unicode MS Regular'])
          T.Array(T.String())
        )
      ),
      'text-size': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (16)
          T.Number({
            minimum: 0,
          })
        )
      ),
      'text-max-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (10)
          T.Number({ minimum: 0 })
        )
      ),
      'text-line-height': T.Optional(
        // TODO: Specify default value (1.2)
        PropertyValueSpecificationSchema(T.Number())
      ),
      'text-letter-spacing': T.Optional(
        // TODO: Specify default value (0)
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'text-justify': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (Justify.center)
          T.Union([
            T.Literal(Justify.auto),
            T.Literal(Justify.left),
            T.Literal(Justify.center),
            T.Literal(Justify.right),
          ])
        )
      ),
      'text-radial-offset': T.Optional(
        // TODO: Specify default value (0)
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'text-variable-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Array(
            T.Union([
              T.Literal(DirectionalAnchor.center),
              T.Literal(DirectionalAnchor.left),
              T.Literal(DirectionalAnchor.right),
              T.Literal(DirectionalAnchor.top),
              T.Literal(DirectionalAnchor.bottom),
              T.Literal(DirectionalAnchor.topLeft),
              T.Literal(DirectionalAnchor.topRight),
              T.Literal(DirectionalAnchor.bottomLeft),
              T.Literal(DirectionalAnchor.bottomRight),
            ])
          )
        )
      ),
      'text-anchor': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (DirectionalAnchor.center)
          T.Union([
            T.Literal(DirectionalAnchor.center),
            T.Literal(DirectionalAnchor.left),
            T.Literal(DirectionalAnchor.right),
            T.Literal(DirectionalAnchor.top),
            T.Literal(DirectionalAnchor.bottom),
            T.Literal(DirectionalAnchor.topLeft),
            T.Literal(DirectionalAnchor.topRight),
            T.Literal(DirectionalAnchor.bottomLeft),
            T.Literal(DirectionalAnchor.bottomRight),
          ])
        )
      ),
      'text-max-angle': T.Optional(
        // TODO: Specify default value (45)
        PropertyValueSpecificationSchema(T.Number())
      ),
      'text-writing-mode': T.Optional(
        PropertyValueSpecificationSchema(
          T.Array(
            T.Union([
              T.Literal(WritingMode.horizontal),
              T.Literal(WritingMode.vertical),
            ])
          )
        )
      ),
      'text-rotate': T.Optional(
        // TODO: Specify default value (9)
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'text-padding': T.Optional(
        // TODO: Specify default value (2)
        PropertyValueSpecificationSchema(T.Number({ minimum: 0 }))
      ),
      'text-keep-upright': T.Optional(
        // TODO: Specify default value (true)
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'text-transform': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Union(
            // TODO: Specify default value (TextTransform.none)
            [
              T.Literal(TextTransform.none),
              T.Literal(TextTransform.uppercase),
              T.Literal(TextTransform.lowercase),
            ]
          )
        )
      ),
      'text-offset': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ([0, 0])
          T.Tuple([T.Number(), T.Number()])
        )
      ),
      'text-allow-overlap': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (false)
          T.Boolean()
        )
      ),
      'text-ignore-placement': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (false)
          T.Boolean()
        )
      ),
      'text-optional': T.Optional(
        // TODO: Specify default value (false)
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      visibility: T.Optional(
        // TODO: Specify default value (Visibility.visible)
        T.Union([T.Literal(Visibility.visible), T.Literal(Visibility.none)])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'icon-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({ minimum: 0, maximum: 1 })
        )
      ),
      'icon-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ('#000000')
          ColorSpecificationSchema()
        )
      ),
      'icon-halo-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ('rgba(0, 0, 0, 0)')
          ColorSpecificationSchema()
        )
      ),
      'icon-halo-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: 0 })
        )
      ),
      'icon-halo-blur': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: 0 })
        )
      ),
      'icon-translate': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value ([0, 0])
          T.Tuple([T.Number(), T.Number()])
        )
      ),
      'icon-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (EntityAnchor.map)
          T.Union([
            T.Literal(EntityAnchor.map),
            T.Literal(EntityAnchor.viewport),
          ])
        )
      ),
      'text-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({ minimum: 0, maximum: 1 })
        )
      ),
      'text-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ('#000000')
          ColorSpecificationSchema()
        )
      ),
      'text-halo-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ('rgba(0, 0, 0, 0)')
          ColorSpecificationSchema()
        )
      ),
      'text-halo-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: 0 })
        )
      ),
      'text-halo-blur': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: 0 })
        )
      ),
      'text-translate': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value ([0, 0])
          T.Tuple([T.Number(), T.Number()])
        )
      ),
      'text-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (EntityAnchor.map)
          T.Union([
            T.Literal(EntityAnchor.map),
            T.Literal(EntityAnchor.viewport),
          ])
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
        // TODO: Specify default value (Visibility.visible)
        T.Union([T.Literal(Visibility.visible), T.Literal(Visibility.none)])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'circle-radius': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (5)
          T.Number({ minimum: 0 })
        )
      ),
      'circle-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ('#000000')
          ColorSpecificationSchema()
        )
      ),
      'circle-blur': T.Optional(
        // TODO: Specify default value (0)
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'circle-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({ minimum: 0, maximum: 1 })
        )
      ),
      'circle-translate': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value ([0, 0])
          T.Tuple([T.Number(), T.Number()])
        )
      ),
      'circle-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (EntityAnchor.map)
          T.Union([
            T.Literal(EntityAnchor.map),
            T.Literal(EntityAnchor.viewport),
          ])
        )
      ),
      'circle-pitch-scale': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (EntityAnchor.map)
          T.Union([
            T.Literal(EntityAnchor.map),
            T.Literal(EntityAnchor.viewport),
          ])
        )
      ),
      'circle-pitch-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (EntityAnchor.map)
          T.Union([
            T.Literal(EntityAnchor.map),
            T.Literal(EntityAnchor.viewport),
          ])
        )
      ),
      'circle-stroke-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: 0 })
        )
      ),
      'circle-stroke-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ('#000000')
          ColorSpecificationSchema()
        )
      ),
      'circle-stroke-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({ minimum: 0, maximum: 0 })
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
        // TODO: Specify default value (Visibility.visible)
        T.Union([T.Literal(Visibility.visible), T.Literal(Visibility.none)])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'heatmap-radius': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (30)
          T.Number({ minimum: 1 })
        )
      ),
      'heatmap-weight': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({ minimum: 0 })
        )
      ),
      'heatmap-intensity': T.Optional(
        // TODO: Specify default value (1)
        PropertyValueSpecificationSchema(T.Number({ minimum: 0 }))
      ),
      'heatmap-color': T.Optional(
        // TODO: Specify default value (['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0, 0, 255, 0)', 0.1, 'royalblue', 0.3, 'cyan', 0.5, 'lime', 0.7, 'yellow', 1, 'red' ])
        ExpressionSpecificationSchema()
      ),
      'heatmap-opacity': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({ minimum: 0, maximum: 1 })
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
        // TODO: Specify default value (Visibility.visible)
        T.Union([T.Literal(Visibility.visible), T.Literal(Visibility.none)])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'fill-extrusion-opacity': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({ minimum: 0, maximum: 1 })
        )
      ),
      'fill-extrusion-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value ('#000000')
          ColorSpecificationSchema()
        )
      ),
      'fill-extrusion-translate': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value ([0,0])
          T.Tuple([T.Number(), T.Number()])
        )
      ),
      'fill-extrusion-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (EntityAnchor.map)
          T.Union([
            T.Literal(EntityAnchor.map),
            T.Literal(EntityAnchor.viewport),
          ])
        )
      ),
      'fill-extrusion-pattern': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ResolvedImageSpecificationSchema()
        )
      ),
      'fill-extrusion-height': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: 0 })
        )
      ),
      'fill-extrusion-base': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: 0 })
        )
      ),
      'fill-extrusion-vertical-gradient': T.Optional(
        // TODO: Specify default value (true)
        PropertyValueSpecificationSchema(T.Boolean())
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
        // TODO: Specify default value (Visibilty.visible)
        T.Union([T.Literal(Visibility.visible), T.Literal(Visibility.none)])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'raster-opacity': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({ minimum: 0, maximum: 1 })
        )
      ),
      'raster-hue-rotate': T.Optional(
        // TODO: Specify default value (0)
        PropertyValueSpecificationSchema(T.Number())
      ),
      'raster-brightness-min': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: 0, maximum: 1 })
        )
      ),
      'raster-brightness-max': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: 0, maximum: 1 })
        )
      ),
      'raster-saturation': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: -1, maximum: 1 })
        )
      ),
      'raster-contrast': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (0)
          T.Number({ minimum: -1, maximum: 1 })
        )
      ),
      'raster-resampling': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (Resampling.linear)
          T.Union([T.Literal(Resampling.linear), T.Literal(Resampling.nearest)])
        )
      ),
      'raster-fade-duration': T.Optional(
        // TODO: Specify default value (300)
        PropertyValueSpecificationSchema(T.Number({ minimum: 0 }))
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
        // TODO: Specify default value (Visibility.visible)
        T.Union([T.Literal(Visibility.visible), T.Literal(Visibility.none)])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'hillshade-illumination-direction': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (335)
          T.Number({ minimum: 0, maximum: 359 })
        )
      ),
      'hillshade-illumination-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (EntityAnchor.viewport)
          T.Union([
            T.Literal(EntityAnchor.map),
            T.Literal(EntityAnchor.viewport),
          ])
        )
      ),
      'hillshade-exaggeration': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (0.5)
          T.Number({
            minimum: 0,
            maximum: 1,
          })
        )
      ),
      'hillshade-shadow-color': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value ('#000000')
          ColorSpecificationSchema()
        )
      ),
      'hillshade-highlight-color': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value ('#ffffff')
          ColorSpecificationSchema()
        )
      ),
      'hillshade-accent-color': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value ('#000000')
          ColorSpecificationSchema()
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
        // TODO: Specify default value (Visibility.visible)
        T.Union([T.Literal(Visibility.visible), T.Literal(Visibility.none)])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'background-color': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value ('#000000')
          ColorSpecificationSchema()
        )
      ),
      'background-pattern': T.Optional(
        PropertyValueSpecificationSchema(ResolvedImageSpecificationSchema())
      ),
      'background-opacity': T.Optional(
        PropertyValueSpecificationSchema(
          // TODO: Specify default value (1)
          T.Number({
            minimum: 0,
            maximum: 1,
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
    T.Tuple([
      T.Number(),
      T.Number(),
      T.Number(),
      T.Number(),
      // T.Number({ default: -180 }),
      // T.Number({ default: -85.051129 }),
      // T.Number({ default: 180 }),
      // T.Number({ default: 85.051129 }),
    ])
  ),
  // TODO: Ajv complains about using a default scheme here
  scheme: T.Optional(T.Union([T.Literal(Scheme.xyz), T.Literal(Scheme.tms)])),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 30 /*default: 0*/ })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 30 /* default: 22 */ })),
  attribution: T.Optional(T.String()),
  promoteId: T.Optional(PromoteIdSpecificationSchema),
  volatile: T.Optional(T.Boolean()),
})
type VectorSourceSpecification = Static<typeof VectorSourceSpecificationSchema>

const RasterSourceSpecificationSchema = T.Object({
  type: T.Literal('raster'),
  url: T.Optional(T.String({ format: 'uri' })),
  tiles: T.Optional(T.Array(T.String())),
  bounds: T.Optional(
    T.Tuple([
      T.Number(),
      T.Number(),
      T.Number(),
      T.Number(),
      // T.Number({ default: -180 }),
      // T.Number({ default: -85.051129 }),
      // T.Number({ default: 180 }),
      // T.Number({ default: 85.051129 }),
    ])
  ),
  minzoom: T.Optional(T.Number({ minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 30 })),
  tileSize: T.Optional(T.Number()),
  // TODO: Ajv complains about using a default scheme here
  scheme: T.Optional(T.Union([T.Literal(Scheme.xyz), T.Literal(Scheme.tms)])),
  attribution: T.Optional(T.String()),
  volatile: T.Optional(T.Boolean()),
})
type RasterSourceSpecification = Static<typeof RasterSourceSpecificationSchema>

const RasterDEMSourceSpecificationSchema = T.Object({
  type: T.Literal('raster-dem'),
  url: T.Optional(T.String({ format: 'uri' })),
  tiles: T.Optional(T.Array(T.String())),
  bounds: T.Optional(
    T.Tuple([
      T.Number(),
      T.Number(),
      T.Number(),
      T.Number(),
      // T.Number({ default: -180 }),
      // T.Number({ default: -85.051129 }),
      // T.Number({ default: 180 }),
      // T.Number({ default: 85.051129 }),
    ])
  ),
  // TODO: Specify default (0)
  minzoom: T.Optional(T.Number({ maximum: 30 })),
  // TODO: Specify default (22)
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 30 })),
  // TODO: Specify default (512)
  tileSize: T.Optional(T.Number()),
  attribution: T.Optional(T.String()),
  // TODO: Specify default (Encoding.mapbox)
  encoding: T.Optional(
    T.Union([T.Literal(Encoding.terrarium), T.Literal(Encoding.mapbox)])
  ),
  // TODO: Specify default (false)
  volatile: T.Optional(T.Boolean()),
})
type RasterDEMSourceSpecification = Static<
  typeof RasterDEMSourceSpecificationSchema
>

const GeoJSONSourceSpecificationSchema = T.Object({
  type: T.Literal('geojson'),
  data: T.Optional(T.Unknown()),
  // TODO: Specify default (18)
  maxzoom: T.Optional(T.Number({ minimum: 0, maximum: 30 })),
  attribution: T.Optional(T.String()),
  // TODO: Specify default (128)
  buffer: T.Optional(T.Number({ minimum: 0, maximum: 512 })),
  filter: T.Optional(T.Unknown()),
  // TODO: Specify default (0.375)
  tolerance: T.Optional(T.Number()),
  // TODO: Specify default (false)
  cluster: T.Optional(T.Boolean()),
  // TODO: Specify default (50)
  clusterRadius: T.Optional(T.Number({ minimum: 0 })),
  clusterMaxZoom: T.Optional(T.Number()),
  clusterMinPoints: T.Optional(T.Number()),
  clusterProperties: T.Optional(T.Unknown()),
  // TODO: Specify default (false)
  lineMetrics: T.Optional(T.Boolean()),
  // TODO: Specify default (false)
  generateId: T.Optional(T.Boolean()),
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

interface ValidateStyleJSON {
  (data: unknown): data is StyleJSON
  schema?: StyleJSON | boolean
  errors?: null | Array<ErrorObject>
  refs?: object
  refVal?: Array<any>
  root?: ValidateFunction | object
  $async?: true
  source?: object
}

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

const validateStyleJSONSchema = ajv.compile(
  StyleJSONSchema
) as ValidateStyleJSON

// TODO: Validation using mapbox-gl-style-spec validator?
const validateStyleJSON: ValidateStyleJSON = (
  data: unknown
): data is StyleJSON => {
  if (!validateStyleJSONSchema(data)) {
    validateStyleJSON.errors = validateStyleJSONSchema.errors
    return false
  }

  validateStyleJSON.errors = validateStyleJSONSchema.errors

  return true
}

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
