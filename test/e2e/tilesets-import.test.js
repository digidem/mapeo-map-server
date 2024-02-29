const test = require('tape')
const path = require('path')
const Database = require('better-sqlite3')

const { createServer } = require('../test-helpers/create-server')
// This disables upstream requests (e.g. simulates offline)
require('../test-helpers/server-mocks')

const fixturesPath = path.resolve(__dirname, '../fixtures')
const rasterMbTilesPath = path.join(
  fixturesPath,
  'mbtiles/raster/countries-png.mbtiles'
)
const vectorMbTilesPath = path.join(
  __dirname,
  '../fixtures/mbtiles/vector/trails-pbf.mbtiles'
)
const vectorMbTilesMissingJsonRowPath = path.join(
  __dirname,
  '../fixtures/bad-mbtiles/vector-missing-json-row.mbtiles'
)
const mbTilesMissingNameMetadataPath = path.join(
  __dirname,
  '../fixtures/bad-mbtiles/missing-name-metadata.mbtiles'
)

const fixtures = [rasterMbTilesPath, vectorMbTilesPath]

/**
 * @param {unknown} vectorLayers
 * @returns {boolean}
 */
function isValidVectorLayersValue(vectorLayers) {
  if (!Array.isArray(vectorLayers)) return false
  if (vectorLayers.length === 0) return false

  return vectorLayers.every((layer) => layer.id && layer.fields)
}

/**
 * @param {ReturnType<typeof createServer>} server
 * @param {string} importId
 * @returns {Promise<void>}
 */
async function importCompleted(server, importId) {
  for await (const _ of server.getImportProgress(importId)) {
    // Exhaust the import progress
  }
  const importState = server.getImport(importId)?.state
  if (importState === 'complete') return
  throw new Error(`Import did not complete. State is ${importState}`)
}

test('POST /tilesets/import fails when providing path for non-existent file', async (t) => {
  const server = createServer(t).fastifyInstance

  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: '/foo/bar.mbtiles' },
  })

  t.equal(importResponse.statusCode, 400)
  t.equal(importResponse.json().code, 'FST_MBTILES_IMPORT_TARGET_MISSING')
})

test('POST /tilesets/import fails when mbtiles file has bad metadata', async (t) => {
  const server = createServer(t).fastifyInstance

  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: vectorMbTilesMissingJsonRowPath },
  })

  t.equal(importResponse.statusCode, 400)
  t.equal(importResponse.json().code, 'FST_MBTILES_INVALID_METADATA')
})

test('POST /tilesets/import creates tileset', async (t) => {
  const server = createServer(t).fastifyInstance

  for (const fixture of fixtures) {
    const importResponse = await server.inject({
      method: 'POST',
      url: '/tilesets/import',
      payload: { filePath: fixture },
    })

    t.equal(importResponse.statusCode, 200)

    const { tileset: createdTileset } = importResponse.json()

    const tilesetGetResponse = await server.inject({
      method: 'GET',
      url: `/tilesets/${createdTileset.id}`,
    })

    t.equal(tilesetGetResponse.statusCode, 200)

    const tileset = tilesetGetResponse.json()

    t.same(tileset, createdTileset)

    if (tileset.format === 'pbf') {
      t.ok(
        isValidVectorLayersValue(tileset['vector_layers']),
        'vector tileset has valid vector_layers field'
      )
    }
  }
})

test('POST /tilesets/import creates style for created tileset', async (t) => {
  const server = createServer(t).fastifyInstance

  for (const fixture of fixtures) {
    const importResponse = await server.inject({
      method: 'POST',
      url: '/tilesets/import',
      payload: { filePath: fixture },
    })

    const {
      tileset: { id: createdTilesetId },
      style: { id: createdStyleId },
    } = importResponse.json()

    const styleGetResponse = await server.inject({
      method: 'GET',
      url: `styles/${createdStyleId}`,
    })

    t.equal(styleGetResponse.statusCode, 200)

    const style = styleGetResponse.json()

    const sources = Object.values(style.sources)

    t.equal(sources.length, 1, 'style has one source')

    const expectedSourceUrl = `http://localhost:80/tilesets/${createdTilesetId}`

    t.equal(
      sources[0].url,
      expectedSourceUrl,
      'style has source pointing to correct tileset'
    )

    const sourceNames = Object.keys(style.sources)
    const allLayersPointToSource = style.layers.every((layer) =>
      sourceNames.includes(layer.source)
    )

    t.ok(allLayersPointToSource, 'all layers point to a source')

    const getStylesResponse = await server.inject({
      method: 'GET',
      url: '/styles',
    })

    const styleInfo = getStylesResponse
      .json()
      .find((info) => info.id === createdStyleId)

    t.ok(
      styleInfo.bytesStored !== null && styleInfo.bytesStored > 0,
      'tiles used by style take up storage space'
    )

    const expectedStyleUrl = `http://localhost:80/styles/${createdStyleId}`

    t.equal(styleInfo.url, expectedStyleUrl)
  }
})

