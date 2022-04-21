import { afterEach, before, beforeEach, teardown, test } from 'tap'
import tmp from 'tmp'
import path from 'path'
import fs from 'fs'
import { FastifyInstance } from 'fastify'
import { VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec'

import { IdResource, Api } from './api'
import app from './app'
import mapboxRasterTilejson from './fixtures/good-tilejson/mapbox_raster_tilejson.json'
import simpleStylejson from './fixtures/good-stylejson/good-simple.json'
import { StyleJSON, validate as validateStyleJSON } from './lib/stylejson'
import { TileJSON, validateTileJSON } from './lib/tilejson'
import { server as mockTileServer } from './mocks/server'

tmp.setGracefulCleanup()

const DUMMY_MB_ACCESS_TOKEN = 'pk.abc123'

type TestContext = {
  server: FastifyInstance
  sampleTileJSON: TileJSON
  sampleStyleJSON: StyleJSON
}

function assertSampleTileJSONIsValid(data: unknown): asserts data is TileJSON {
  if (!validateTileJSON(data)) {
    const message = `Sample input does not conform to TileJSON schema spec: ${JSON.stringify(
      validateTileJSON.errors,
      null,
      2
    )}`

    throw new Error(message)
  }
}

before(() => {
  // Check if prisma/migrations directory exists in project
  if (!fs.existsSync(path.resolve(__dirname, '../prisma/migrations'))) {
    throw new Error(
      'Could not find prisma migrations directory. Make sure you run `npm run prisma:migrate-dev -- --name MIGRATION_NAME_HERE` first!'
    )
  }

  assertSampleTileJSONIsValid(mapboxRasterTilejson)
  validateStyleJSON(simpleStylejson)

  mockTileServer.listen()
})

beforeEach((t) => {
  const { name: dataDir } = tmp.dirSync({ unsafeCleanup: true })

  t.context = {
    server: app(
      { logger: false },
      { dbPath: path.resolve(dataDir, 'test.db') }
    ),
    sampleTileJSON: mapboxRasterTilejson,
    sampleStyleJSON: simpleStylejson,
  }
})

afterEach((t) => {
  t.context.server.close()
  mockTileServer.resetHandlers()
})

teardown(() => {
  mockTileServer.close()
})

/**
 * /tilesets tests
 */
test('GET /tilesets (empty)', async (t) => {
  const { server } = t.context as TestContext

  const response = await server.inject({ method: 'GET', url: '/tilesets' })

  t.equal(response.statusCode, 200, 'returns a status code of 200')

  t.equal(
    response.headers['content-type'],
    'application/json; charset=utf-8',
    'returns correct content-type header'
  )

  t.same(response.json(), [], 'returns empty array')

  t.end()
})

test('GET /tilesets (not empty)', async (t) => {
  const { sampleTileJSON, server } = t.context as TestContext

  await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const expectedId = '23z3tmtw49abd8b4ycah9x94ykjhedam'
  const expectedTileUrl = `http://localhost:80/tilesets/${expectedId}/{z}/{x}/{y}`
  const expectedResponse = [
    {
      ...sampleTileJSON,
      id: expectedId,
      tiles: [expectedTileUrl],
    },
  ]

  const response = await server.inject({ method: 'GET', url: '/tilesets' })

  t.same(response.json(), expectedResponse)

  t.end()
})

test('POST /tilesets', async (t) => {
  const { sampleTileJSON, server } = t.context as TestContext

  const expectedId = '23z3tmtw49abd8b4ycah9x94ykjhedam'
  const expectedTileUrl = `http://localhost:80/tilesets/${expectedId}/{z}/{x}/{y}`
  const expectedResponse = {
    ...sampleTileJSON,
    id: expectedId,
    tiles: [expectedTileUrl],
  }

  const responsePost = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  t.same(
    responsePost.json(),
    expectedResponse,
    'TileJSON POST response matches expected response'
  )

  const responseGet = await server.inject({
    method: 'GET',
    url: '/tilesets',
    payload: { tilesetId: expectedId },
  })

  t.equal(
    responseGet.statusCode,
    200,
    'Can GET the specific tileset after creation'
  )

  t.end()
})

test('PUT /tilesets (tileset exists)', async (t) => {
  const { sampleTileJSON, server } = t.context as TestContext

  const initialResponse = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const updatedFields: Partial<TileJSON> = {
    name: 'Map Server Test',
  }

  const updatedResponse = await server.inject({
    method: 'PUT',
    url: `/tilesets/${initialResponse.json<TileJSON>().id}`,
    payload: { ...initialResponse.json<TileJSON>(), ...updatedFields },
  })

  t.equal(updatedResponse.statusCode, 200, 'PUT responded with 200')

  t.notSame(
    initialResponse.json(),
    updatedResponse.json(),
    'Updated response is different from initial creation'
  )

  t.equal(
    updatedResponse.json<TileJSON>().name,
    updatedFields.name,
    'Response has updated fields'
  )

  t.end()
})

test('PUT /tilesets (bad param)', async (t) => {
  const { sampleTileJSON, server } = t.context as TestContext

  const response = await server.inject({
    method: 'PUT',
    url: `/tilesets/bad-id`,
    payload: { ...sampleTileJSON, name: 'Map Server Test' },
  })

  t.equal(
    response.statusCode,
    400,
    'Mismatched id param and body id returns Bad Request error code (400)'
  )

  t.end()
})

test('PUT /tilesets (tileset does not exist)', async (t) => {
  const { sampleTileJSON, server } = t.context as TestContext

  const response = await server.inject({
    method: 'PUT',
    url: `/tilesets/${sampleTileJSON.id}`,
    payload: { ...sampleTileJSON, name: 'Map Server Test' },
  })

  t.equal(
    response.statusCode,
    404,
    'Attempt to update non-existent tileset returns Not Found status code (404)'
  )

  t.end()
})

/**
 * /tile tests
 */
test('GET /tile before tileset created', async (t) => {
  const { server } = t.context as TestContext

  const response = await server.inject({
    method: 'GET',
    url: `/tilesets/foobar/1/2/3`,
  })

  t.equal(
    response.statusCode,
    404,
    'Responds with Not Found error code (404) when requested before tileset creation'
  )
})

test('GET /tile (png)', async (t) => {
  const { sampleTileJSON, server } = t.context as TestContext

  // Create initial tileset
  const initialResponse = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const tilesetId = initialResponse.json<TileJSON & IdResource>().id

  const response = await server.inject({
    method: 'GET',
    url: `/tilesets/${tilesetId}/1/2/3`,
  })

  t.equal(response.statusCode, 200, 'Responds with 200 status code')

  t.equal(
    response.headers['content-type'],
    'image/png',
    'Response content type matches desired resource type'
  )

  t.equal(typeof response.body, 'string', 'Response body type is a string')

  t.end()
})

/**
 * /styles tests
 */

// TODO: Add styles tests for:
// - POST /styles (style via url)

test('POST /styles with invalid style returns 400 status code', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: { style: { ...sampleStyleJSON, sources: undefined } },
  })

  t.equal(responsePost.statusCode, 400)
})

