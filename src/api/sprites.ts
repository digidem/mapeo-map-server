import {
  Sprite,
  UpstreamSpriteResponse,
  validateSpriteIndex,
} from '../lib/sprites'
import { isMapboxURL, normalizeSpriteURL } from '../lib/mapbox_urls'
import { UpstreamResponse } from '../lib/upstream_requests_manager'
import { Context, IdResource } from '.'
import {
  AlreadyExistsError,
  MBAccessTokenRequiredError,
  NotFoundError,
  UpstreamJsonValidationError,
} from './errors'

export interface SpritesApi {
  createSprite(info: Sprite): Sprite & IdResource
  deleteSprite(id: string, pixelDensity?: number): void
  fetchUpstreamSprites(
    upstreamSpriteUrl: string,
    options?: {
      accessToken?: string
      etag?: string // etag for the 1x image asset
    }
  ): Promise<
    Map<number, UpstreamSpriteResponse> // Map of pixel density to the response result
  >
  getSprite(
    id: string,
    pixelDensity: number,
    allowFallback?: boolean
  ): Sprite & IdResource
  updateSprite(
    id: string,
    pixelDensity: number,
    options: {
      layout: string
      data: Buffer
      etag?: string
      upstreamUrl?: string
    }
  ): Sprite & IdResource
}

function createSpritesApi({ context }: { context: Context }): SpritesApi {
  const { db, upstreamRequestsManager } = context

  function spriteExists(spriteId: string, pixelDensity?: number) {
    const query =
      pixelDensity === undefined
        ? db
            .prepare('SELECT EXISTS (SELECT 1 FROM Sprite WHERE id = ?)')
            .bind(spriteId)
        : db
            .prepare<{ spriteId: string; pixelDensity: number }>(
              'SELECT EXISTS (SELECT 1 FROM Sprite WHERE id = :spriteId AND pixelDensity = :pixelDensity)'
            )
            .bind({ spriteId, pixelDensity })

    return query.pluck().get() !== 0
  }

  return {
    createSprite(info: Sprite) {
      if (spriteExists(info.id, info.pixelDensity)) {
        throw new AlreadyExistsError(info.id)
      }

      db.prepare<Sprite>(
        'INSERT INTO Sprite (id, pixelDensity, data, layout, etag, upstreamUrl) ' +
          'VALUES (:id, :pixelDensity, :data, :layout, :etag, :upstreamUrl)'
      ).run(info)

      return info
    },
    deleteSprite(id, pixelDensity) {
      if (!spriteExists(id, pixelDensity)) {
        throw new NotFoundError(id)
      }

      const query =
        pixelDensity === undefined
          ? db.prepare('DELETE FROM Sprite WHERE id = :id').bind(id)
          : db
              .prepare<{ id: string; pixelDensity: number }>(
                'DELETE FROM Sprite WHERE id = :id AND pixelDensity = :pixelDensity'
              )
              .bind({
                id,
                pixelDensity,
              })

      query.run()
    },
    async fetchUpstreamSprites(upstreamSpriteUrl, { accessToken, etag } = {}) {
      if (isMapboxURL(upstreamSpriteUrl) && !accessToken) {
        throw new MBAccessTokenRequiredError()
      }

      // Download the sprite layout and image for both 1x and 2x pixel densities
      const upstreamRequests1x = Promise.all([
        upstreamRequestsManager.getUpstream({
          url: normalizeSpriteURL(upstreamSpriteUrl, '', '.json', accessToken),
          responseType: 'json',
        }),
        upstreamRequestsManager.getUpstream({
          url: normalizeSpriteURL(upstreamSpriteUrl, '', '.png', accessToken),
          responseType: 'buffer',
          // We only keep track of the etag for the 1x image asset
          etag,
        }),
      ])

      const upstreamRequests2x = Promise.all([
        upstreamRequestsManager.getUpstream({
          url: normalizeSpriteURL(
            upstreamSpriteUrl,
            '@2x',
            '.json',
            accessToken
          ),
          responseType: 'json',
        }),
        upstreamRequestsManager.getUpstream({
          url: normalizeSpriteURL(
            upstreamSpriteUrl,
            '@2x',
            '.png',
            accessToken
          ),
          responseType: 'buffer',
        }),
      ])

      const [responses1x, responses2x] = await Promise.allSettled([
        upstreamRequests1x,
        upstreamRequests2x,
      ])

      const extractedSprite1x = processUpstreamSpriteResponse(responses1x)
      const extractedSprite2x = processUpstreamSpriteResponse(responses2x)

      const upstreamSprites: Awaited<
        ReturnType<SpritesApi['fetchUpstreamSprites']>
      > = new Map()

      if (extractedSprite1x) {
        upstreamSprites.set(1, extractedSprite1x)
      }

      if (extractedSprite2x) {
        upstreamSprites.set(2, extractedSprite2x)
      }

      return upstreamSprites

      function processUpstreamSpriteResponse(
        settledResponseResult: PromiseSettledResult<
          [UpstreamResponse<'json'>, UpstreamResponse<'buffer'>]
        >
      ): UpstreamSpriteResponse | null {
        // This means that the asset was not modified upstream
        if (settledResponseResult.status === 'rejected') return null

        const [layoutAssetResponse, imageAssetResponse] =
          settledResponseResult.value

        if (!validateSpriteIndex(layoutAssetResponse.data)) {
          return new UpstreamJsonValidationError(
            upstreamSpriteUrl,
            validateSpriteIndex.errors
          )
        }

        return {
          layout: layoutAssetResponse.data,
          data: imageAssetResponse.data,
          etag: imageAssetResponse.etag,
        }
      }
    },
    getSprite(id, pixelDensity, allowFallback = false) {
      const row: Sprite | undefined = db
        .prepare<{ id: string; pixelDensity: number }>(
          `SELECT * FROM Sprite WHERE id = :id AND pixelDensity ${
            allowFallback ? '<=' : '='
          } :pixelDensity LIMIT 1`
        )
        .get({
          id,
          pixelDensity,
        })

      if (!row) {
        throw new NotFoundError(id)
      }

      return row
    },
    updateSprite(id, pixelDensity, options) {
      if (!spriteExists(id, pixelDensity)) {
        throw new NotFoundError(id)
      }

      const spriteToSave: Sprite = {
        ...options,
        etag: options.etag || null,
        upstreamUrl: options.upstreamUrl || null,
        id,
        pixelDensity,
      }

      db.prepare<Sprite>(
        'UPDATE Sprite SET data = :data, layout = :layout, etag = :etag, upstreamUrl = :upstreamUrl ' +
          'WHERE id = :id AND pixelDensity = :pixelDensity'
      ).run(spriteToSave)

      return spriteToSave
    },
  }
}

export default createSpritesApi
