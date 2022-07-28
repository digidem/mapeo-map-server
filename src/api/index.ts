import Database, { Database as DatabaseInstance } from 'better-sqlite3'
import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import path from 'path'
import Piscina from 'piscina'
import { MessagePort } from 'worker_threads'

import { convertActiveToError as convertActiveImportsToErrorImports } from '../lib/imports'
import { migrate } from '../lib/migrations'
import { UpstreamRequestsManager } from '../lib/upstream_requests_manager'
import createImportsApi, { ImportsApi } from './imports'
import createSpritesApi, { SpritesApi } from './sprites'
import createStylesApi, { StylesApi } from './styles'
import createTilesApi, { TilesApi } from './tiles'
import createTilesetsApi, { TilesetsApi } from './tilesets'

export interface MapServerOptions {
  dbPath: string
}

export interface Context {
  activeImports: Map<string, MessagePort>
  db: DatabaseInstance
  piscina: Piscina
  upstreamRequestsManager: UpstreamRequestsManager
}

// Any resource returned by the API will always have an `id` property
export interface IdResource {
  id: string
}

export interface Api
  extends ImportsApi,
    SpritesApi,
    StylesApi,
    TilesApi,
    TilesetsApi {}

function createApi({
  context,
  fastify,
  request,
}: {
  context: Context
  fastify: FastifyInstance
  request: FastifyRequest
}): Api {
  const { hostname, protocol } = request
  const apiUrl = `${protocol}://${hostname}`

  const tilesetsApi = createTilesetsApi({
    apiUrl,
    context,
    fastify,
  })

  const stylesApi = createStylesApi({
    api: {
      createTileset: tilesetsApi.createTileset,
    },
    apiUrl,
    context,
    fastify,
  })

  const importsApi = createImportsApi({
    api: {
      createTileset: tilesetsApi.createTileset,
      createStyleForTileset: stylesApi.createStyleForTileset,
    },
    context,
  })

  const tilesApi = createTilesApi({
    api: {
      getTilesetInfo: tilesetsApi.getTilesetInfo,
    },
    context,
  })

  const spritesApi = createSpritesApi({
    context,
  })

  return {
    ...importsApi,
    ...spritesApi,
    ...stylesApi,
    ...tilesApi,
    ...tilesetsApi,
  }
}

function init(dbPath: string): Context {
  const db = new Database(dbPath)

  // Enable auto-vacuum by setting it to incremental mode
  // This has to be set before the anything on the db instance is called!
  // https://www.sqlite.org/pragma.html#pragma_auto_vacuum
  // https://www.sqlite.org/pragma.html#pragma_incremental_vacuum
  db.pragma('auto_vacuum = INCREMENTAL')

  // Enable WAL for potential performance benefits
  // https://github.com/JoshuaWise/better-sqlite3/blob/master/docs/performance.md
  db.pragma('journal_mode = WAL')

  migrate(db, path.resolve(__dirname, '../../prisma/migrations'))

  // Any import with an `active` state on startup most likely failed due to the server process stopping
  // so we update these import records to have an error state
  convertActiveImportsToErrorImports(db)

  const piscina = new Piscina({
    filename: path.resolve(__dirname, '../lib/mbtiles_import_worker.js'),
    minThreads: 1,
  })

  piscina.on('error', (error) => {
    // TODO: Do something with this error https://github.com/piscinajs/piscina#event-error
    console.error(error)
  })

  return {
    activeImports: new Map(),
    db,
    piscina,
    upstreamRequestsManager: new UpstreamRequestsManager(),
  }
}

const ApiPlugin: FastifyPluginAsync<MapServerOptions> = async (
  fastify,
  { dbPath }
) => {
  if (dbPath == null)
    throw new Error('Map server option `dbPath` must be specified')

  // Create context once for each fastify instance
  const context = init(dbPath)

  fastify.addHook('onClose', async () => {
    const { piscina, db } = context

    if (context.activeImports.size > 0) {
      // Wait for all worker threads to finish, so we don't terminate the thread
      // without closing the DB connections in thread. This is kind-of hacky:
      // It relies on the MessagePort being closed when the worker thread is done.
      await Promise.all(
        [...context.activeImports.values()].map(
          (port) =>
            new Promise((res) => {
              port.once('close', res)
              port.once('error', res)
            })
        )
      )
    }

    await piscina.destroy()
    db.close()
  })

  fastify.decorateRequest('api', {
    getter(this: FastifyRequest) {
      return createApi({ context, fastify, request: this })
    },
  })
}

export default fp(ApiPlugin, {
  fastify: '3.x',
  name: 'api',
})
