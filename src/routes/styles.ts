import { FastifyPluginAsync } from 'fastify'
import { Static, Type as T } from '@sinclair/typebox'

import { StyleJSON, StyleJSONSchema } from '../lib/stylejson'

const GetStyleParamsSchema = T.Object({
  styleId: T.String(),
})

const PutStyleParamsSchema = T.Object({
  styleId: T.String(),
  style: StyleJSONSchema,
})

const DeleteStyleParamsSchema = T.Object({
  styleId: T.String(),
})

const styles: FastifyPluginAsync = async function (fastify) {
  fastify.get(
    '/',
    {
      schema: {
        response: {
          200: T.Array(StyleJSONSchema),
        },
      },
    },
    async function (request) {
      return request.api.listStyles()
    }
  )

  fastify.post<{ Body: StyleJSON }>(
    '/',
    {
      schema: {
        body: StyleJSONSchema,
        response: {
          200: StyleJSONSchema,
        },
      },
    },
    async function (request, reply) {
      // TODO: Update argument type for createStyle
      const stylejson = await request.api.createStyle(request.body)
      reply.header('Location', `${fastify.prefix}/${stylejson.id}`)
      return stylejson
    }
  )

  fastify.get<{ Params: Static<typeof GetStyleParamsSchema> }>(
    '/:styleId',
    {
      schema: {
        params: GetStyleParamsSchema,
        response: {
          200: StyleJSONSchema,
        },
      },
    },
    async function (request) {
      return request.api.getStyle(request.params.styleId)
    }
  )

  fastify.put<{ Params: Static<typeof PutStyleParamsSchema> }>(
    '/:styleId',
    {
      schema: {
        response: {
          200: StyleJSONSchema,
        },
      },
    },
    async function (request) {
      // TODO: Update argument type for putStyle
      return request.api.putStyle(request.params.styleId, request.params.style)
    }
  )

  fastify.delete<{ Params: Static<typeof DeleteStyleParamsSchema> }>(
    '/:styleId',
    {
      schema: {
        response: {
          200: T.Boolean(),
        },
      },
    },
    async function (request) {
      // TODO: Add deleteStyle method to API
      return request.api.deleteStyle(request.params.styleId)
    }
  )
}
export default styles
