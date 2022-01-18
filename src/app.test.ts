import { test, beforeEach, afterEach } from 'tap'
import tmp from 'tmp'
import Db, {Database, Options, RunResult} from 'better-sqlite3'

import app from './app'
// import mapboxRasterTilejson from './fixtures/good-tilejson/mapbox_raster_tilejson.json'
// import { getTilesetId } from './lib/tilestore'

import * as goodFull from './fixtures/good-tilejson/good-full.json'
import * as goodSimple from './fixtures/good-tilejson/good-simple.json'
import * as mapboxRaster from './fixtures/good-tilejson/mapbox_raster_tilejson.json'
import * as openMapTiles from './fixtures/good-tilejson/openmaptiles_tilejson.json'

tmp.setGracefulCleanup()

beforeEach((done, t) => {
  const { name: dataDir } = tmp.dirSync({ unsafeCleanup: true })
  t.context.app = app({ logger: false }, { dataDir })
  done()
})

afterEach((done, t) => {
  t.context.app.close().then(done)
})

// test('GET /tilesets (empty)', async (t) => {
//   const { app } = t.context

//   const response = await app.inject({ method: 'GET', url: '/tilesets' })
//   t.strictEqual(response.statusCode, 200, 'returns a status code of 200')
//   t.strictEqual(
//     response.headers['content-type'],
//     'application/json; charset=utf-8',
//     'returns correct content-type header'
//   )
//   t.deepEqual(response.json(), [], 'returns empty array')
// })

// test('POST /tilesets', async (t) => {
//   const { app } = t.context
  
  
//   // @ts-ignore
//   const expectedId = getTilesetId(mapboxRasterTilejson)
//   const expectedTileUrl = `http://localhost:80/tilesets/${expectedId}/{z}/{x}/{y}`
//   const expectedResponse = {
//     ...mapboxRasterTilejson,
//     id: expectedId,
//     tiles: [expectedTileUrl],
//   }

//   const response = await app.inject({
//     method: 'POST',
//     url: '/tilesets',
//     payload: mapboxRasterTilejson,
//   })
//   t.deepEqual(response.json(), expectedResponse)
// })

test('DELETE /tileset', async t =>
{
  const db = new Db('./data/dev.db')
  db.prepare('DELETE FROM Tileset').run()
  const tilesetsArray = [goodFull, goodSimple, mapboxRaster, openMapTiles]
  
  db.prepare('DELETE FROM Tileset').run()
  const insert = db.prepare('INSERT INTO Tileset (id, tilejson, format) VALUES (?, ?, ?)');
  const insertMany = db.transaction((tilesets:Object[], inc:number)=>
  {
    for(const tileset of tilesets)
    {
      //@ts-ignore
      insert.run(inc.toString(), JSON.stringify(tileset), tileset.format) 
      inc++
    } 
  })

  insertMany(tilesetsArray, 1)

  const count = db.prepare('SELECT COUNT(*) count FROM Tileset').get()
  t.equal(count.count, 4)
})
