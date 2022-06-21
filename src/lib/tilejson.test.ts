import fs from 'fs'
import path from 'path'
import test from 'tape'

import { validateTileJSON } from './tilejson'

test('Bad tileJSON fails validation', (t) => {
  const dir = path.join(__dirname, '../fixtures/bad-tilejson')
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const tilejson = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    t.notOk(validateTileJSON(tilejson), `${file} fails validation`)
  }
  t.end()
})

test('Good tileJSON passes validation', (t) => {
  const dir = path.join(__dirname, '../fixtures/good-tilejson')
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const tilejson = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    t.ok(validateTileJSON(tilejson), `${file} passes validation`)
  }
  t.end()
})
