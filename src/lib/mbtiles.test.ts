import test from 'tape'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

import { mbTilesToTileJSON } from './mbtiles'
import { validateTileJSON } from './tilejson'

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

    const tilejson = mbTilesToTileJSON(fixtureDb)

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
