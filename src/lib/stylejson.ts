/* eslint-disable @typescript-eslint/ban-types */
import { Static, Type as T, TSchema } from '@sinclair/typebox'
import Ajv from 'ajv/dist/2019'

const ColorSpecificationSchema = T.String()
const ExpressionSpecificationSchema = T.Array(T.Unknown())
const ResolvedImageSpecificationSchema = T.String()
const FormattedSpecificationSchema = T.String()

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
    ExpressionSpecificationSchema,
  ])

const DataDrivenPropertyValueSpecificationSchema = <T extends TSchema>(
  type: T
) =>
  T.Union([
    type,
    CameraFunctionSpecificationSchema(type),
    SourceFunctionSpecificationSchema(type),
    CompositeFunctionSpecificationSchema(type),
    ExpressionSpecificationSchema,
  ])

const LightSpecificationSchema = T.Object({
  anchor: T.Optional(
    PropertyValueSpecificationSchema(
      T.Union([T.Literal('map'), T.Literal('viewport')])
    )
  ),
  position: T.Optional(T.Tuple([T.Number(), T.Number(), T.Number()])),
  color: T.Optional(PropertyValueSpecificationSchema(ColorSpecificationSchema)),
  intesity: T.Optional(PropertyValueSpecificationSchema(T.Number())),
})
const TransitionSpecificationSchema = T.Object({
  duration: T.Optional(T.Number()),
  delay: T.Optional(T.Number()),
})

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

/**
 * Layers
 */
const FillLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('fill'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      'fill-sort-key': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'fill-antialias': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'fill-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'fill-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'fill-outline-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'fill-translate': T.Optional(
        PropertyValueSpecificationSchema(T.Tuple([T.Number(), T.Number()]))
      ),
      'fill-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')])
        )
      ),
      'fill-pattern': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ResolvedImageSpecificationSchema
        )
      ),
    })
  ),
})

const LineLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('line'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      'line-cap': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('butt'), T.Literal('round'), T.Literal('square')])
        )
      ),
      'line-join': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Union([T.Literal('bevel'), T.Literal('round'), T.Literal('miter')])
        )
      ),
      'line-miter-limit': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      'line-round-limit': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      'line-sort-key': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'line-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'line-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'line-translate': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number()])
        )
      ),
      'line-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')])
        )
      ),
      'line-width': T.Optional(PropertyValueSpecificationSchema(T.Number())),
      'line-gap-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'line-offset': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'line-blur': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'line-dasharray': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'line-pattern': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ResolvedImageSpecificationSchema
        )
      ),
      'line-gradient': T.Optional(ExpressionSpecificationSchema),
    })
  ),
})

const SymbolLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('line'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      'symbol-placement': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([
            T.Literal('point'),
            T.Literal('line'),
            T.Literal('line-center'),
          ])
        )
      ),
      'symbol-spacing': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      'symbol-avoid-edges': PropertyValueSpecificationSchema(T.Boolean()),
      'symbol-sort-key': DataDrivenPropertyValueSpecificationSchema(T.Number()),
      'symbol-z-order': PropertyValueSpecificationSchema(
        T.Union([
          T.Literal('auto'),
          T.Literal('viewport-y'),
          T.Literal('source'),
        ])
      ),
      'icon-allow-overlap': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'icon-ignore-placement': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'icon-optional': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'icon-rotation-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport'), T.Literal('auto')])
        )
      ),
      'icon-size': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'icon-text-fit': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([
            T.Literal('none'),
            T.Literal('width'),
            T.Literal('height'),
            T.Literal('both'),
          ])
        )
      ),
      'icon-text-fit-padding': T.Optional(
        PropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number(), T.Number(), T.Number()])
        )
      ),
      'icon-image': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ResolvedImageSpecificationSchema
        )
      ),
      'icon-rotate': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'icon-padding': T.Optional(PropertyValueSpecificationSchema(T.Number())),
      'icon-keep-upright': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'icon-offset': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number()])
        )
      ),
      'icon-anchor': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
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
      ),
      'icon-pitch-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport'), T.Literal('auto')])
        )
      ),
      'text-pitch-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport'), T.Literal('auto')])
        )
      ),
      'text-rotation-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport'), T.Literal('auto')])
        )
      ),
      'text-field': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(FormattedSpecificationSchema)
      ),
      'text-font': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Array(T.String()))
      ),
      'text-size': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'text-max-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'text-line-height': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      'text-letter-spacing': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'text-justify': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Union([
            T.Literal('auto'),
            T.Literal('left'),
            T.Literal('center'),
            T.Literal('right'),
          ])
        )
      ),
      'text-radial-offset': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
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
      ),
      'text-max-angle': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      'text-writing-mode': T.Optional(
        PropertyValueSpecificationSchema(
          T.Array(T.Union([T.Literal('horizontal'), T.Literal('vertical')]))
        )
      ),
      'text-rotate': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'text-padding': T.Optional(PropertyValueSpecificationSchema(T.Number())),
      'text-keep-upright': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      'text-transform': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Union([
            T.Literal('none'),
            T.Literal('uppercase'),
            T.Literal('lowercase'),
          ])
        )
      ),
      'text-offset': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          T.Tuple([T.Number(), T.Number()])
        )
      ),
      'text-allow-overlap': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Boolean())
      ),
      'text-ignore-placement': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Boolean())
      ),
      'text-optional': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean())
      ),
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'icon-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'icon-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'icon-halo-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'icon-halo-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'icon-halo-blur': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'icon-translate': T.Optional(
        PropertyValueSpecificationSchema(T.Tuple([T.Number(), T.Number()]))
      ),
      'icon-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')])
        )
      ),
      'text-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'text-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'text-halo-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'text-halo-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'text-halo-blur': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'text-translate': T.Optional(
        PropertyValueSpecificationSchema(T.Tuple([T.Number(), T.Number()]))
      ),
      'text-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')])
        )
      ),
    })
  ),
})

const CircleLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('circle'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      'circle-sort-key': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'circle-radius': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'circle-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'circle-blur': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'circle-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'circle-translate': T.Optional(
        PropertyValueSpecificationSchema(T.Tuple([T.Number(), T.Number()]))
      ),
      'circle-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')])
        )
      ),
      'circle-pitch-scale': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')])
        )
      ),
      'circle-pitch-alignment': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')])
        )
      ),
      'circle-stroke-width': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'circle-stroke-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'circle-stroke-opacity': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
    })
  ),
})

const HeatmapLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('heatmap'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'heatmap-radius': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'heatmap-weight': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'heatmap-intensity': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      'heatmap-color': T.Optional(ExpressionSpecificationSchema),
      'heatmap-opacity': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
    })
  ),
})

const FillExtrusionLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('fill-extrusion'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'fill-extrusion-opacity': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      'fill-extrusion-color': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'fill-extrusion-translate': T.Optional(
        PropertyValueSpecificationSchema(T.Tuple([T.Number(), T.Number()]))
      ),
      'fill-extrusion-translate-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')])
        )
      ),
      'fill-extrusion-pattern': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(
          ResolvedImageSpecificationSchema
        )
      ),
      'fill-extrusion-height': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'fill-extrusion-base': T.Optional(
        DataDrivenPropertyValueSpecificationSchema(T.Number())
      ),
      'fill-extrusion-vertical-gradient': T.Optional(
        PropertyValueSpecificationSchema(T.Boolean())
      ),
    })
  ),
})

const RasterLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('raster'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'raster-opacity': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      'raster-hue-rotate': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      // TODO: What's min, max, default?
      'raster-brightness-min': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      // TODO: What's min, max, default?
      'raster-brightness-max': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      // TODO: What's min, max, default?
      'raster-saturation': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      // TODO: What's min, max, default?
      'raster-contrast': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      'raster-resampling': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('linear'), T.Literal('nearest')])
        )
      ),
      'raster-fade-duration': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
    })
  ),
})

const HillshadeLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('hillshade'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'hillshade-illumination-direction': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      'hillshade-illumination-anchor': T.Optional(
        PropertyValueSpecificationSchema(
          T.Union([T.Literal('map'), T.Literal('viewport')])
        )
      ),
      'hillshade-exaggeration': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
      'hillshade-shadow-color': T.Optional(
        PropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'hillshade-highlight-color': T.Optional(
        PropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'hillshade-accent-color': T.Optional(
        PropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
    })
  ),
})

const BackgroundLayerSpecificationSchema = T.Object({
  id: T.String(),
  type: T.Literal('background'),
  metadata: T.Optional(T.Unknown()),
  source: T.String(),
  'source-layer': T.Optional(T.String()),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  filter: T.Optional(FilterSpecificationSchema),
  layout: T.Optional(
    T.Object({
      visibility: T.Optional(
        T.Union([T.Literal('visible'), T.Literal('none')])
      ),
    })
  ),
  paint: T.Optional(
    T.Object({
      'background-color': T.Optional(
        PropertyValueSpecificationSchema(ColorSpecificationSchema)
      ),
      'background-pattern': T.Optional(
        PropertyValueSpecificationSchema(ResolvedImageSpecificationSchema)
      ),
      'background-opacity': T.Optional(
        PropertyValueSpecificationSchema(T.Number())
      ),
    })
  ),
})

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

/**
 * Sources
 */
