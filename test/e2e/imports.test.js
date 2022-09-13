const test = require('tape')
const path = require('path')
const EventSource = require('eventsource')

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

// This tests that the server can force an eventsource client to disconnect by
// responding with a 204 status code. This is in case the client does not close
// the eventSource (as it should) after the 'complete' message is received
test('GET /imports/progress/:importId - EventSource forced to close after import completes', async (t) => {
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
  const evtSource = new EventSource(
    `${address}/imports/progress/${createdImportId}`
  )
  await new Promise((res) => {
    let errors = 0
    let lastMessage
    evtSource.onmessage = (ev) => {
      lastMessage = JSON.parse(ev.data)
    }
    evtSource.onerror = async () => {
      errors++
      if (errors === 1) {
        t.equal(lastMessage.type, 'complete')
        t.equal(
          evtSource.readyState,
          evtSource.CONNECTING,
          'EventSource tries to reconnect the first time after the server closes'
        )
      } else {
        // Await next tick before checking event source state
        await new Promise((res) => setTimeout(res, 0))
        t.equal(
          evtSource.readyState,
          evtSource.CLOSED,
          'EventSource is closed the second time after the server closes'
        )
        res()
      }
    }
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

// This tests that the server can force an eventsource client to disconnect by
// responding with a 204 status code. This is in case the client does not close
// the eventSource (as it should) after the 'complete' message is received
test('GET /imports/progress/:importId - EventSource forced to close after single message if import has already completed', async (t) => {
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
  // Wait for import to complete
  await importSse(progressEndpoint)

  const evtSource = new EventSource(progressEndpoint)
  await new Promise((res) => {
    let errors = 0
    let msgs = 0
    evtSource.onmessage = (ev) => {
      msgs++
      t.equal(msgs, 1, 'only one message is received')
      t.equal(JSON.parse(ev.data).type, 'complete', 'message is complete')
    }
    evtSource.onerror = async () => {
      errors++
      if (errors === 1) {
        t.equal(msgs, 1, 'disconnect after first message')
        t.equal(
          evtSource.readyState,
          evtSource.CONNECTING,
          'EventSource tries to reconnect the first time after the server closes'
        )
      } else {
        // Await next tick before checking event source state
        await new Promise((res) => setTimeout(res, 0))
        t.equal(
          evtSource.readyState,
          evtSource.CLOSED,
          'EventSource is closed the second time after the server closes'
        )
        res()
      }
    }
  })
})

// TODO: Potentially flaky test
test('GET /imports/:importId after deferred import error shows error state', async (t) => {
  const server = createServer(t)
  // This mbtiles file has one of the tile_data fields set to null. This causes
  // the import to initially report progress, but fail when it reaches the null
  // field
  const mbTilesPath = path.join(
    fixturesPath,
    'bad-mbtiles/null-tile_data.mbtiles'
  )
  const createImportResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: mbTilesPath },
  })
  t.equal(
    createImportResponse.statusCode,
    200,
    'initial import creation successful'
  )

  const {
    import: { id: createdImportId },
  } = createImportResponse.json()

  const address = await server.listen(0)
  // Wait for import to complete
  await importSse(`${address}/imports/progress/${createdImportId}`)

  const getImportResponse = await server.inject({
    method: 'GET',
    url: `/imports/${createdImportId}`,
  })

  t.equal(getImportResponse.statusCode, 200)

  const impt = getImportResponse.json()

  t.equal(impt.state, 'error')
  t.equal(impt.error, 'UNKNOWN')
  t.ok(impt.finished)
})
