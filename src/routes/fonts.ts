import { FastifyPluginAsync } from 'fastify'
import { HTTPError, RequestError } from 'got'
import { Static, Type as T } from '@sinclair/typebox'

import {
  NotFoundError,
  OFFLINE_ERROR_CODES,
  createForwardedUpstreamError,
} from '../api/errors'
import { DEFAULT_STATIC_FONT, createStaticGlyphPath } from '../lib/glyphs'

const GetGlyphsParams = T.Object({
  fontstack: T.String({ description: 'A comma-separated list of fonts' }),
  start: T.Number({
    description: 'A multiple of `256` between `0` and `65280`',
  }),
  end: T.Number({ description: '`start` plus `255`' }),
})

const GetGlyphsQuerystring = T.Object({
  access_token: T.Optional(
    T.String({
      description: 'Access token used to make upstream requests',
    })
  ),
  styleId: T.Optional(
    T.String({
      description:
        'ID of style requesting this font range (necessary for making upstream requests)',
    })
  ),
})

const GetGlyphsResponse200 = T.String({
  description: 'Protocol buffer-encoded SDF values',
  contentEncoding: 'binary',
  contentMediaType: 'application/x-protobuf',
})

function isOfflineError(err: unknown) {
  return err instanceof RequestError && OFFLINE_ERROR_CODES.includes(err.code)
}

function isNotFoundError(err: unknown) {
  return (
    err instanceof NotFoundError ||
    (err instanceof HTTPError && err.response.statusCode === 404)
  )
}

const fonts: FastifyPluginAsync = async function (fastify) {
  // TODO: This endpoint may need to mirror the fonts api errors provided by Mapbox
  // https://docs.mapbox.com/api/maps/fonts/#fonts-api-errors
  fastify.get<{
    Params: Static<typeof GetGlyphsParams>
    Querystring: Static<typeof GetGlyphsQuerystring>
  }>(
    '/:fontstack/:start-:end.pbf',
    {
      schema: {
        description:
          'Retrieve a range of font glyphs. Uses a fallback font if no matching local or upstream fonts are available',
        params: GetGlyphsParams,
        querystring: GetGlyphsQuerystring,
        produces: ['application/x-protobuf', 'application/json'],
        response: {
          200: GetGlyphsResponse200,
        },
      },
    },
    async function (request, reply) {
      const { fontstack, start, end } = request.params
      const { access_token, styleId } = request.query

      const fonts = decodeURIComponent(fontstack).split(',')

      try {
        const firstFont = fonts[0]

        const result = await this.api.getGlyphs({
          styleId,
          accessToken: access_token,
          font: firstFont,
          start,
          end,
        })

        switch (result.type) {
          case 'file': {
            reply.header('Content-Type', 'application/x-protobuf')
            return reply.sendFile(createStaticGlyphPath(firstFont, start, end))
          }
          case 'raw': {
            reply.headers({
              'Content-Type': 'application/x-protobuf',
              ETag: result.etag,
            })
            return result.data
          }
        }
      } catch (err) {
        // TODO: Do we want to return default fallback if upstream returns 404?
        if (isOfflineError(err) || isNotFoundError(err)) {
          return reply.sendFile(
            createStaticGlyphPath(DEFAULT_STATIC_FONT, start, end)
          )
        }

        // This is when the upstream api provides an error status
        if (err instanceof HTTPError) {
          throw new (createForwardedUpstreamError(err.response.statusCode))(
            err.response.url,
            err.response.statusMessage
          )
        }

        throw err
      }
    }
  )
}

export default fonts