const PromoteIdSpecificationSchema = T.Union([
  T.Record(T.String(), T.String()),
  T.String(),
])

const VectorSourceSpecificationSchema = T.Object({
  type: T.Literal('vector'),
  url: T.Optional(T.String()),
  tiles: T.Optional(T.Array(T.String())),
  bounds: T.Optional(T.Tuple([T.Number(), T.Number(), T.Number(), T.Number()])),
  scheme: T.Optional(T.Union([T.Literal('xyz'), T.Literal('tms')])),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  attribution: T.Optional(T.String()),
  promoteId: T.Optional(PromoteIdSpecificationSchema),
  volatile: T.Optional(T.Boolean()),
})

const RasterSourceSpecificationSchema = T.Object({
  type: T.Literal('raster'),
  url: T.Optional(T.String()),
  tiles: T.Optional(T.Array(T.String())),
  bounds: T.Optional(T.Tuple([T.Number(), T.Number(), T.Number(), T.Number()])),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  tileSize: T.Optional(T.Number()),
  scheme: T.Optional(T.Union([T.Literal('xyz'), T.Literal('tms')])),
  attribution: T.Optional(T.String()),
  volatile: T.Optional(T.Boolean()),
})

const RasterDEMSourceSpecificationSchema = T.Object({
  type: T.Literal('raster-dem'),
  url: T.Optional(T.String()),
  tiles: T.Optional(T.Array(T.String())),
  bounds: T.Optional(T.Tuple([T.Number(), T.Number(), T.Number(), T.Number()])),
  minzoom: T.Optional(T.Number({ default: 0, minimum: 0, maximum: 30 })),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  tileSize: T.Optional(T.Number()),
  attribution: T.Optional(T.String()),
  encoding: T.Optional(T.Union([T.Literal('terrarium'), T.Literal('mapbox')])),
  volatile: T.Optional(T.Boolean()),
})

const GeoJSONSourceSpecificationSchema = T.Object({
  type: T.Literal('geojson'),
  data: T.Optional(T.Unknown()),
  maxzoom: T.Optional(T.Number({ default: 22, minimum: 0, maximum: 30 })),
  attribution: T.Optional(T.String()),
  buffer: T.Optional(T.Number()),
  filter: T.Optional(T.Unknown()),
  tolerance: T.Optional(T.Number()),
  cluster: T.Optional(T.Boolean()),
  clusterRadius: T.Optional(T.Number()),
  clusterMaxZoom: T.Optional(T.Number()),
  clusterMinPoints: T.Optional(T.Number()),
  clusterProperties: T.Optional(T.Unknown()),
  lineMetrics: T.Optional(T.Boolean()),
  generateId: T.Optional(T.Boolean()),
  promoteId: T.Optional(PromoteIdSpecificationSchema),
})

const VideoSourceSpecificationSchema = T.Object({
  type: T.Literal('video'),
  urls: T.Array(T.String()),
  coordinates: T.Tuple([
    T.Tuple([T.Number(), T.Number()]),
    T.Tuple([T.Number(), T.Number()]),
    T.Tuple([T.Number(), T.Number()]),
    T.Tuple([T.Number(), T.Number()]),
  ]),
})

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

const SourceSpecificationSchema = T.Union([
  VectorSourceSpecificationSchema,
  RasterSourceSpecificationSchema,
  RasterDEMSourceSpecificationSchema,
  GeoJSONSourceSpecificationSchema,
  VideoSourceSpecificationSchema,
  ImageSourceSpecificationSchema,
])

export const StyleJSONSchema = T.Object({
  upstreamUrl: T.Optional(T.String()),
  version: T.Literal(8),
  name: T.Optional(T.String()),
  metadata: T.Optional(T.Unknown()),
  center: T.Optional(T.Array(T.Number())),
  zoom: T.Optional(T.Number({ minimum: 0, maximum: 30 })),
  bearing: T.Optional(T.Number()),
  light: T.Optional(LightSpecificationSchema),
  pitch: T.Optional(T.Number()),
  sources: T.Record(T.String(), SourceSpecificationSchema),
  sprite: T.Optional(T.String()),
  glyphs: T.Optional(T.String()),
  transition: T.Optional(TransitionSpecificationSchema),
  layers: T.Array(LayerSpecificationSchema),
})

export type StyleJSON = Static<typeof StyleJSONSchema>

const ajv = new Ajv({
  removeAdditional: false,
  useDefaults: true,
  coerceTypes: true,
})

export const validateStyleJSONSchema = ajv.compile<StyleJSON>(StyleJSONSchema)

// TODO: Validation using mapbox-gl-style-spec validator
export const validateStyleJSON = (data: unknown) => {}
