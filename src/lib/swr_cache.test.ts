import Fastify from 'fastify'
import Etag from 'fastify-etag'
import Level from 'level'
import tap from 'tap'
import tmp from 'tmp'

import SWRCache from './swr_cache'
import subleveldown from 'subleveldown'

tmp.setGracefulCleanup()

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

  server.addHook('onSend', (request, reply, payload, done) => {
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

tap.beforeEach(async (done, t) => {
  const server = createServer()
  await server.listen(3000)
  const { name: dbPath } = tmp.dirSync({ unsafeCleanup: true })
  const db = Level(dbPath, { valueEncoding: 'binary' })
  const cacheDb = subleveldown(db, 'cache', { valueEncoding: 'binary' })
  const etagDb = subleveldown(db, 'etag', { valueEncoding: 'string' })
  t.context.swrCache = new SWRCache({ cacheDb, etagDb })
  t.context.server = server
})

tap.afterEach(async (done, t) => {
  await t.context.server.close()
})

/**
 * This should test expected Stale-While-Revalidate behaviour:
 * 1. First request goes to the server, and is cached
 * 2. Second request is fulfilled from the cache
 * 3. Cache is revalidated via a request to the server with `If-None-Match`
 *    header, and does nothing if server responds 304
 */
tap.test('Repeat request comes from cache', async (t) => {
  const { swrCache, server } = t.context
  const buf = await swrCache.get('http://localhost:3000/')
  t.deepEqual(JSON.parse(buf.toString()), { hello: 'world' })
  const buf2 = await swrCache.get('http://localhost:3000/')
  t.deepEqual(JSON.parse(buf2.toString()), { hello: 'world' })
  // Need to await pending cache revalidate to server
  await swrCache.allSettled()
  t.equal(server.responses.length, 2, '2 requests to server')
  t.equal(
    server.responses[1].statusCode,
    304,
    'Server responded with not modified 304'
  )
  t.equal(
    server.responses[1].payload.length,
    0,
    'Server responded with empty body'
  )
  t.end()
})

/**
 * This should test behaviour to avoid repeat requests:
 * 1. Cache has inflight request for a resource
 * 2. Client requests same resource again
 * 3. Cache does not make additional requests, fulfills with existing request
 */
tap.test('Repeat requests in same tick only hit server once', async (t) => {
  const { swrCache, server } = t.context
  const bufs: Buffer[] = await Promise.all(
    new Array(10).fill(swrCache.get('http://localhost:3000/'))
  )
  bufs.reduce((prev, curr) => {
    t.ok(prev.equals(curr), 'Responses match')
    return curr
  })
  // Need to await pending requests to server
  await swrCache.allSettled()
  t.equal(server.responses.length, 1, 'Only one request to server')

  t.end()
})

/**
 * This checks the Stale-While-Revalidate behaviour to check that the cache is
 * actually updated when the server resource changes
 */
tap.test('Repeat request updates cache with new value', async (t) => {
  const { swrCache, server } = t.context
  const buf = await swrCache.get('http://localhost:3000/')
  t.deepEqual(
    JSON.parse(buf.toString()),
    { hello: 'world' },
    'First response comes from server'
  )

  // Change server resource
  server.setPayload(Buffer.from(JSON.stringify({ hello: 'earth' })))
  const buf2 = await swrCache.get('http://localhost:3000/')
  t.deepEqual(
    JSON.parse(buf2.toString()),
    { hello: 'world' },
    'Second response comes from cache'
  )

  // Need to await pending cache revalidate to server
  await swrCache.allSettled()
  const buf3 = await swrCache.get('http://localhost:3000/')
  t.deepEqual(
    JSON.parse(buf3.toString()),
    { hello: 'earth' },
    'Third response comes from now updated cache'
  )

  await swrCache.allSettled()

  t.equal(server.responses.length, 3, '3 requests to server')
  t.equal(
    server.responses[1].statusCode,
    200,
    'On second request server responded with updated resource'
  )
  t.equal(
    server.responses[2].statusCode,
    304,
    'Third request, server says not modified'
  )
  t.end()
})

tap.test('forceOffline option does not make request to server', async (t) => {
  const { swrCache, server } = t.context
  const buf = await swrCache.get('http://localhost:3000/')
  const buf2 = await swrCache.get('http://localhost:3000/', {
    forceOffline: true,
  })
  t.ok(buf.equals(buf2), 'Responses are equal')

  // Need to await pending requests to server
  await swrCache.allSettled()
  t.equal(server.responses.length, 1, 'Only one request to server')

  t.end()
})

tap.test('forceOffline option throws error if no cache', async (t) => {
  const { swrCache, server } = t.context

  t.rejects(
    swrCache.get('http://localhost:3000/', { forceOffline: true }),
    'Throws'
  )

  // Need to await pending requests to server
  await swrCache.allSettled()
  t.equal(server.responses.length, 0, 'No requests to server')

  t.end()
})
