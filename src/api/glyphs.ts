import fs from 'fs'
import path from 'path'

import { SDF_STATIC_DIR } from '../lib/glyphs'
import { Context } from '.'
import { NotFoundError } from './errors'

export type GlyphsResult =
  | { type: 'file'; data: string } // data is an absolute file path
  | { type: 'raw'; data: Buffer }

export interface GlyphsApi {
  getGlyphs(font: string, start: number, end: number): Promise<GlyphsResult>
}

function createGlyphsApi({ context }: { context: Context }): GlyphsApi {
  function getStaticFilePath(font: string, start: number, end: number) {
    return path.resolve(SDF_STATIC_DIR, font, `${start}-${end}.pbf`)
  }

  return {
    getGlyphs(font, start, end) {
      const staticPath = getStaticFilePath(font, start, end)

      return new Promise<GlyphsResult>((res, rej) => {
        fs.access(staticPath, (err) => {
          if (err) {
            // TODO: Get from upstream if this happens
            rej(new NotFoundError(`${font} (${start}-${end})`))
          }

          res({ type: 'file', data: staticPath })
        })
      })
    },
  }
}

export default createGlyphsApi
