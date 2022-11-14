const test = require('tape')
const path = require('path')
const nock = require('nock')

const { DUMMY_MB_ACCESS_TOKEN } = require('../test-helpers/constants')
const createServer = require('../test-helpers/create-server')
const sampleStyleJSON = require('../fixtures/good-stylejson/good-simple-raster.json')
const sampleTileJSON = require('../fixtures/good-tilejson/mapbox_raster_tilejson.json')

const {
  defaultMockHeaders,
  spriteLayoutMockBody,
  spriteImageMockBody,
  tilesetMockBody,
} = require('../test-helpers/server-mocks')

const sampleMbTilesPath = path.resolve(
  __dirname,
  '../fixtures/mbtiles/raster/countries-png.mbtiles'
)

/**
 * @param {string} endpointPath
 * @param {number} pixelDensity
 * @param {string} format
 * @returns {string}
 */
function createSpriteEndpoint(endpointPath, pixelDensity, format) {
  return `${endpointPath}${
    pixelDensity > 1 ? `@${pixelDensity}x` : ''
  }.${format}`
}

// TODO: Add styles tests for:
// - POST /styles (style via url)
// - checking tiles are/are not deleted when style is deleted

test('POST /styles with invalid style returns 400 status code', async (t) => {
  const server = createServer(t)

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
  const server = createServer(t)
  const mockedTilesetScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

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

  t.equal(responsePost.statusCode, 200)
  t.equal(responsePost.json().id, expectedId)
  t.ok(mockedTilesetScope.isDone(), 'upstream request was made')
})

test('POST /styles when style exists returns 409', async (t) => {
  const server = createServer(t)
  const mockedTilesetScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

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
  t.ok(mockedTilesetScope.isDone(), 'upstream request was made')

  const responsePost2 = await server.inject({
    method: 'POST',
    url: '/styles',
    payload,
  })

  t.equal(responsePost2.statusCode, 409)
})

test('POST /styles when providing valid style returns resource with id and altered style', async (t) => {
  const server = createServer(t)
  const mockedTilesetScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

  const styleWithGlyphs = {
    ...sampleStyleJSON,
    // The fixture doesn't have this defined but we want to test that this changes too
    glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  }

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: styleWithGlyphs,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  t.equal(responsePost.statusCode, 200)
  t.ok(mockedTilesetScope.isDone(), 'upstream request was made')

  const { id, style } = responsePost.json()

  t.ok(id, 'created style possesses an id')

  const expectedGlyphsUrl = `http://localhost:80/fonts/{fontstack}/{range}.pbf?styleId=${id}`

  t.equal(style.glyphs, expectedGlyphsUrl, 'glyphs points to offline url')

  t.notSame(
    style.sources,
    sampleStyleJSON.sources,
    'created style possesses sources that are different from input'
  )

  // The map server updates the sources so that each source's `url` field points to the map server
  const ignoredStyleFields = {
    glyphs: undefined,
    sources: undefined,
  }

  t.same(
    { ...style, ...ignoredStyleFields },
    { ...sampleStyleJSON, ...ignoredStyleFields },
    'with exception of `sources` and `glyphs` fields, created style is the same as input'
  )

  const tilesetEndpointPrefix = `http://localhost:80/tilesets/`

  Object.entries(style.sources).forEach(([sourceId, source]) => {
    if ('url' in source) {
      // TODO: Ideally verify that each url ends with the corresponding tileset id
      t.ok(
        source.url.startsWith(tilesetEndpointPrefix),
        'url field in source remapped to point to map server api endpoint'
      )
    }

    const ignoredSourceFields = {
      url: undefined,
    }

    t.same(
      { ...source, ...ignoredSourceFields },
      {
        // @ts-ignore
        ...sampleStyleJSON.sources[sourceId],
        ...ignoredSourceFields,
      },
      'with exception of `url` field, source from created style matches source from input'
    )
  })
})

test('POST /styles when required Mapbox access token is missing returns 401 status code', async (t) => {
  const server = createServer(t)

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    // Make sure that the style used here has URLs that reference Mapbox APIs
    payload: { style: sampleStyleJSON, accessToken: undefined },
  })

  t.equal(responsePost.statusCode, 401)
})

