import { isMapboxURL, normalizeSourceURL } from '../lib/mapbox_urls'
import {
  StyleJSON,
  createIdFromStyleUrl,
  createRasterStyle,
  createVectorStyle,
  uncompositeStyle,
} from '../lib/stylejson'
import { TileJSON, validateTileJSON } from '../lib/tilejson'
import { encodeBase32, generateId, getTilesetId, hash } from '../lib/utils'
import { Api, Context, IdResource } from '.'
import {
  AlreadyExistsError,
  MBAccessTokenRequiredError,
  NotFoundError,
  ParseError,
  UnsupportedSourceError,
} from './errors'
import { generateSpriteId } from '../lib/sprites'

interface SourceIdToTilesetId {
  [sourceId: keyof StyleJSON['sources']]: string
}

export interface StylesApi {
  createStyle(
    style: StyleJSON,
    baseApiUrl: string,
    options?: {
      accessToken?: string
      etag?: string
      id?: string
      upstreamUrl?: string
    }
  ): Promise<{ style: StyleJSON } & IdResource>
  createStyleForTileset(
    tilejson: TileJSON & IdResource,
    nameForStyle?: string
  ): { style: StyleJSON } & IdResource
  deleteStyle(id: string, baseApiUrl: string): void
  getStyle(id: string, baseApiUrl: string): StyleJSON
  listStyles(baseApiUrl: string): Array<
    {
      bytesStored: number
      name: string | null
      url: string
    } & IdResource
  >
  updateStyle(
    id: string,
    style: StyleJSON,
    baseApiUrl: string
  ): Promise<StyleJSON>
}

