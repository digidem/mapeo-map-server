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
  db.transaction(()=>{
    db.prepare('DELETE FROM TilesetsOnStyles').run()
    db.prepare('DELETE FROM Style').run()
    db.prepare('DELETE FROM Tile').run()
    db.prepare('DELETE FROM TileData').run()
    db.prepare('DELETE FROM Tileset').run()
    
    
  })()
 
  const insertTileSet = db.prepare('INSERT INTO Tileset (id, tilejson, format) VALUES (?, ?, ?)');
  const insertTile = db.prepare('INSERT INTO Tile (quadKey, tileHash, tilesetId) VALUES (?,?,?)');
  const insertTileData = db.prepare('INSERT INTO TileData (tileHash, data, tilesetId) VALUES (?,?,?)');
  const insertStyle = db.prepare('INSERT INTO Style (id, stylejson) VALUES(?,?)')
  const insertTilesetsOnStyles = db.prepare('INSERT INTO TilesetsOnStyles (tilesetId, styleId) VALUES(?,?)')
  const insertMany = db.transaction((tilesets:Object[], inc:number)=>
  {
    for(const tileset of tilesets){
      const random = 'asdfals'
      const quadKey =  inc+random
      const tileHash =  inc+random+inc+inc
      const tilesetId = inc.toString()
      const styleId = (inc*5).toString()
      //@ts-ignore
      insertTileSet.run(tilesetId, JSON.stringify(tileset), tileset.format) 
      insertTileData.run(tileHash, Buffer.from(inc.toString(), "utf-8"), tilesetId)
      insertTile.run(quadKey, tileHash, tilesetId)
      insertStyle.run(styleId, JSON.stringify({}))
      if(inc === 3)
      {
        insertTilesetsOnStyles.run(tilesetId, ((inc-1)*5).toString())
      }
      else
      {
        insertTilesetsOnStyles.run(tilesetId, styleId)

      }
      inc++
    } 
  })

  insertMany(tilesetsArray, 1)

  let count = db.prepare('SELECT COUNT(*) count FROM Tileset').get()
  t.equal(count.count, 4)

  count = db.prepare('SELECT COUNT(*) count FROM TilesetsOnStyles').get()
  t.equal(count.count, 4)
  
  const deleteSingleRecord = db.transaction((id:string)=>
  {
    db.prepare('DELETE FROM Tile WHERE tilesetId = ? ').run(id) 
    db.prepare('DELETE FROM TileData WHERE tilesetId = ? ').run(id) 
    db.prepare('DELETE FROM Tileset WHERE id = ? ').run(id)  
    db.prepare('DELETE FROM TilesetsOnStyles ').run()
    db.prepare('DELETE FROM Style').run()
  })

  // deleteSingleRecord("2")

  // count = db.prepare('SELECT COUNT(*) count FROM Tileset').get()
  // t.equal(count.count, 3)



  //@ts-ignore
  // const updateTables = db.transaction((id:string)=>
  // {
  //   // db.prepare('UPDATE TileData SET tilesetId = ? WHERE tilesetId=1').run(id)

  //   // db.prepare('UPDATE Tile SET tilesetId = ? WHERE tilesetId=1').run(id)

  //   db.prepare('UPDATE Tileset SET id = ? WHERE id=1').run(id)
  // })

  // updateTables("99")





  

  // const count1 = db.prepare('SELECT COUNT(*) count FROM Tileset').get()
  // t.equal(count1.count, 3)

  // db.prepare('DELETE FROM Tileset').run()
  t.end()
})