test('GET /styles/:styleId when style does not exist return 404 status code', async (t) => {
  const server = createServer(t)

  const id = 'nonexistent-id'

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${id}`,
  })

  t.equal(responseGet.statusCode, 404)
})

test('GET /styles/:styleId when style exists returns style with sources pointing to offline tilesets', async (t) => {
  const server = createServer(t)
  const mockedTilesetScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: { style: sampleStyleJSON, accessToken: DUMMY_MB_ACCESS_TOKEN },
  })

  const { id: expectedId } = responsePost.json()

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${expectedId}`,
  })

  t.equal(responseGet.statusCode, 200)
  t.ok(mockedTilesetScope.isDone(), 'upstream request was made')

  for (const source of Object.values(responseGet.json()['sources'])) {
    const urlExists = 'url' in source && source.url !== undefined

    t.ok(urlExists)

    if (urlExists) {
      const responseTilesetGet = await server.inject({
        method: 'GET',
        url: source.url,
        query: { access_token: DUMMY_MB_ACCESS_TOKEN },
      })

      t.equal(responseTilesetGet.statusCode, 200)
    }
  }
})

test('GET /styles when no styles exist returns body with an empty array', async (t) => {
  const server = createServer(t)

  const response = await server.inject({ method: 'GET', url: '/styles' })

  t.equal(response.statusCode, 200)

  t.same(response.json(), [])
})

test('GET /styles when styles exist returns array of metadata for each', async (t) => {
  const server = createServer(t)
  const mockedTilesetScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

  const expectedName = 'My Style'

  // Only necessary because the fixture doesn't have a `name` property
  const sampleStyleWithName = { ...sampleStyleJSON, name: expectedName }

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: sampleStyleWithName,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const { id: expectedId } = responsePost.json()

  const expectedUrl = `http://localhost:80/styles/${expectedId}`

  const expectedStyleInfo = {
    id: expectedId,
    bytesStored: 0,
    name: expectedName,
    url: expectedUrl,
  }

  const expectedGetResponse = [expectedStyleInfo]

  const responseGet = await server.inject({ method: 'GET', url: '/styles' })

  t.equal(responseGet.statusCode, 200)
  t.ok(mockedTilesetScope.isDone(), 'upstream request was made')
  t.same(responseGet.json(), expectedGetResponse)
})

test('DELETE /styles/:styleId when style does not exist returns 404 status code', async (t) => {
  const server = createServer(t)

  const id = 'nonexistent-id'

  const responseDelete = await server.inject({
    method: 'DELETE',
    url: `/styles/${id}`,
  })

  t.equal(responseDelete.statusCode, 404)
})

test('DELETE /styles/:styleId when style exists returns 204 status code and empty body', async (t) => {
  const server = createServer(t)
  const mockedTilesetScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: sampleStyleJSON,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const { id } = responsePost.json()
  t.equal(responsePost.statusCode, 200)
  t.ok(mockedTilesetScope.isDone(), 'upstream request was made')

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

test('DELETE /styles/:styleId works for style created from tileset import', async (t) => {
  t.plan(5)

  const server = createServer(t)

  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleMbTilesPath },
  })

  const {
    tileset: { id: createdTilesetId },
    style: { id: createdStyleId },
  } = importResponse.json()

  const getStyleResponseBefore = await server.inject({
    method: 'GET',
    url: `/styles/${createdStyleId}`,
  })

  t.equal(getStyleResponseBefore.statusCode, 200, 'style created')

  const responseDelete = await server.inject({
    method: 'DELETE',
    url: `/styles/${createdStyleId}`,
  })

  t.equal(responseDelete.statusCode, 204)

  t.equal(responseDelete.body, '')

  const getStyleResponseAfter = await server.inject({
    method: 'GET',
    url: `/styles/${createdStyleId}`,
  })

  t.equal(getStyleResponseAfter.statusCode, 404, 'style is properly deleted')

  const tilesetResponseGet = await server.inject({
    method: 'GET',
    url: `/tilesets/${createdTilesetId}`,
  })

  t.equal(tilesetResponseGet.statusCode, 404, 'tileset is properly deleted')
})

