import { test } from 'tap'
import Tilestore from './tilestore'
import tmp from 'tmp'
import Level from 'level'

import SWRCache from './swr_cache'
import subleveldown from 'subleveldown'

tmp.setGracefulCleanup()

async function createTilestoreFromUrl(url: string): Promise<Tilestore> {
  const { name: dbPath } = tmp.dirSync({ unsafeCleanup: true })
  const db = Level(dbPath, { valueEncoding: 'binary' })
  const cacheDb = subleveldown(db, 'cache', { valueEncoding: 'binary' })
  const etagDb = subleveldown(db, 'etag', { valueEncoding: 'string' })
  const swrCache = new SWRCache({ cacheDb, etagDb })
  const tilestore = new Tilestore({
    id: 'testTilestore',
    mode: 'rwc',
    swrCache,
    dir: dbPath,
  })
  await tilestore.putTileJSON({
    tilejson: '2.2.0',
    tiles: [url],
    format: 'png',
    scheme: 'xyz',
    other: 'test',
  })
  return tilestore
}
test('Tilestore', (t) => {
  t.test('.getTileUrl()', (t) => {
    t.test('replaces {z}/{x}/{y}', async (t) => {
      const ts = await createTilestoreFromUrl('{z}/{x}/{y}.png')
      t.equal(await ts.getTileUrl(1, 0, 0), '1/0/0.png')
    })

    t.test('replaces {quadkey}', async (t) => {
      const ts = await createTilestoreFromUrl('quadkey={quadkey}')
      t.equal(await ts.getTileUrl(1, 0, 0), 'quadkey=0')
      t.equal(await ts.getTileUrl(2, 0, 0), 'quadkey=00')
      t.equal(await ts.getTileUrl(2, 1, 1), 'quadkey=03')
      t.equal(
        await ts.getTileUrl(17, 22914, 52870),
        'quadkey=02301322130000230'
      )
      // Test case confirmed by quadkeytools package
      // https://bitbucket.org/steele/quadkeytools/src/master/test/quadkey.js?fileviewer=file-view-default#quadkey.js-57
      t.equal(await ts.getTileUrl(6, 29, 3), 'quadkey=011123')
    })

    t.test('replaces {bbox-epsg-3857}', async (t) => {
      const ts = await createTilestoreFromUrl('bbox={bbox-epsg-3857}')
      t.equal(
        await ts.getTileUrl(1, 0, 0),
        'bbox=-20037508.342789244,0,0,20037508.342789244'
      )
    })

    t.end()
  })
  t.end()
})
