import { readFileSync } from 'fs'
import path from 'path'
import createFastify, { FastifyInstance, FastifyServerOptions } from 'fastify'
import fastifySwagger from 'fastify-swagger'

import './type-extensions' // necessary to make sure that the fastify types are augmented
import api, { PluginOptions } from './api'
import * as routes from './routes'

const version = JSON.parse(
  readFileSync(path.resolve(__dirname, '../package.json'), {
    encoding: 'utf-8',
  })
).version

function build(
  opts: FastifyServerOptions = {},
  pluginOpts?: PluginOptions
): FastifyInstance {
  const fastify = createFastify(opts)

  fastify.register(api, pluginOpts)

  fastify.register(fastifySwagger, {
    swagger: {
      info: {
        title: 'Mapeo Map Server',
        version,
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
