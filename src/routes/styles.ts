import { FastifyPluginAsync } from 'fastify'
import { TileJSON, TileJSONSchema } from '../lib/tilejson'
import { Static, Type as T } from '@sinclair/typebox'
import { SpriteJSONSchema } from '../lib/spritejson'

const GetStyleIdParamsSchema = T.Object(
{
    styleId:T.String(),
    pd:T.Optional(T.Number()),
})



export const styles: FastifyPluginAsync = async function (fastify)
{
    // /:styleId/sprite/2
    fastify.get<{ Params: Static<typeof GetStyleIdParamsSchema>}>(
        '/:styleId/sprite/:pd',
        {
            schema:
            {
                description:"Returns JSON schema for sprites associated with a style",
                params:GetStyleIdParamsSchema,
                response:
                {
                    200: SpriteJSONSchema
                }
            }
        },
        async (request) =>
        {
            return request.api.getSpriteJSON(request.params.styleId, request.params.pd)
        }
    ),
    
    fastify.get<{ Params: Static<typeof GetStyleIdParamsSchema> }>(
        '/:styleId/sprite.png/:pd',
        {
            schema:
            {
                description:"Returns png of sprites associated with a style",
                params:GetStyleIdParamsSchema,
                response:
                {
                    200: Buffer
                }
            }
        },
        async function (request) 
        {
            return request.api.getSpriteImg(request.params.styleId, request.params.pd)
        }
    )
}
