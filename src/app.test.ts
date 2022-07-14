import test, { Test } from 'tape'
import tmp from 'tmp'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import EventSource from 'eventsource'
import { FastifyServerOptions } from 'fastify'

import { IdResource, Api } from './api'
import createMapServer from './app'
import mapboxRasterTilejson from './fixtures/good-tilejson/mapbox_raster_tilejson.json'
import simpleRasterStylejson from './fixtures/good-stylejson/good-simple-raster.json'
import { MessageComplete } from './lib/mbtiles_import_worker'
import {
  DEFAULT_RASTER_SOURCE_ID,
  DEFAULT_RASTER_LAYER_ID,
  StyleJSON,
  validate as validateStyleJSON,
} from './lib/stylejson'
import { TileJSON, validateTileJSON } from './lib/tilejson'
import { server as mockServer } from './mocks/server'

tmp.setGracefulCleanup()

const DUMMY_MB_ACCESS_TOKEN = 'pk.abc123'

function assertSampleTileJSONIsValid(data: unknown): asserts data is TileJSON {
  if (!validateTileJSON(data)) {
    const message = `Sample input does not conform to TileJSON schema spec: ${JSON.stringify(
      validateTileJSON.errors,
      null,
      2
    )}`

    throw new Error(message)
  }
}

// Check if prisma/migrations directory exists in project
if (!fs.existsSync(path.resolve(__dirname, '../prisma/migrations'))) {
  throw new Error(
    'Could not find prisma migrations directory. Make sure you run `npm run prisma:migrate-dev -- --name MIGRATION_NAME_HERE` first!'
  )
}

assertSampleTileJSONIsValid(mapboxRasterTilejson)
validateStyleJSON(simpleRasterStylejson)

mockServer.listen({
  onUnhandledRequest: (req, print) => {
    const canIgnorePath = ['/imports/progress'].some((p) =>
      req.url.pathname.startsWith(p)
    )
    const isLocalhost = ['localhost', '127.0.0.1'].includes(req.url.hostname)

    if (isLocalhost && canIgnorePath) {
      return
    }

    print.warning()
  },
})

function createContext(t: Test) {
  const { name: dataDir } = tmp.dirSync({ unsafeCleanup: true })

  const dbPath = path.resolve(dataDir, 'test.db')

  const mbTilesPath = path.resolve(
    __dirname,
    './fixtures/mbtiles/raster/countries-png.mbtiles'
  )

  const createServer = (
    fastifyOpts: FastifyServerOptions = { logger: false }
  ) => createMapServer(fastifyOpts, { dbPath })

  const server = createServer()

  t.teardown(() => server.close())

  const context = {
    createServer,
    server,
    sampleMbTilesPath: mbTilesPath,
    sampleTileJSON: mapboxRasterTilejson,
    sampleStyleJSON: simpleRasterStylejson,
  }

  return context
}

async function waitForImportCompletion(endpoint: string) {
  return new Promise<MessageComplete>((res, rej) => {
    const evtSource = new EventSource(endpoint)

    evtSource.onmessage = (event) => {
      const message = JSON.parse(event.data)

      if (message.type === 'complete') {
        evtSource.close()
        res(message)
      }
    }

    evtSource.onerror = (err) => {
      evtSource.close()
      rej(err as any)
    }
  })
}

/**
 * /tilesets tests
 */

test('GET /tilesets when no tilesets exist returns an empty array', async (t) => {
  const { server } = createContext(t)

  const response = await server.inject({ method: 'GET', url: '/tilesets' })

  t.equal(response.statusCode, 200)

  t.equal(
    response.headers['content-type'],
    'application/json; charset=utf-8',
    'returns correct content-type header'
  )

  t.same(response.json(), [])
})

