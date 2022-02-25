import { afterEach, beforeEach, test } from 'tap'
import path from 'path'
import Database, { Database as DatabaseInstance } from 'better-sqlite3'

import { mbTilesToTileJSON } from './mbtiles'
import { validateTileJSON } from './tilejson'

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/trails.mbtiles')

type TestContext = { mbTilesDb: DatabaseInstance }

beforeEach((t) => {
  t.context = {
    mbTilesDb: new Database(FIXTURE_PATH, { readonly: true }),
  }
})

afterEach((t) => {
  t.context.mbTilesDb.close()
})

test('Conversion outputs spec-compliant tilejson', (t) => {
  const { mbTilesDb } = t.context as TestContext

  const tilejson = mbTilesToTileJSON(mbTilesDb)

  t.ok(
    validateTileJSON(tilejson),
    'Converted output complies with tilejson spec'
  )

  const { tiles } = tilejson

  t.equal(tiles.length, 0, '`tiles` field is an empty array')

  t.end()
})
