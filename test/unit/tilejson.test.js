// @ts-check
const fs = require('node:fs/promises')
const path = require('node:path')
const test = require('tape')

const {
  validateTileJSON,
  validateVectorLayerSchema,
} = require('../../dist/lib/tilejson')

const fixturesDir = path.join(__dirname, '..', 'fixtures')

test('Bad tileJSON fails validation', async (t) => {
  for await (const { name, data } of readFixturesIn('bad-tilejson')) {
    t.notOk(validateTileJSON(data), `${name} fails validation`)
  }
})

test('Good tileJSON passes validation', async (t) => {
  for await (const { name, data } of readFixturesIn('good-tilejson')) {
    t.ok(validateTileJSON(data), `${name} passes validation`)
  }
})

test('Bad vector layer fails validation', async (t) => {
  for await (const { name, data } of readFixturesIn('bad-vector-layers')) {
    t.notOk(validateVectorLayerSchema(data), `${name} fails validation`)
  }
})

test('Good vector layer passes validation', async (t) => {
  for await (const { name, data } of readFixturesIn('good-vector-layers')) {
    t.ok(validateVectorLayerSchema(data), `${name} passes validation`)
  }
})

/**
 * @param {string} subdir
 * @returns <AsyncGenerator<{ name: string, data: unknown }>>
 */
async function* readFixturesIn(subdir) {
  const dirPath = path.join(fixturesDir, subdir)
  for await (const { name } of await fs.opendir(dirPath)) {
    const fixturePath = path.join(dirPath, name)
    yield {
      name,
      data: JSON.parse(await fs.readFile(fixturePath, 'utf8')),
    }
  }
}