test('GET /tilesets when tilesets exist returns an array of the tilesets', async (t) => {
  const { sampleTileJSON, server } = createContext(t)

  await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const expectedId = '23z3tmtw49abd8b4ycah9x94ykjhedam'
  const expectedTileUrl = `http://localhost:80/tilesets/${expectedId}/{z}/{x}/{y}`
  const expectedResponse = [
    {
      ...sampleTileJSON,
      id: expectedId,
      tiles: [expectedTileUrl],
    },
  ]

  const response = await server.inject({ method: 'GET', url: '/tilesets' })

  t.same(response.json(), expectedResponse)
})

test('POST /tilesets when tileset does not exist creates a tileset and returns it', async (t) => {
  const { sampleTileJSON, server } = createContext(t)

  const expectedId = '23z3tmtw49abd8b4ycah9x94ykjhedam'
  const expectedTileUrl = `http://localhost:80/tilesets/${expectedId}/{z}/{x}/{y}`
  const expectedResponse = {
    ...sampleTileJSON,
    id: expectedId,
    tiles: [expectedTileUrl],
  }

  const responsePost = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  t.same(responsePost.json(), expectedResponse)

  const responseGet = await server.inject({
    method: 'GET',
    url: '/tilesets',
    payload: { tilesetId: expectedId },
  })

  t.equal(responseGet.statusCode, 200)
})

test('POST /tilesets creates a style for the raster tileset', async (t) => {
  const { sampleTileJSON, server } = createContext(t)

  const responseTilesetsPost = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const { id: tilesetId, name: expectedName } = responseTilesetsPost.json<
    TileJSON & IdResource
  >()

  const responseStylesListGet = await server.inject({
    method: 'GET',
    url: '/styles',
  })

  const stylesList = responseStylesListGet.json()

  t.equal(stylesList.length, 1)

  const responseStyleGet = await server.inject({
    method: 'GET',
    url: stylesList[0].url,
  })

  t.equal(responseStyleGet.statusCode, 200)

  const expectedStyle = {
    version: 8,
    name: expectedName,
    sources: {
      [DEFAULT_RASTER_SOURCE_ID]: {
        type: 'raster',
        url: `http://localhost:80/tilesets/${tilesetId}`,
        tileSize: 256,
      },
    },
    layers: [
      {
        id: DEFAULT_RASTER_LAYER_ID,
        type: 'raster',
        source: DEFAULT_RASTER_SOURCE_ID,
      },
    ],
  }

  t.same(responseStyleGet.json(), expectedStyle)
})

test('PUT /tilesets when tileset exists returns the updated tileset', async (t) => {
  const { sampleTileJSON, server } = createContext(t)

  const initialResponse = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const updatedFields: Partial<TileJSON> = {
    name: 'Map Server Test',
  }

  const updatedResponse = await server.inject({
    method: 'PUT',
    url: `/tilesets/${initialResponse.json<TileJSON>().id}`,
    payload: { ...initialResponse.json<TileJSON>(), ...updatedFields },
  })

  t.equal(updatedResponse.statusCode, 200)

  t.notSame(initialResponse.json(), updatedResponse.json())

  t.equal(updatedResponse.json<TileJSON>().name, updatedFields.name)
})

test('PUT /tilesets when providing an incorrect id returns 400 status code', async (t) => {
  const { sampleTileJSON, server } = createContext(t)

  const response = await server.inject({
    method: 'PUT',
    url: `/tilesets/bad-id`,
    payload: { ...sampleTileJSON, name: 'Map Server Test' },
  })

  t.equal(response.statusCode, 400)
})

test('PUT /tilesets when tileset does not exist returns 404 status code', async (t) => {
  const { sampleTileJSON, server } = createContext(t)

  const response = await server.inject({
    method: 'PUT',
    url: `/tilesets/${sampleTileJSON.id}`,
    payload: { ...sampleTileJSON, name: 'Map Server Test' },
  })

  t.equal(response.statusCode, 404)
})

/**
 * /tile tests
 */

test('GET /tile before tileset is created returns 404 status code', async (t) => {
  const { server } = createContext(t)

  const response = await server.inject({
    method: 'GET',
    url: `/tilesets/foobar/1/2/3`,
  })

  t.equal(response.statusCode, 404)
})

