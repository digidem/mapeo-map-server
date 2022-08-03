import fs from 'fs'
import path from 'path'

import { createStaticGlyphPath, SDF_STATIC_DIR } from '../lib/glyphs'
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
    const staticPath = path.resolve(
      SDF_STATIC_DIR,
      createStaticGlyphPath(font, start, end)
    )

    return new Promise<GlyphsResult>((res, rej) => {
      fs.access(staticPath, (err) => {
        if (err) {
          rej(new NotFoundError(`${font} (${start}-${end}): ${err}`))
        }

        res({ type: 'file', data: staticPath })
      })
    })
  }

  return {
    // TODO: Should we return always return the offline asset if it exists?
    async getGlyphs({ styleId, accessToken, font, start, end }) {
      try {
        // 1. Attempt to get desired offline asset
        // Right now this is just a static asset bundled with the module.
        // May eventually be the Glyph table in the db.
        return await getStaticFile(font, start, end)
      } catch (err) {
        if (!styleId) throw err

        // 2. Offline attempt failed, but may be able to get upstream resource

        // TODO: Validate that the glyphs url contains {fontstack} and {range} templates?
        const row: { url: string } | undefined = db
          .prepare(
            "SELECT json_each.value as url FROM Style, json_each(Style.stylejson, '$.glyphs') WHERE Style.id = ?"
          )
          .get(styleId)

        // TODO: Change the kind of error thrown here?
        if (!row) throw err

        const { url: upstreamGlyphsUrl } = row

        if (isMapboxURL(upstreamGlyphsUrl) && !accessToken) {
          throw new MBAccessTokenRequiredError()
        }

        const interpolatedUrl = normalizeGlyphsURL(
          upstreamGlyphsUrl,
          accessToken
        )
          .replace('{fontstack}', encodeURIComponent(font))
          .replace('{range}', `${start}-${end}`)

        const response = await upstreamRequestsManager.getUpstream({
          url: interpolatedUrl,
          responseType: 'buffer',
        })

        return {
          ...response,
          type: 'raw',
        }
      }
    },
  }
}

export default createGlyphsApi
