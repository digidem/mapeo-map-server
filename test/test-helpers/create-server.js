const tmp = require('tmp')
const path = require('path')
const fs = require('fs')

const createMapServer = require('../..')
const mockServer = require('../test-helpers/mock-server')

tmp.setGracefulCleanup()

// Check if prisma/migrations directory exists in project
if (!fs.existsSync(path.resolve(__dirname, '../../prisma/migrations'))) {
  throw new Error(
    'Could not find prisma migrations directory. Make sure you run `npm run prisma:migrate-dev -- --name MIGRATION_NAME_HERE` first!'
  )
}

module.exports = createServer

/**
 * @param {import('tape').Test} t
 */
function createServer(t) {
  const { name: dataDir, removeCallback } = tmp.dirSync({ unsafeCleanup: true })

  const dbPath = path.resolve(dataDir, 'test.db')

  const server = createMapServer(
    { logger: false, forceCloseConnections: true },
    { dbPath }
  )

  t.teardown(async () => {
    await server.close()
    removeCallback()
    // Ensure mock server is closed after each test (catch error if it is not running)
    try {
      mockServer.close()
    } catch (e) {}
  })

  return server
}
