const test = require('tape')
const path = require('path')
const Database = require('better-sqlite3')

const importSse = require('../test-helpers/import-sse')
const createServer = require('../test-helpers/create-server')
// This disables upstream requests (e.g. simulates offline)
require('../test-helpers/server-mocks')

const fixturesPath = path.resolve(__dirname, '../fixtures')
const sampleMbTilesPath = path.join(
  fixturesPath,
  'mbtiles/raster/countries-png.mbtiles'
)

test('POST /tilesets/import fails when providing path for non-existent file', async (t) => {
  const server = createServer(t)

  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: '/foo/bar.mbtiles' },
  })

  t.equal(importResponse.statusCode, 400)
  t.equal(importResponse.json().code, 'FST_MBTILES_IMPORT_TARGET_MISSING')
})

test('POST /tilesets/import fails when provided vector tiles format', async (t) => {
  const server = createServer(t)

  const unsupportedFixturePath = path.resolve(
    __dirname,
    '../fixtures/mbtiles/vector/trails-pbf.mbtiles'
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
  const server = createServer(t)

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
  const server = createServer(t)

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
    styleGetResponse.json().sources
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

  const server = createServer(t)

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
  const server = createServer(t)

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

  await importSse(`${address}/imports/progress/${createdImportId}`)

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
  const server = createServer(t)

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

    return await importSse(`${address}/imports/progress/${createdImportId}`)
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
    .then((resp) => resp.json().find((s) => s.id === style1Before.id))

  t.equal(style1Before.bytesStored, style1After.bytesStored)
})

test('POST /tilesets/import fails when providing invalid mbtiles, no tilesets or styles created', async (t) => {
  const server = createServer(t)
  const badMbTilesPath = path.join(
    fixturesPath,
    'bad-mbtiles/missing-tiles-table.mbtiles'
  )
  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: badMbTilesPath },
  })

  t.equal(importResponse.statusCode, 400)

  const tilesetsRes = await server.inject({ method: 'GET', url: '/tilesets' })
  t.equal(tilesetsRes.statusCode, 200)
  t.same(tilesetsRes.json(), [], 'no tilesets created')

  const stylesRes = await server.inject({ method: 'GET', url: '/styles' })
  t.equal(stylesRes.statusCode, 200)
  t.same(stylesRes.json(), [], 'no styles created')
})
