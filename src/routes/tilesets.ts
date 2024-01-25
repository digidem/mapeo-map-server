import { FastifyPluginAsync } from 'fastify'
import { HTTPError } from 'got'

import { Static, Type as T } from '@sinclair/typebox'
import {
  NotFoundError,
  createForwardedUpstreamError,
  isOfflineError,
} from '../api/errors'
import { TileJSON, TileJSONSchema } from '../lib/tilejson'
import { getBaseApiUrl } from '../lib/utils'

const GetTilesetParamsSchema = T.Object({
  tilesetId: T.String(),
})

// Clients like Mapbox will pass the access token in the querystring
// but at the moment, we do not use it for anything since the persisted
// upstream url will already have it included if required
const GetTilesetQuerystringSchema = T.Object({
  access_token: T.Optional(T.String()),
})

const GetTileParamsSchema = T.Object({
  tilesetId: T.String(),
  zoom: T.Number(),
  x: T.Number(),
  y: T.Number(),
})

// Clients like Mapbox will pass the access token in the querystring
// but at the moment, we do not use it for anything since the persisted
// upstream url will already have it included if required
const GetTileQuerystringSchema = T.Object({
  access_token: T.Optional(T.String()),
})

const PutTilesetParamsSchema = T.Object({
  tilesetId: T.String(),
})

const ImportMBTilesRequestBodySchema = T.Object({
  filePath: T.String(),
})

const ImportMBTilesResponseBodySchema = T.Object({
  import: T.Object({ id: T.String() }),
  style: T.Union([T.Object({ id: T.String() }), T.Null()]),
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

  fastify.get<{
    Params: Static<typeof GetTilesetParamsSchema>
    Querystring: Static<typeof GetTilesetQuerystringSchema>
  }>(
    '/:tilesetId',
    {
      schema: {
        response: {
          200: TileJSONSchema,
        },
        params: GetTilesetParamsSchema,
        querystring: GetTilesetQuerystringSchema,
      },
    },
    async function (request) {
      return this.api.getTileset(
        request.params.tilesetId,
        getBaseApiUrl(request)
      )
    }
  )

  // TODO: Update body to include an optional `upstreamUrl` field so that we can fetch from upstream?
  fastify.post<{ Body: TileJSON }>(
    '/',
    {
      schema: {
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

      this.api.createStyleForTileset(tileset, tileset.name)

      reply.header('Location', `${fastify.prefix}/${tileset.id}`)
      return tileset
    }
  )

  fastify.get<{
    Params: Static<typeof GetTileParamsSchema>
    Querystring: Static<typeof GetTileQuerystringSchema>
  }>(
    '/:tilesetId/:zoom/:x/:y',
    {
      schema: {
        params: GetTileParamsSchema,
        querystring: GetTileQuerystringSchema,
      },
    },
    async function (request, reply) {
      try {
        const { data, headers } = await this.api.getTile(request.params)
        // Ignore Etag header from MBTiles
        reply.header('Last-Modified', headers['Last-Modified'])
        // See getTileHeaders in lib/utils.ts
        reply.header('Content-Type', headers['Content-Type'])
        reply.header('Content-Encoding', headers['Content-Encoding'])
        reply.send(data)
      } catch (err) {
        if (isOfflineError(err)) {
          const { tilesetId, zoom, x, y } = request.params

          throw new NotFoundError(
            `Tileset id = ${tilesetId}, [${zoom}, ${x}, ${y}]`
          )
        }

        // Handle upstream error
        if (err instanceof HTTPError) {
          const { statusCode: upstreamStatusCode } = err.response

          // If the upstream status code is 4XX or 5XX, we return a 404
          // with information about the upstream error in the body
          const statusCodeToReturn =
            upstreamStatusCode >= 400 && upstreamStatusCode < 600
              ? 404
              : upstreamStatusCode

          throw new (createForwardedUpstreamError(statusCodeToReturn))(
            err.response.url,
            err.message
          )
        }

        throw err
      }
    }
  )

  fastify.put<{
    Body: TileJSON
    Params: Static<typeof PutTilesetParamsSchema>
  }>(
    '/:tilesetId',
    {
      schema: {
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
