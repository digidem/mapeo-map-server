const test = require('tape')
const path = require('path')

const { createServer } = require('../test-helpers/create-server')
// This disables upstream requests (e.g. simulates offline)
require('../test-helpers/server-mocks')

const fixturesPath = path.resolve(__dirname, '../fixtures')
const sampleMbTilesPath = path.join(
  fixturesPath,
  'mbtiles/raster/countries-png.mbtiles'
)
const badMbTilesPath = path.join(
  fixturesPath,
  'bad-mbtiles/bad-tile-row.mbtiles'
)

test("getImport() returns undefined if the import doesn't exist", async (t) => {
  const server = createServer(t)

  t.is(server.getImport('abc123'), undefined, 'no import found')
})

test('getImportProgress() returns an empty iterable if the import does not exist', async (t) => {
  const server = createServer(t)

  for await (const _ of server.getImportProgress('abc123')) {
    t.fail('should not have any import progress messages')
  }
})

test('successful import', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  const createImportResponse = await fastifyInstance.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleMbTilesPath },
  })
  t.equals(createImportResponse.statusCode, 200)
  const {
    import: { id: createdImportId },
  } = createImportResponse.json()

  const createdImport = server.getImport(createdImportId)
  t.is(createdImport.state, 'active', 'import is active')
  t.is(createdImport.error, null, 'import has no errors')
  t.is(createdImport.finished, null, 'import has not finished')

  const messages = []
  for await (const message of server.getImportProgress(createdImportId)) {
    messages.push(message)
  }

  t.ok(messages.length > 0, 'at least one message is received')
  t.ok(
    messages.every(({ importId }) => importId === createdImportId),
    'all messages have correct importId'
  )
  const lastMessage = messages[messages.length - 1]
  t.equal(lastMessage?.type, 'complete', 'last message is complete')
  t.equal(lastMessage?.soFar, lastMessage?.total)

  const completedImport = server.getImport(createdImportId)
  t.is(completedImport.state, 'complete', 'import is complete')
  t.is(completedImport.error, null, 'import has no errors')
  t.is(
    completedImport.lastUpdated,
    completedImport.finished,
    'import has finished'
  )
  t.ok(
    millisecondsBetween(
      new Date(),
      sqliteCurrentTimestampToDate(completedImport.finished)
    ) < 30_000,
    'finished recently'
  )
})

test('failed import', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  const createImportResponse = await fastifyInstance.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: badMbTilesPath },
  })
  t.equals(createImportResponse.statusCode, 200)
  const {
    import: { id: createdImportId },
  } = createImportResponse.json()

  const createdImport = server.getImport(createdImportId)
  t.is(createdImport.state, 'active', 'import is active')
  t.is(createdImport.error, null, 'import has no errors yet')
  t.is(createdImport.finished, null, 'import has not finished')

  const messages = []
  for await (const message of server.getImportProgress(createdImportId)) {
    messages.push(message)
  }

  t.ok(messages.length > 0, 'at least one message is received')
  t.ok(
    messages.every(({ importId }) => importId === createdImportId),
    'all messages have correct importId'
  )
  const lastMessage = messages[messages.length - 1]
  t.equal(lastMessage?.type, 'error', 'last message is error')
  t.notEqual(lastMessage?.soFar, lastMessage?.total)

  const completedImport = server.getImport(createdImportId)
  t.is(completedImport.state, 'error', 'import is in the "error" state')
  t.is(completedImport.error, 'UNKNOWN', 'import has an error')
  t.is(
    completedImport.lastUpdated,
    completedImport.finished,
    'import has finished'
  )
  t.ok(
    millisecondsBetween(
      new Date(),
      sqliteCurrentTimestampToDate(completedImport.finished)
    ) < 30_000,
    'finished recently'
  )
})

/**
 * Convert a SQLite CURRENT_TIMESTAMP string (YYYY-MM-DD HH:MM:SS, in UTC) to a Date.
 *
 * @param {string} timestamp
 * @returns {Date}
 */
function sqliteCurrentTimestampToDate(timestamp) {
  // See <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_time_string_format>.
  const jsDateTimeString = timestamp.replace(' ', 'T') + 'Z'
  return new Date(jsDateTimeString)
}

/**
 * Return the difference between two Dates in milliseconds. Always returns a positive number.
 *
 * @param {Date} a
 * @param {Date} b
 * @returns {number}
 */
function millisecondsBetween(a, b) {
  return Math.abs(a.valueOf() - b.valueOf())
}