test('GET /tile of png format returns a tile image', async (t) => {
  const { sampleTileJSON, server } = createContext(t)

  // Create initial tileset
  const initialResponse = await server.inject({
    method: 'POST',
    url: '/tilesets',
    payload: sampleTileJSON,
  })

  const { id: tilesetId } = initialResponse.json<TileJSON & IdResource>()

  const response = await server.inject({
    method: 'GET',
    url: `/tilesets/${tilesetId}/1/2/3`,
  })

  t.equal(response.statusCode, 200)

  t.equal(
    response.headers['content-type'],
    'image/png',
    'Response content type matches desired resource type'
  )

  t.equal(typeof response.body, 'string')
})

test('POST /tilesets/import fails when providing path for non-existent file', async (t) => {
  const { server } = createContext(t)

  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: '/foo/bar.mbtiles' },
  })

  t.equal(importResponse.statusCode, 400)
  t.equal(importResponse.json().code, 'FST_MBTILES_IMPORT_TARGET_MISSING')
})

test('POST /tilesets/import fails when provided vector tiles format', async (t) => {
  const { server } = createContext(t)

  const unsupportedFixturePath = path.resolve(
    __dirname,
    './fixtures/mbtiles/vector/trails-pbf.mbtiles'
  )

  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: {
      filePath: unsupportedFixturePath,
    },
  })

  t.equal(importResponse.statusCode, 400)

  t.equal(importResponse.json().code, 'FST_UNSUPPORTED_MBTILES_FORMAT')
})

test('POST /tilesets/import creates tileset', async (t) => {
  const { sampleMbTilesPath, server } = createContext(t)

  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleMbTilesPath },
  })

  t.equal(importResponse.statusCode, 200)

  const { tileset: createdTileset } = importResponse.json()

  const tilesetGetResponse = await server.inject({
    method: 'GET',
    url: `/tilesets/${createdTileset.id}`,
  })

  t.equal(tilesetGetResponse.statusCode, 200)

  t.same(tilesetGetResponse.json(), createdTileset)
})

test('POST /tilesets/import creates style for created tileset', async (t) => {
  const { sampleMbTilesPath, server } = createContext(t)

  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleMbTilesPath },
  })

  const {
    tileset: { id: createdTilesetId },
  } = importResponse.json()

  const getStylesResponse = await server.inject({
    method: 'GET',
    url: '/styles',
  })

  const styleInfo = getStylesResponse.json()[0]

  t.ok(
    styleInfo.bytesStored !== null && styleInfo.bytesStored > 0,
    'tiles used by style take up storage space'
  )

  const expectedSourceUrl = `http://localhost:80/tilesets/${createdTilesetId}`

  const styleGetResponse = await server.inject({
    method: 'GET',
    url: styleInfo.url,
  })

  t.equal(styleGetResponse.statusCode, 200)

  const styleHasSourceReferringToTileset = Object.values(
    styleGetResponse.json<StyleJSON & IdResource>().sources
  ).some((source) => {
    if ('url' in source && source.url) {
      return source.url === expectedSourceUrl
    }
    return false
  })

  t.ok(
    styleHasSourceReferringToTileset,
    'style has source pointing to correct tileset'
  )
})

test('POST /tilesets/import multiple times using same source file works', async (t) => {
  t.plan(5)

  const { sampleMbTilesPath, server } = createContext(t)

  async function requestImport() {
    return await server.inject({
      method: 'POST',
      url: '/tilesets/import',
      payload: { filePath: sampleMbTilesPath },
    })
  }

  const importResponse1 = await requestImport()

  t.equal(importResponse1.statusCode, 200)

  const {
    import: { id: importId1 },
    tileset: { id: tilesetId1 },
  } = importResponse1.json()

  const tilesetGetResponse1 = await server.inject({
    method: 'GET',
    url: `/tilesets/${tilesetId1}`,
  })

  t.equal(tilesetGetResponse1.statusCode, 200)

  // Repeated request with same file path

  const importResponse2 = await requestImport()

  t.equal(importResponse2.statusCode, 200)

  const {
    import: { id: importId2 },
    tileset: { id: tilesetId2 },
  } = importResponse2.json()

  const tilesetGetResponse2 = await server.inject({
    method: 'GET',
    url: `/tilesets/${tilesetId2}`,
  })

  t.equal(tilesetGetResponse2.statusCode, 200)

  t.notEqual(importId1, importId2, 'new import is created')
})

