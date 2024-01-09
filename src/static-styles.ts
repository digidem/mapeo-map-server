import path from 'path'
import fp from 'fastify-plugin'
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { Static, Type as T } from '@sinclair/typebox'
import FastifyStatic from '@fastify/static'
import asar from '@electron/asar'
// TODO: Need NodeNext module resolution enabled in order to do 'mime/lite'
import mime from 'mime'

import { NotFoundError } from './api/errors'

export interface StaticStylesPluginOptions {
  staticStylesDir: string
}

function extractAsarFile(archive: string, filename: string) {
  try {
    return asar.extractFile(archive, filename)
  } catch (err) {
    return undefined
  }
}

function getStyleTileInfo(
  baseDirectory: string,
  params: Static<typeof GetStaticStyleTileParamsSchema>
): null | {
  data: Buffer
  mimeType: string | null
  shouldGzip: boolean
} {
  const { id, tileId, z, y, x } = params
  let { ext } = params

  const fileBasename = path.join(z.toString(), y.toString(), x.toString())
  const asarPath = path.join(baseDirectory, id, 'tiles', tileId + '.asar')

  let data: Buffer | undefined

  if (ext) {
    data = extractAsarFile(asarPath, fileBasename + '.' + ext)
  } else {
    // Try common extensions
    const extensions = ['png', 'jpg', 'jpeg']

    for (const e of extensions) {
      data = extractAsarFile(asarPath, fileBasename + '.' + e)

      // Match found, use the corresponding extension moving forward
      if (data) {
        ext = e
        break
      }
    }
  }

  // extension check isn't fully necessary since the buffer will only exist if the extension exists
  // but useful to check for types reasons
  if (!data || !ext) {
    return null
  }

  const mimeType = mime.getType(ext)

  // Set gzip encoding on {mvt,pbf} tiles.
  const shouldGzip = /mvt|pbf$/.test(ext)

  return { data, mimeType, shouldGzip }
}

const GetStaticStyleTileParamsSchema = T.Object({
  id: T.String(),
  tileId: T.String(),
  z: T.Number(),
  y: T.Number(),
  x: T.Number(),
  ext: T.Optional(T.String()),
})

const StaticStylesPlugin: FastifyPluginAsync<
  StaticStylesPluginOptions
> = async (fastify, { staticStylesDir }) => {
  if (!staticStylesDir) throw new Error('Need to provide staticStylesDir')

  /// Plugin-scoped helpers

  async function handleStyleTileGet(
    req: FastifyRequest<{
      Params: Static<typeof GetStaticStyleTileParamsSchema>
    }>,
    res: FastifyReply
  ) {
    const result = getStyleTileInfo(staticStylesDir, req.params)

    if (!result) {
      const { tileId, z, x, y, ext } = req.params
      throw new NotFoundError(
        `Tileset id = ${tileId}, ext=${ext}, [${z}, ${x}, ${y}]`
      )
    }

    const { data, mimeType, shouldGzip } = result

    if (mimeType) {
      res.header('Content-Type', mimeType)
    }

    if (shouldGzip) {
      res.header('Content-Encoding', 'gzip')
    }

    res.send(data)
  }

  /// Registered routes

  fastify.get<{
    Params: Static<typeof GetStaticStyleTileParamsSchema>
  }>(
    `/:id/tiles/:tileId/:z/:y/:x.:ext`,
    { schema: { params: GetStaticStyleTileParamsSchema } },
    handleStyleTileGet
  )

  fastify.get<{
    Params: Static<typeof GetStaticStyleTileParamsSchema>
  }>(
    `/:id/tiles/:tileId/:z/:y/:x`,
    { schema: { params: GetStaticStyleTileParamsSchema } },
    handleStyleTileGet
  )

  fastify.register(FastifyStatic, {
    root: staticStylesDir,
    decorateReply: false,
  })
}

export default fp(
  async function (fastify, opts: StaticStylesPluginOptions) {
    // Needed in order for route prefix to work
    // https://fastify.dev/docs/latest/Reference/Routes/#route-prefixing
    fastify.register(StaticStylesPlugin, opts)
  },
  {
    fastify: '3.x',
    name: 'static-styles',
  }
)
