import createFastify, { FastifyInstance, FastifyServerOptions } from 'fastify'
import fastifySwagger from '@fastify/swagger'
import FastifyStatic from '@fastify/static'

import './type-extensions' // necessary to make sure that the fastify types are augmented
import api, { type MapServerOptions } from './api'
import StaticStylesPlugin, { StaticStylesPluginOptions } from './static-styles'
import { SDF_STATIC_DIR } from './lib/glyphs'
import * as routes from './routes'

type ServerOptions = MapServerOptions & Partial<StaticStylesPluginOptions>

function createServer(
  fastifyOpts: FastifyServerOptions = {},
  serverOpts: ServerOptions
): FastifyInstance {
  const fastify = createFastify(fastifyOpts)

  fastify.register(api, serverOpts)

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

  if (serverOpts.staticStylesDir) {
    fastify.register(StaticStylesPlugin, {
      staticStylesDir: serverOpts.staticStylesDir,
      prefix: '/static-styles',
    })
  }

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

export {
  type MapServerOptions,
  type StaticStylesPluginOptions,
  type ServerOptions,
}