test('POST /tilesets/import storage used by tiles is roughly equivalent to that of source', async (t) => {
  const { sampleMbTilesPath, server } = createContext(t)

  function getMbTilesByteCount() {
    const mbTilesDb = new Database(sampleMbTilesPath, { readonly: true })

    const count = mbTilesDb
      .prepare('SELECT SUM(LENGTH(tile_data)) as byteCount FROM tiles')
      .get().byteCount

    mbTilesDb.close()

    return count
  }

  // Completely arbitrary proportion of original source's count where it's not suspiciously too low,
  // to account for a potentially incomplete/faulty import
  const minimumProportion = 0.8
  const roughlyExpectedCount = getMbTilesByteCount()

  const {
    import: { id: createdImportId },
  } = await server
    .inject({
      method: 'POST',
      url: '/tilesets/import',
      payload: { filePath: sampleMbTilesPath },
    })
    .then((resp) => resp.json())

  const address = await server.listen(0)

  await waitForImportCompletion(
    `${address}/imports/progress/${createdImportId}`
  )

  const { bytesStored } = await server
    .inject({
      method: 'GET',
      url: '/styles',
    })
    .then((resp) => resp.json()[0])

  t.ok(
    bytesStored >= roughlyExpectedCount * minimumProportion &&
      bytesStored <= roughlyExpectedCount
  )
})

// TODO: This may eventually become a failing test if styles that share tiles reuse new ones that are stored
test('POST /tilesets/import subsequent imports do not affect storage calculation for existing styles', async (t) => {
  const { sampleMbTilesPath, server } = createContext(t)

  const address = await server.listen(0)

  // Creates and waits for import to finish
  async function requestImport() {
    const {
      import: { id: createdImportId },
    } = await server
      .inject({
        method: 'POST',
        url: '/tilesets/import',
        payload: { filePath: sampleMbTilesPath },
      })
      .then((resp) => resp.json())

    return await waitForImportCompletion(
      `${address}/imports/progress/${createdImportId}`
    )
  }

  await requestImport()

  const style1Before = await server
    .inject({
      method: 'GET',
      url: '/styles',
    })
    .then((resp) => resp.json()[0])

  // TODO: Would be helpful to use a different fixture for this import
  await requestImport()

  const style1After = await server
    .inject({
      method: 'GET',
      url: '/styles',
    })
    .then((resp) =>
      resp.json().find((s: { id: string }) => s.id === style1Before.id)
    )

  t.equal(style1Before.bytesStored, style1After.bytesStored)
})

/**
 * /imports tests
 */

test('GET /imports/:importId returns 404 error when import does not exist', async (t) => {
  const { server } = createContext(t)

  const getImportInfoResponse = await server.inject({
    method: 'GET',
    url: `/imports/abc123`,
  })

  t.equal(getImportInfoResponse.statusCode, 404)
})

test('GET /imports/progress/:importId returns 404 error when import does not exist', async (t) => {
  const { server } = createContext(t)

  const address = await server.listen(0)

  const error = await new Promise((res) => {
    const evtSource = new EventSource(`${address}/imports/progress/abc123`)

    evtSource.onerror = (err) => {
      evtSource.close()
      res(err)
    }
  })

  // @ts-ignore
  t.equal(error?.status, 404)
})

