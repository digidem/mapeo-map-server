const tmp = require('tmp')
const path = require('path')
const fs = require('fs')

const createMapServer = require('../..')

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
 * @returns {import('fastify').FastifyInstance}
 */
function createServer(t) {
  const { name: dataDir, removeCallback } = tmp.dirSync({ unsafeCleanup: true })

  const storagePath = path.resolve(dataDir, 'test.db')

  const server = createMapServer(
    { logger: false, forceCloseConnections: true },
    { storagePath },
  )

  t.teardown(async () => {
    await server.close()
    removeCallback()
  })

  return server
}
