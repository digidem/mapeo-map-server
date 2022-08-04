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

/**
 * Utility to reduce boilerplate in tests that attempt to test upstream behavior
 *
 * @param {import('fastify').FastifyInstance} server
 * @param {import('tape').Test} t
 * @returns {{id: string, style: import('../../dist/lib/stylejson').StyleJSON}}
 */
async function createStyle(server, t) {
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

  const { id, style } = createStyleResponse.json()

  return { id, style }
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

    const { id: styleId, style } = await createStyle(server, t)

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

    const { id: styleId, style } = await createStyle(server, t)

    const mockedGlyphsScope = nock('https://api.mapbox.com/')
      .defaultReplyHeaders(defaultMockHeaders)
      .get(
        /\/fonts\/v1\/(?:.*)\/(?<fontstack>.*)\/(?<start>.*)-(?<end>.*)\.pbf/
      )
      .reply(200, glyphsMockBody, { 'Content-Type': 'application/x-protobuf' })

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

    const { id: styleId, style } = await createStyle(server, t)

    const mockedGlyphsScope = nock('https://api.mapbox.com/')
      .defaultReplyHeaders(defaultMockHeaders)
      .get(
        /\/fonts\/v1\/(?:.*)\/(?<fontstack>.*)\/(?<start>.*)-(?<end>.*)\.pbf/
      )
      .reply(200, glyphsMockBody, { 'Content-Type': 'application/x-protobuf' })

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
    ' returns fallback glyphs when offline and upstream glyphs return a 404',
  async (t) => {
    const server = createServer(t)

    const { id: styleId, style } = await createStyle(server, t)

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

test(
  'GET /fonts/:fontstack/:start-:end.pbf?styleId=:styleId&access_token=:accessToken ' +
    'forwards non-404 upstream errors',
  async (t) => {
    const server = createServer(t)

    const { id: styleId, style } = await createStyle(server, t)

    const upstreamGlyphsApiRegex =
      /\/fonts\/v1\/(?:.*)\/(?<fontstack>.*)\/(?<start>.*)-(?<end>.*)\.pbf/

    const mockedGlyphsScope = nock('https://api.mapbox.com/')
      .defaultReplyHeaders(defaultMockHeaders)
      .get(upstreamGlyphsApiRegex)
      .reply(
        400,
        () => {
          return JSON.stringify({
            message: 'Maximum of 10 font faces permitted',
          })
        },
        { 'Content-Type': 'application/json' }
      )
      .get(upstreamGlyphsApiRegex)
      .reply(
        403,
        () => {
          return JSON.stringify({
            message: 'Forbidden',
          })
        },
        { 'Content-Type': 'application/json' }
      )

    const expectedGlyphsUrl = `http://localhost:80/fonts/{fontstack}/{range}.pbf?styleId=${styleId}`

    t.equal(style.glyphs, expectedGlyphsUrl)

    // TODO: Nock seems to have a problem with long urls that have encoded space characters
    // Ideally we'd test something like 'Arial Unicode MS Regular'
    const longFontstack = createFontStack(...new Array(11).fill('Random'))

    const getGlyphsTooManyFontsResponse = await server.inject({
      method: 'GET',
      url: new URL(
        style.glyphs
          .replace('{fontstack}', longFontstack)
          .replace('{range}', '0-255')
      ).pathname,
      query: {
        styleId,
        access_token: DUMMY_MB_ACCESS_TOKEN,
      },
    })

    t.equal(
      getGlyphsTooManyFontsResponse.statusCode,
      400,
      '400 status code forwarded'
    )
    t.equal(getGlyphsTooManyFontsResponse.json().code, 'FORWARDED_UPSTREAM_400')

    const getGlyphsUnauthorizedResponse = await server.inject({
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

    t.equal(
      getGlyphsUnauthorizedResponse.statusCode,
      403,
      '403 status code forwarded'
    )
    t.equal(getGlyphsUnauthorizedResponse.json().code, 'FORWARDED_UPSTREAM_403')

    t.ok(mockedGlyphsScope.isDone(), 'upstream glyphs requests were made')
  }
)

test(
  'GET /fonts/:fontstack/:start-:end.pbf?styleId=:styleId&access_token=:accessToken ' +
    'returns default fallback glyphs when offline',
  async (t) => {
    const server = createServer(t)

    const { id: styleId, style } = await createStyle(server, t)

    // This is needed to return the proper request error from nock when net requests are disabled
    nock.cleanAll()

    const expectedGlyphsUrl = `http://localhost:80/fonts/{fontstack}/{range}.pbf?styleId=${styleId}`

    t.equal(style.glyphs, expectedGlyphsUrl)

    const mockedGlyphsScope = nock('https://api.mapbox.com/')

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

    const { headers, statusCode } = getGlyphsResponse

    t.equal(statusCode, 200)
    t.equal(
      parseInt(headers['content-length']),
      OPEN_SANS_REGULAR_CONTENT_LENGTH
    )
    t.equal(headers['content-type'], 'application/x-protobuf')
  }
)
