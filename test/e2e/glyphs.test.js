const test = require('tape')

const createServer = require('../test-helpers/create-server')

// This disables upstream requests (e.g. simulates offline)
require('../test-helpers/server-mocks')

test('GET /fonts/:fontstack/:start-:end.pbf works when one font is specified', async (t) => {
  const server = createServer(t)

  const getGlyphsResponse = await server.inject({
    method: 'GET',
    url: '/fonts/opensans/0-255.pbf',
  })

  t.equal(getGlyphsResponse.statusCode, 200)
})

test('GET /fonts/:fontstack/:start-:end.pbf works when multiple fonts are specified', async (t) => {
  const server = createServer(t)

  const getGlyphsResponse = await server.inject({
    method: 'GET',
    url: `/fonts/${decodeURIComponent(
      ['opensans', 'Arial Unicode MS Regualr'].join(',')
    )}/0-255.pbf`,
  })

  t.equal(getGlyphsResponse.statusCode, 200)
})

// TODO: How to determine that what's sent is the fallback?
test('GET /fonts/:fontstack/:start-:end.pbf sends fallback when specified font is not available', async (t) => {
  const server = createServer(t)

  const getGlyphsResponse = await server.inject({
    method: 'GET',
    url: '/fonts/random/0-255.pbf',
  })

  t.equal(getGlyphsResponse.statusCode, 200)
})

test('GET /fonts/:fontstack/:start-:end.pbf returns 404 for requests with non-existent ranges', async (t) => {
  const server = createServer(t)

  const badStart = 1_000_000

  const getGlyphsResponse = await server.inject({
    method: 'GET',
    url: `/fonts/opensans/${badStart}-${badStart + 255}.pbf`,
  })

  t.equal(getGlyphsResponse.statusCode, 404)
})
