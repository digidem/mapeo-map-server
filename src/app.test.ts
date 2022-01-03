import { test, beforeEach, afterEach } from 'tap'
import tmp from 'tmp'
import { NotFoundError } from './api'

import app from './app'
import mapboxRasterTilejson from './fixtures/good-tilejson/mapbox_raster_tilejson.json'
import { getTilesetId } from './lib/tilestore'

tmp.setGracefulCleanup()

beforeEach((done, t) => {
  const { name: dataDir } = tmp.dirSync({ unsafeCleanup: true })
  t.context.app = app({ logger: false }, { dataDir })
  done()
})

afterEach((done, t) => {
  t.context.app.close().then(done)
})

test('GET /tilesets (empty)', async (t) => {
  const { app } = t.context

  const response = await app.inject({ method: 'GET', url: '/tilesets' })
  t.strictEqual(response.statusCode, 200, 'returns a status code of 200')
  t.strictEqual(
    response.headers['content-type'],
    'application/json; charset=utf-8',
    'returns correct content-type header'
  )
  t.deepEqual(response.json(), [], 'returns empty array')
})

test('POST /tilesets', async (t) => {
  const { app }= t.context

  // @ts-ignore
  const expectedId = getTilesetId(mapboxRasterTilejson)
  const expectedTileUrl = `http://localhost:80/tilesets/${expectedId}/{z}/{x}/{y}`
  const expectedResponse = {
    ...mapboxRasterTilejson,
    id: expectedId,
    tiles: [expectedTileUrl],
  }

  const response = await app.inject({
    method: 'POST',
    url: '/tilesets',
    payload: mapboxRasterTilejson,
  })
  t.deepEqual(response.json(), expectedResponse)
})

test('GET /styles/', async (t)=>
{
  const {app} = t.context

  const response = await app.inject({
    method:"GET",
    url:'/styles/0/sprite'
  })
  console.log(response)
  t.equal(response, NotFoundError)
})
