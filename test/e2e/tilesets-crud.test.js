const test = require('tape')
const nock = require('nock')

const {
  DEFAULT_RASTER_LAYER_ID,
  DEFAULT_RASTER_SOURCE_ID,
} = require('../../dist/lib/stylejson')

const createServer = require('../test-helpers/create-server')
const sampleTileJSON = require('../fixtures/good-tilejson/mapbox_raster_tilejson.json')
const {
  defaultMockHeaders,
  tileMockBody,
  createFakeTile,
} = require('../test-helpers/server-mocks')

/**
 * /tilesets tests
 */

test('GET /tilesets when no tilesets exist returns an empty array', async (t) => {
  const server = createServer(t)

  const response = await server.inject({ method: 'GET', url: '/tilesets' })

  t.equal(response.statusCode, 200)

  t.equal(
    response.headers['content-type'],
    'application/json; charset=utf-8',
    'returns correct content-type header'
  )

  t.same(response.json(), [])
})

test('GET /tilesets when tilesets exist returns an array of the tilesets', async (t) => {
  const server = createServer(t)

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
  const server = createServer(t)

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

test('POST /tilesets creates a style for the raster tileset', async (t) => {
  const server = createServer(t)

  const responseTilesetsPost = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const { id: tilesetId, name: expectedName } = responseTilesetsPost.json()

  const responseStylesListGet = await server.inject({
    method: 'GET',
    url: '/styles',
  })

  const stylesList = responseStylesListGet.json()

  t.equal(stylesList.length, 1)

  const responseStyleGet = await server.inject({
    method: 'GET',
    url: stylesList[0].url,
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

  const initialResponse = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const updatedFields = {
    name: 'Map Server Test',
  }

  const updatedResponse = await server.inject({
    method: 'PUT',
    url: `/tilesets/${initialResponse.json().id}`,
    payload: { ...initialResponse.json(), ...updatedFields },
  })

  t.equal(updatedResponse.statusCode, 200)

  t.notSame(initialResponse.json(), updatedResponse.json())

  t.equal(updatedResponse.json().name, updatedFields.name)
})

test('PUT /tilesets when providing an incorrect id returns 400 status code', async (t) => {
  const server = createServer(t)

  const response = await server.inject({
    method: 'PUT',
    url: `/tilesets/bad-id`,
    payload: { ...sampleTileJSON, name: 'Map Server Test' },
  })

  t.equal(response.statusCode, 400)
})

test('PUT /tilesets when tileset does not exist returns 404 status code', async (t) => {
  const server = createServer(t)

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
  const server = createServer(t)

  const response = await server.inject({
    method: 'GET',
    url: `/tilesets/foobar/1/2/3`,
  })

  t.equal(response.statusCode, 404)
})

test('GET /tile of png format returns a tile image', async (t) => {
  const server = createServer(t)

  // Create initial tileset
  const initialResponse = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const { id: tilesetId } = initialResponse.json()

  const scope = nock(/tiles.mapbox.com/)
    .defaultReplyHeaders(defaultMockHeaders)
    // This should match the URLs in the `tiles` property of the sampleTileJSON
    .get(/\/v3\/aj\.1x1-degrees\/(?<z>.*)\/(?<x>.*)\/(?<y>.*)\.png/)
    .reply(200, tileMockBody, { 'Content-Type': 'image/png' })

  const expectedTile = createFakeTile(1, 2, 3)
  const response = await server.inject({
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
