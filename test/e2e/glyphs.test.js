const test = require('tape')
const nock = require('nock')

const sampleStyleJSON = require('../fixtures/good-stylejson/good-simple-raster.json')
const createServer = require('../test-helpers/create-server')
const {
  defaultMockHeaders,
  glyphsMockBody,
  tilesetMockBody,
} = require('../test-helpers/server-mocks')
// This disables upstream requests (e.g. simulates offline)
require('../test-helpers/server-mocks')

const DUMMY_MB_ACCESS_TOKEN = 'pk.abc123'

// Nonideal proxy to identify what a response sends back
const OPEN_SANS_REGULAR_CONTENT_LENGTH = 74892

// This disables upstream requests (e.g. simulates offline)
require('../test-helpers/server-mocks')

/**
 * @param {...string} fonts
 * @returns {string}
 */
function createFontStack(...fonts) {
  return encodeURIComponent((fonts || ['Open Sans Regular']).join(','))
}

test('GET /fonts/:fontstack/:start-:end.pbf works when one font is specified', async (t) => {
  const server = createServer(t)

  const getGlyphsResponse = await server.inject({
    method: 'GET',
    url: `/fonts/${createFontStack()}/0-255.pbf`,
  })

  const { headers, statusCode } = getGlyphsResponse

  t.equal(statusCode, 200)
  t.equal(headers['content-length'], OPEN_SANS_REGULAR_CONTENT_LENGTH)
  t.equal(headers['content-type'], 'application/x-protobuf')
})

test('GET /fonts/:fontstack/:start-:end.pbf works when multiple fonts are specified', async (t) => {
  const server = createServer(t)

  const getGlyphsResponse = await server.inject({
    method: 'GET',
    url: `/fonts/${createFontStack(
      'Open Sans Regular',
      'Arial Unicode MS Regular'
    )}/0-255.pbf`,
  })

  const { headers, statusCode } = getGlyphsResponse

  t.equal(statusCode, 200)
  t.equal(headers['content-length'], OPEN_SANS_REGULAR_CONTENT_LENGTH)
  t.equal(headers['content-type'], 'application/x-protobuf')
})

// TODO: How to determine that what's sent is the fallback?
test('GET /fonts/:fontstack/:start-:end.pbf sends fallback when specified font is not available', async (t) => {
  const server = createServer(t)

  const getGlyphsResponse = await server.inject({
    method: 'GET',
    url: `/fonts/${createFontStack('random')}/0-255.pbf`,
  })

  const { headers, statusCode } = getGlyphsResponse

  t.equal(statusCode, 200)
  t.equal(headers['content-length'], OPEN_SANS_REGULAR_CONTENT_LENGTH)
  t.equal(headers['content-type'], 'application/x-protobuf')
})

test('GET /fonts/:fontstack/:start-:end.pbf returns 400 response for invalid glyph ranges', async (t) => {
  const server = createServer(t)

  const badStart = 1_000_000

  const getGlyphsResponse = await server.inject({
    method: 'GET',
    url: `/fonts/${createFontStack()}/${badStart}-${badStart + 255}.pbf`,
  })

  t.equal(getGlyphsResponse.statusCode, 400)
})

test(
  'GET /fonts/:fontstack/:start-:end.pbf?styleId=:styleId ' +
    'when glyphs exist offline and style does not exist returns glyphs',
  async (t) => {
    const server = createServer(t)

    const getGlyphsResponse = await server.inject({
      method: 'GET',
      url: `/fonts/${createFontStack()}/0-255.pbf?styleId=abc123`,
    })

    const { headers, statusCode } = getGlyphsResponse

    t.equal(statusCode, 200)
    t.equal(headers['content-length'], OPEN_SANS_REGULAR_CONTENT_LENGTH)
    t.equal(headers['content-type'], 'application/x-protobuf')
  }
)

