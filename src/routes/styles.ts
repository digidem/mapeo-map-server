import { FastifyPluginAsync } from 'fastify'
import createError from 'fastify-error'
import { Static, Type as T } from '@sinclair/typebox'
import { OfflineStyle, StyleJSON, validate } from '../lib/stylejson'

const GetStylesQuerystringSchema = T.Object({
  limit: T.Optional(T.Number()),
})

const GetStyleParamsSchema = T.Object({
  styleId: T.String(),
})

const PutStyleParamsSchema = T.Object({
  styleId: T.String(),
})

const PutStyleBodySchema = T.Object({
  style: T.Unknown(),
})

const DeleteStyleParamsSchema = T.Object({
  styleId: T.String(),
})

const InvalidStyleError = createError(
  'FST_INVALID_STYLE',
  'Invalid style: %s',
  400
)

function validateStyle(style: unknown): asserts style is StyleJSON {
  try {
    validate(style)
  } catch (err) {
    throw new InvalidStyleError((err as Error).message)
  }
}

const styles: FastifyPluginAsync = async function (fastify) {
  fastify.get<{ Querystring: Static<typeof GetStylesQuerystringSchema> }>(
    '/',
    async function (request) {
      return request.api.listStyles(request.query.limit)
    }
  )

  fastify.post<{ Body: StyleJSON }>('/', async function (request, reply) {
    validateStyle(request.body)

    const stylejson = await request.api.createStyle(request.body)

    reply.header('Location', `${fastify.prefix}/${stylejson.id}`)

    return stylejson
  })

  fastify.get<{ Params: Static<typeof GetStyleParamsSchema> }>(
    '/:styleId',
    async function (request) {
      return request.api.getStyle(request.params.styleId)
    }
  )

  fastify.put<{
    Params: Static<typeof PutStyleParamsSchema>
    Body: OfflineStyle | StyleJSON
  }>('/:styleId', async function (request) {
    const style = request.body

    validateStyle(style)

    const stylejson = await request.api.putStyle(request.params.styleId, style)

    return stylejson
  })

  fastify.delete<{ Params: Static<typeof DeleteStyleParamsSchema> }>(
    '/:styleId',
    {
      schema: {
        response: 204,
      },
    },
    async function (request, reply) {
      await request.api.deleteStyle(request.params.styleId)
      reply.code(204).send()
    }
  )
}

export default styles
