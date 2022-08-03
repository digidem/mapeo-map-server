import { FastifyPluginAsync } from 'fastify'
import { Static, Type as T } from '@sinclair/typebox'

import { NotFoundError } from '../api/errors'
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
            return reply.sendFile(createStaticGlyphPath(firstFont, start, end))
          }
          case 'raw': {
            // TODO: Set other headers here?
            reply.header('Content-Type', 'application/octet-stream')
            return result.data
          }
        }
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.sendFile(
            createStaticGlyphPath(DEFAULT_STATIC_FONT, start, end)
          )
        }
        throw err
      }
    }
  )
}

export default fonts
