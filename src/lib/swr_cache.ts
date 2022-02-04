/* eslint-disable @typescript-eslint/no-empty-function */
import got from 'got'
import { LevelUp } from 'levelup'
import { AbstractLevelDOWN } from 'abstract-leveldown'
import PromiseAny from 'promise.any'

PromiseAny.shim()

class SWRCache {
  private etagDb: LevelUp<AbstractLevelDOWN<string, string>>
  private cacheDb: LevelUp<AbstractLevelDOWN<string, Buffer>>
  private inflight = new Map<string, Promise<Buffer>>()
  private pending = new Set<Promise<any>>()

  constructor({
    etagDb,
    cacheDb,
  }: {
    etagDb: SWRCache['etagDb']
    cacheDb: SWRCache['cacheDb']
  }) {
    this.etagDb = etagDb
    this.cacheDb = cacheDb
  }

  get(
    url: string,
    {
      forceOffline,
      cacheGet = () => this.cacheDb.get(url),
      cachePut = (buf: Buffer) => this.cacheDb.put(url, buf),
    }: {
      forceOffline?: boolean
      // This is used by tilestore, which uses mbtiles as the "cache"
      cacheGet?: () => Promise<Buffer>
      cachePut?: (buf: Buffer) => Promise<void>
    } = {}
  ): Promise<Buffer> {
    // If there is already an inflight request for this url, use that
    const inflightRequest = this.inflight.get(url)
    if (inflightRequest) return inflightRequest

    // Get the resource either from the cache or from upstream, but unless
    // forceOffline is true, always try to revalidate the cache
    const request = forceOffline
      ? Promise.any([cacheGet()])
      : Promise.any([cacheGet(), this.getUpstream(url, { cachePut })])
    this.inflight.set(url, request)
    // Warning: Using .finally() here will result in an unhandled rejection
    request
      .then(() => this.inflight.delete(url))
      .catch(() => this.inflight.delete(url))
    return request
  }

  /**
   * Wait until all pending requests have completed (this is necessary because
   * swrCache.get() will return a value from the cache while a request will be
   * sent upstream to revalidate the cache. This method allows you to wait for
   * pending revalidation requests to complete)
   */
  allSettled(): Promise<void> {
    return Promise.allSettled(this.pending).then(() => {})
  }

  /**
   * Request a URL, respecting cached headers, and update the cache
   */
  private getUpstream(
    url: string,
    {
      cachePut,
    }: {
      cachePut: (buf: Buffer) => Promise<void>
    }
  ): Promise<Buffer> {
    /**
     * 1. Get etag for currently cached resource, if it exists
     * 2. Request resource, if it does not match etag
     * 3. Throw if the resouce has not been modified (cached value is up-to-date)
     * 4. Otherwise save the etag and cache the resource
     */
    const request = this.etagDb
      .get(url)
      .catch(() => {
        /** ignore error, just not cached yet */
      })
      .then((etag) => {
        const headers = etag ? { 'If-None-Match': etag } : {}
        return got(url, { headers, responseType: 'buffer' })
      })
      .then((response) => {
        if (response.statusCode === 304) throw new Error('Not Modified')
        const etag = response.headers.etag as string
        // Don't await these, they can happen after response is returned
        // TODO: How to handle errors here? Logging?
        this.etagDb.put(url, etag).catch(() => {})
        cachePut(response.body).catch(() => {})
        return response.body
      })
    // Keep track of this pending request, for the allSettled() method
    this.pending.add(request)
    request
      .then(() => this.pending.delete(request))
      .catch(() => this.pending.delete(request))
    return request
  }
}

export type SWRCacheResponse<Data> = {
  data: Data
  // TODO: is this necessary?
  etag?: string
}

type UpstreamResponseType = 'buffer' | 'text' | 'json'

type CacheAdaptor<Data> = {
  get: () => Promise<SWRCacheResponse<Data>>
  put: (params: { data: Data; etag?: string; url: string }) => Promise<void>
  // TODO: Think of a better name for this?
  // TODO: Would it be better to pass this into the constructor?
  upstreamResponseType: UpstreamResponseType
}

// Derived from https://github.com/sindresorhus/type-fest/blob/61c35052f09caa23de5eef96d95196375d8ed498/source/basic.d.ts#L15-L45
type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [key in string]?: JSONValue }
  | JSONValue[]

export class SWRCacheV2<Data extends Buffer | JSONValue> {
  private inflight = new Map<string, Promise<SWRCacheResponse<Data>>>()
  private pending = new Set<Promise<any>>()

  /**
   * Wait until all pending requests have completed (this is necessary because
   * swrCache.get() will return a value from the cache while a request will be
   * sent upstream to revalidate the cache. This method allows you to wait for
   * pending revalidation requests to complete)
   */
  async allSettled(): Promise<void> {
    return Promise.allSettled(this.pending).then(() => {})
  }

  get(
    url: string,
    cache: CacheAdaptor<Data>,
    {
      etag,
      forceOffline,
    }: {
      // TODO: This complicates the API and we need to figure out a better way to get the latest etag each time
      etag?: string
      forceOffline?: boolean
    } = {}
  ): Promise<SWRCacheResponse<Data>> {
    // If there is already an inflight request for this url, use that
    const inflightRequest = this.inflight.get(url)
    if (inflightRequest) return inflightRequest

    // Get the resource either from the cache or from upstream, but unless
    // forceOffline is true, always try to revalidate the cache
    const request = forceOffline
      ? Promise.any([cache.get()])
      : Promise.any([
          cache.get(),
          this.getUpstream(url, {
            cachePut: cache.put,
            etag,
            responseType: cache.upstreamResponseType,
          }),
        ])

    this.inflight.set(url, request)

    // Warning: Using .finally() here will result in an unhandled rejection
    request
      .then(() => this.inflight.delete(url))
      .catch(() => this.inflight.delete(url))

    return request
  }

  private getUpstream(
    url: string,
    {
      cachePut,
      etag,
      responseType,
    }: {
      cachePut: CacheAdaptor<Data>['put']
      etag?: string
      responseType: UpstreamResponseType
    }
  ): Promise<SWRCacheResponse<Data>> {
    /**
     * 1. Get etag for currently cached resource, if it exists
     * 2. Request resource, if it does not match etag
     * 3. Throw if the resouce has not been modified (cached value is up-to-date)
     * 4. Otherwise save the etag and cache the resource
     */
    const headers = etag ? { 'If-None-Match': etag } : {}

    const request = got(url, { headers, responseType }).then((response) => {
      if (response.statusCode === 304) throw new Error('Not Modified')

      const etag = response.headers.etag as string

      // Not excited about this but think it works okay
      const data = response.body as Data

      cachePut({ data, etag, url }).catch(() => {})

      return { data, etag }
    })

    // Keep track of this pending request, for the allSettled() method
    this.pending.add(request)

    request
      .then(() => this.pending.delete(request))
      .catch(() => this.pending.delete(request))

    return request
  }
}

export default SWRCache
