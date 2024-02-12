// @ts-check
const test = require('tape')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const { mbTilesToTileJSON } = require('../../dist/lib/mbtiles')
const { validateTileJSON } = require('../../dist/lib/tilejson')

const FIXTURE_DIRECTORIES_PATHS = [
  path.resolve(__dirname, '../fixtures/mbtiles/raster/'),
  path.resolve(__dirname, '../fixtures/mbtiles/vector/'),
]

test('Conversion outputs spec-compliant tilejson', (t) => {
  const fixturePaths = FIXTURE_DIRECTORIES_PATHS.flatMap((directoryPath) => {
    const filenames = fs.readdirSync(directoryPath)
    return filenames.map((name) => path.resolve(directoryPath, name))
  })

  fixturePaths.forEach((p) => {
    const fixtureDb = new Database(p, { readonly: true })

    const tilejson = mbTilesToTileJSON(fixtureDb, 'fallback name')

    fixtureDb.close()

    t.ok(
      validateTileJSON(tilejson),
      'Converted output complies with tilejson spec'
    )

    const { tiles } = tilejson

    t.equal(tiles.length, 0, '`tiles` field is an empty array')
  })

  t.end()
})
