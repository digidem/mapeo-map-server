import { afterEach, before, beforeEach, teardown, test } from 'tap'
import tmp from 'tmp'
import path from 'path'
import fs from 'fs'
import { FastifyInstance } from 'fastify'
import { VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec'

import { IdResource } from './api'
import app from './app'
import mapboxRasterTilejson from './fixtures/good-tilejson/mapbox_raster_tilejson.json'
import simpleStylejson from './fixtures/good-stylejson/good-simple.json'
import {
  OfflineStyle,
  StyleJSON,
  validate as validateStyleJSON,
} from './lib/stylejson'
import { TileJSON, validateTileJSON } from './lib/tilejson'
import { server as mockTileServer } from './mocks/server'

tmp.setGracefulCleanup()

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
test('POST /styles (style does not exist)', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: sampleStyleJSON,
  })

  t.equal(responsePost.statusCode, 200, 'returns a status code of 200')

  const createdStyle = responsePost.json<OfflineStyle>()

  // TODO: Need to deterministically generate an id for a style, so we should be expecting a known id here at some point
  t.ok(createdStyle.id, 'created style possesses an id')

  t.notSame(
    createdStyle.sources,
    sampleStyleJSON.sources,
    'created style possesses sources that are altered from input'
  )

  const ignoredStyleFields = {
    id: undefined,
    sources: undefined,
  }

  t.same(
    { ...createdStyle, ...ignoredStyleFields },
    { ...sampleStyleJSON, ...ignoredStyleFields },
    'besides id and sources fields, created style is the same as input'
  )

  Object.entries(createdStyle.sources).forEach(([name, source]) => {
    t.ok(source.tilesetId, 'source has tileset id field attached to it')

    if ('url' in source) {
      const expectedSourceUrl = `http://localhost:80/tilesets/${source.tilesetId}`

      t.equal(
        source.url,
        expectedSourceUrl,
        'url field in source remapped to map server instance'
      )
    }

    const ignoredSourceFields = {
      tilesetId: undefined,
      url: undefined,
    }

    t.same(
      { ...source, ...ignoredSourceFields },
      {
        ...sampleStyleJSON.sources[
          name as keyof typeof sampleStyleJSON.sources
        ],
        ...ignoredSourceFields,
      },
      'besides tilesetId and url fields, source from created style matches source from input'
    )
  })
})

// TODO: Style id creation is not deterministic so repeat requests will not detect a conflict right now
test('POST /styles (styles exists)', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const expectedId = 'example-style-id'

  // Reflects the case where a user is importing a local file
  // We'd enforce at the application level that the file contains an `id` field
  const input = { ...sampleStyleJSON, id: expectedId }

  const responsePost1 = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: input,
  })

  t.equal(
    responsePost1.json().id,
    expectedId,
    'id field preserved when providing style with pre-existing id'
  )

  const responsePost2 = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: input,
  })

  t.equal(responsePost2.statusCode, 409, 'repeated POST responds with 409')
})

test('GET /style (style does not exist)', async (t) => {
  const { server } = t.context as TestContext

  const id = 'nonexistent-id'

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${id}`,
  })

  t.equal(responseGet.statusCode, 404, 'responds with 404 status code')
})

test('GET /style (style exists)', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: sampleStyleJSON,
  })

  const { id: expectedId } = responsePost.json<OfflineStyle>()

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${expectedId}`,
  })

  t.equal(responseGet.statusCode, 200, 'responds with 200 status code')

  // This will change if a style fixture other than good-stylejson/good-simple.json is used
  const expectedTilesetId = 'yqtx3fxnp2vdyssc82ew4f377g4y0njk' // generated from getTilesetId in lib/utils.ts
  const expectedTilesetUrl = `http://localhost:80/tilesets/${expectedTilesetId}`

  const expectedSources = {
    'mapbox-streets': {
      ...(simpleStylejson.sources[
        'mapbox-streets'
      ] as VectorSourceSpecification),
      url: expectedTilesetUrl,
      tilesetId: expectedTilesetId,
    },
  }

  const expectedGetResponse = {
    ...sampleStyleJSON,
    id: expectedId,
    sources: expectedSources,
  }

  t.same(responseGet.json(), expectedGetResponse, 'returns desired stylejson')
})

