import type { Database } from 'better-sqlite3'
import Piscina from 'piscina'
import { MessagePort } from 'worker_threads'

import { UpstreamRequestsManager } from '../lib/upstream_requests_manager'
import createGlyphsApi, { GlyphsApi } from './glyphs'
import createImportsApi, { ImportsApi } from './imports'
import createSpritesApi, { SpritesApi } from './sprites'
import createStylesApi, { StylesApi } from './styles'
import createTilesApi, { TilesApi } from './tiles'
import createTilesetsApi, { TilesetsApi } from './tilesets'

export interface MapServerOptions {
  storagePath: string
}

export interface Context {
  activeImports: Map<string, MessagePort>
  db: Database
  piscina: Piscina
  upstreamRequestsManager: UpstreamRequestsManager
}

// Any resource returned by the API will always have an `id` property
export interface IdResource {
  id: string
}

export interface Api
  extends GlyphsApi,
    ImportsApi,
    SpritesApi,
    StylesApi,
    TilesApi,
    TilesetsApi {}

export default function createApi(context: Context): Api {
  const tilesetsApi = createTilesetsApi({ context })

  const stylesApi = createStylesApi({
    api: {
      createTileset: tilesetsApi.createTileset,
    },
    context,
  })

  const importsApi = createImportsApi({
    api: {
      createTileset: tilesetsApi.createTileset,
      createStyleForTileset: stylesApi.createStyleForTileset,
      deleteStyle: stylesApi.deleteStyle,
    },
    context,
  })

  const tilesApi = createTilesApi({
    api: {
      getTilesetInfo: tilesetsApi.getTilesetInfo,
    },
    context,
  })

  const spritesApi = createSpritesApi({
    context,
  })

  const glyphsApi = createGlyphsApi({ context })

  return {
    ...glyphsApi,
    ...importsApi,
    ...spritesApi,
    ...stylesApi,
    ...tilesApi,
    ...tilesetsApi,
  }
}
