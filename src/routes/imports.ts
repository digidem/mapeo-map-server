import { FastifyPluginAsync } from 'fastify'
import { Static, Type as T } from '@sinclair/typebox'

import { PortMessage } from '../lib/mbtiles_import_worker'

const GetImportProgressParamsSchema = T.Object({
  importId: T.String(),
})

const imports: FastifyPluginAsync = async function (fastify) {
  fastify.get<{ Params: Static<typeof GetImportProgressParamsSchema> }>(
    '/:importId',
    {
      schema: {
        params: GetImportProgressParamsSchema,
      },
    },
    async function (request) {
      return request.api.getImport(request.params.importId)
    }
  )

  fastify.get<{ Params: Static<typeof GetImportProgressParamsSchema> }>(
    '/progress/:importId',
    {
      schema: {
        params: GetImportProgressParamsSchema,
      },
    },
    async function (request, reply) {
      const { importId } = request.params

      const port = await request.api.getImportPort(importId)

      // No port means that the import may already be completed
      if (!port) {
        const { state, totalBytes } = await request.api.getImport(importId)

        if (state === 'complete') {
          reply.sse({
            data: JSON.stringify({
              type: state,
              importId,
              soFar: totalBytes,
              total: totalBytes,
            }),
          })
        }

        return reply
      }

      port.on('message', onMessage)

      request.socket.on('close', () => {
        port.off('message', onMessage)
      })

      function onMessage(message: PortMessage) {
        reply.sse({ data: JSON.stringify(message) })
      }

      return reply
    }
  )
}

export default imports