test('GET /styles (empty)', async (t) => {
  const { server } = t.context as TestContext

  const response = await server.inject({ method: 'GET', url: '/styles' })

  t.equal(response.statusCode, 200, 'returns a status code of 200')

  t.same(response.json(), [], 'returns empty array')
})

test('GET /styles (not empty)', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: sampleStyleJSON,
  })

  const { id: expectedId } = responsePost.json<OfflineStyle>()

  // This will change if a style fixture other than good-stylejson/good-simple.json is used
  const expectedTilesetId = 'yqtx3fxnp2vdyssc82ew4f377g4y0njk' // generated from getTilesetId in lib/utils.ts
  const expectedTilesetUrl = `http://localhost:80/tilesets/${expectedTilesetId}`

  const expectedSources = {
    'mapbox-streets': {
      ...(simpleStylejson.sources[
        'mapbox-streets'
      ] as VectorSourceSpecification),
      url: expectedTilesetUrl,
      tilesetId: expectedTilesetId,
    },
  }

  const expectedGetResponse = [
    {
      ...sampleStyleJSON,
      id: expectedId,
      sources: expectedSources,
    },
  ]

  const responseGet = await server.inject({ method: 'GET', url: '/styles' })

  t.equal(responseGet.statusCode, 200, 'returns a status code of 200')

  t.same(
    responseGet.json(),
    expectedGetResponse,
    'returns array with desired stylejson'
  )
})

test('PUT /styles (bad id param)', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const id = 'nonexistent-id'

  const responsePut = await server.inject({
    method: 'PUT',
    url: `/styles/${id}`,
    payload: { ...sampleStyleJSON, id },
  })

  t.equal(responsePut.statusCode, 404, 'returns 404 status code')
})

test('PUT /styles (style does not exist)', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const responsePut = await server.inject({
    method: 'PUT',
    url: `/styles/b`,
    payload: { ...sampleStyleJSON, id: 'a' },
  })

  t.equal(
    responsePut.statusCode,
    400,
    'returns 400 status code due to mismatched id param'
  )
})

test('PUT /styles (style exists, simple root field change)', async (t) => {
  const { server, sampleStyleJSON } = t.context as TestContext

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: sampleStyleJSON,
  })

  const createdStyle = responsePost.json<OfflineStyle>()

  const updatedNameField = 'New name'

  const responsePut = await server.inject({
    method: 'PUT',
    url: `/styles/${createdStyle.id}`,
    payload: { ...createdStyle, name: updatedNameField },
  })

  const updatedStyle = responsePut.json<OfflineStyle>()

  t.equal(responsePut.statusCode, 200, 'PUT responded with success code')

  t.notSame(
    createdStyle,
    updatedStyle,
    'Updated response is different from initially created resource'
  )

  t.same(updatedStyle.name, updatedNameField, 'Response has updated fields')
})

test('DELETE /styles (style does not exist)', async (t) => {
  const { server } = t.context as TestContext

  const id = 'nonexistent-id'

  const responseDelete = await server.inject({
    method: 'DELETE',
    url: `/styles/${id}`,
  })

  t.equal(
    responseDelete.statusCode,
    404,
    'DELETE responds with 404 status code'
  )
})

test('DELETE /styles (style exists)', async (t) => {
  const { server } = t.context as TestContext

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: simpleStylejson,
  })

  const { id } = responsePost.json<OfflineStyle>()

  const responseDelete = await server.inject({
    method: 'DELETE',
    url: `/styles/${id}`,
  })

  t.equal(
    responseDelete.statusCode,
    204,
    'DELETE responds with 204 status code'
  )

  t.equal(responseDelete.body, '', 'DELETE responds with empty body')

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${id}`,
  })

  t.equal(responseGet.statusCode, 404, 'GET responds with 404 status code')
})

// TODO: Add styles tests for:
// - PUT /styles (style exists, change to a source url)
// - POST /styles (style exists)
