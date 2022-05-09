import 'make-promises-safe'

import createMapServer, { MapServerOptions } from './src/app'

const mapServerOpts: MapServerOptions = {
  dbPath: './example.db',
}

// Require the framework and instantiate it
const mapServer = createMapServer({ logger: true }, mapServerOpts)

// Run the server!
mapServer.listen(3000, function (err) {
  if (err) {
    mapServer.log.error(err)
    process.exit(1)
  }
})
