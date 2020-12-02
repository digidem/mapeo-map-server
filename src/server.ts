import 'make-promises-safe'
import createApp from './app'
import './type-extensions' // necessary to make sure that the fastify types are augmented

// Require the framework and instantiate it
const fastify = createApp({
  logger: true,
})

// Run the server!
fastify.listen(3000, function (err, address) {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
  fastify.log.info(`server listening on ${address}`)
})