test('POST /tilesets/import fills in a default name if missing from metadata', async (t) => {
  const server = createServer(t).fastifyInstance

  const importResponse = await server.inject({
    method: 'POST',
    url: '/tilesets/import',
    payload: { filePath: mbTilesMissingNameMetadataPath },
  })

  t.equal(importResponse.statusCode, 200)

  const { tileset: createdTileset } = importResponse.json()

  const tilesetGetResponse = await server.inject({
    method: 'GET',
    url: `/tilesets/${createdTileset.id}`,
  })

  t.equal(tilesetGetResponse.statusCode, 200)

  const tileset = tilesetGetResponse.json()

  t.equal(
    tileset.name,
    'missing-name-metadata',
    'Fallback name matches file name'
  )
})

test('POST /tilesets/import multiple times using same source file works', async (t) => {
  t.plan(10)

  const server = createServer(t).fastifyInstance

  async function requestImport(fixture) {
    return await server.inject({
      method: 'POST',
      url: '/tilesets/import',
      payload: { filePath: fixture },
    })
  }

  for (const fixture of fixtures) {
    const importResponse1 = await requestImport(fixture)

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

    const importResponse2 = await requestImport(fixture)

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
  }
})

test('POST /tilesets/import storage used by tiles is roughly equivalent to that of source', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  function getMbTilesByteCount(fixture) {
    const mbTilesDb = new Database(fixture, { readonly: true })

    const count = mbTilesDb
      .prepare('SELECT SUM(LENGTH(tile_data)) as byteCount FROM tiles')
      .get().byteCount

    mbTilesDb.close()

    return count
  }

  // Completely arbitrary proportion of original source's count where it's not suspiciously too low,
  // to account for a potentially incomplete/faulty import
  const minimumProportion = 0.8

  const checkedStyleIds = new Set()
  for (const fixture of fixtures) {
    const roughlyExpectedCount = getMbTilesByteCount(fixture)

    const {
      import: { id: createdImportId },
    } = await fastifyInstance
      .inject({
        method: 'POST',
        url: '/tilesets/import',
        payload: { filePath: fixture },
      })
      .then((resp) => resp.json())

    await importCompleted(server, createdImportId)

    const styleInfo = await fastifyInstance
      .inject({
        method: 'GET',
        url: '/styles',
      })
      .then((resp) => {
        const styleInfo = resp.json()
        return styleInfo.find(({ id }) => !checkedStyleIds.has(id))
      })

    t.ok(
      styleInfo.bytesStored >= roughlyExpectedCount * minimumProportion &&
        styleInfo.bytesStored <= roughlyExpectedCount
    )

    checkedStyleIds.add(styleInfo.id)
  }
})

// TODO: This may eventually become a failing test if styles that share tiles reuse new ones that are stored
test('POST /tilesets/import subsequent imports do not affect storage calculation for existing styles', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  // Creates and waits for import to finish
  async function requestImport(fixture) {
    const {
      import: { id: createdImportId },
    } = await fastifyInstance
      .inject({
        method: 'POST',
        url: '/tilesets/import',
        payload: { filePath: fixture },
      })
      .then((resp) => resp.json())
    await importCompleted(server, createdImportId)
  }

  await requestImport(rasterMbTilesPath)

  const rasterStyleBefore = await fastifyInstance
    .inject({
      method: 'GET',
      url: '/styles',
    })
    .then((resp) => resp.json()[0])

  // Do a repeat import and an import of a completely different tileset
  await requestImport(rasterMbTilesPath)
  await requestImport(vectorMbTilesPath)

  const rasterStyleAfter = await fastifyInstance
    .inject({
      method: 'GET',
      url: '/styles',
    })
    .then((resp) => {
      const stylesInfo = resp.json()
      return stylesInfo.find(({ id }) => id === rasterStyleBefore.id)
    })

  t.equal(rasterStyleBefore.bytesStored, rasterStyleAfter.bytesStored)
})

test('POST /tilesets/import fails when providing invalid mbtiles, no tilesets or styles created', async (t) => {
  const server = createServer(t).fastifyInstance
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
  t.equal(importResponse.json().code, 'FST_MBTILES_CANNOT_READ')

  const tilesetsRes = await server.inject({ method: 'GET', url: '/tilesets' })
  t.equal(tilesetsRes.statusCode, 200)
  t.same(tilesetsRes.json(), [], 'no tilesets created')

  const stylesRes = await server.inject({ method: 'GET', url: '/styles' })
  t.equal(stylesRes.statusCode, 200)
  t.same(stylesRes.json(), [], 'no styles created')
})

// TODO: Add test for worker timeout