test('GET /imports/:importId returns import information', async (t) => {
  const { sampleMbTilesPath, server } = createContext(t)

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
  t.plan(5)

  const { sampleMbTilesPath, server } = createContext(t)

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

  try {
    let receivedProgressEvent = false
    let receivedFinalProgressEvent = false
    let receivedCompletedEvent = false

    const completedEventMessage = await new Promise<any>((res, rej) => {
      evtSource.onmessage = (event) => {
        const message = JSON.parse(event.data)

        if (message.importId !== createdImportId) {
          evtSource.close()
          rej(
            new Error(
              `expected import id ${createdImportId} but message has import id of ${message.importId}`
            )
          )
        }

        switch (message.type) {
          case 'progress': {
            receivedProgressEvent = true

            if (message.soFar === message.total) {
              receivedFinalProgressEvent = true
            }

            break
          }
          case 'complete': {
            receivedCompletedEvent = true
            evtSource.close()
            res(message)
          }
        }
      }

      evtSource.onerror = (err: any) => {
        evtSource.close()
        rej(new Error(err.message))
      }
    })

    t.ok(receivedProgressEvent, 'at least 1 progress event received')
    t.ok(receivedFinalProgressEvent, 'received final progress event')
    t.ok(receivedCompletedEvent, 'completed event received')

    t.equal(completedEventMessage.soFar, completedEventMessage.total)

    const importGetResponse = await server.inject({
      method: 'GET',
      url: `/imports/${createdImportId}`,
    })

    t.equal(
      importGetResponse.json().state,
      'complete',
      'import successfully recorded as complete in db'
    )
  } catch (err) {
    if (err instanceof Error) {
      t.fail(err.message)
    }
  }
})

test('GET /imports/progress/:importId when import is already completed returns single complete event (SSE)', async (t) => {
  t.plan(1)

  const { sampleMbTilesPath, server } = createContext(t)

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
  const expectedMessage = await waitForImportCompletion(progressEndpoint)

  // Conduct actual test
  const evtSource = new EventSource(progressEndpoint)

  const message = await new Promise((res) => {
    evtSource.onmessage = (event) => {
      const m = JSON.parse(event.data)

      if (m.type !== 'complete') {
        t.fail(`Expected first message of "${m.type}" to be "complete"`)
      }

      evtSource.close()
      res(m)
    }
  })

  t.same(message, expectedMessage)
})

test('GET /imports/:importId on failed import returns import with error state', async (t) => {
  const { createServer, sampleMbTilesPath, server: server1 } = createContext(t)

  const createImportResponse = await server1.inject({
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
  await server1.close()

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

// TODO: Add styles tests for:
// - POST /styles (style via url)

test('POST /styles with invalid style returns 400 status code', async (t) => {
  const { server, sampleStyleJSON } = createContext(t)

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: { style: { ...sampleStyleJSON, sources: undefined } },
  })

  t.equal(responsePost.statusCode, 400)
})

// Reflects the case where a user is providing the style directly
// We'd enforce at the application level that they provide an `id` field in their body
test('POST /styles when providing an id returns resource with the same id', async (t) => {
  const { server, sampleStyleJSON } = createContext(t)

  const expectedId = 'example-style-id'

  const payload = {
    style: sampleStyleJSON,
    id: expectedId,
    accessToken: DUMMY_MB_ACCESS_TOKEN,
  }

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload,
  })

  t.equal(responsePost.json().id, expectedId)
})

test('POST /styles when style exists returns 409', async (t) => {
  const { server, sampleStyleJSON } = createContext(t)

  const payload = {
    style: sampleStyleJSON,
    id: 'example-style-id',
    accessToken: DUMMY_MB_ACCESS_TOKEN,
  }

  const responsePost1 = await server.inject({
    method: 'POST',
    url: '/styles',
    payload,
  })

  t.equal(responsePost1.statusCode, 200)

  const responsePost2 = await server.inject({
    method: 'POST',
    url: '/styles',
    payload,
  })

  t.equal(responsePost2.statusCode, 409)
})

