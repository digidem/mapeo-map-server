import fs from 'fs'
import path from 'path'

import { SDF_STATIC_DIR } from '../lib/glyphs'
import { isMapboxURL, normalizeGlyphsURL } from '../lib/mapbox_urls'
import { Context } from '.'
import { MBAccessTokenRequiredError, NotFoundError } from './errors'

export type GlyphsResult =
  | { type: 'file'; data: string } // data is an absolute file path
  | { type: 'raw'; data: Buffer; etag?: string }

export interface GlyphsApi {
  getGlyphs(params: {
    styleId?: string
    accessToken?: string
    font: string
    start: number
    end: number
  }): Promise<GlyphsResult>
}

function createGlyphsApi({ context }: { context: Context }): GlyphsApi {
  const { db, upstreamRequestsManager } = context

  // TODO: Use LRU for this?
  function getStaticFile(font: string, start: number, end: number) {
    const staticPath = path.resolve(SDF_STATIC_DIR, font, `${start}-${end}.pbf`)

    return new Promise<GlyphsResult>((res, rej) => {
      fs.access(staticPath, (err) => {
        if (err) {
          rej(new NotFoundError(`${font} (${start}-${end})`))
        }

        res({ type: 'file', data: staticPath })
      })
    })
  }

  return {
    async getGlyphs({ styleId, accessToken, font, start, end }) {
      if (!styleId) {
        return getStaticFile(font, start, end)
      }

      const upstreamGlyphsUrl: string | undefined = db
        .prepare(
          `SELECT json_each.value FROM Style, json_each(Style.stylejson, '$.glyphs') WHERE id = ?`
        )
        .get(styleId)

      if (upstreamGlyphsUrl) {
        if (isMapboxURL(upstreamGlyphsUrl) && !accessToken) {
          throw new MBAccessTokenRequiredError()
        }

        const interpolatedUrl = normalizeGlyphsURL(
          upstreamGlyphsUrl,
          accessToken
        )
          .replace('{fontstack}', encodeURIComponent(font))
          .replace('{range}', `${start}-${end}`)

        try {
          const response = await upstreamRequestsManager.getUpstream({
            url: interpolatedUrl,
            responseType: 'buffer',
          })

          return {
            ...response,
            type: 'raw',
          }
        } catch (_err) {
          // TODO: Do we fallback to static or throw an error?
        }
      }

      return getStaticFile(font, start, end)
    },
  }
}

export default createGlyphsApi
