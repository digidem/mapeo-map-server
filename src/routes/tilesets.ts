import { FastifyPluginAsync } from 'fastify'
import { TileJSON, TileJSONSchema } from '../lib/tilejson'
import { Static, Type as T } from '@sinclair/typebox'
// import { on } from 'events'

const GetTilesetParamsSchema = T.Object({
  tilesetId: T.String(),
})

const GetTileParamsSchema = T.Object({
  tilesetId: T.String(),
  zoom: T.Number(),
  x: T.Number(),
  y: T.Number(),
})

const PutTilesetParamsSchema = T.Object({
  tilesetId: T.String(),
})

const ImportMBTilesBodySchema = T.Object({
  filePath: T.String(),
})

// const GetImportProgressParamsSchema = T.Object({
//   tilesetId: T.String(),
// })

const tilesets: FastifyPluginAsync = async function (fastify) {
  fastify.get(
    '/',
    {
      schema: {
        response: {
          200: T.Array(TileJSONSchema),
        },
      },
    },
    async function (request) {
      return request.api.listTilesets()
    }
  )

  fastify.get<{ Params: Static<typeof GetTilesetParamsSchema> }>(
    '/:tilesetId',
    {
      schema: {
        params: GetTilesetParamsSchema,
        response: {
          200: TileJSONSchema,
        },
      },
    },
    async function (request) {
      return request.api.getTileset(request.params.tilesetId)
    }
  )

  fastify.post<{ Body: TileJSON }>(
    '/',
    {
      schema: {
        description:
          'Create a new tileset from a TileJSON that references online tiles',
        body: TileJSONSchema,
        response: {
          200: TileJSONSchema,
        },
      },
    },
    async function (request, reply) {
      const { tileset } = await request.api.createTileset(request.body)
      reply.header('Location', `${fastify.prefix}/${tileset.id}`)
      return tileset
    }
  )

  fastify.get<{ Params: Static<typeof GetTileParamsSchema> }>(
    '/:tilesetId/:zoom/:x/:y',
    {
      schema: {
        description: 'Get a single tile from a tileset',
        params: GetTileParamsSchema,
      },
    },
    async function (request, reply) {
      const { data, headers } = await request.api.getTile(request.params)
      // Ignore Etag header from MBTiles
      reply.header('Last-Modified', headers['Last-Modified'])
      reply.header('Content-Type', headers['Content-Type'])
      // These come from https://github.com/mapbox/tiletype
      reply.header('Content-Encoding', headers['Content-Encoding'])
      reply.send(data)
    }
  )

  fastify.put<{
    Body: TileJSON
    Params: Static<typeof PutTilesetParamsSchema>
  }>(
    '/:tilesetId',
    {
      schema: {
        description: 'Update a single tileset using a TileJSON',
        body: TileJSONSchema,
        params: PutTilesetParamsSchema,
      },
    },
    async function (request, reply) {
      const tilejson = await request.api.putTileset(
        request.params.tilesetId,
        request.body
      )
      reply.header('Location', `${fastify.prefix}/${tilejson.id}`)
      return tilejson
    }
  )

  fastify.post<{ Body: Static<typeof ImportMBTilesBodySchema> }>(
    '/import',
    {
      schema: {
        body: ImportMBTilesBodySchema,
        response: {
          200: TileJSONSchema,
        },
      },
    },
    async function (request, reply) {
      const tilejson = await request.api.importMBTiles(request.body.filePath)
      reply.header('Location', `${fastify.prefix}/${tilejson.id}`)
      return tilejson
    }
  )

  // fastify.get<{ Params: Static<typeof GetImportProgressParamsSchema> }>(
  //   '/import/:tilesetId',
  //   {
  //     schema: {
  //       params: GetImportProgressParamsSchema,
  //     },
  //   },
  //   async function (request, reply) {
  //     const emitter = await request.api.getImportProgress(
  //       request.params.tilesetId
  //     )

  //     reply.raw.setHeader('Content-Type', 'text/event-stream')
  //     reply.raw.setHeader('Connection', 'keep-alive')
  //     reply.raw.setHeader('Cache-Control', 'no-cache,no-transform')
  //     reply.raw.setHeader('x-no-compression', 1)

  //     emitter.on('progress', ({ type, ...data }) => {
  //       const finished = data.soFar === data.total

  //       reply.raw.write(`event: ${finished ? 'finished' : type}\n`)

  //       if (data) {
  //         reply.raw.write(`data: ${JSON.stringify(data)}\n`)
  //       }

  //       reply.raw.write('\n')

  //       if (finished) {
  //         reply.raw.end()
  //         emitter.removeAllListeners('progress')
  //       }
  //     })
  //   }
  // )
}

export default tilesets
