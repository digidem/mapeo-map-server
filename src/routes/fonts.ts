import { FastifyPluginAsync } from 'fastify'
import { HTTPError } from 'got'
import { Static, Type as T } from '@sinclair/typebox'

import {
  createForwardedUpstreamError,
  isOfflineError,
  isNotFoundError,
} from '../api/errors'
import { DEFAULT_STATIC_FONT, createStaticGlyphPath } from '../lib/glyphs'

const GetGlyphsParams = T.Object({
  fontstack: T.String(),
  start: T.Number(),
  end: T.Number(),
})

const GetGlyphsQuerystring = T.Object({
  access_token: T.Optional(T.String()),
  styleId: T.Optional(T.String()),
})

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
        params: GetGlyphsParams,
        querystring: GetGlyphsQuerystring,
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
