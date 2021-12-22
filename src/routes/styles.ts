import { FastifyPluginAsync } from 'fastify'
import { TileJSON, TileJSONSchema } from '../lib/tilejson'
import { Static, Type as T } from '@sinclair/typebox'
import { SpriteJSONSchema } from '../lib/spritejson'

const GetStyleIdParamsSchema = T.Object(
{
    styleId:T.String(),
    pixelDensity: T.Optional(T.Number())
})

export const styles: FastifyPluginAsync = async function (fastify)
{
    //How do i get the "@2x" here?
    fastify.get<{ Params: Static<typeof GetStyleIdParamsSchema> }>(
        '/:styleId/sprite{@2x}',
        {
            schema:
            {
                params:GetStyleIdParamsSchema,
                response:
                {
                    200: SpriteJSONSchema
                }
            }
        },
        async function (request) 
        {
            return request.api.getSpriteJSON(request.params.styleId, )
        }
    ),
    
    //How do i get the "@2x" here?
    fastify.get<{ Params: Static<typeof GetStyleIdParamsSchema> }>(
        '/:styleId/sprite{@2x}.png',
        {
            schema:
            {
                params:GetStyleIdParamsSchema,
                response:
                {
                    200: Buffer
                }
            }
        },
        async function (request) 
        {
            return request.api.getSpriteImg(request.params.styleId,)
        }
    )
}
