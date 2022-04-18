import { promises as fs } from 'fs'
import { FastifyPluginAsync } from 'fastify'
import createError from 'fastify-error'
import got from 'got'

import { normalizeStyleURL } from '../lib/mapbox_urls'
import { StyleJSON, createIdFromStyleUrl, validate } from '../lib/stylejson'

interface GetStyleParams {
  styleId: string
}

interface DeleteStyleParams {
  styleId: string
}

type PostStyleBody = { accessToken?: string } & (
  | { url: string }
  | { style: StyleJSON }
)

const InvalidStyleError = createError(
  'FST_INVALID_STYLE',
  'Invalid style: %s',
  400
)

const InvalidRequestBodyError = createError(
  'FST_INVALID_REQUEST_BODY',
  'Invalid request body: %s',
  400
)

function createInvalidStyleError(err: unknown) {
  return new InvalidStyleError((err as Error).message)
}

function validateStyle(style: unknown): asserts style is StyleJSON {
  try {
    validate(style)
  } catch (err) {
    throw createInvalidStyleError(err)
  }
}

const styles: FastifyPluginAsync = async function (fastify) {
  fastify.get('/', async function (request) {
    return request.api.listStyles()
  })

  fastify.post<{ Body: PostStyleBody }>('/', async function (request, reply) {
    let style: unknown
    let id: string | undefined
    const { accessToken } = request.body

    if ('url' in request.body) {
      try {
        const { url } = request.body

        // This will throw if the url is a mapbox style url and an access token is not provided
        // Ideally prevented via client-side code but just in case
        const upstreamUrl = normalizeStyleURL(url, accessToken)

        style = (await got(upstreamUrl).json()) as any
        id = createIdFromStyleUrl(url)
      } catch (err) {
        throw createInvalidStyleError(err)
      }
    } else if ('style' in request.body) {
      style = request.body.style
    } else {
      throw new InvalidRequestBodyError(
        'Body must have one of the following fields: style, filepath, url'
      )
    }

    validateStyle(style)

    // TODO: Should we catch the missing access token issue before calling this? i.e. check if `url` or any of `style.sources` are Mapbox urls
    // `createStyle` will catch these but may save resources in the db before that occurs
    const stylejson = await request.api.createStyle(style, { id, accessToken })

    reply.header('Location', `${fastify.prefix}/${id}`)

    return stylejson
  })

  fastify.get<{ Params: GetStyleParams }>(
    '/:styleId',
    async function (request) {
      return request.api.getStyle(request.params.styleId)
    }
  )

  fastify.delete<{ Params: DeleteStyleParams }>(
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
