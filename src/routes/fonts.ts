import { FastifyPluginAsync } from 'fastify'
import { Static, Type as T } from '@sinclair/typebox'

const GetGlyphsParams = T.Object({
  fontstack: T.String(),
  start: T.Number(),
  end: T.Number(),
})

const fonts: FastifyPluginAsync = async function (fastify) {
  fastify.get<{ Params: Static<typeof GetGlyphsParams> }>(
    '/:fontstack/:start-:end.pbf',
    {
      schema: {
        params: GetGlyphsParams,
      },
    },
    async function (request, reply) {
      const { fontstack, start, end } = request.params

      const fonts = decodeURIComponent(fontstack).split(',')

      const fontToUse = fonts[0] || 'opensans'

      const result = await this.api.getGlyphs(fontToUse, start, end)

      switch (result.type) {
        case 'file': {
          return reply.sendFile(`${fontToUse}/${start}-${end}.pbf`)
        }
        case 'raw': {
          // TODO: Set the headers here
          reply.header('Content-Type', 'application/octet-stream')
          return result.data
        }
      }
    }
  )
}

export default fonts
