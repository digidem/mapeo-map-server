const test = require('tape')
const path = require('path')

const importSse = require('../test-helpers/import-sse')
const createServer = require('../test-helpers/create-server')
// This disables upstream requests (e.g. simulates offline)
require('../test-helpers/server-mocks')

const fixturesPath = path.resolve(__dirname, '../fixtures')
const sampleMbTilesPath = path.join(
  fixturesPath,
  'mbtiles/raster/countries-png.mbtiles'
)
const sampleSmallMbTilesPath = path.join(
  fixturesPath,
  'mbtiles/raster/countries-png-small.mbtiles'
)

test('GET /imports/:importId returns 404 error when import does not exist', async (t) => {
  const server = createServer(t)

  const getImportInfoResponse = await server.inject({
    method: 'GET',
    url: `/imports/abc123`,
  })

  t.equal(getImportInfoResponse.statusCode, 404)
})

test('GET /imports/progress/:importId returns 404 error when import does not exist', async (t) => {
  const server = createServer(t)

  const getImportProgressResponse = await server.inject({
    method: 'GET',
    url: `/imports/progress/abc123`,
  })

  t.equal(getImportProgressResponse.statusCode, 404)
})

test('GET /imports/:importId returns import information', async (t) => {
  const server = createServer(t)

  const createImportResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleSmallMbTilesPath },
  })

  t.equals(createImportResponse.statusCode, 200)

  const {
    import: { id: createdImportId },
  } = createImportResponse.json()

  const getImportInfoResponse = await server.inject({
    method: 'GET',
    url: `/imports/${createdImportId}`,
  })

  t.equal(getImportInfoResponse.statusCode, 200)
})

test('GET /imports/progress/:importId returns import progress info (SSE)', async (t) => {
  const server = createServer(t)

  const createImportResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleMbTilesPath },
  })

  const {
    import: { id: createdImportId },
  } = createImportResponse.json()

  const address = await server.listen(0, '127.0.0.1')
  const messages = await importSse(
    `${address}/imports/progress/${createdImportId}`
  )
  t.ok(messages.length > 0, 'at least one message is received')
  t.ok(
    messages.every(({ importId }) => importId === createdImportId),
    'all messages have correct importId'
  )
  const lastMessage = messages[messages.length - 1]
  t.equal(lastMessage.type, 'complete', 'last message is complete')
  t.equal(lastMessage.soFar, lastMessage.total)

  const importGetResponse = await server.inject({
    method: 'GET',
    url: `/imports/${createdImportId}`,
  })

  t.equal(
    importGetResponse.json().state,
    'complete',
    'import successfully recorded as complete in db'
  )
})
;['complete', 'error'].forEach((lastEventId) => {
  test(`GET /imports/progress/:importId returns a 204 if last event ID was "${lastEventId}"`, async (t) => {
    const server = createServer(t)

    const createImportResponse = await server.inject({
      method: 'POST',
      url: '/tilesets/import',
      payload: { filePath: sampleMbTilesPath },
    })
    const {
      import: { id: createdImportId },
    } = createImportResponse.json()

    const importProgressResponse = await server.inject({
      method: 'GET',
      url: `/imports/progress/${createdImportId}`,
      headers: { 'Last-Event-ID': lastEventId },
    })

    t.equal(importProgressResponse.statusCode, 204)
  })
})

test('GET /imports/progress/:importId when import is already completed returns single complete event (SSE)', async (t) => {
  const server = createServer(t)

  const createImportResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleSmallMbTilesPath },
  })

  const {
    import: { id: createdImportId },
  } = createImportResponse.json()

  const address = await server.listen(0, '127.0.0.1')
  const progressEndpoint = `${address}/imports/progress/${createdImportId}`

  // Wait for the import to complete before attempting actual test
  const messages1 = await importSse(progressEndpoint)

  // Conduct actual test
  const messages2 = await importSse(progressEndpoint)
  t.equal(messages2.length, 1, 'only one message is received')
  t.equal(messages2[0].type, 'complete', 'message is complete')
  t.same(messages2[0], messages1[messages1.length - 1])
})

// This test is skipped because it's flaky.
// See <https://github.com/digidem/mapeo-map-server/issues/40> for details.
test.skip('GET /imports/:importId after deferred import error shows error state', async (t) => {
  const server = createServer(t)
  // This mbtiles file has one of the tile_data fields set to null. This causes
  // the import to initially report progress, but fail when it reaches the null
  // field
  const mbTilesPath = path.join(
    fixturesPath,
    'bad-mbtiles/null-tile_data.mbtiles'
  )
  t.comment('Starting POST /tilesets/import...')
  const createImportResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: mbTilesPath },
  })
  t.comment('Finished POST /tilesets/import.')
  t.equal(
    createImportResponse.statusCode,
    200,
    'initial import creation successful'
  )

  t.comment('Reading response body from POST /tilesets/import...')
  const {
    import: { id: createdImportId },
  } = createImportResponse.json()
  t.comment('Read response body from POST /tilesets/import.')

  t.comment('Starting server...')
  const address = await server.listen(0, '127.0.0.1')
  t.comment('Server started.')

  // Wait for import to complete
  t.comment('Waiting for import to complete...')
  await importSse(`${address}/imports/progress/${createdImportId}`)
  t.comment('Import completed.')

  t.comment(`Starting GET /imports/${createdImportId}...`)
  const getImportResponse = await server.inject({
    method: 'GET',
    url: `/imports/${createdImportId}`,
  })
  t.comment(`Finished GET /imports/${createdImportId}.`)

  t.equal(getImportResponse.statusCode, 200)

  t.comment(`Reading response body from GET /imports/${createdImportId}...`)
  const impt = getImportResponse.json()
  t.comment(`Read response body from GET /imports/${createdImportId}.`)

  t.equal(impt.state, 'error')
  t.equal(impt.error, 'UNKNOWN')
  t.ok(impt.finished)
})
