import 'make-promises-safe'

import createApp from './src/app'

// Require the framework and instantiate it
const fastify = createApp({
  logger: true,
})

// Run the server!
fastify.listen(3000, function (err) {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
})
