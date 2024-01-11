import 'make-promises-safe'
import Database from 'better-sqlite3'
import path from 'path'

import createMapServer, { ServerOptions } from './src/app'

const serverOpts: ServerOptions = {
  database: new Database('./example.db'),
  staticStylesDir: path.resolve(__dirname, 'test', 'fixtures', 'static-styles'),
}

// Require the framework and instantiate it
const mapServer = createMapServer({ logger: true }, serverOpts)

// Run the server!
mapServer.listen(3000, function (err) {
  if (err) {
    mapServer.log.error(err)
    process.exit(1)
  }
})
