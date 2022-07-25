const fs = require('fs')
const path = require('path')
const test = require('tape')

const { validate } = require('../../dist/lib/stylejson')

test('Bad styleJSON fails validation', (t) => {
  t.pass('TODO: Add bad StyleJSON fixtures')
  t.end()
})

test('Good styleJSON passes validation', (t) => {
  const dir = path.join(__dirname, '../fixtures/good-stylejson')
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const stylejson = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    validate(stylejson)
    t.pass(`${file} passes validation`)
  }
  t.end()
})
