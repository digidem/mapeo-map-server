import test from 'tape'
import path from 'path'
import Database from 'better-sqlite3'

import { mbTilesToTileJSON } from './mbtiles'
import { validateTileJSON } from './tilejson'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../fixtures/mbtiles/trails.mbtiles'
)

function createContext() {
  const context = {
    mbTilesDb: new Database(FIXTURE_PATH, { readonly: true }),
    cleanup: () => context.mbTilesDb.close(),
  }

  return context
}

test('Conversion outputs spec-compliant tilejson', (t) => {
  const { cleanup, mbTilesDb } = createContext()

  const tilejson = mbTilesToTileJSON(mbTilesDb)

  t.ok(
    validateTileJSON(tilejson),
    'Converted output complies with tilejson spec'
  )

  const { tiles } = tilejson

  t.equal(tiles.length, 0, '`tiles` field is an empty array')

  return cleanup()
})
