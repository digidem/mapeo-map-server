import createFastify, { FastifyInstance, FastifyServerOptions } from 'fastify'
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
    root: SDF_STATIC_DIR,
    prefix: '/fonts',
    // res type documented in @fastify/static@5 docs is misleading
    setHeaders: (res: any, path: string) => {
      if (path.toLowerCase().endsWith('.pbf')) {
        res.setHeader('Content-Type', 'application/x-protobuf')
      }
    },
  })

  for (const name of Object.keys(routes) as Array<keyof typeof routes>) {
    fastify.register(routes[name], { prefix: '/' + name })
  }

  return fastify
}

export default createServer

module.exports = createServer

export { type MapServerOptions }
