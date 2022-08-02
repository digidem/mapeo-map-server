const test = require('tape')

const createServer = require('../test-helpers/create-server')

// This disables upstream requests (e.g. simulates offline)
require('../test-helpers/server-mocks')

test('GET /fonts/:font/:start-:end.pbf works', async (t) => {
  const server = createServer(t)

  const getGlyphsResponse = await server.inject({
    method: 'GET',
    url: '/fonts/opensans/0-255.pbf',
  })

  t.equal(getGlyphsResponse.statusCode, 200)
})

test('GET /fonts/:font/:start-:end.pbf returns 404 for requests with non-existent ranges', async (t) => {
  const server = createServer(t)

  const badStart = 1_000_000

  const getGlyphsResponse = await server.inject({
    method: 'GET',
    url: `/fonts/opensans/${badStart}-${badStart + 255}.pbf`,
  })

  t.equal(getGlyphsResponse.statusCode, 404)
})