test('DELETE /styles/:styleId deletes tilesets that are only referenced by the deleted style', async (t) => {
  const server = createServer(t)

  nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

  const createStyleResponse = await server.inject({
    method: 'POST',
    url: 'styles',
    payload: {
      style: sampleStyleJSON,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const { id: styleId, style } = createStyleResponse.json()

  const createIsolatedTilesetBeforeResponse = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  t.equal(createIsolatedTilesetBeforeResponse.statusCode, 200)

  const { id: isolatedTilesetId } = createIsolatedTilesetBeforeResponse.json()

  const { pathname: tilesetPathname } = new URL(
    Object.values(style.sources)[0].url
  )

  const getTilesetBeforeResponse = await server.inject({
    method: 'GET',
    url: tilesetPathname,
    query: { access_token: DUMMY_MB_ACCESS_TOKEN },
  })

  t.equal(
    getTilesetBeforeResponse.statusCode,
    200,
    'tileset successfully created'
  )

  const styleDeleteResponse = await server.inject({
    method: 'DELETE',
    url: `/styles/${styleId}`,
  })

  t.equal(styleDeleteResponse.statusCode, 204, 'style successfully deleted')

  const getTilesetAfterResponse = await server.inject({
    method: 'GET',
    url: tilesetPathname,
  })

  t.equal(
    getTilesetAfterResponse.statusCode,
    404,
    'referenced tileset no longer exists'
  )

  const getIsolatedTilesetAfterResponse = await server.inject({
    method: 'GET',
    url: `/tilesets/${isolatedTilesetId}`,
  })

  t.equal(
    getIsolatedTilesetAfterResponse.statusCode,
    200,
    'isolated tileset still exists'
  )
})

test('DELETE /styles/:styleId does not delete referenced tilesets that are also referenced by other styles', async (t) => {
  const server = createServer(t)

  nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .times(4)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

  // Create a style with sources A and B and another with sources B and C
  const sources = {
    A: {
      url: 'mapbox://A',
      type: 'raster',
      tileSize: 256,
    },
    B: {
      url: 'mapbox://B',
      type: 'raster',
      tileSize: 256,
    },
    C: {
      url: 'mapbox://C',
      type: 'raster',
      tileSize: 256,
    },
  }

  const createStyleABResponse = await server.inject({
    method: 'POST',
    url: 'styles',
    payload: {
      style: {
        version: 8,
        sources: { A: sources.A, B: sources.B },
        layers: [
          {
            id: 'A',
            type: 'raster',
            source: 'A',
          },
          {
            id: 'B',
            type: 'raster',
            source: 'B',
          },
        ],
      },
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const createStyleBCResponse = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: {
        version: 8,
        sources: { B: sources.B, C: sources.C },
        layers: [
          {
            id: 'B',
            type: 'raster',
            source: 'B',
          },
          {
            id: 'C',
            type: 'raster',
            source: 'C',
          },
        ],
      },
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const { id: styleIdAB, style: styleAB } = createStyleABResponse.json()
  const { style: styleBC } = createStyleBCResponse.json()

  t.notDeepEqual(
    styleAB.sources,
    styleBC.sources,
    'created styles have different `sources` field'
  )

  t.deepEqual(
    styleAB.sources.B,
    styleBC.sources.B,
    'created styles share source B'
  )

  const styleABDeleteResponse = await server.inject({
    method: 'DELETE',
    url: `/styles/${styleIdAB}`,
  })

  t.equal(
    styleABDeleteResponse.statusCode,
    204,
    'style AB successfully deleted'
  )

  const tilesetAPathname = new URL(styleAB.sources.A.url).pathname
  const tilesetBPathname = new URL(styleAB.sources.B.url).pathname
  const tilesetCPathname = new URL(styleBC.sources.C.url).pathname

  async function getTileset(url) {
    return server.inject({
      method: 'GET',
      url,
      query: { access_token: DUMMY_MB_ACCESS_TOKEN },
    })
  }

  const getTilesetAResponse = await getTileset(tilesetAPathname)

  t.equal(
    getTilesetAResponse.statusCode,
    404,
    'tileset A no longer exists after style AB deletion'
  )

  const getTilesetBResponse = await getTileset(tilesetBPathname)

  t.equal(
    getTilesetBResponse.statusCode,
    200,
    'tileset B still exists after style AB deletion'
  )

  const getTilesetCResponse = await getTileset(tilesetCPathname)

  t.equal(
    getTilesetCResponse.statusCode,
    200,
    'tileset C still exists after style AB deletion'
  )
})

test('GET /styles/:styleId/sprites/:spriteId[pixelDensity].[format] returns 404 when sprite does not exist', async (t) => {
  const server = createServer(t)

  const getSpriteImageResponse = await server.inject({
    method: 'GET',
    url: '/styles/abc123/sprites/abc123.png',
  })

  t.equal(getSpriteImageResponse.statusCode, 404)

  const getSpriteLayoutResponse = await server.inject({
    method: 'GET',
    url: '/styles/abc123/sprites/abc123.json',
  })

  t.equal(getSpriteLayoutResponse.statusCode, 404)
})

test('GET /styles/:styleId/sprites/:spriteId[pixelDensity].[format] returns correct sprite asset', async (t) => {
  const server = createServer(t)

  nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

  const mockedSpriteLayoutScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/\/styles\/v1\/(?<username>.*)\/(?<styleId>.*)\/(?<name>.*)\.json/)
    .query({ access_token: DUMMY_MB_ACCESS_TOKEN })
    .reply(200, spriteLayoutMockBody, { 'Content-Type': 'application/json' })

  const mockedSpriteImageScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/\/styles\/v1\/(?<username>.*)\/(?<styleId>.*)\/(?<name>.*)\.png/)
    .query({ access_token: DUMMY_MB_ACCESS_TOKEN })
    .reply(200, spriteImageMockBody, { 'Content-Type': 'image/png' })

  const styleWithSprite = {
    ...sampleStyleJSON,
    sprite: 'mapbox://sprites/terrastories/test',
  }

  const createStyleResponse = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: styleWithSprite,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  t.ok(
    mockedSpriteLayoutScope.isDone(),
    'upstream request for sprite layout was made'
  )

  t.ok(
    mockedSpriteImageScope.isDone(),
    'upstream request for sprite image was made'
  )

  const {
    style: { sprite },
  } = createStyleResponse.json()

  t.ok(sprite)

  const spriteEndpointPath = new URL(sprite).pathname

  const existingPixelDensities = [1, 2]

  for (const density of existingPixelDensities) {
    const getSpriteImageResponse = await server.inject({
      method: 'GET',
      url: createSpriteEndpoint(spriteEndpointPath, density, 'png'),
    })

    t.equal(getSpriteImageResponse.statusCode, 200)
    t.equal(getSpriteImageResponse.headers['content-type'], 'image/png')
    t.ok(
      parseInt(
        (getSpriteImageResponse.headers['content-length'] || '').toString(),
        10
      ) > 0
    )

    const getSpriteLayoutResponse = await server.inject({
      method: 'GET',
      url: createSpriteEndpoint(spriteEndpointPath, density, 'json'),
    })

    t.equal(getSpriteLayoutResponse.statusCode, 200)
    t.ok(getSpriteLayoutResponse.json())
  }
})

test('GET /styles/:styleId/sprites/:spriteId[pixelDensity].[format] returns an available fallback asset', async (t) => {
  const server = createServer(t)

  nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

  const mockedSpriteLayoutScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/\/styles\/v1\/(?<username>.*)\/(?<styleId>.*)\/(?<name>.*)\.json/)
    .query({ access_token: DUMMY_MB_ACCESS_TOKEN })
    .reply(200, spriteLayoutMockBody, { 'Content-Type': 'application/json' })

  const mockedSpriteImageScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/\/styles\/v1\/(?<username>.*)\/(?<styleId>.*)\/(?<name>.*)\.png/)
    .query({ access_token: DUMMY_MB_ACCESS_TOKEN })
    .reply(200, spriteImageMockBody, { 'Content-Type': 'image/png' })

  const styleWithSprite = {
    ...sampleStyleJSON,
    sprite: 'mapbox://sprites/terrastories/test',
  }

  const createStyleResponse = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: styleWithSprite,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  t.ok(
    mockedSpriteLayoutScope.isDone(),
    'upstream request for sprite layout was made'
  )

  t.ok(
    mockedSpriteImageScope.isDone(),
    'upstream request for sprite image was made'
  )

  const {
    style: { sprite },
  } = createStyleResponse.json()

  t.ok(sprite)

  const spriteEndpointPath = new URL(sprite).pathname

  const getSpriteImage2xResponse = await server.inject({
    method: 'GET',
    url: `${spriteEndpointPath}@2x.png`,
  })

  const getSpriteImage3xResponse = await server.inject({
    method: 'GET',
    url: `${spriteEndpointPath}@3x.png`,
  })

  t.equal(getSpriteImage3xResponse.statusCode, 200)
  t.equal(getSpriteImage3xResponse.headers['content-type'], 'image/png')
  t.ok(
    parseInt(
      (getSpriteImage3xResponse.headers['content-length'] || '').toString(),
      10
    ) > 0
  )

  t.equal(getSpriteImage3xResponse.body, getSpriteImage2xResponse.body)

  const getSpriteLayout1xResponse = await server.inject({
    method: 'GET',
    url: `${spriteEndpointPath}@2x.json`,
  })

  const getSpriteLayout3xResponse = await server.inject({
    method: 'GET',
    url: `${spriteEndpointPath}@3x.json`,
  })

  t.equal(getSpriteLayout3xResponse.statusCode, 200)
  t.deepEqual(
    getSpriteLayout3xResponse.json(),
    getSpriteLayout1xResponse.json()
  )
})

test('DELETE /styles/:styleId deletes the associated sprites', async (t) => {
  const server = createServer(t)

  nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

  const mockedSpriteLayoutScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/\/styles\/v1\/(?<username>.*)\/(?<styleId>.*)\/(?<name>.*)\.json/)
    .query({ access_token: DUMMY_MB_ACCESS_TOKEN })
    .reply(200, spriteLayoutMockBody, { 'Content-Type': 'application/json' })

  const mockedSpriteImageScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/\/styles\/v1\/(?<username>.*)\/(?<styleId>.*)\/(?<name>.*)\.png/)
    .query({ access_token: DUMMY_MB_ACCESS_TOKEN })
    .reply(200, spriteImageMockBody, { 'Content-Type': 'image/png' })

  const styleWithSprite = {
    ...sampleStyleJSON,
    sprite: 'mapbox://sprites/terrastories/test',
  }

  const createStyleResponse = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: styleWithSprite,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  t.equal(createStyleResponse.statusCode, 200)

  t.ok(
    mockedSpriteLayoutScope.isDone(),
    'upstream request for sprite layout was made'
  )

  t.ok(
    mockedSpriteImageScope.isDone(),
    'upstream request for sprite image was made'
  )

  const {
    id: styleId,
    style: { sprite },
  } = createStyleResponse.json()

  const spriteEndpointPath = new URL(sprite).pathname

  const deleteStyleResponse = await server.inject({
    method: 'DELETE',
    url: `/styles/${styleId}`,
  })

  t.equal(deleteStyleResponse.statusCode, 204)

  const pixelDensities = [1, 2]

  for (const density of pixelDensities) {
    const getSpriteImageResponse = await server.inject({
      method: 'GET',
      url: createSpriteEndpoint(spriteEndpointPath, density, 'png'),
    })

    const getSpriteLayoutResponse = await server.inject({
      method: 'GET',
      url: createSpriteEndpoint(spriteEndpointPath, density, 'json'),
    })

    t.equal(getSpriteImageResponse.statusCode, 404)
    t.equal(getSpriteLayoutResponse.statusCode, 404)
  }
})
