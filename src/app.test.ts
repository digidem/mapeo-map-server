import { afterEach, before, beforeEach, teardown, test } from 'tap'
import tmp from 'tmp'
import path from 'path'
import fs from 'fs'
import { FastifyInstance } from 'fastify'

import app from './app'
import mapboxRasterTilejson from './fixtures/good-tilejson/mapbox_raster_tilejson.json'
import { TileJSON, validateTileJSON } from './lib/tilejson'
import { server as mockTileServer } from './mocks/server'

import { IdResource } from './api'

tmp.setGracefulCleanup()

type TestContext = {
  server: FastifyInstance
  sampleTileJSON: TileJSON
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
  }
})

afterEach((t) => {
  t.context.server.close()
  mockTileServer.resetHandlers()
})

teardown(() => {
  mockTileServer.close()
})

test('GET /tilesets when no tilesets exist returns an empty array', async (t) => {
  const { server } = t.context as TestContext

  const response = await server.inject({ method: 'GET', url: '/tilesets' })

  t.equal(response.statusCode, 200)

  t.equal(
    response.headers['content-type'],
    'application/json; charset=utf-8',
    'returns correct content-type header'
  )

  t.same(response.json(), [])

  t.end()
})

test('GET /tilesets when tilesets exist returns an array of the tilesets', async (t) => {
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
})

test('POST /tilesets when tileset does not exist creates a tileset and returns it', async (t) => {
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

  t.same(responsePost.json(), expectedResponse)

  const responseGet = await server.inject({
    method: 'GET',
    url: '/tilesets',
    payload: { tilesetId: expectedId },
  })

  t.equal(responseGet.statusCode, 200)
})

test('PUT /tilesets when tileset exists returns the updated tileset', async (t) => {
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

  t.equal(updatedResponse.statusCode, 200)

  t.notSame(initialResponse.json(), updatedResponse.json())

  t.equal(updatedResponse.json<TileJSON>().name, updatedFields.name)
})

test('PUT /tilesets when providing an incorrect id returns 400 status code', async (t) => {
  const { sampleTileJSON, server } = t.context as TestContext

  const response = await server.inject({
    method: 'PUT',
    url: `/tilesets/bad-id`,
    payload: { ...sampleTileJSON, name: 'Map Server Test' },
  })

  t.equal(response.statusCode, 400)
})

test('PUT /tilesets when tileset does not exist returns 404 status code', async (t) => {
  const { sampleTileJSON, server } = t.context as TestContext

  const response = await server.inject({
    method: 'PUT',
    url: `/tilesets/${sampleTileJSON.id}`,
    payload: { ...sampleTileJSON, name: 'Map Server Test' },
  })

  t.equal(response.statusCode, 404)
})

test('GET /tile before tileset is created returns 404 status code', async (t) => {
  const { server } = t.context as TestContext

  const response = await server.inject({
    method: 'GET',
    url: `/tilesets/foobar/1/2/3`,
  })

  t.equal(response.statusCode, 404)
})

test('GET /tile of png format returns a tile image', async (t) => {
  const { sampleTileJSON, server } = t.context as TestContext

  // Create initial tileset
  const initialResponse = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const { id: tilesetId } = initialResponse.json<TileJSON & IdResource>()

  const response = await server.inject({
    method: 'GET',
    url: `/tilesets/${tilesetId}/1/2/3`,
  })

  t.equal(response.statusCode, 200)

  t.equal(
    response.headers['content-type'],
    'image/png',
    'Response content type matches desired resource type'
  )

  t.equal(typeof response.body, 'string')
})
