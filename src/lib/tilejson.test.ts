import fs from 'fs'
import path from 'path'

import tap from 'tap'
import Db, {Database, Options, RunResult} from 'better-sqlite3'

import { validateTileJSON } from './tilejson'

import * as goodFull from '../fixtures/good-tilejson/good-full.json'
import * as goodSimple from '../fixtures/good-tilejson/good-simple.json'
import * as mapboxRaster from '../fixtures/good-tilejson/mapbox_raster_tilejson.json'
import * as openMapTiles from '../fixtures/good-tilejson/openmaptiles_tilejson.json'


const db = new Db('./data/dev.db')


tap.test('Bad tileJSON fails validation', (t) => {
  const dir = path.join(__dirname, '../fixtures/bad-tilejson')
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const tilejson = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    t.notOk(validateTileJSON(tilejson), `${file} fails validation`)
  }
  t.end()
})

tap.test('Good tileJSON passes validation', (t) => {
  const dir = path.join(__dirname, '../fixtures/good-tilejson')
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const tilejson = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    t.ok(validateTileJSON(tilejson), `${file} passes validation`)
  }
  t.end()
})

tap.test('seed db with tileJson', (t)=>
{
  const tilesetsArray = [goodFull, goodSimple, mapboxRaster, openMapTiles]
  
  db.prepare('DELETE FROM Tileset').run()
  const insert = db.prepare('INSERT INTO Tileset (id, tilejson, format) VALUES (?, ?, ?)');
  const insertMany = db.transaction((tilesets:Object[], inc:number)=>
  {
    for(const tileset of tilesets){
      //@ts-ignore
      insert.run(inc.toString(), JSON.stringify(tileset), tileset.format) 
      inc++
    } 
  })

  insertMany(tilesetsArray, 1)

  const count = db.prepare('SELECT COUNT(*) count FROM Tileset').get()
  t.equal(count.count, 4)
  
  db.prepare('DELETE FROM Tileset WHERE id = 1 ').run()

  const count1 = db.prepare('SELECT COUNT(*) count FROM Tileset').get()
  t.equal(count1.count, 3)

  db.prepare('DELETE FROM Tileset').run()
  t.end()
})
