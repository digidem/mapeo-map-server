const test = require('tape')
const path = require('path')
const nock = require('nock')

const createServer = require('../test-helpers/create-server')
const sampleStyleJSON = require('../fixtures/good-stylejson/good-simple-raster.json')
const sampleTileJSON = require('../fixtures/good-tilejson/mapbox_raster_tilejson.json')
const {
  defaultMockHeaders,
  tilesetMockBody,
} = require('../test-helpers/server-mocks')

const sampleMbTilesPath = path.resolve(
  __dirname,
  '../fixtures/mbtiles/raster/countries-png.mbtiles'
)

const DUMMY_MB_ACCESS_TOKEN = 'pk.abc123'

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

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: { style: sampleStyleJSON, accessToken: DUMMY_MB_ACCESS_TOKEN },
  })

  t.equal(responsePost.statusCode, 200)
  t.ok(mockedTilesetScope.isDone(), 'upstream request was made')

  const { id, style } = responsePost.json()

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

test('POST /styles when required Mapbox access token is missing returns 400 status code', async (t) => {
  const server = createServer(t)

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    // Make sure that the style used here has URLs that reference Mapbox APIs
    payload: { style: sampleStyleJSON, accessToken: undefined },
  })

  t.equal(responsePost.statusCode, 400)
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
  t.plan(4)

  const server = createServer(t)

  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleMbTilesPath },
  })

  const {
    tileset: { id: createdTilesetId },
  } = importResponse.json()

  const getStylesResponse = await server.inject({
    method: 'GET',
    url: '/styles',
  })

  const stylesList = getStylesResponse.json()

  const expectedSourceUrl = `http://localhost:80/tilesets/${createdTilesetId}`

  const styles = await Promise.all(
    stylesList.map(({ url, id }) =>
      server
        .inject({
          method: 'GET',
          url,
        })
        .then((response) => response.json())
        .then((style) => ({ ...style, id }))
    )
  )

  const matchingStyle = styles.find((style) =>
    Object.values(style.sources).find((source) => {
      if ('url' in source && source.url) {
        return source.url === expectedSourceUrl
      }
    })
  )

  if (!matchingStyle) {
    t.fail('Could not find style created by import')
    return
  }

  const responseDelete = await server.inject({
    method: 'DELETE',
    url: `/styles/${matchingStyle.id}`,
  })

  t.equal(responseDelete.statusCode, 204)

  t.equal(responseDelete.body, '')

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${matchingStyle.id}`,
  })

  t.equal(responseGet.statusCode, 404, 'style is properly deleted')

  const tilesetResponseGet = await server.inject({
    method: 'GET',
    url: `/tilesets/${createdTilesetId}`,
  })

  t.equal(tilesetResponseGet.statusCode, 404, 'tileset is properly deleted')
})

test('DELETE /styles/:styleId deletes tilesets that are only referenced by the deleted style', async (t) => {
  const server = createServer(t)

  const mockedTilesetScope = nock('https://api.mapbox.com')
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

  const mockedTilesetScope = nock('https://api.mapbox.com')
    .defaultReplyHeaders(defaultMockHeaders)
    .get(/v4\/(?<tilesetId>.*)\.json/)
    .times(2)
    .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

  const createStyle1Response = await server.inject({
    method: 'POST',
    url: 'styles',
    payload: {
      style: sampleStyleJSON,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const createStyle2Response = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: sampleStyleJSON,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const { id: styleId1, style: style1 } = createStyle1Response.json()
  const { id: styleId2, style: style2 } = createStyle2Response.json()

  t.notEqual(styleId1, styleId2, 'ids for created styles are different')

  t.deepEqual(
    style1.sources,
    style2.sources,
    'created styles have same `sources` field'
  )

  const tilesetPathname = new URL(Object.values(style1.sources)[0].url).pathname

  const getTilesetBeforeResponse = await server.inject({
    method: 'GET',
    url: tilesetPathname,
  })

  t.equal(
    getTilesetBeforeResponse.statusCode,
    200,
    'tileset successfully created'
  )

  const style1DeleteResponse = await server.inject({
    method: 'DELETE',
    url: `/styles/${styleId1}`,
  })

  t.equal(style1DeleteResponse.statusCode, 204, 'style 1 successfully deleted')

  const getTilesetAfterResponse = await server.inject({
    method: 'GET',
    url: tilesetPathname,
  })

  t.equal(
    getTilesetAfterResponse.statusCode,
    200,
    'tileset still exists after style 1 deletion'
  )
})