test('POST /styles when providing valid style returns resource with id and altered style', async (t) => {
  const { server, sampleStyleJSON } = createContext(t)

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: { style: sampleStyleJSON, accessToken: DUMMY_MB_ACCESS_TOKEN },
  })

  t.equal(responsePost.statusCode, 200)

  const { id, style } =
    responsePost.json<Awaited<ReturnType<Api['createStyle']>>>()

  t.ok(id, 'created style possesses an id')

  t.notSame(
    style.sources,
    sampleStyleJSON.sources,
    'created style possesses sources that are different from input'
  )

  // The map server updates the sources so that each source's `url` field points to the map server
  const ignoredStyleFields = {
    sources: undefined,
  }

  t.same(
    { ...style, ...ignoredStyleFields },
    { ...sampleStyleJSON, ...ignoredStyleFields },
    'with exception of `sources` field, created style is the same as input'
  )

  const tilesetEndpointPrefix = `http://localhost:80/tilesets/`

  Object.entries(style.sources).forEach(([sourceId, source]) => {
    if ('url' in source) {
      // TODO: Ideally verify that each url ends with the corresponding tileset id
      t.ok(
        source.url?.startsWith(tilesetEndpointPrefix),
        'url field in source remapped to point to map server api endpoint'
      )
    }

    const ignoredSourceFields = {
      url: undefined,
    }

    t.same(
      { ...source, ...ignoredSourceFields },
      {
        // @ts-ignore
        ...sampleStyleJSON.sources[sourceId],
        ...ignoredSourceFields,
      },
      'with exception of `url` field, source from created style matches source from input'
    )
  })
})

test('POST /styles when required Mapbox access token is missing returns 400 status code', async (t) => {
  const { server, sampleStyleJSON } = createContext(t)

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    // Make sure that the style used here has URLs that reference Mapbox APIs
    payload: { style: sampleStyleJSON, accessToken: undefined },
  })

  t.equal(responsePost.statusCode, 400)
})

test('GET /styles/:styleId when style does not exist return 404 status code', async (t) => {
  const { server } = createContext(t)

  const id = 'nonexistent-id'

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${id}`,
  })

  t.equal(responseGet.statusCode, 404)
})

test('GET /styles/:styleId when style exists returns style with sources pointing to offline tilesets', async (t) => {
  const { server, sampleStyleJSON } = createContext(t)

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: { style: sampleStyleJSON, accessToken: DUMMY_MB_ACCESS_TOKEN },
  })

  const { id: expectedId } = responsePost.json<{
    id: string
    style: StyleJSON
  }>()

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${expectedId}`,
  })

  t.equal(responseGet.statusCode, 200)

  for (const source of Object.values(
    responseGet.json<StyleJSON>()['sources']
  )) {
    const urlExists = 'url' in source && source.url !== undefined

    t.ok(urlExists)

    if (urlExists) {
      const responseTilesetGet = await server.inject({
        method: 'GET',
        url: source.url,
      })

      t.equal(responseTilesetGet.statusCode, 200)
    }
  }
})

test('GET /styles when no styles exist returns body with an empty array', async (t) => {
  const { server } = createContext(t)

  const response = await server.inject({ method: 'GET', url: '/styles' })

  t.equal(response.statusCode, 200)

  t.same(response.json(), [])
})

test('GET /styles when styles exist returns array of metadata for each', async (t) => {
  const { server, sampleStyleJSON } = createContext(t)

  const expectedName = 'My Style'

  // Only necessary because the fixture doesn't have a `name` property
  const sampleStyleWithName = { ...sampleStyleJSON, name: expectedName }

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: sampleStyleWithName,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const { id: expectedId } = responsePost.json()

  const expectedUrl = `http://localhost:80/styles/${expectedId}`

  const expectedStyleInfo = {
    id: expectedId,
    bytesStored: 0,
    name: expectedName,
    url: expectedUrl,
  }

  const expectedGetResponse = [expectedStyleInfo]

  const responseGet = await server.inject({ method: 'GET', url: '/styles' })

  t.equal(responseGet.statusCode, 200)

  t.same(responseGet.json(), expectedGetResponse)
})

