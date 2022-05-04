/**
 * Basic script to manually update the "main" field in @maplibre/maplibre-gl-style-spec/package.json
 * because using patch-package causes a variety of issues when running on different machines
 */
const fs = require('fs')
const path = require('path')
const process = require('process')

const PACKAGE_JSON_PATH = path.join(
  // When executing the "postinstall" script, the "process.cwd" equals
  // the package directory, not the parent project where the package is installed.
  // NPM stores the parent project directory in the "INIT_CWD" env variable.
  process.env.INIT_CWD,
  'node_modules/@maplibre/maplibre-gl-style-spec/package.json'
)

const file = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')

const parsed = JSON.parse(file)

fs.writeFileSync(
  PACKAGE_JSON_PATH,
  JSON.stringify({ ...parsed, main: './dist/index.cjs' }, null, 2)
)

console.log(
  'Applied non-traditional patch to @maplibre/maplibre-gl-style-spec/package.json'
)
