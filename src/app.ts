import createFastify, { FastifyInstance, FastifyServerOptions } from 'fastify'
import fastifySwagger from 'fastify-swagger'
import { FastifySSEPlugin } from 'fastify-sse-v2'

import api, { PluginOptions } from './api'
import * as routes from './routes'
import pkg from '../package.json'

function build(
  opts: FastifyServerOptions = {},
  pluginOpts?: PluginOptions
): FastifyInstance {
  const fastify = createFastify(opts)

  fastify.register(FastifySSEPlugin)

  fastify.register(api, pluginOpts)

  fastify.register(fastifySwagger, {
    swagger: {
      info: {
        title: 'Mapeo Map Server',
        version: pkg.version,
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

export default build
