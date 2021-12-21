import { Static, Type as T } from '@sinclair/typebox'

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