test(
  'GET /fonts/:fontstack/:start-:end.pbf?styleId=:styleId ' +
    'returns access token error when offline glyphs do not exist and style does',
  async (t) => {
    const server = createServer(t)

    const mockedTilesetScope = nock('https://api.mapbox.com')
      .defaultReplyHeaders(defaultMockHeaders)
      .get(/v4\/(?<tilesetId>.*)\.json/)
      .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

    const createStyleResponse = await server.inject({
      method: 'POST',
      url: '/styles',
      payload: {
        style: {
          ...sampleStyleJSON,
          glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
        },
        accessToken: DUMMY_MB_ACCESS_TOKEN,
      },
    })

    t.equal(createStyleResponse.statusCode, 200, 'style created successfully')

    const { id: styleId, style } = createStyleResponse.json()

    const expectedGlyphsUrl = `http://localhost:80/fonts/{fontstack}/{range}.pbf?styleId=${styleId}`

    t.equal(style.glyphs, expectedGlyphsUrl)

    const getGlyphsResponse = await server.inject({
      method: 'GET',
      url: new URL(
        style.glyphs
          .replace('{fontstack}', createFontStack('random'))
          .replace('{range}', '0-255')
      ).pathname,
      query: {
        styleId,
      },
    })

    t.equal(getGlyphsResponse.statusCode, 401, 'access token error received')
  }
)

test(
  'GET /fonts/:fontstack/:start-:end.pbf?styleId=:styleId&access_token=:accessToken' +
    ' makes upstream request when offline glyphs do not exist',
  async (t) => {
    const server = createServer(t)

    const mockedTilesetScope = nock('https://api.mapbox.com')
      .defaultReplyHeaders(defaultMockHeaders)
      .get(/v4\/(?<tilesetId>.*)\.json/)
      .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

    const mockedGlyphsScope = nock('https://api.mapbox.com/')
      .defaultReplyHeaders(defaultMockHeaders)
      .get(
        /\/fonts\/v1\/(?:.*)\/(?<fontstack>.*)\/(?<start>.*)-(?<end>.*)\.pbf/
      )
      .reply(200, glyphsMockBody, { 'Content-Type': 'application/x-protobuf' })

    const createStyleResponse = await server.inject({
      method: 'POST',
      url: '/styles',
      payload: {
        style: {
          ...sampleStyleJSON,
          glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
        },
        accessToken: DUMMY_MB_ACCESS_TOKEN,
      },
    })

    t.equal(createStyleResponse.statusCode, 200, 'style created successfully')

    const { id: styleId, style } = createStyleResponse.json()

    const expectedGlyphsUrl = `http://localhost:80/fonts/{fontstack}/{range}.pbf?styleId=${styleId}`

    t.equal(style.glyphs, expectedGlyphsUrl)

    const getGlyphsResponse = await server.inject({
      method: 'GET',
      url: new URL(
        style.glyphs
          .replace('{fontstack}', createFontStack('Arial Unicode MS Regular'))
          .replace('{range}', '0-255')
      ).pathname,
      query: {
        styleId,
        access_token: DUMMY_MB_ACCESS_TOKEN,
      },
    })

    t.ok(mockedGlyphsScope.isDone(), 'upstream glyphs request was made')

    const { headers, statusCode } = getGlyphsResponse

    t.equal(statusCode, 200)
    t.ok(parseInt(headers['content-length'], 10) > 0)
    t.equal(headers['content-type'], 'application/x-protobuf')
  }
)

