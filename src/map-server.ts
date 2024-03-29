import * as path from 'path'
import { MessagePort } from 'worker_threads'
import createFastify, { FastifyInstance, FastifyServerOptions } from 'fastify'
import Database, { type Database as DatabaseInstance } from 'better-sqlite3'
import Piscina from 'piscina'
import FastifyStatic from '@fastify/static'
import { map } from 'iterpal'

import './type-extensions' // necessary to make sure that the fastify types are augmented
import createApi, { type Api } from './api'
import { convertActiveToError as convertActiveImportsToErrorImports } from './lib/imports'
import { migrate } from './lib/migrations'
import { UpstreamRequestsManager } from './lib/upstream_requests_manager'
import type { IdResource } from './api/index'
import type { StyleResource } from './api/styles'
import type { ImportRecord } from './lib/imports'
import type { PortMessage } from './lib/mbtiles_import_worker.d.ts'
import type { TileJSON } from './lib/tilejson'
import { SDF_STATIC_DIR } from './lib/glyphs'
import * as routes from './routes'

export default class MapServer {
  readonly fastifyInstance: FastifyInstance

  #api: Api
  #activeImports = new Map<string, MessagePort>()
  #db: DatabaseInstance
  #piscina: Piscina
  #upstreamRequestsManager = new UpstreamRequestsManager()

  constructor({
    fastifyOpts = {},
    storagePath,
  }: Readonly<{ fastifyOpts?: FastifyServerOptions; storagePath: string }>) {
    this.#db = createDatabase(storagePath)

    this.#piscina = createPiscina()

    this.#api = createApi({
      activeImports: this.#activeImports,
      db: this.#db,
      piscina: this.#piscina,
      upstreamRequestsManager: this.#upstreamRequestsManager,
    })

    this.fastifyInstance = createMapFastifyServer(this.#api, fastifyOpts)
  }

  /**
   * Retrieve a list of all style records.
   */
  listStyles(): Array<StyleResource> {
    return this.#api.listStyles()
  }

  /**
   * Get information about an import that has occurred or is occurring.
   *
   * An import can represent a variety of different assets, such as tiles or style-related assets like fonts, glyphs, etc.
   *
   * This is a subset of what's represented in the database, which includes information such as the type of import, its state and progress, and important timestamps.
   *
   * @param importId The ID for the desired import.
   * @returns The import record, or undefined if no import with the given ID exists.
   */
  getImport(importId: string): undefined | ImportRecord {
    return this.#api.getImport(importId)
  }

  /**
   * Get progress events for an import.
   *
   * If the import doesn't exist or is complete, this will return an empty iterable.
   */
  getImportProgress(importId: string): AsyncIterableIterator<PortMessage> {
    return this.#api.getImportProgress(importId)
  }

  /**
   * Create a tileset by importing an existing file.
   *
   * @param filePath An absolute path to the location of the file to import.
   * @param baseApiUrl The base API URL for the imported mbtiles.
   */
  importMBTiles(
    filePath: string,
    baseApiUrl: string
  ): Promise<{
    import: IdResource
    style: null | IdResource
    tileset: TileJSON & IdResource
  }> {
    return this.#api.importMBTiles(filePath, baseApiUrl)
  }

  /**
   * Get all tilesets.
   */
  listTilesets(baseApiUrl: string): Array<TileJSON & IdResource> {
    return this.#api.listTilesets(baseApiUrl)
  }

  /**
   * Create a tileset. Returns the created tileset TileJSON if successful.
   */
  createTileset(
    tileset: Readonly<TileJSON>,
    baseApiUrl: string
  ): TileJSON & IdResource {
    // TODO: Add an optional `upstreamUrl` field so that we can fetch from upstream?
    const result = this.#api.createTileset(tileset, baseApiUrl)
    this.#api.createStyleForTileset(result, result.name)
    return result
  }

  listen(port: number | string, host?: string): Promise<string> {
    return this.fastifyInstance.listen(port, host)
  }

  async close() {
    if (this.#activeImports.size > 0) {
      // Wait for all worker threads to finish, so we don't terminate the thread
      // without closing the DB connections in thread. This is kind-of hacky:
      // It relies on the MessagePort being closed when the worker thread is done.
      await Promise.all(
        map(
          this.#activeImports.values(),
          (port) =>
            new Promise((res) => {
              port.once('close', res)
              port.once('error', res)
            })
        )
      )
    }

    await this.#piscina.destroy()

    this.#db.close()

    this.fastifyInstance.close()
  }
}

function createDatabase(dbPath: string): DatabaseInstance {
  const result = new Database(dbPath)

  // Enable auto-vacuum by setting it to incremental mode
  // This has to be set before the anything on the db instance is called!
  // https://www.sqlite.org/pragma.html#pragma_auto_vacuum
  // https://www.sqlite.org/pragma.html#pragma_incremental_vacuum
  result.pragma('auto_vacuum = INCREMENTAL')

  // Enable WAL for potential performance benefits
  // https://github.com/JoshuaWise/better-sqlite3/blob/master/docs/performance.md
  result.pragma('journal_mode = WAL')

  migrate(result, path.resolve(__dirname, '../prisma/migrations'))

  // Any import with an `active` state on startup most likely failed due to the server process stopping
  // so we update these import records to have an error state
  convertActiveImportsToErrorImports(result)

  return result
}

function createPiscina() {
  const result = new Piscina({
    filename: path.resolve(__dirname, './lib/mbtiles_import_worker.js'),
    minThreads: 1,
  })

  result.on('error', (error) => {
    // TODO: Do something with this error https://github.com/piscinajs/piscina#event-error
    console.error(error)
  })

  return result
}

function createMapFastifyServer(
  api: Api,
  fastifyOpts: FastifyServerOptions
): FastifyInstance {
  const result = createFastify(fastifyOpts)

  result.decorate('api', api)

  result.register(FastifyStatic, {
    root: SDF_STATIC_DIR,
    prefix: '/fonts',
    // res type documented in @fastify/static@5 docs is misleading
    setHeaders: (res: any, path: string) => {
      if (path.toLowerCase().endsWith('.pbf')) {
        res.setHeader('Content-Type', 'application/x-protobuf')
      }
    },
  })

  for (const name of Object.keys(routes) as Array<keyof typeof routes>) {
    result.register(routes[name], { prefix: '/' + name })
  }

  return result
}
