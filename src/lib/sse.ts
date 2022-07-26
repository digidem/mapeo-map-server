import { type FastifyReply } from 'fastify'

//seems like fastify removed EventMessage in recent release so this is replacement for that
export interface EventMessage {
  /**
   * Message payload
   */
  data?: string

  /**
   * Message identifier, if set, client will send `Last-Event-ID: <id>` header on reconnect
   */
  id?: string

  /**
   * Message type
   */
  event?: string

  /**
   * Update client reconnect interval (how long will client wait before trying to reconnect).
   */
  retry?: number
}

export function addSSEHeaders(reply: FastifyReply) {
  reply.header('Content-Type', 'text/event-stream')
  reply.header('Cache-Control', 'no-cache,no-transform')
  reply.header('Connection', 'keep-alive')
  reply.header('X-Accel-Buffering', 'no')
}

export function serializeSSE(chunk: EventMessage): string {
  let payload = ''
  if (chunk.id) {
    payload += `id: ${chunk.id}\n`
  }
  if (chunk.event) {
    payload += `event: ${chunk.event}\n`
  }
  if (chunk.data) {
    payload += `data: ${chunk.data}\n`
  }
  if (chunk.retry) {
    payload += `retry: ${chunk.retry}\n`
  }
  if (!payload) {
    return ''
  }
  payload += '\n'
  return payload
}