test('DELETE /styles/:styleId when style does not exist returns 404 status code', async (t) => {
  const { server } = createContext(t)

  const id = 'nonexistent-id'

  const responseDelete = await server.inject({
    method: 'DELETE',
    url: `/styles/${id}`,
  })

  t.equal(responseDelete.statusCode, 404)
})

test('DELETE /styles/:styleId when style exists returns 204 status code and empty body', async (t) => {
  const { sampleStyleJSON, server } = createContext(t)

  const responsePost = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: sampleStyleJSON,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const { id } = responsePost.json<{ id: string; style: StyleJSON }>()

  const responseDelete = await server.inject({
    method: 'DELETE',
    url: `/styles/${id}`,
  })

  t.equal(responseDelete.statusCode, 204)

  t.equal(responseDelete.body, '')

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${id}`,
  })

  t.equal(responseGet.statusCode, 404, 'style is properly deleted')
})

test('DELETE /styles/:styleId works for style created from tileset import', async (t) => {
  t.plan(3)

  const { sampleMbTilesPath, server } = createContext(t)

  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: sampleMbTilesPath },
  })

  const {
    tileset: { id: createdTilesetId },
  } = importResponse.json()

  const getStylesResponse = await server.inject({
    method: 'GET',
    url: '/styles',
  })

  const stylesList = getStylesResponse.json()

  const expectedSourceUrl = `http://localhost:80/tilesets/${createdTilesetId}`

  const styles = await Promise.all<StyleJSON & IdResource>(
    stylesList.map(({ url, id }: { url: string; id: string }) =>
      server
        .inject({
          method: 'GET',
          url,
        })
        .then((response) => response.json<StyleJSON>())
        .then((style) => ({ ...style, id }))
    )
  )

  const matchingStyle = styles.find((style) =>
    Object.values(style.sources).find((source) => {
      if ('url' in source && source.url) {
        return source.url === expectedSourceUrl
      }
    })
  )

  if (!matchingStyle) {
    t.fail('Could not find style created by import')
    return
  }

  const responseDelete = await server.inject({
    method: 'DELETE',
    url: `/styles/${matchingStyle.id}`,
  })

  t.equal(responseDelete.statusCode, 204)

  t.equal(responseDelete.body, '')

  const responseGet = await server.inject({
    method: 'GET',
    url: `/styles/${matchingStyle.id}`,
  })

  t.equal(responseGet.statusCode, 404, 'style is properly deleted')
})

test('GET /styles/:styleId/sprites/:spriteId[pixelDensity].[format] returns 404 when sprite does not exist', async (t) => {
  const { server } = createContext(t)

  const getSpriteImageResponse = await server.inject({
    method: 'GET',
    url: '/styles/abc123/sprites/abc123.png',
  })

  t.equal(getSpriteImageResponse.statusCode, 404)

  const getSpriteLayoutResponse = await server.inject({
    method: 'GET',
    url: '/styles/abc123/sprites/abc123.json',
  })

  t.equal(getSpriteLayoutResponse.statusCode, 404)
})

test('GET /styles/:styleId/sprites/:spriteId[pixelDensity].[format] returns correct sprite asset', async (t) => {
  const { sampleStyleJSON, server } = createContext(t)

  const styleWithSprite = {
    ...sampleStyleJSON,
    sprite: 'mapbox://sprites/terrastories/test',
  }

  const createStyleResponse = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: styleWithSprite,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const {
    style: { sprite },
  } = createStyleResponse.json()

  t.ok(sprite)

  const spriteEndpointPath = new URL(sprite).pathname

  function createSpriteEndpoint(pixelDensity: number, format: string) {
    return `${spriteEndpointPath}${
      pixelDensity > 1 ? `@${pixelDensity}x` : ''
    }.${format}`
  }

  const existingPixelDensities = [1, 2]

  for (const density of existingPixelDensities) {
    const getSpriteImageResponse = await server.inject({
      method: 'GET',
      url: createSpriteEndpoint(density, 'png'),
    })

    t.equal(getSpriteImageResponse.statusCode, 200)
    t.equal(getSpriteImageResponse.headers['content-type'], 'image/png')
    t.ok(
      parseInt(
        getSpriteImageResponse.headers['content-length']?.toString() || '',
        10
      ) > 0
    )

    const getSpriteLayoutResponse = await server.inject({
      method: 'GET',
      url: createSpriteEndpoint(density, 'json'),
    })

    t.equal(getSpriteLayoutResponse.statusCode, 200)
    t.ok(getSpriteLayoutResponse.json())
  }
})

