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

  const baseTilesUrl = 'http://localhost/'

  const tilejson = mbTilesToTileJSON(mbTilesDb, baseTilesUrl)

  t.ok(
    validateTileJSON(tilejson),
    'Converted output complies with tilejson spec'
  )

  const { format, tiles } = tilejson

  const tilesUrl = tiles[0]

  t.ok(
    tilesUrl.startsWith(baseTilesUrl),
    "Provided base url is used for beginning 'tiles' url"
  )

  t.ok(
    tilesUrl.endsWith('.' + format),
    "Detected format is used for ending of 'tiles' url"
  )

  t.end()
})
