const test = require('tape')
const path = require('path')

const createServer = require('../test-helpers/create-server')
const sampleStyleJSON = require('../fixtures/good-stylejson/good-simple-raster.json')
const mockServer = require('../test-helpers/mock-server')

const sampleMbTilesPath = path.resolve(
  __dirname,
  '../fixtures/mbtiles/raster/countries-png.mbtiles'
)

const DUMMY_MB_ACCESS_TOKEN = 'pk.abc123'

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
  mockServer.listen()

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
  const server = createServer(t)
  mockServer.listen()

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
  const server = createServer(t)
  mockServer.listen()

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: { style: sampleStyleJSON, accessToken: DUMMY_MB_ACCESS_TOKEN },
  })

  t.equal(responsePost.statusCode, 200)

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
  mockServer.listen()

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
  mockServer.listen()

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
  mockServer.listen()

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: sampleStyleJSON,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const { id } = responsePost.json()

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
  t.plan(3)

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
})

test('GET /styles/:styleId/sprites/:spriteId[pixelDensity].[format] returns 404 when sprite does not exist', async (t) => {
  const server = createServer(t)
  mockServer.listen()

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
  mockServer.listen()

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
  mockServer.listen()

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
  mockServer.listen()

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