function createStylesApi({
  api,
  context,
}: {
  api: Pick<Api, 'createTileset'>
  context: Context
}): StylesApi {
  const { db, upstreamRequestsManager } = context

  function getStyleUrl(baseApiUrl: string, styleId: string): string {
    return `${baseApiUrl}/styles/${styleId}`
  }

  function getSpriteUrl(
    baseApiUrl: string,
    {
      styleId,
      spriteId,
    }: {
      styleId: string
      spriteId: string
    }
  ): string {
    return `${getStyleUrl(baseApiUrl, styleId)}/sprites/${spriteId}`
  }

  function getTilesetUrl(baseApiUrl: string, tilesetId: string): string {
    return `${baseApiUrl}/tilesets/${tilesetId}`
  }

  function getGlyphsUrl(baseApiUrl: string, styleId?: string) {
    // The GET /fonts api uses this search param to figure out how to make upstream requests
    const searchParams = styleId
      ? `?${new URLSearchParams({ styleId }).toString()}`
      : ''

    return `${baseApiUrl}/fonts/{fontstack}/{range}.pbf${searchParams}`
  }

  function styleExists(styleId: string) {
    return (
      db
        .prepare('SELECT COUNT(*) AS count FROM Style WHERE id = ?')
        .get(styleId).count > 0
    )
  }

  function addOfflineUrls(
    baseApiUrl: string,
    {
      sourceIdToTilesetId,
      spriteId,
      style,
      styleId,
    }: {
      sourceIdToTilesetId: SourceIdToTilesetId
      spriteId?: string
      style: StyleJSON
      styleId: string
    }
  ): StyleJSON {
    const updatedSources: StyleJSON['sources'] = {}

    for (const sourceId of Object.keys(style.sources)) {
      const source = style.sources[sourceId]

      const tilesetId = sourceIdToTilesetId[sourceId]

      const includeUrlField =
        tilesetId && ['vector', 'raster', 'raster-dem'].includes(source.type)

      updatedSources[sourceId] = {
        ...source,
        ...(includeUrlField
          ? { url: getTilesetUrl(baseApiUrl, tilesetId) }
          : undefined),
      }
    }

    return {
      ...style,
      sources: updatedSources,
      sprite: spriteId
        ? getSpriteUrl(baseApiUrl, { styleId, spriteId })
        : undefined,
      glyphs: style.glyphs ? getGlyphsUrl(baseApiUrl, styleId) : undefined,
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
    baseApiUrl,
    sources,
  }: {
    accessToken?: string
    baseApiUrl: string
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

      const normalizedUpstreamSourceUrl = normalizeSourceURL(
        source.url,
        accessToken
      )

      const tilesetResponse = await upstreamRequestsManager.getUpstream({
        url: normalizedUpstreamSourceUrl,
        responseType: 'json',
      })

      if (!validateTileJSON(tilesetResponse.data)) {
        // TODO: Write these errors to UnsupportedSourceError.message

        throw new UnsupportedSourceError(
          `Invalid TileJSON at '${source.url}' for source '${sourceId}'`
        )
      }

      // We try to get an idempotent ID for each source, so that we only create
      // one offline copy of sources that are referenced from multiple styles,
      // e.g. lots of styles created on Mapbox will use the
      // mapbox.mapbox-streets-v7 source
      const tilesetId = getTilesetId(tilesetResponse.data)

      if (!tilesetExists(tilesetId)) {
        api.createTileset(tilesetResponse.data, baseApiUrl, {
          etag: tilesetResponse.etag,
          // Using the normalized url here means that the querystrings
          // that may contain platform-specific parameters (e.g. access token)
          // will be persisted in the db, allowing them to be reused by other styles.
          upstreamUrl: normalizedUpstreamSourceUrl,
        })
      } else {
        // TODO: Should we update an existing tileset here?
        // api.putTileset(tilesetId, tilejson)
      }
      sourceIdToTilesetId[sourceId] = tilesetId
    }

    return sourceIdToTilesetId
  }

  return {
    async createStyle(
      style,
      baseApiUrl,
      { accessToken, etag, id, upstreamUrl } = {}
    ) {
      const styleId =
        id || (upstreamUrl ? createIdFromStyleUrl(upstreamUrl) : generateId())

      if (styleExists(styleId)) {
        throw new AlreadyExistsError(
          `Style already exists. PUT changes to /styles/${styleId} to modify this style`
        )
      }

      const spriteId = style.sprite ? generateSpriteId(style.sprite) : undefined

      const sourceIdToTilesetId = await createOfflineSources({
        accessToken,
        baseApiUrl,
        sources: style.sources,
      })

      const styleToSave: StyleJSON = await uncompositeStyle(style)

      db.prepare<{
        id: string
        stylejson: string
        spriteId?: string
        etag?: string
        upstreamUrl?: string
        sourceIdToTilesetId: string
      }>(
        'INSERT INTO Style (id, stylejson, spriteId, etag, upstreamUrl, sourceIdToTilesetId) ' +
          'VALUES (:id, :stylejson, :spriteId, :etag, :upstreamUrl, :sourceIdToTilesetId)'
      ).run({
        id: styleId,
        stylejson: JSON.stringify(styleToSave),
        spriteId,
        etag,
        upstreamUrl,
        sourceIdToTilesetId: JSON.stringify(sourceIdToTilesetId),
      })

      return {
        id: styleId,
        style: addOfflineUrls(baseApiUrl, {
          sourceIdToTilesetId,
          spriteId,
          style: styleToSave,
          styleId,
        }),
      }
    },
    // TODO: Ideally could consolidate with createStyle
    createStyleForTileset(tilejson, nameForStyle) {
      const tilesetId = tilejson.id
      const styleId = encodeBase32(hash(`style:${tilesetId}`))

      // TODO: Come up with better default name?
      const styleName = nameForStyle || `Style ${tilesetId.slice(-4)}`

      const url = `mapeo://tilesets/${tilesetId}`

      const style =
        tilejson.format === 'pbf' && tilejson['vector_layers']
          ? createVectorStyle({
              name: styleName,
              url,
              vectorLayers: tilejson['vector_layers'],
            })
          : createRasterStyle({
              name: styleName,
              url,
            })

      const sourceIdToTilesetId: { [sourceId: string]: string } = {}

      // In this case, the style will only have 1 source
      Object.keys(style.sources).forEach((sourceId) => {
        sourceIdToTilesetId[sourceId] = tilesetId
      })

      db.prepare<{
        id: string
        sourceIdToTilesetId: string
        stylejson: string
      }>(
        'INSERT INTO Style (id, sourceIdToTilesetId, stylejson) VALUES (:id, :sourceIdToTilesetId, :stylejson)'
      ).run({
        id: styleId,
        sourceIdToTilesetId: JSON.stringify(sourceIdToTilesetId),
        stylejson: JSON.stringify(style),
      })

      return { id: styleId, style }
    },
    deleteStyle(id: string) {
      if (!styleExists(id)) {
        throw new NotFoundError(id)
      }

      const tilesetsToDelete: Array<string> = db
        .prepare(
          `SELECT DISTINCT json_each.value
           FROM Style, json_each(Style.sourceIdToTilesetId, '$')
           WHERE Style.id = @styleId
         EXCEPT
           SELECT DISTINCT json_each.value
           FROM Style, json_each(Style.sourceIdToTilesetId, '$')
           WHERE Style.id != @styleId`
        )
        .pluck(true)
        .all({ styleId: id })

      const tilesetsSqlList = tilesetsToDelete.map((id) => `'${id}'`).join(',')

      db.transaction(() => {
        db.prepare(
          `DELETE FROM Tile WHERE tilesetId IN (${tilesetsSqlList})`
        ).run()
        db.prepare(`DELETE FROM Tileset WHERE id IN (${tilesetsSqlList})`).run()
        db.prepare(
          `DELETE FROM TileData WHERE tilesetId IN (${tilesetsSqlList})`
        ).run()
        db.prepare(
          'DELETE FROM Import WHERE areaId IN (SELECT id FROM OfflineArea WHERE styleId = ?)'
        ).run(id)
        db.prepare('DELETE FROM OfflineArea WHERE styleId = ?').run(id)
        db.prepare(
          'DELETE FROM Sprite WHERE Sprite.id IN (SELECT spriteId FROM Style WHERE Style.id = ?)'
        ).run(id)
        db.prepare('DELETE FROM Style WHERE id = ?').run(id)
      })()
    },
    getStyle(id, baseApiUrl) {
      const row:
        | {
            id: string
            stylejson: string
            sourceIdToTilesetId: string
            spriteId: string | null
          }
        | undefined = db
        .prepare(
          'SELECT id, stylejson, sourceIdToTilesetId, spriteId FROM Style WHERE id = ?'
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

      return addOfflineUrls(baseApiUrl, {
        sourceIdToTilesetId,
        spriteId: row.spriteId || undefined,
        style,
        styleId: id,
      })
    },
    listStyles(baseApiUrl) {
      // `bytesStored` calculates the total bytes stored by tiles that the style references
      // Eventually we want to get storage taken up by other resources like sprites and glyphs
      return db
        .prepare(
          `SELECT Style.id,
            json_extract(Style.stylejson, '$.name') as name,
            (
              SELECT sum(length(TileData.data))
              FROM TileData
              WHERE TileData.tilesetId IN (
                SELECT DISTINCT json_each.value
                FROM Style S2, json_each(S2.sourceIdToTilesetId, '$')
                WHERE S2.id = Style.id)
            ) AS bytesStored
          FROM Style;`
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
            url: getStyleUrl(baseApiUrl, row.id),
          })
        )
    },
    // TODO: May need to accept an access token
    async updateStyle(id, style, baseApiUrl) {
      if (!styleExists(id)) {
        throw new NotFoundError(id)
      }

      const sourceIdToTilesetId = await createOfflineSources({
        baseApiUrl,
        sources: style.sources,
      })

      const spriteId = style.sprite ? generateSpriteId(style.sprite) : undefined

      const styleToSave: StyleJSON = await uncompositeStyle(style)

      db.prepare<{
        id: string
        sourceIdToTilesetId: string
        spriteId?: string
        stylejson: string
      }>(
        'UPDATE Style SET stylejson = :stylejson, sourceIdToTilesetId = :sourceIdToTilesetId, spriteId = :spriteId ' +
          'WHERE id = :id'
      ).run({
        id,
        sourceIdToTilesetId: JSON.stringify(sourceIdToTilesetId),
        spriteId,
        stylejson: JSON.stringify(styleToSave),
      })

      return addOfflineUrls(baseApiUrl, {
        sourceIdToTilesetId,
        spriteId,
        style: styleToSave,
        styleId: id,
      })
    },
  }
}

export default createStylesApi
