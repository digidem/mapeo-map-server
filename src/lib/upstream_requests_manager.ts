import got from 'got'
import { TileJSON } from './tilejson'

type ResponseType = 'buffer' | 'json' | 'text'

type DataType<T extends ResponseType> = T extends 'buffer'
  ? Buffer
  : T extends 'json'
  ? TileJSON
  : T extends 'text'
  ? string
  : never

// TODO: Consider changing this to:
// export type UpstreamResponse<T extends ResponseType> = {
//   data: DataType<T>
//   headers: Headers // from @mapbox/mbtiles
// }
export type UpstreamResponse<T extends ResponseType> = {
  data: DataType<T>
  etag?: string
}

export class UpstreamRequestsManager {
  private inflight = new Map<string, Promise<UpstreamResponse<any>>>()
  private pending = new Set<Promise<UpstreamResponse<any>>>()

  async allSettled(): Promise<void> {
    return Promise.allSettled(this.pending).then(() => {})
  }

  async getUpstream<ResType extends ResponseType>({
    url,
    etag,
    responseType,
  }: {
    url: string
    etag?: string
    responseType: ResType
  }): Promise<UpstreamResponse<ResType>> {
    // If there is already an inflight request for this url, use that
    const inflightRequest = this.inflight.get(url)
    if (inflightRequest) return inflightRequest

    const headers = etag ? { 'If-None-Match': etag } : {}

    const request = got(url, { headers, responseType }).then((response) => {
      if (response.statusCode === 304) throw new Error('Not Modified')

      const etag = response.headers.etag as string | undefined

      // Not ideal but think it's fine in this case
      const data = response.body as DataType<ResType>

      return { data, etag }
    })

    this.inflight.set(url, request)

    // Keep track of this pending request, for the allSettled() method
    this.pending.add(request)

    request
      .then(() => {
        this.inflight.delete(url)
        this.pending.delete(request)
      })
      .catch(() => {
        this.inflight.delete(url)
        this.pending.delete(request)
      })

    return request
  }
}
