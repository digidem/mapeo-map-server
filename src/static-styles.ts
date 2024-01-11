import path from 'path'
import { Stats, promises as fs } from 'fs'
import fp from 'fastify-plugin'
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { Static, Type as T } from '@sinclair/typebox'
import FastifyStatic from '@fastify/static'
import asar from '@electron/asar'
// TODO: Need NodeNext module resolution enabled in order to do 'mime/lite'
import mime from 'mime'

import { NotFoundError } from './api/errors'
import { getBaseApiUrl } from './lib/utils'

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

const ListStaticStylesReplySchema = T.Array(
  T.Object({
    id: T.String(),
    name: T.Union([T.String(), T.Null()]),
    url: T.String(),
  })
)

const GetStyleJsonParamsSchema = T.Object({
  id: T.String(),
})

const routes: FastifyPluginAsync<StaticStylesPluginOptions> = async (
  fastify,
  { staticStylesDir }
) => {
  /// Plugin-scoped helpers

  const normalizedPrefix = fastify.prefix.endsWith('/')
    ? fastify.prefix
    : fastify.prefix + '/'

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
    Reply: Static<typeof ListStaticStylesReplySchema>
  }>(
    '/',
    { schema: { response: { 200: ListStaticStylesReplySchema } } },
    async (req) => {
      const styleDirFiles = await fs.readdir(staticStylesDir)

      const result = (
        await Promise.all(
          styleDirFiles.map(async (filename) => {
            const stat = await fs.stat(path.join(staticStylesDir, filename))
            if (!stat.isDirectory()) return null

            let styleJson

            try {
              const styleJsonContent = await fs.readFile(
                path.join(staticStylesDir, filename, 'style.json'),
                'utf-8'
              )

              styleJson = JSON.parse(styleJsonContent)
            } catch (err) {
              return null
            }

            return {
              id: filename,
              name: typeof styleJson.name === 'string' ? styleJson.name : null,
              // TODO: What should this URL point to?
              url: new URL(normalizedPrefix + filename, getBaseApiUrl(req))
                .href,
            }
          })
        )
      ).filter(
        <V extends Static<typeof ListStaticStylesReplySchema>[number] | null>(
          v: V
        ): v is NonNullable<V> => v !== null
      )

      return result
    }
  )

  fastify.get<{ Params: Static<typeof GetStyleJsonParamsSchema> }>(
    `/:id/style.json`,
    { schema: { params: GetStyleJsonParamsSchema } },
    async (req, res) => {
      const { id } = req.params

      let stat: Stats
      let data: string | Buffer

      try {
        const filePath = path.join(staticStylesDir, id, 'style.json')
        stat = await fs.stat(filePath)
        data = await fs.readFile(filePath, 'utf-8')
      } catch (err) {
        throw new NotFoundError(`id = ${id}, style.json`)
      }

      data = Buffer.from(
        data.replace(
          /\{host\}/gm,
          'http://' + req.headers.host + normalizedPrefix + id
        )
      )
      res.header('Content-Type', 'application/json; charset=utf-8')
      res.header('Last-Modified', new Date(stat.mtime).toUTCString())
      res.header('Cache-Control', 'max-age=' + 5 * 60) // 5 minutes
      res.header('Content-Length', data.length)
      res.header(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, If-Match, If-Modified-Since, If-None-Match, If-Unmodified-Since'
      )
      res.header('Access-Control-Allow-Origin', '*')

      res.send(data)
    }
  )

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

const StaticStylesPlugin: FastifyPluginAsync<
  StaticStylesPluginOptions
> = async (fastify, opts) => {
  if (!opts.staticStylesDir) throw new Error('Need to provide staticStylesDir')

  // Needed in order for route prefix to work
  // https://fastify.dev/docs/latest/Reference/Routes/#route-prefixing
  fastify.register(routes, opts)
}

export default fp(StaticStylesPlugin, {
  fastify: '3.x',
  name: 'static-styles',
})
