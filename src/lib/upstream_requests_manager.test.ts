import Fastify from 'fastify'
import Etag from '@fastify/etag'
import { afterEach, beforeEach, test } from 'tap'

import { UpstreamRequestsManager } from './upstream_requests_manager'

const PORT = 3001
const ENDPOINT_URL = `http://localhost:${PORT}/`

type TestContext = {
  server: any
  upstreamRequestsManager: UpstreamRequestsManager
}

function createServer() {
  const server = Fastify({ logger: false })
  let payload = Buffer.from(JSON.stringify({ hello: 'world' }))
  const responses: Array<{
    payload: any
    statusCode: number
    headers: any
  }> = []
  server.register(Etag)

  server.get('/', async () => {
    return payload
  })

  server.addHook('onSend', (_request, reply, payload, done) => {
    responses.push({
      payload,
      statusCode: reply.statusCode,
      headers: reply.getHeaders(),
    })
    done(null, payload)
  })

  return {
    listen: server.listen.bind(server),
    close: server.close.bind(server),
    responses,
    setPayload(newPayload: Buffer) {
      payload = newPayload
    },
  }
}

beforeEach(async (t) => {
  const server = createServer()
  await server.listen(PORT)

  t.context = {
    server,
    upstreamRequestsManager: new UpstreamRequestsManager(),
  }
})

afterEach((t) => {
  t.context.server.close()
})

/**
 * This should test behaviour to avoid repeat requests:
 * 1. Manager has inflight request for a resource
 * 2. Client requests same resource again
 * 3. Manager does not make additional requests, fulfills with existing request
 */
test('Repeat requests in same tick only hit server once', async (t) => {
  const { server, upstreamRequestsManager } = t.context as TestContext

  const responses = await Promise.all([
    upstreamRequestsManager.getUpstream({
      url: ENDPOINT_URL,
      responseType: 'buffer',
    }),
    upstreamRequestsManager.getUpstream({
      url: ENDPOINT_URL,
      responseType: 'buffer',
    }),
    upstreamRequestsManager.getUpstream({
      url: ENDPOINT_URL,
      responseType: 'buffer',
    }),
  ])

  responses.reduce((prev, curr) => {
    t.ok(prev.data.equals(curr.data), 'Responses match')
    t.ok(prev.etag === curr.etag, 'etags match')
    return curr
  })

  // Need to await pending requests to revalidate to server
  await upstreamRequestsManager.allSettled()

  t.equal(server.responses.length, 1, 'Only one request to server')

  t.end()
})

/**
 * 1. Client makes initial request for resource
 * 2. Server updates associated resource
 * 3. Client makes subsequent request for resource. Response should reflect updated resource
 * 4. Server updates associated resource again
 * 5. Client make subsequent request for resource *based on resource from step 1*. Response should reflect updated resource
 */
test('Upstream resource updated when modified', async (t) => {
  const { server, upstreamRequestsManager } = t.context as TestContext

  const response1 = await upstreamRequestsManager.getUpstream({
    url: ENDPOINT_URL,
    responseType: 'buffer',
  })

  t.same(
    JSON.parse(response1.data.toString()),
    { hello: 'world' },
    'First response comes from server'
  )

  // Change server resource
  server.setPayload(Buffer.from(JSON.stringify({ hello: 'earth' })))

  const response2 = await upstreamRequestsManager.getUpstream({
    url: ENDPOINT_URL,
    responseType: 'buffer',
    etag: response1.etag,
  })

  t.same(
    JSON.parse(response2.data.toString()),
    { hello: 'earth' },
    'Second response comes from updated server'
  )

  // Change server resource again
  server.setPayload(Buffer.from(JSON.stringify({ hello: 'goodbye' })))

  const response3 = await upstreamRequestsManager.getUpstream({
    url: ENDPOINT_URL,
    responseType: 'buffer',
    etag: response1.etag,
  })

  t.same(
    JSON.parse(response3.data.toString()),
    { hello: 'goodbye' },
    'Third response comes from updated server'
  )

  // Need to await pending requests to revalidate to server
  await upstreamRequestsManager.allSettled()

  t.equal(server.responses.length, 3, '3 requests to server')

  t.equal(
    server.responses[1].statusCode,
    200,
    'On second request, server responded with updated resource'
  )

  t.equal(
    server.responses[2].statusCode,
    200,
    'On third request, server responded with updated resource'
  )

  t.end()
})

/**
 * Requesting an upstream resource that hasn't been modified should reject with a not modified error
 */
test('Upstream resource not modified', async (t) => {
  const { server, upstreamRequestsManager } = t.context as TestContext

  const response1 = await upstreamRequestsManager.getUpstream({
    url: ENDPOINT_URL,
    responseType: 'buffer',
  })

  t.rejects(
    upstreamRequestsManager.getUpstream({
      url: ENDPOINT_URL,
      responseType: 'buffer',
      etag: response1.etag,
    })
  )

  // Need to await pending requests to revalidate to server
  await upstreamRequestsManager.allSettled()

  t.equal(server.responses.length, 2, '2 requests to server')

  t.equal(
    server.responses[1].statusCode,
    304,
    'On second request, server says not modified'
  )

  t.end()
})

// TODO: Add tests for text and json response types
