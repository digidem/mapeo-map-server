import { FastifyInstance } from 'fastify'
import got from 'got'

import { isMapboxURL, normalizeSourceURL } from '../lib/mapbox_urls'
import {
  DEFAULT_RASTER_SOURCE_ID,
  StyleJSON,
  createIdFromStyleUrl,
  createRasterStyle,
  uncompositeStyle,
} from '../lib/stylejson'
import { validateTileJSON } from '../lib/tilejson'
import { encodeBase32, generateId, getTilesetId, hash } from '../lib/utils'
import { Api, Context, IdResource } from '.'
import {
  AlreadyExistsError,
  MBAccessTokenRequiredError,
  NotFoundError,
  ParseError,
  UnsupportedSourceError,
} from './errors'

interface SourceIdToTilesetId {
  [sourceId: keyof StyleJSON['sources']]: string
}

export interface StylesApi {
  createStyle(
    style: StyleJSON,
    options?: {
      accessToken?: string
      etag?: string
      id?: string
      upstreamUrl?: string
    }
  ): Promise<{ style: StyleJSON } & IdResource>
  createStyleForTileset(
    tilesetId: string,
    nameForStyle?: string
  ): { style: StyleJSON } & IdResource
  deleteStyle(id: string): void
  getStyle(id: string): StyleJSON
  listStyles(): Array<
    {
      bytesStored: number
      name: string | null
      url: string
    } & IdResource
  >
  updateStyle(id: string, style: StyleJSON): Promise<StyleJSON>
}

