import { Static, Type as T } from '@sinclair/typebox'
import Ajv from 'ajv/dist/2019'

const ajv = new Ajv(
{
    removeAdditional: false,
    useDefaults: true,
    coerceTypes: true,
})

export const SpriteJSONSchema = T.Object(
{
    width:T.Number(),
    height:T.Number(),
    x:T.Number(),
    y:T.Number(),
    pixelRation:T.Number(),
    content:T.Optional(T.Tuple([T.Number(),T.Number(),T.Number(),T.Number()])),
    stretchX:T.Optional(T.Tuple([T.Tuple([T.Number(), T.Number()]), T.Tuple([T.Number(), T.Number()])])),
    stretchY:T.Optional(T.Tuple([T.Tuple([T.Number(), T.Number()]), T.Tuple([T.Number(), T.Number()])]))
})

export type SpriteJSON = Static<typeof SpriteJSONSchema>;

export const validateSpriteJSON = ajv.compile<SpriteJSON>(SpriteJSONSchema)

