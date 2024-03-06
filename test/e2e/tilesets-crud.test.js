const test = require('tape')
const nock = require('nock')

const {
  DEFAULT_RASTER_LAYER_ID,
  DEFAULT_RASTER_SOURCE_ID,
} = require('../../dist/lib/stylejson')

const { DUMMY_MB_ACCESS_TOKEN } = require('../test-helpers/constants')
const { createServer } = require('../test-helpers/create-server')
const sampleTileJSON = require('../fixtures/good-tilejson/mapbox_raster_tilejson.json')
const {
  defaultMockHeaders,
  tileMockBody,
  createFakeTile,
} = require('../test-helpers/server-mocks')

/**
 * /tilesets tests
 */

test('listTilesets() returns an empty array when no tilesets exist', async (t) => {
  const server = createServer(t)

  t.deepEqual(server.listTilesets('https://example.com'), [])
})

test('listTilesets() returns an array of tilesets when tilesets exist', async (t) => {
  const server = createServer(t)

  server.createTileset(sampleTileJSON, 'https://example.com')

  const expectedId = '23z3tmtw49abd8b4ycah9x94ykjhedam'
  const expectedTileUrl = `https://example.com/tilesets/${expectedId}/{z}/{x}/{y}`
  const expectedResponse = [
    {
      ...sampleTileJSON,
      id: expectedId,
      tiles: [expectedTileUrl],
    },
  ]

  t.deepEqual(server.listTilesets('https://example.com'), expectedResponse)
})

test('createTileset() when tileset does not exist creates a tileset and returns it', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  const expectedId = '23z3tmtw49abd8b4ycah9x94ykjhedam'
  const expectedTileUrl = `https://example.com/tilesets/${expectedId}/{z}/{x}/{y}`
  const expectedTileset = {
    ...sampleTileJSON,
    id: expectedId,
    tiles: [expectedTileUrl],
  }

  const tileset = server.createTileset(sampleTileJSON, 'https://example.com')
  t.same(tileset, expectedTileset)

  const responseGet = await fastifyInstance.inject({
    method: 'GET',
    url: `/tilesets/${expectedId}`,
  })

  t.equal(responseGet.statusCode, 200)
})

test('createTileset() creates a style for the raster tileset', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  const { id: tilesetId, name: expectedName } = server.createTileset(
    sampleTileJSON,
    // TODO: Once we replace GET /styles/:id with a JS API, we should replace
    // this with example.com or similar.
    // See <https://github.com/digidem/mapeo-map-server/issues/111>.
    'http://localhost:80'
  )

  const stylesList = server.listStyles()
  t.equal(stylesList.length, 1)

  const responseStyleGet = await fastifyInstance.inject({
    method: 'GET',
    url: `/styles/${stylesList[0].id}`,
  })

  t.equal(responseStyleGet.statusCode, 200)

  const expectedStyle = {
    version: 8,
    name: expectedName,
    sources: {
      [DEFAULT_RASTER_SOURCE_ID]: {
        type: 'raster',
        url: `http://localhost:80/tilesets/${tilesetId}`,
        tileSize: 256,
      },
    },
    layers: [
      {
        id: DEFAULT_RASTER_LAYER_ID,
        type: 'raster',
        source: DEFAULT_RASTER_SOURCE_ID,
      },
    ],
  }

  t.same(responseStyleGet.json(), expectedStyle)
})

test('PUT /tilesets when tileset exists returns the updated tileset', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  const initialTileset = server.createTileset(
    sampleTileJSON,
    'https://example.com'
  )

  const updatedFields = {
    name: 'Map Server Test',
  }

  const updatedResponse = await fastifyInstance.inject({
    method: 'PUT',
    url: `/tilesets/${initialTileset.id}`,
    payload: { ...initialTileset, ...updatedFields },
  })

  t.equal(updatedResponse.statusCode, 200)

  t.notSame(initialTileset, updatedResponse.json())

  t.equal(updatedResponse.json().name, updatedFields.name)
})

test('PUT /tilesets when providing an incorrect id returns 400 status code', async (t) => {
  const server = createServer(t).fastifyInstance

  const response = await server.inject({
    method: 'PUT',
    url: `/tilesets/bad-id`,
    payload: { ...sampleTileJSON, name: 'Map Server Test' },
  })

  t.equal(response.statusCode, 400)
})

test('PUT /tilesets when tileset does not exist returns 404 status code', async (t) => {
  const server = createServer(t).fastifyInstance

  const response = await server.inject({
    method: 'PUT',
    url: `/tilesets/${sampleTileJSON.id}`,
    payload: { ...sampleTileJSON, name: 'Map Server Test' },
  })

  t.equal(response.statusCode, 404)
})

/**
 * /tile tests
 */

test('GET /tile before tileset is created returns 404 status code', async (t) => {
  const server = createServer(t).fastifyInstance

  const response = await server.inject({
    method: 'GET',
    url: `/tilesets/foobar/1/2/3`,
  })

  t.equal(response.statusCode, 404)
})

