import 'make-promises-safe'

import createServer, { MapServerOptions } from './src/app'

const mapServerOpts: MapServerOptions = {
  dbPath: './example.db',
}

// Require the framework and instantiate it
const mapServer = createServer({ logger: true })(mapServerOpts)

// Run the server!
mapServer.listen(3000, function (err) {
  if (err) {
    mapServer.log.error(err)
    process.exit(1)
  }
})
