import { Api } from './api'

// This extends the Fastify Request type to include a property for our API
declare module 'fastify' {
  interface FastifyInstance {
    api: Api
  }
}
