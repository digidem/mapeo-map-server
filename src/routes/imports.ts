import { FastifyPluginAsync } from 'fastify'
import { Static, Type as T } from '@sinclair/typebox'
import { PassThrough } from 'readable-stream'

import { PortMessage } from '../lib/mbtiles_import_worker'
import { serializeSSE, addSSEHeaders, type EventMessage } from '../lib/sse'

import { NotFoundError } from '../api/errors'

const GetImportProgressParamsSchema = T.Object({
  importId: T.String(),
})

const SSE_RETRY_INTERVAL = 5000

const imports: FastifyPluginAsync = async function (fastify) {
  fastify.get<{ Params: Static<typeof GetImportProgressParamsSchema> }>(
    '/progress/:importId',
    {
      schema: {
        params: GetImportProgressParamsSchema,
      },
    },
    async function (request, reply) {
      const { importId } = request.params
      // Respond with 404 and close connection if import does not exist
      const importProgress = this.api.getImport(importId)
      if (!importProgress) throw NotFoundError(importId)

      addSSEHeaders(reply)

      const lastEventId = request.headers['last-event-id']
      // If the last event sent was a complete or error message, then respond
      // with 204, so that the client does not reconnect.
      if (lastEventId === 'complete' || lastEventId === 'error') {
        reply.code(204).send()
        return
      }

      const port = this.api.getImportPort(importId)
      // This is an unexpected error state: import active but no port
      if (importProgress.state === 'active' && !port) {
        // TODO: log / report error
        return reply.code(204).send()
      }

      const data: PortMessage = {
        type: importProgress.state.replace(
          'active',
          'progress'
        ) as PortMessage['type'],
        importId,
        soFar: importProgress.importedBytes || 0,
        total: importProgress.totalBytes || 0,
      }
      const message: EventMessage = {
        data: JSON.stringify(data),
        retry: SSE_RETRY_INTERVAL,
      }

      // If the progress state is 'complete' or 'error', then send a single
      // SSE message with the message id set to the import progress state, and
      // close the connection
      if (importProgress.state !== 'active') {
        message.id = importProgress.state
        reply.send(serializeSSE(message))
        return
      }
      // Can't get here, but Typescript doesn't understand that.
      if (!port) return

      const stream = new PassThrough()
      reply.send(stream)
      // Immediately send message with current import state in DB
      // (e.g. don't wait for message from socket)
      stream.write(serializeSSE(message))

      port.on('message', onMessage)

      request.socket.on('close', () => {
        port.off('message', onMessage)
      })

      function onMessage(data: PortMessage) {
        const message: EventMessage = { data: JSON.stringify(data) }
        if (data.type !== 'progress') {
          message.id = data.type
        }
        stream.write(serializeSSE(message))
        // If import type becomes 'complete' or 'error', close connection
        // (the client will reconnect and get the appropriate status code)
        // (check for port is to let Typescript know this is defined)
        if (data.type !== 'progress' && port) {
          port.off('message', onMessage)
          stream.end()
        }
      }
    }
  )
}

export default imports