test('GET /styles/:styleId/sprites/:spriteId[pixelDensity].[format] returns an available fallback asset', async (t) => {
  const { sampleStyleJSON, server } = createContext(t)

  const styleWithSprite = {
    ...sampleStyleJSON,
    sprite: 'mapbox://sprites/terrastories/test',
  }

  const createStyleResponse = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: styleWithSprite,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  const {
    style: { sprite },
  } = createStyleResponse.json()

  t.ok(sprite)

  const spriteEndpointPath = new URL(sprite).pathname

  const getSpriteImage2xResponse = await server.inject({
    method: 'GET',
    url: `${spriteEndpointPath}@2x.png`,
  })

  const getSpriteImage3xResponse = await server.inject({
    method: 'GET',
    url: `${spriteEndpointPath}@3x.png`,
  })

  t.equal(getSpriteImage3xResponse.statusCode, 200)
  t.equal(getSpriteImage3xResponse.headers['content-type'], 'image/png')
  t.ok(
    parseInt(
      getSpriteImage3xResponse.headers['content-length']?.toString() || '',
      10
    ) > 0
  )

  t.equal(getSpriteImage3xResponse.body, getSpriteImage2xResponse.body)

  const getSpriteLayout1xResponse = await server.inject({
    method: 'GET',
    url: `${spriteEndpointPath}@2x.json`,
  })

  const getSpriteLayout3xResponse = await server.inject({
    method: 'GET',
    url: `${spriteEndpointPath}@3x.json`,
  })

  t.equal(getSpriteLayout3xResponse.statusCode, 200)
  t.deepEqual(
    getSpriteLayout3xResponse.json(),
    getSpriteLayout1xResponse.json()
  )
})

test('DELETE /styles/:styleId deletes the associated sprites', async (t) => {
  const { sampleStyleJSON, server } = createContext(t)

  const styleWithSprite = {
    ...sampleStyleJSON,
    sprite: 'mapbox://sprites/terrastories/test',
  }

  const createStyleResponse = await server.inject({
    method: 'POST',
    url: '/styles',
    payload: {
      style: styleWithSprite,
      accessToken: DUMMY_MB_ACCESS_TOKEN,
    },
  })

  t.equal(createStyleResponse.statusCode, 200)

  const {
    id: styleId,
    style: { sprite },
  } = createStyleResponse.json()

  const spriteEndpointPath = new URL(sprite).pathname

  const deleteStyleResponse = await server.inject({
    method: 'DELETE',
    url: `/styles/${styleId}`,
  })

  t.equal(deleteStyleResponse.statusCode, 204)

  function createSpriteEndpoint(pixelDensity: number, format: string) {
    return `${spriteEndpointPath}${
      pixelDensity > 1 ? `@${pixelDensity}x` : ''
    }.${format}`
  }

  const pixelDensities = [1, 2]

  for (const density of pixelDensities) {
    const getSpriteImageResponse = await server.inject({
      method: 'GET',
      url: createSpriteEndpoint(density, 'png'),
    })

    const getSpriteLayoutResponse = await server.inject({
      method: 'GET',
      url: createSpriteEndpoint(density, 'json'),
    })

    t.equal(getSpriteImageResponse.statusCode, 404)
    t.equal(getSpriteLayoutResponse.statusCode, 404)
  }
})

// Keep this as the last test in this file
test('e2e tests cleanup', (t) => {
  mockServer.close()
  t.end()
})
