import Database, { Database as DatabaseInstance } from 'better-sqlite3'
import { EventEmitter } from 'events'
import { MessageChannel, MessagePort } from 'worker_threads'

import { ImportRecord } from '../lib/imports'
import { PortMessage } from '../lib/mbtiles_import_worker'
import { TileJSON, validateTileJSON } from '../lib/tilejson'
import path from 'path'
import {
  isSupportedMBTilesFormat,
  isValidMBTilesFormat,
  mbTilesToTileJSON,
} from '../lib/mbtiles'
import { generateId, getTilesetId } from '../lib/utils'
import { Api, Context, IdResource } from '.'
import {
  MBTilesImportTargetMissingError,
  MBTilesInvalidMetadataError,
  NotFoundError,
  UnsupportedMBTilesFormatError,
} from './errors'

export interface ImportsApi {
  getImport(importId: string): ImportRecord
  getImportPort(importId: string): MessagePort | undefined
  importMBTiles(
    filePath: string,
    baseApiUrl: string
  ): Promise<{ import: IdResource; tileset: TileJSON & IdResource }>
}

function createImportsApi({
  api,
  context,
}: {
  api: Pick<Api, 'createStyleForTileset' | 'createTileset'>
  context: Context
}): ImportsApi {
  const { activeImports, db, piscina } = context

  return {
    getImport(importId) {
      const row: ImportRecord | undefined = db
        .prepare(
          'SELECT state, error, importedResources, totalResources, importedBytes, totalBytes, ' +
            'started, finished, lastUpdated FROM Import WHERE id = ?'
        )
        .get(importId)

      if (!row) {
        throw NotFoundError(importId)
      }

      return row
    },
    getImportPort(importId) {
      return activeImports.get(importId)
    },
    importMBTiles(filePath: string, baseApiUrl: string) {
      const filePathWithExtension =
        path.extname(filePath) === '.mbtiles' ? filePath : filePath + '.mbtiles'

      let mbTilesDb: DatabaseInstance

      try {
        mbTilesDb = new Database(filePathWithExtension, {
          // Ideally would set `readOnly` to `true` here but causes `fileMustExist` to be ignored:
          // https://github.com/JoshuaWise/better-sqlite3/blob/230ea65ed0d7566e32d41c3d13a90fb32ccdbee6/docs/api.md#new-databasepath-options
          fileMustExist: true,
        })
      } catch (_err) {
        throw new MBTilesImportTargetMissingError(filePath)
      }
      const tilejson = mbTilesToTileJSON(mbTilesDb)

      mbTilesDb.close()

      // TODO: Should this be handled in extractMBTilesMetadata?
      const formatSupported =
        tilejson.format &&
        isValidMBTilesFormat(tilejson.format) &&
        isSupportedMBTilesFormat(tilejson.format)

      if (!formatSupported) {
        throw new UnsupportedMBTilesFormatError()
      }

      if (!validateTileJSON(tilejson)) {
        throw new MBTilesInvalidMetadataError()
      }

      const tilesetId = getTilesetId(tilejson)

      const tileset = api.createTileset(tilejson, baseApiUrl)

      const { id: styleId } = api.createStyleForTileset(
        tileset.id,
        tileset.name
      )

      const importId = generateId()

      const { port1, port2 } = new MessageChannel()

      activeImports.set(importId, port2)

      return new Promise((res, rej) => {
        let workerDone = false
        // Initially use a longer duration to account for worker startup
        let timeoutId = createTimeout(10000)

        port2.on('message', handleFirstProgressMessage)
        port2.on('message', resetTimeout)

        // Can use a normal event emitter that emits an `abort` event as the abort signaler for Piscina,
        // which allows us to not have to worry about globals or relying on polyfills
        // https://github.com/piscinajs/piscina#cancelable-tasks
        const abortSignaler = new EventEmitter()

        piscina
          .run(
            {
              dbPath: db.name,
              importId,
              mbTilesDbPath: mbTilesDb.name,
              styleId,
              tilesetId,
              port: port1,
            },
            { signal: abortSignaler, transferList: [port1] }
          )
          .catch((err) => {
            // FYI this will be called when piscina.destroy() in the onClose hook
            rej(err)
          })
          .finally(() => {
            cleanup()
            workerDone = true
          })

        function handleFirstProgressMessage(message: PortMessage) {
          if (message.type === 'progress') {
            port2.off('message', handleFirstProgressMessage)
            res({ import: { id: message.importId }, tileset })
          }
        }

        function cleanup() {
          clearTimeout(timeoutId)
          port2.off('message', resetTimeout)
          port2.close()
          activeImports.delete(importId)
        }

        function onMessageTimeout() {
          if (workerDone) return

          cleanup()

          abortSignaler.emit('abort')

          try {
            db.prepare(
              "UPDATE Import SET state = 'error', finished = CURRENT_TIMESTAMP, error = 'TIMEOUT' WHERE id = ?"
            ).run(importId)
          } catch (err) {
            // TODO: This could potentially throw when the db is closed already. Need to properly handle/report
            console.error(err)
          }

          rej(new Error('Timeout reached while waiting for worker message'))
        }

        function createTimeout(durationMs: number) {
          return setTimeout(onMessageTimeout, durationMs)
        }

        function resetTimeout() {
          clearTimeout(timeoutId)
          // Use shorter duration since worker should be up and running at this point
          timeoutId = createTimeout(5000)
        }
      })
    },
  }
}

export default createImportsApi