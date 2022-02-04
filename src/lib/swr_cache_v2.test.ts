import path from 'path'
import Fastify from 'fastify'
import Etag from 'fastify-etag'
import tap from 'tap'
import tmp from 'tmp'
import Database, { Database as DatabaseInstance } from 'better-sqlite3'

import { SWRCacheResponse, SWRCacheV2 } from './swr_cache'

type TestContext = {
  db: DatabaseInstance
  server: any
  swrCache: SWRCacheV2<Buffer>
}

const PORT = 3001
const ENDPOINT_URL = `http://localhost:${PORT}/`

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

function createCacheGet(db: DatabaseInstance, id: number) {
  return async function () {
    const result: { id: number; data: Buffer; etag?: string } | undefined = db
      .prepare('SELECT id, data, etag FROM CacheTest WHERE id = ?;')
      .get(id)

    if (!result) {
      throw new Error(`No result matching id = ${id}`)
    }

    return result
  }
}

function createCachePut(db: DatabaseInstance, id?: number) {
  return async function ({
    data,
    etag,
  }: {
    data: Buffer
    etag?: string
    url: string
  }) {
    const query =
      id === undefined
        ? 'INSERT INTO CacheTest (data, etag) VALUES (:data, :etag)'
        : 'INSERT INTO CacheTest (id, data, etag) VALUES (:id, :data, :etag) ' +
          'ON CONFLICT DO UPDATE SET (data, etag) = (excluded.data, excluded.etag)'

    db.prepare(query).run({
      id,
      data,
      etag,
    })
  }
}

tap.beforeEach(async (_done, t) => {
  const server = createServer()
  await server.listen(PORT)
  const { name: dbPath } = tmp.dirSync({ unsafeCleanup: true })

  const db = new Database(path.resolve(dbPath, 'cache-test.db'))

  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS CacheTest (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        data BLOB NOT NULL,
        etag TEXT
    );`
  ).run()

  db.prepare('DELETE FROM CacheTest;').run()

  t.context = {
    db,
    server,
    swrCache: new SWRCacheV2<Buffer>(),
  }
})

tap.afterEach(async (_done, t) => {
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
  const { db, server, swrCache } = t.context as TestContext

  const result1 = await swrCache.get(ENDPOINT_URL, {
    upstreamResponseType: 'buffer',
    get: createCacheGet(db, 1),
    put: createCachePut(db, 1),
  })

  if (!result1) {
    t.fail('Expected result from SWRCache')
    t.done()
    return
  }

  t.deepEqual(JSON.parse(result1.data.toString()), { hello: 'world' })

  const result2 = await swrCache.get(
    ENDPOINT_URL,
    {
      upstreamResponseType: 'buffer',
      get: createCacheGet(db, 1),
      put: createCachePut(db, 1),
    },
    { etag: result1.etag }
  )

  if (!result2) {
    t.fail('Expected result from SWRCache')
    t.done()
    return
  }

  t.deepEqual(JSON.parse(result2.data.toString()), { hello: 'world' })

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
  const { db, server, swrCache } = t.context as TestContext

  const bufs: (Buffer | undefined)[] = (
    await Promise.all(
      new Array(10).fill(
        swrCache.get(ENDPOINT_URL, {
          upstreamResponseType: 'buffer',
          get: createCacheGet(db, 1),
          put: createCachePut(db, 1),
        })
      )
    )
  ).map((response: SWRCacheResponse<Buffer>) => response?.data)

  bufs.reduce((prev, curr) => {
    if (!(prev && curr)) {
      t.ok(prev === curr, 'Responses match')
      return curr
    }
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
  const { db, server, swrCache } = t.context as TestContext

  const result1 = await swrCache.get(ENDPOINT_URL, {
    upstreamResponseType: 'buffer',
    get: createCacheGet(db, 1),
    put: createCachePut(db, 1),
  })

  if (!result1) {
    t.fail('Expected result from SWRCache')
    t.done()
    return
  }

  t.deepEqual(
    JSON.parse(result1.data.toString()),
    { hello: 'world' },
    'First response comes from server'
  )

  // Change server resource
  server.setPayload(Buffer.from(JSON.stringify({ hello: 'earth' })))

  const result2 = await swrCache.get(
    ENDPOINT_URL,
    {
      upstreamResponseType: 'buffer',
      get: createCacheGet(db, 1),
      put: createCachePut(db, 1),
    },
    { etag: result1.etag }
  )

  if (!result2) {
    t.fail('Expected result from SWRCache')
    t.done()
    return
  }

  t.deepEqual(
    JSON.parse(result2.data.toString()),
    { hello: 'world' },
    'Second response comes from cache'
  )

  // Need to await pending cache revalidate to server
  await swrCache.allSettled()

  // TODO: This shouldn't be necessary and we should fix the SWRCacheV2 implementation
  // to make this more internal
  const latestEtag = (await createCacheGet(db, 1)()).etag

  const result3 = await swrCache.get(
    ENDPOINT_URL,
    {
      upstreamResponseType: 'buffer',
      get: createCacheGet(db, 1),
      put: createCachePut(db, 1),
    },
    // TODO: This fails because the etag in the db is updated after this result is retrieved
    // Ideally we'd pass the etag found from calling `cache.get`
    { etag: latestEtag }
  )

  if (!result3) {
    t.fail('Expected result from SWRCache')
    t.done()
    return
  }

  t.deepEqual(
    JSON.parse(result3.data.toString()),
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
  const { db, server, swrCache } = t.context as TestContext
  const result1 = await swrCache.get(ENDPOINT_URL, {
    upstreamResponseType: 'buffer',
    get: createCacheGet(db, 1),
    put: createCachePut(db, 1),
  })

  if (!result1) {
    t.fail('Expected result from SWRCache')
    t.done()
    return
  }

  const result2 = await swrCache.get(
    ENDPOINT_URL,
    {
      upstreamResponseType: 'buffer',
      get: createCacheGet(db, 1),
      put: createCachePut(db, 1),
    },
    { forceOffline: true }
  )

  if (!result2) {
    t.fail('NO RESULT RETURNED FROM CACHE GET')
    t.done()
    return
  }

  t.ok(result1.data.equals(result2.data), 'Responses are equal')

  // Need to await pending requests to server
  await swrCache.allSettled()

  t.equal(server.responses.length, 1, 'Only one request to server')

  t.end()
})

tap.test('forceOffline option throws error if no cache', async (t) => {
  const { db, server, swrCache } = t.context as TestContext

  t.rejects(
    swrCache.get(
      ENDPOINT_URL,
      {
        upstreamResponseType: 'buffer',
        get: createCacheGet(db, 1),
        put: createCachePut(db, 1),
      },
      { forceOffline: true }
    ),
    'Throws'
  )

  // Need to await pending requests to server
  await swrCache.allSettled()

  t.equal(server.responses.length, 0, 'No requests to server')

  t.end()
})