test(
  'GET /fonts/:fontstack/:start-:end.pbf?styleId=:styleId&access_token=:accessToken' +
    ' returns upstream glyphs when offline glyphs do not exist and upstream glyphs exist',
  async (t) => {
    const server = createServer(t)

    const mockedTilesetScope = nock('https://api.mapbox.com')
      .defaultReplyHeaders(defaultMockHeaders)
      .get(/v4\/(?<tilesetId>.*)\.json/)
      .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

    const mockedGlyphsScope = nock('https://api.mapbox.com/')
      .defaultReplyHeaders(defaultMockHeaders)
      .get(
        /\/fonts\/v1\/(?:.*)\/(?<fontstack>.*)\/(?<start>.*)-(?<end>.*)\.pbf/
      )
      .reply(200, glyphsMockBody, { 'Content-Type': 'application/x-protobuf' })

    const createStyleResponse = await server.inject({
      method: 'POST',
      url: '/styles',
      payload: {
        style: {
          ...sampleStyleJSON,
          glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
        },
        accessToken: DUMMY_MB_ACCESS_TOKEN,
      },
    })

    t.equal(createStyleResponse.statusCode, 200, 'style created successfully')

    const { id: styleId, style } = createStyleResponse.json()

    const expectedGlyphsUrl = `http://localhost:80/fonts/{fontstack}/{range}.pbf?styleId=${styleId}`

    t.equal(style.glyphs, expectedGlyphsUrl)

    const getGlyphsResponse = await server.inject({
      method: 'GET',
      url: new URL(
        style.glyphs
          .replace('{fontstack}', createFontStack('Arial Unicode MS Regular'))
          .replace('{range}', '0-255')
      ).pathname,
      query: {
        styleId,
        access_token: DUMMY_MB_ACCESS_TOKEN,
      },
    })

    t.ok(mockedGlyphsScope.isDone(), 'upstream glyphs request was made')

    const { headers, statusCode } = getGlyphsResponse

    t.equal(statusCode, 200)
    t.ok(parseInt(headers['content-length'], 10) > 0)
    t.equal(headers['content-type'], 'application/x-protobuf')
  }
)

// TODO: Is this desired behavior?
test(
  'GET /fonts/:fontstack/:start-:end.pbf?styleId=:styleId&access_token=:accessToken' +
    ' returns fallback glyphs when offline and upstream glyphs do not exist',
  async (t) => {
    const server = createServer(t)

    const mockedTilesetScope = nock('https://api.mapbox.com')
      .defaultReplyHeaders(defaultMockHeaders)
      .get(/v4\/(?<tilesetId>.*)\.json/)
      .reply(200, tilesetMockBody, { 'Content-Type': 'application/json' })

    const mockedGlyphsScope = nock('https://api.mapbox.com/')
      .defaultReplyHeaders(defaultMockHeaders)
      .get(
        /\/fonts\/v1\/(?:.*)\/(?<fontstack>.*)\/(?<start>.*)-(?<end>.*)\.pbf/
      )
      .reply(
        404,
        () => {
          return JSON.stringify({
            message: 'Not Found',
          })
        },
        { 'Content-Type': 'application/json' }
      )

    const createStyleResponse = await server.inject({
      method: 'POST',
      url: '/styles',
      payload: {
        style: {
          ...sampleStyleJSON,
          glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
        },
        accessToken: DUMMY_MB_ACCESS_TOKEN,
      },
    })

    t.equal(createStyleResponse.statusCode, 200, 'style created successfully')

    const { id: styleId, style } = createStyleResponse.json()

    const expectedGlyphsUrl = `http://localhost:80/fonts/{fontstack}/{range}.pbf?styleId=${styleId}`

    t.equal(style.glyphs, expectedGlyphsUrl)

    const getGlyphsResponse = await server.inject({
      method: 'GET',
      url: new URL(
        style.glyphs
          .replace('{fontstack}', createFontStack('random'))
          .replace('{range}', '0-255')
      ).pathname,
      query: {
        styleId,
        access_token: DUMMY_MB_ACCESS_TOKEN,
      },
    })

    t.ok(mockedGlyphsScope.isDone(), 'upstream glyphs request was made')

    const { headers, statusCode } = getGlyphsResponse

    t.equal(statusCode, 200)
    t.equal(headers['content-length'], OPEN_SANS_REGULAR_CONTENT_LENGTH)
    t.equal(headers['content-type'], 'application/x-protobuf')
  }
)
