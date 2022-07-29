import { FastifyPluginAsync } from 'fastify'
import { TileJSON, TileJSONSchema } from '../lib/tilejson'
import { Static, Type as T } from '@sinclair/typebox'
import { getBaseApiUrl } from '../lib/utils'

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

const ImportMBTilesRequestBodySchema = T.Object({
  filePath: T.String(),
})

const ImportMBTilesResponseBodySchema = T.Object({
  import: T.Object({ id: T.String() }),
  tileset: TileJSONSchema,
})

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
      return this.api.listTilesets(getBaseApiUrl(request))
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
      return this.api.getTileset(
        request.params.tilesetId,
        getBaseApiUrl(request)
      )
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
      const tileset = this.api.createTileset(
        request.body,
        getBaseApiUrl(request)
      )

      this.api.createStyleForTileset(tileset.id, tileset.name)

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
      const { data, headers } = await this.api.getTile(request.params)
      // Ignore Etag header from MBTiles
      reply.header('Last-Modified', headers['Last-Modified'])
      // See getTileHeaders in lib/utils.ts
      reply.header('Content-Type', headers['Content-Type'])
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
      const tilejson = this.api.putTileset(
        request.params.tilesetId,
        request.body,
        getBaseApiUrl(request)
      )
      reply.header('Location', `${fastify.prefix}/${tilejson.id}`)
      return tilejson
    }
  )

  fastify.post<{ Body: Static<typeof ImportMBTilesRequestBodySchema> }>(
    '/import',
    {
      schema: {
        body: ImportMBTilesRequestBodySchema,
        response: {
          200: ImportMBTilesResponseBodySchema,
        },
      },
    },
    async function (request, reply) {
      const result = await this.api.importMBTiles(
        request.body.filePath,
        getBaseApiUrl(request)
      )
      reply.header('Location', `${fastify.prefix}/${result.tileset.id}`)
      return result
    }
  )
}

export default tilesets
