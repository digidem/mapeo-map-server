const tmp = require('tmp')
const path = require('path')
const fs = require('fs')
const Db = require('better-sqlite3')

const createMapServer = require('../..')

tmp.setGracefulCleanup()

// Check if prisma/migrations directory exists in project
if (!fs.existsSync(path.resolve(__dirname, '../../prisma/migrations'))) {
  throw new Error(
    'Could not find prisma migrations directory. Make sure you run `npm run prisma:migrate-dev -- --name MIGRATION_NAME_HERE` first!'
  )
}

exports.createServer = createServer
exports.createFastifyServer = createFastifyServer

/**
 * @param {import('tape').Test} t
 * @returns {import('../../src/map-server.ts')}
 */
function createServer(t) {
  const { name: dataDir, removeCallback } = tmp.dirSync({ unsafeCleanup: true })

  const dbPath = path.resolve(dataDir, 'test.db')

  const server = createMapServer({
    fastifyOpts: { logger: false, forceCloseConnections: true },
    database: new Db(dbPath),
  })

  t.teardown(async () => {
    await server.close()
    removeCallback()
  })

  return server
}

/**
 * @param {import('tape').Test} t
 * @returns {import('fastify').FastifyInstance}
 */
function createFastifyServer(t) {
  return createServer(t).fastifyInstance
}
