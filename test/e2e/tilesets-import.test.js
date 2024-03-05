const test = require('tape')
const path = require('path')
const Database = require('better-sqlite3')

const { assertRejects } = require('../test-helpers/assertions')
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

test('importMBTiles() fails when providing path for non-existent file', async (t) => {
  const server = createServer(t)

  await assertRejects(
    t,
    server.importMBTiles('/foo/bar.mbtiles', 'https://example.com'),
    { code: 'MBTILES_IMPORT_TARGET_MISSING' }
  )
})

test('importMBTiles() fails when mbtiles file has bad metadata', async (t) => {
  const server = createServer(t)

  await assertRejects(
    t,
    server.importMBTiles(
      vectorMbTilesMissingJsonRowPath,
      'https://example.com'
    ),
    { code: 'MBTILES_INVALID_METADATA' }
  )
})

test('importMBTiles() creates tileset', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  for (const fixture of fixtures) {
    const { tileset: createdTileset } = await server.importMBTiles(
      fixture,
      // TODO: Once we replace GET /tilesets/:id with a JS API, we should
      // replace this with example.com or similar.
      // See <https://github.com/digidem/mapeo-map-server/issues/111>.
      'http://localhost:80'
    )

    const tilesetGetResponse = await fastifyInstance.inject({
      method: 'GET',
      url: `/tilesets/${createdTileset.id}`,
    })

    t.equal(tilesetGetResponse.statusCode, 200)

    const tileset = tilesetGetResponse.json()

    // TODO: Once we replace GET /tilesets/:id with a JS API, we shouldn't need
    // this `undefined` removal hack.
    // See <https://github.com/digidem/mapeo-map-server/issues/111>.
    t.same(tileset, JSON.parse(JSON.stringify(createdTileset)))

    if (tileset.format === 'pbf') {
      t.ok(
        isValidVectorLayersValue(tileset['vector_layers']),
        'vector tileset has valid vector_layers field'
      )
    }
  }
})

test('importMBTiles() creates style for created tileset', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  for (const fixture of fixtures) {
    const {
      tileset: { id: createdTilesetId },
      style: { id: createdStyleId },
    } = await server.importMBTiles(fixture, 'https://example.com')

    const styleGetResponse = await fastifyInstance.inject({
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

    const styleInfo = server
      .listStyles()
      .find((info) => info.id === createdStyleId)

    t.ok(
      styleInfo.bytesStored !== null && styleInfo.bytesStored > 0,
      'tiles used by style take up storage space'
    )
  }
})

test('importMBTiles() fills in a default name if missing from metadata', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  const { tileset: createdTileset } = await server.importMBTiles(
    mbTilesMissingNameMetadataPath,
    'https://example.com'
  )

  const tilesetGetResponse = await fastifyInstance.inject({
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

test('importMBTiles() multiple times using same source file works', async (t) => {
  const server = createServer(t)
  const { fastifyInstance } = server

  const requestImport = (fixture) =>
    server.importMBTiles(fixture, 'https://example.com')

  for (const fixture of fixtures) {
    const {
      import: { id: importId1 },
      tileset: { id: tilesetId1 },
    } = await requestImport(fixture)

    const tilesetGetResponse1 = await fastifyInstance.inject({
      method: 'GET',
      url: `/tilesets/${tilesetId1}`,
    })

    t.equal(tilesetGetResponse1.statusCode, 200)

    // Repeated request with same file path

    const {
      import: { id: importId2 },
      tileset: { id: tilesetId2 },
    } = await requestImport(fixture)

    const tilesetGetResponse2 = await fastifyInstance.inject({
      method: 'GET',
      url: `/tilesets/${tilesetId2}`,
    })

    t.equal(tilesetGetResponse2.statusCode, 200)

    t.notEqual(importId1, importId2, 'new import is created')
  }
})

test('importMBTiles() storage used by tiles is roughly equivalent to that of source', async (t) => {
  const server = createServer(t)

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
    } = await server.importMBTiles(fixture, 'https://example.com')

    await importCompleted(server, createdImportId)

    const styleInfo = server
      .listStyles()
      .find(({ id }) => !checkedStyleIds.has(id))

    t.ok(
      styleInfo.bytesStored >= roughlyExpectedCount * minimumProportion &&
        styleInfo.bytesStored <= roughlyExpectedCount
    )

    checkedStyleIds.add(styleInfo.id)
  }
})

// TODO: This may eventually become a failing test if styles that share tiles reuse new ones that are stored
test('importMBTiles() subsequent imports do not affect storage calculation for existing styles', async (t) => {
  const server = createServer(t)

  // Creates and waits for import to finish
  async function requestImport(fixture) {
    const {
      import: { id: createdImportId },
    } = await server.importMBTiles(fixture, 'https://example.com')
    await importCompleted(server, createdImportId)
  }

  await requestImport(rasterMbTilesPath)

  const rasterStyleBefore = server.listStyles()[0]

  // Do a repeat import and an import of a completely different tileset
  await requestImport(rasterMbTilesPath)
  await requestImport(vectorMbTilesPath)

  const rasterStyleAfter = server
    .listStyles()
    .find(({ id }) => id === rasterStyleBefore.id)

  t.equal(rasterStyleBefore.bytesStored, rasterStyleAfter.bytesStored)
})

test('importMBTiles() fails when providing invalid mbtiles, no tilesets or styles created', async (t) => {
  const server = createServer(t)

  const badMbTilesPath = path.join(
    fixturesPath,
    'bad-mbtiles/missing-tiles-table.mbtiles'
  )
  await assertRejects(
    t,
    server.importMBTiles(badMbTilesPath, 'https://example.com'),
    { code: 'MBTILES_CANNOT_READ' }
  )

  t.deepEqual(
    server.listTilesets('https://example.com'),
    [],
    'no tilesets created'
  )

  t.same(server.listStyles(), [], 'no styles created')
})

// TODO: Add test for worker timeout