function createStylesApi({
  api,
  apiUrl,
  context,
  fastify,
}: {
  api: Pick<Api, 'createTileset'>
  apiUrl: string
  context: Context
  fastify: FastifyInstance
}): StylesApi {
  const { db } = context

  function getStyleUrl(styleId: string): string {
    return `${apiUrl}/styles/${styleId}`
  }

  function getTilesetUrl(tilesetId: string): string {
    return `${apiUrl}/tilesets/${tilesetId}`
  }

  function styleExists(styleId: string) {
    return (
      db
        .prepare('SELECT COUNT(*) AS count FROM Style WHERE id = ?')
        .get(styleId).count > 0
    )
  }

  function addOfflineUrls({
    sourceIdToTilesetId,
    style,
  }: {
    sourceIdToTilesetId: SourceIdToTilesetId
    style: StyleJSON
  }): StyleJSON {
    const updatedSources: StyleJSON['sources'] = {}

    for (const sourceId of Object.keys(style.sources)) {
      const source = style.sources[sourceId]

      const tilesetId = sourceIdToTilesetId[sourceId]

      const includeUrlField =
        tilesetId && ['vector', 'raster', 'raster-dem'].includes(source.type)

      updatedSources[sourceId] = {
        ...source,
        ...(includeUrlField ? { url: getTilesetUrl(tilesetId) } : undefined),
      }
    }

    // TODO: Remap glyphs and sprite URLs to map server
    return {
      ...style,
      sources: updatedSources,
    }
  }

  function tilesetExists(tilesetId: string) {
    return (
      db
        .prepare('SELECT COUNT(*) AS count FROM Tileset WHERE id = ?')
        .get(tilesetId).count > 0
    )
  }

  async function createOfflineSources({
    accessToken,
    sources,
  }: {
    accessToken?: string
    sources: StyleJSON['sources']
  }): Promise<SourceIdToTilesetId> {
    const sourceIdToTilesetId: SourceIdToTilesetId = {}

    for (const sourceId of Object.keys(sources)) {
      const source = sources[sourceId]

      // TODO:
      // - Support vector sources
      // - Should we continue instead of throw if the source is vector?
      if (!(source.type === 'raster')) {
        throw new UnsupportedSourceError(
          `Currently only sources of type 'raster' are supported, and this style.json has a source '${sourceId}' of type '${source.type}'`
        )
      }
      if (typeof source.url !== 'string') {
        throw new UnsupportedSourceError(
          `Currently only sources defined with \`source.url\` are supported (referencing a TileJSON), but this style.json has a source '${sourceId}' that does not have a \`url\` property`
        )
      }
      if (isMapboxURL(source.url) && !accessToken) {
        throw new MBAccessTokenRequiredError()
      }

      const upstreamUrl = normalizeSourceURL(source.url, accessToken)

      const tilejson = await got(upstreamUrl).json()

      if (!validateTileJSON(tilejson)) {
        // TODO: Write these errors to UnsupportedSourceError.message

        throw new UnsupportedSourceError(
          `Invalid TileJSON at '${source.url}' for source '${sourceId}'`
        )
      }

      // We try to get an idempotent ID for each source, so that we only create
      // one offline copy of sources that are referenced from multiple styles,
      // e.g. lots of styles created on Mapbox will use the
      // mapbox.mapbox-streets-v7 source
      const tilesetId = getTilesetId(tilejson)

      if (!tilesetExists(tilesetId)) {
        api.createTileset(tilejson)
      } else {
        // TODO: Should we update an existing tileset here?
        // api.putTileset(tilesetId, tilejson)
      }
      sourceIdToTilesetId[sourceId] = tilesetId
    }

    return sourceIdToTilesetId
  }

  return {
    async createStyle(style, { accessToken, etag, id, upstreamUrl } = {}) {
      const styleId =
        id || (upstreamUrl ? createIdFromStyleUrl(upstreamUrl) : generateId())

      if (styleExists(styleId)) {
        throw new AlreadyExistsError(
          `Style already exists. PUT changes to ${fastify.prefix}/${styleId} to modify this style`
        )
      }

      const sourceIdToTilesetId = await createOfflineSources({
        accessToken,
        sources: style.sources,
      })

      const styleToSave: StyleJSON = await uncompositeStyle(style)

      db.prepare<{
        id: string
        stylejson: string
        etag?: string
        upstreamUrl?: string
        sourceIdToTilesetId: string
      }>(
        'INSERT INTO Style (id, stylejson, etag, upstreamUrl, sourceIdToTilesetId) VALUES (:id, :stylejson, :etag, :upstreamUrl, :sourceIdToTilesetId)'
      ).run({
        id: styleId,
        stylejson: JSON.stringify(styleToSave),
        etag,
        upstreamUrl,
        sourceIdToTilesetId: JSON.stringify(sourceIdToTilesetId),
      })

      return {
        style: addOfflineUrls({
          sourceIdToTilesetId,
          style: styleToSave,
        }),
        id: styleId,
      }
    },
    // TODO: Ideally could consolidate with createStyle
    createStyleForTileset(tilesetId, nameForStyle) {
      const styleId = encodeBase32(hash(`style:${tilesetId}`))

      // TODO: Come up with better default name?
      const styleName = nameForStyle || `Style ${tilesetId.slice(-4)}`

      const style = createRasterStyle({
        name: styleName,
        url: `mapeo://tilesets/${tilesetId}`,
      })

      db.prepare<{
        id: string
        sourceIdToTilesetId: string
        stylejson: string
      }>(
        'INSERT INTO Style (id, sourceIdToTilesetId, stylejson) VALUES (:id, :sourceIdToTilesetId, :stylejson)'
      ).run({
        id: styleId,
        sourceIdToTilesetId: JSON.stringify({
          [DEFAULT_RASTER_SOURCE_ID]: tilesetId,
        }),
        stylejson: JSON.stringify(style),
      })

      return { id: styleId, style }
    },
    deleteStyle(id: string) {
      if (!styleExists(id)) {
        throw new NotFoundError(id)
      }

      // TODO
      // - Delete any orphaned tilesets and sprites
      // - How to handle glpyhs here?
      const deleteStyleTransaction = db.transaction(() => {
        db.prepare(
          'DELETE FROM Import WHERE areaId IN (SELECT id FROM OfflineArea WHERE styleId = ?)'
        ).run(id)
        db.prepare('DELETE FROM OfflineArea WHERE styleId = ?').run(id)
        db.prepare('DELETE FROM Style WHERE id = ?').run(id)
      })

      deleteStyleTransaction()
    },
    getStyle(id) {
      const row:
        | {
            id: string
            stylejson: string
            sourceIdToTilesetId: string
          }
        | undefined = db
        .prepare(
          'SELECT id, stylejson, sourceIdToTilesetId FROM Style WHERE id = ?'
        )
        .get(id)

      if (!row) {
        throw new NotFoundError(id)
      }

      let style: StyleJSON
      let sourceIdToTilesetId: SourceIdToTilesetId

      try {
        style = JSON.parse(row.stylejson)
        sourceIdToTilesetId = JSON.parse(row.sourceIdToTilesetId)
      } catch (err) {
        throw new ParseError(err)
      }

      return addOfflineUrls({
        sourceIdToTilesetId,
        style,
      })
    },
    listStyles() {
      // `bytesStored` calculates the total bytes stored by tiles that the style references
      // Eventually we want to get storage taken up by other resources like sprites and glyphs
      return db
        .prepare(
          `
          SELECT Style.id,
            json_extract(Style.stylejson, '$.name') as name,
            (
              SELECT SUM(LENGTH(TileData.data))
              FROM TileData
              JOIN (
                SELECT S2.id AS styleId, StyleReferencedTileset.value AS tilesetId
                FROM Style S2, json_each(S2.sourceIdToTilesetId, '$') AS StyleReferencedTileset
              ) AS SourceTileset ON SourceTileset.tilesetId = TileData.tilesetId
              JOIN Style S1 ON S1.id = SourceTileset.styleId
              WHERE SourceTileset.styleId = Style.id
            ) AS bytesStored
          FROM Style;
          `
        )
        .all()
        .map(
          (row: {
            id: string
            bytesStored: number | null
            name: string | null
          }) => ({
            ...row,
            bytesStored: row.bytesStored || 0,
            url: getStyleUrl(row.id),
          })
        )
    },
    // TODO: May need to accept an access token
    async updateStyle(id, style) {
      if (!styleExists(id)) {
        throw new NotFoundError(id)
      }

      const sourceIdToTilesetId = await createOfflineSources({
        sources: style.sources,
      })

      const styleToSave: StyleJSON = await uncompositeStyle(style)

      db.prepare<{
        id: string
        sourceIdToTilesetId: string
        stylejson: string
      }>(
        'UPDATE Style SET stylejson = :stylejson, sourceIdToTilesetId = :sourceIdToTilesetId WHERE id = :id'
      ).run({
        id,
        sourceIdToTilesetId: JSON.stringify(sourceIdToTilesetId),
        stylejson: JSON.stringify(styleToSave),
      })

      return addOfflineUrls({
        sourceIdToTilesetId,
        style: styleToSave,
      })
    },
  }
}
export default createStylesApi
