import { FastifyPluginAsync } from 'fastify'
import createError from '@fastify/error'
import got from 'got'
import { Static, Type as T } from '@sinclair/typebox'

import { normalizeStyleURL } from '../lib/mapbox_urls'
import { StyleJSON, createIdFromStyleUrl, validate } from '../lib/stylejson'
import { parseSpriteUrlName, SpriteIndexSchema } from '../lib/sprites'

const GetSpriteParamsSchema = T.Object({
  styleId: T.String(),
  spriteInfo: T.String(), // contains desired sprite id (and maybe pixel density)
})

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
  fastify.get<{ Reply: { id: string; name: string | null; url: string }[] }>(
    '/',
    async function (request) {
      return request.api.listStyles()
    }
  )

  fastify.post<{
    Body: { accessToken?: string } & (
      | { url: string }
      | { id?: string; style: StyleJSON }
    )
    Reply: { id: string; style: StyleJSON }
  }>('/', async function (request, reply) {
    let etag: string | undefined
    let id: string | undefined
    let style: unknown
    let upstreamUrl: string | undefined

    const { accessToken } = request.body

    if ('url' in request.body && request.body.url) {
      try {
        upstreamUrl = request.body.url

        id = createIdFromStyleUrl(upstreamUrl)

        // This will throw if the url is a mapbox style url and an access token is not provided
        // Ideally prevented via client-side code but just in case
        const normalizedUpstreamUrl = normalizeStyleURL(
          upstreamUrl,
          accessToken
        )

        const { body: fetchedStyle, headers } = await got(
          normalizedUpstreamUrl,
          { responseType: 'json' }
        )

        etag = headers.etag as string | undefined

        style = fetchedStyle
      } catch (err) {
        throw createInvalidStyleError(err)
      }
    } else if ('style' in request.body && request.body.style) {
      // Client can provide id to use for style since there's no good way of deterministically generating one in this case
      id = request.body.id
      style = request.body.style
    } else {
      throw new InvalidRequestBodyError(
        'Body must have one of the following fields: style, url'
      )
    }

    validateStyle(style)

    // TODO: Should we catch the missing access token issue before calling this? i.e. check if `url` or any of `style.sources` are Mapbox urls
    // `createStyle` will catch these but may save resources in the db before that occurs
    const result = await request.api.createStyle(style, {
      accessToken,
      etag,
      id,
      upstreamUrl,
    })

    reply.header('Location', `${fastify.prefix}/${id}`)

    return result
  })

  fastify.get<{
    Params: {
      id: string
    }
    Reply: StyleJSON
  }>('/:id', async function (request) {
    return request.api.getStyle(request.params.id)
  })

  fastify.delete<{
    Params: {
      id: string
    }
  }>(
    '/:id',
    {
      schema: {
        response: 204,
      },
    },
    async function (request, reply) {
      await request.api.deleteStyle(request.params.id)
      reply.code(204).send()
    }
  )

  /**
   * Mapbox SDKs will send requests to json and png endpoints for a corresponding sprite url
   * https://docs.mapbox.com/mapbox-gl-js/style-spec/sprite/#loading-sprite-files
   */

  fastify.get<{
    Params: Static<typeof GetSpriteParamsSchema>
  }>(
    '/:styleId/sprites/:spriteInfo.png',
    {
      schema: {
        params: GetSpriteParamsSchema,
      },
    },
    async (request, reply) => {
      const { id, pixelDensity } = parseSpriteUrlName(request.params.spriteInfo)
      const { data } = await request.api.getSprite(id, pixelDensity, true)

      reply.header('Content-Type', 'image/png')
      reply.send(data)
    }
  )

  fastify.get<{
    Params: Static<typeof GetSpriteParamsSchema>
  }>(
    '/:styleId/sprites/:spriteInfo.json',
    {
      schema: {
        params: GetSpriteParamsSchema,
        response: {
          200: SpriteIndexSchema,
        },
      },
    },
    async (request) => {
      const { id, pixelDensity } = parseSpriteUrlName(request.params.spriteInfo)

      const { layout } = await request.api.getSprite(id, pixelDensity, true)

      return JSON.parse(layout)
    }
  )
}

export default styles
