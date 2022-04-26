/**
 * Basic script to manually update the "main" field in @maplibre/maplibre-gl-style-spec/package.json
 * because using patch-package causes a variety of issues when running on different machines
 */
const fs = require('fs')
const path = require('path')

const PACKAGE_JSON_PATH = path.resolve(
  __dirname,
  '../node_modules/@maplibre/maplibre-gl-style-spec/package.json'
)

const file = fs.readFileSync(PACKAGE_JSON_PATH, { encoding: 'utf8' })

const parsed = JSON.parse(file)

fs.writeFileSync(
  PACKAGE_JSON_PATH,
  JSON.stringify({ ...parsed, main: './dist/index.cjs' }, null, 2)
)

console.log(
  'Applied hacky patch to @maplibre/maplibre-gl-style-spec/package.json'
)
