import createFastify, { FastifyInstance, FastifyServerOptions } from 'fastify'
import fastifySwagger from '@fastify/swagger'
import FastifyStatic from '@fastify/static'

import './type-extensions' // necessary to make sure that the fastify types are augmented
import api, { type MapServerOptions } from './api'
import { SDF_STATIC_DIR } from './lib/glyphs'
import * as routes from './routes'

function createServer(
  fastifyOpts: FastifyServerOptions = {},
  mapServerOpts: MapServerOptions
): FastifyInstance {
  const fastify = createFastify(fastifyOpts)

  fastify.register(api, mapServerOpts)

  fastify.register(FastifyStatic, {
    // TODO: Does it matter that this uses path.resolve instead of path.join?
    root: SDF_STATIC_DIR,
    prefix: '/fonts',
  })

  fastify.register(fastifySwagger, {
    swagger: {
      info: {
        title: 'Mapeo Map Server',
        // Change when package.json version changes
        version: '1.0.0-alpha.2',
      },
    },
    routePrefix: '/docs',
    exposeRoute: true,
  })

  for (const name of Object.keys(routes) as Array<keyof typeof routes>) {
    fastify.register(routes[name], { prefix: '/' + name })
  }

  return fastify
}

export default createServer

module.exports = createServer

export { type MapServerOptions }