// Reflects the case where a user is providing the style directly
// We'd enforce at the application level that they provide an `id` field in their body
test('POST /styles when providing an id returns resource with the same id', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const expectedId = 'example-style-id'

  const payload = {
    style: sampleStyleJSON,
    id: expectedId,
    accessToken: DUMMY_MB_ACCESS_TOKEN,
  }

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload,
  })

  t.equal(responsePost.json().id, expectedId)
})

test('POST /styles when style exists returns 409', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const payload = {
    style: sampleStyleJSON,
    id: 'example-style-id',
    accessToken: DUMMY_MB_ACCESS_TOKEN,
  }

  const responsePost1 = await server.inject({
    method: 'POST',
    url: '/styles',
    payload,
  })

  t.equal(responsePost1.statusCode, 200)

  const responsePost2 = await server.inject({
    method: 'POST',
    url: '/styles',
    payload,
  })

  t.equal(responsePost2.statusCode, 409)
})

test('POST /styles when providing valid style returns resource with id and altered style', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: { style: sampleStyleJSON, accessToken: DUMMY_MB_ACCESS_TOKEN },
  })

  t.equal(responsePost.statusCode, 200)

  const { id, style } =
    responsePost.json<Awaited<ReturnType<Api['createStyle']>>>()

  t.ok(id, 'created style possesses an id')

  t.notSame(
    style.sources,
    sampleStyleJSON.sources,
    'created style possesses sources that are different from input'
  )

  // The map server updates the sources so that each source's `url` field points to the map server
  const ignoredStyleFields = {
    sources: undefined,
  }

  t.same(
    { ...style, ...ignoredStyleFields },
    { ...sampleStyleJSON, ...ignoredStyleFields },
    'with exception of `sources` field, created style is the same as input'
  )

  const tilesetEndpointPrefix = `http://localhost:80/tilesets/`

  Object.entries(style.sources).forEach(([sourceId, source]) => {
    if ('url' in source) {
      // TODO: Ideally verify that each url ends with the corresponding tileset id
      t.ok(
        source.url?.startsWith(tilesetEndpointPrefix),
        'url field in source remapped to point to map server api endpoint'
      )
    }

    const ignoredSourceFields = {
      url: undefined,
    }

    t.same(
      { ...source, ...ignoredSourceFields },
      {
        ...sampleStyleJSON.sources[sourceId],
        ...ignoredSourceFields,
      },
      'with exception of `url` field, source from created style matches source from input'
    )
  })
})

