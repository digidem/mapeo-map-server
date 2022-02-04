/* eslint-disable @typescript-eslint/no-empty-function */
import got from 'got'
import PromiseAny from 'promise.any'

PromiseAny.shim()

export type SWRCacheResponse<Data> = {
  data: Data
  // TODO: is this necessary?
  etag?: string
}

type CacheAdaptor<Data> = {
  get: () => Promise<SWRCacheResponse<Data>>
  put: (params: { data: Data; etag?: string; url: string }) => Promise<void>
  // TODO: Think of a better name for this?
  // TODO: Would it be better to pass this into the constructor?
  upstreamResponseType: 'buffer' | 'text' | 'json'
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
      responseType: 'buffer' | 'text' | 'json'
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
