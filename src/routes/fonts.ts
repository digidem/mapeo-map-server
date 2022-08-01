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

      return reply.sendFile(`${fontToUse}/${start}-${end}.pbf`)
    }
  )
}

export default fonts
