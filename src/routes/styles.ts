import { promises as fs } from 'fs'
import { FastifyPluginAsync } from 'fastify'
import createError from 'fastify-error'
import got from 'got'

import { normalizeStyleURL } from '../lib/mapbox_urls'
import {
  OfflineStyle,
  StyleJSON,
  createIdFromStyleUrl,
  validate,
} from '../lib/stylejson'

interface GetStylesQuerystring {
  limit?: number
}

interface GetStyleParams {
  styleId: string
}

interface PutStyleParams {
  styleId: string
}

type PutStyleBody = OfflineStyle | StyleJSON

interface DeleteStyleParams {
  styleId: string
}

type PostStyleBody = { accessToken?: string } & (
  | { url: string }
  | { filepath: string }
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
  fastify.get<{ Querystring: GetStylesQuerystring }>(
    '/',
    async function (request) {
      return request.api.listStyles(request.query.limit)
    }
  )

  fastify.post<{ Body: PostStyleBody }>('/', async function (request, reply) {
    let style: unknown
    let id: string | undefined
    const { accessToken } = request.body

    if ('filepath' in request.body) {
      try {
        const parsedStyle = JSON.parse(
          await fs.readFile(request.body.filepath, 'utf-8')
        )

        if (!parsedStyle.id) {
          throw new Error('Styles imported via file must have an id field')
        }

        id = parsedStyle.id
      } catch (err) {
        throw createInvalidStyleError(err)
      }
    } else if ('url' in request.body) {
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

    const stylejson = await request.api.createStyle(style, { id, accessToken })

    reply.header('Location', `${fastify.prefix}/${stylejson.id}`)

    return stylejson
  })

  fastify.get<{ Params: GetStyleParams }>(
    '/:styleId',
    async function (request) {
      return request.api.getStyle(request.params.styleId)
    }
  )

  // TODO: May need to accept an access token?
  fastify.put<{
    Params: PutStyleParams
    Body: PutStyleBody
  }>('/:styleId', async function (request) {
    const style = request.body

    validateStyle(style)

    const stylejson = await request.api.putStyle(request.params.styleId, style)

    return stylejson
  })

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