test('POST /styles when required Mapbox access token is missing returns 400 status code', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    // Make sure that the style used here has URLs that reference Mapbox APIs
    payload: { style: sampleStyleJSON, accessToken: undefined },
  })

  t.equal(responsePost.statusCode, 400)
})

test('GET /styles/:styleId when  style does not exist return 404 status code', async (t) => {
  const { server } = t.context as TestContext

  const id = 'nonexistent-id'

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${id}`,
  })

  t.equal(responseGet.statusCode, 404)
})

test('GET /styles/:styleId when style exists returns altered style', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: { style: sampleStyleJSON, accessToken: DUMMY_MB_ACCESS_TOKEN },
  })

  const { id: expectedId } =
    responsePost.json<{ id: string; style: StyleJSON }>()

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${expectedId}`,
  })

  t.equal(responseGet.statusCode, 200)

  // This will change if a style fixture other than good-stylejson/good-simple.json is used
  const expectedTilesetId = 'yqtx3fxnp2vdyssc82ew4f377g4y0njk' // generated from getTilesetId in lib/utils.ts
  const expectedTilesetUrl = `http://localhost:80/tilesets/${expectedTilesetId}`

  // Each source id should be replaced with the id of the tileset used for it
  const expectedSources = {
    'mapbox-streets': {
      ...(simpleStylejson.sources[
        'mapbox-streets'
      ] as VectorSourceSpecification),
      url: expectedTilesetUrl,
    },
  }

  const expectedGetResponse = {
    ...sampleStyleJSON,
    sources: expectedSources,
  }

  t.same(responseGet.json(), expectedGetResponse)
})

test('GET /styles when no styles exist returns body with an empty array', async (t) => {
  const { server } = t.context as TestContext

  const response = await server.inject({ method: 'GET', url: '/styles' })

  t.equal(response.statusCode, 200)

  t.same(response.json(), [])
})

test('GET /styles when styles exist returns array of metadata for each', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: sampleStyleJSON,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const { id: expectedId } = responsePost.json()

  const expectedSources = {
    'mapbox-streets': {
      ...(sampleStyleJSON.sources[
        'mapbox-streets'
      ] as VectorSourceSpecification),
      url: 'http://localhost:80/tilesets/yqtx3fxnp2vdyssc82ew4f377g4y0njk',
    },
  }

  const expectedGetResponse = [
    {
      id: expectedId,
      style: { ...sampleStyleJSON, sources: expectedSources },
    },
  ]

  const responseGet = await server.inject({ method: 'GET', url: '/styles' })

  t.equal(responseGet.statusCode, 200)

  t.same(responseGet.json(), expectedGetResponse)
})

test('DELETE /styles/:styleId when style does not exist returns 404 status code', async (t) => {
  const { server } = t.context as TestContext

  const id = 'nonexistent-id'

  const responseDelete = await server.inject({
    method: 'DELETE',
    url: `/styles/${id}`,
  })

  t.equal(responseDelete.statusCode, 404)
})

test('DELETE /styles/:styleId when style exists returns 204 status code and empty body', async (t) => {
  const { server } = t.context as TestContext

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: { style: simpleStylejson, accessToken: DUMMY_MB_ACCESS_TOKEN },
  })

  const { id } = responsePost.json<{ id: string; style: StyleJSON }>()

  const responseDelete = await server.inject({
    method: 'DELETE',
    url: `/styles/${id}`,
  })

  t.equal(responseDelete.statusCode, 204)

  t.equal(responseDelete.body, '')

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${id}`,
  })

  t.equal(responseGet.statusCode, 404, 'style is properly deleted')
})
