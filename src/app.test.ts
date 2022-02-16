import { afterEach, before, beforeEach, test } from 'tap'
import tmp from 'tmp'
import path from 'path'
import fs from 'fs-extra'
import { FastifyInstance } from 'fastify'

import app from './app'
import mapboxRasterTilejson from './fixtures/good-tilejson/mapbox_raster_tilejson.json'
import { getTilesetId } from './lib/utils'
import { TileJSON, validateTileJSON } from './lib/tilejson'

tmp.setGracefulCleanup()

type TestContext = {
  server: FastifyInstance
  sampleTileJSON: TileJSON
}

before(() => {
  function assertSampleTileJSONIsValid(
    data: unknown
  ): asserts data is TileJSON {
    if (!validateTileJSON(data)) {
      const message = `Sample input does not conform to TileJSON schema spec: ${JSON.stringify(
        validateTileJSON.errors,
        null,
        2
      )}`

      throw new Error(message)
    }
  }

  assertSampleTileJSONIsValid(mapboxRasterTilejson)
})

beforeEach((t) => {
  const { name: dataDir } = tmp.dirSync({ unsafeCleanup: true })

  // Copy over /prisma/migrations to tmp directory
  try {
    fs.copySync(
      path.resolve(__dirname, '../prisma/migrations'),
      path.resolve(dataDir, 'migrations')
    )
  } catch (err) {
    console.log('Could not find prisma migrations directory 🤔')
    console.log(
      'Make sure you run `npm run prisma:migrate-dev -- --name MIGRATION_NAME_HERE` first!'
    )
    throw err
  }

  t.context = {
    server: app({ logger: false }, { dataDir }),
    sampleTileJSON: mapboxRasterTilejson,
  }
})

afterEach((t) => {
  t.context.server.close()
})

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
  const { sampleTileJSON, server } = t.context

  await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const expectedId = getTilesetId(sampleTileJSON)
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

  const expectedId = getTilesetId(sampleTileJSON)
  const expectedTileUrl = `http://localhost:80/tilesets/${expectedId}/{z}/{x}/{y}`
  const expectedResponse = {
    ...sampleTileJSON,
    id: expectedId,
    tiles: [expectedTileUrl],
  }

  const response = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  t.same(response.json(), expectedResponse)

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
    'Mismatched id param returns Bad Request error code (400)'
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

// TODO: Add test for tile GET