test('GET /tile of png format returns a tile image', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  // Create initial tileset
  const { id: tilesetId } = server.createTileset(
    sampleTileJSON,
    'https://example.com'
  )

  const scope = nock(/tiles.mapbox.com/)
    .defaultReplyHeaders(defaultMockHeaders)
    // This should match the URLs in the `tiles` property of the sampleTileJSON
    .get(/\/v3\/aj\.1x1-degrees\/(?<z>.*)\/(?<x>.*)\/(?<y>.*)\.png/)
    .reply(200, tileMockBody, { 'Content-Type': 'image/png' })

  const expectedTile = createFakeTile(1, 2, 3)
  const response = await fastifyInstance.inject({
    method: 'GET',
    url: `/tilesets/${tilesetId}/1/2/3`,
  })

  t.ok(scope.isDone(), 'tile mock was called')
  t.equal(response.statusCode, 200)
  t.equal(
    response.headers['content-type'],
    'image/png',
    'Response content type matches desired resource type'
  )
  t.deepEqual(response.rawPayload, expectedTile, 'Got expected response')
})

test('GET /tile returns 404 response when upstream returns a 4XX error', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  const { id: tilesetId } = server.createTileset(
    sampleTileJSON,
    'https://example.com'
  )

  // This should match the URLs in the `tiles` property of the sampleTileJSON
  const upstreamTileApiRegex =
    /\/v3\/aj\.1x1-degrees\/(?<z>.*)\/(?<x>.*)\/(?<y>.*)\.png/

  const mockedTileScope = nock(/tiles.mapbox.com/)
    .defaultReplyHeaders(defaultMockHeaders)
    .get(upstreamTileApiRegex)
    .reply(401, JSON.stringify('Not Authorized - No Token'), {
      'Content-Type': 'application/json',
    })
    .get(upstreamTileApiRegex)
    .reply(404, JSON.stringify({ message: 'Tile not found' }), {
      'Content-Type': 'application/json',
    })
    .get(upstreamTileApiRegex)
    .reply(
      422,
      JSON.stringify({ message: 'Zoom level must be between 0-30.' }),
      {
        'Content-Type': 'application/json',
      }
    )

  const tokenErrorResponse = await fastifyInstance.inject({
    method: 'GET',
    url: `/tilesets/${tilesetId}/1/2/3`,
  })

  t.equal(tokenErrorResponse.statusCode, 404)
  t.equal(tokenErrorResponse.json().code, 'FST_FORWARDED_UPSTREAM')

  const notFoundResponse = await fastifyInstance.inject({
    method: 'GET',
    url: `/tilesets/${tilesetId}/1/2/3`,
    query: {
      access_token: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  t.equal(notFoundResponse.statusCode, 404)
  t.equal(notFoundResponse.json().code, 'FST_FORWARDED_UPSTREAM')

  const unprocessableEntityResponse = await fastifyInstance.inject({
    method: 'GET',
    url: `/tilesets/${tilesetId}/31/1/2`,
    query: {
      access_token: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  t.equal(unprocessableEntityResponse.statusCode, 404)
  t.equal(unprocessableEntityResponse.json().code, 'FST_FORWARDED_UPSTREAM')

  t.ok(mockedTileScope.isDone(), 'tile mocks were called')
})

test('GET /tile returns 404 error when upstream returns a 5XX error', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  const { id: tilesetId } = server.createTileset(
    sampleTileJSON,
    'https://example.com'
  )

  const mockedTileScope = nock(/tiles.mapbox.com/)
    .defaultReplyHeaders(defaultMockHeaders)
    // This should match the URLs in the `tiles` property of the sampleTileJSON
    .get(/\/v3\/aj\.1x1-degrees\/(?<z>.*)\/(?<x>.*)\/(?<y>.*)\.png/)
    .reply(500, JSON.stringify({ message: 'Server error' }), {
      'Content-Type': 'application/json',
    })
    // Persisting this scope is necessary because got will retry requests on 500 errors by default
    // https://github.com/sindresorhus/got/tree/v11.8.5#retry
    .persist()

  const upstreamServerErrorResponse = await fastifyInstance.inject({
    method: 'GET',
    url: `/tilesets/${tilesetId}/1/2/3`,
    query: {
      access_token: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  t.equal(
    upstreamServerErrorResponse.statusCode,
    404,
    'server responds with 404 when 500 upstream error occurs'
  )

  t.ok(mockedTileScope.isDone(), 'tile mock was called')
})

test('GET /tile returns 404 error when internet connection is unavailable', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  const { id: tilesetId } = server.createTileset(
    sampleTileJSON,
    'https://example.com'
  )

  // This is needed to return the proper request error from nock when net requests are disabled
  nock.cleanAll()

  const response = await fastifyInstance.inject({
    method: 'GET',
    url: `/tilesets/${tilesetId}/1/2/3`,
    query: {
      access_token: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  t.equal(response.statusCode, 404, 'server responded with 404')
})
