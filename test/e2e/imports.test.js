const test = require('tape')
const path = require('path')

const importSse = require('../test-helpers/import-sse')
const createServer = require('../test-helpers/create-server')
// This disables upstream requests (e.g. simulates offline)
require('../test-helpers/server-mocks')

const sampleMbTilesPath = path.resolve(
  __dirname,
  '../fixtures/mbtiles/raster/countries-png.mbtiles'
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

  const address = await server.listen(0)
  try {
    await importSse(`${address}/imports/progress/abc123`)
    t.fail('Should not reach here')
  } catch ({ errorEvent, messages }) {
    t.equal(messages.length, 0)
    t.equal(errorEvent.status, 404)
  }
})

test('GET /imports/:importId returns import information', async (t) => {
  const server = createServer(t)

  const createImportResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleMbTilesPath },
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

  const address = await server.listen(0)
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

// TODO: Sometimes this test is hanging locally
test('GET /imports/progress/:importId when import is already completed returns single complete event (SSE)', async (t) => {
  const server = createServer(t)

  const createImportResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleMbTilesPath },
  })

  const {
    import: { id: createdImportId },
  } = createImportResponse.json()

  const address = await server.listen(0)
  const progressEndpoint = `${address}/imports/progress/${createdImportId}`

  // Wait for the import to complete before attempting actual test
  const messages1 = await importSse(progressEndpoint)

  // Conduct actual test
  const messages2 = await importSse(progressEndpoint)
  t.equal(messages2.length, 1, 'only one message is received')
  t.equal(messages2[0].type, 'complete', 'message is complete')
  t.same(messages2[0], messages1[messages1.length - 1])
})

// Skipping for now - need a better way to generate the error
test.skip('GET /imports/:importId on failed import returns import with error state', async (t) => {
  const server = createServer(t)

  const createImportResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleMbTilesPath },
  })

  const {
    import: { id: createdImportId },
  } = createImportResponse.json()

  // Close the server to simulate it going down, ideally before the import finishes
  // Theoretically a race condition can occur where the import does finish in time,
  // which would cause this test to fail
  await server.close()

  const server2 = createServer()

  t.teardown(() => server2.close())

  const getImportResponse = await server2.inject({
    method: 'GET',
    url: `/imports/${createdImportId}`,
  })

  t.equal(getImportResponse.statusCode, 200)

  const impt = getImportResponse.json()

  t.equal(impt.state, 'error')
  t.equal(impt.error, 'UNKNOWN')
  t.ok(impt.finished)
})
