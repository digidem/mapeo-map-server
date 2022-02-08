import got from 'got'

export type UpstreamResponse<Data> = {
  data: Data
  etag?: string
}

export class UpstreamRequestsManager {
  private inflight = new Map<string, Promise<UpstreamResponse<any>>>()
  private pending = new Set<Promise<UpstreamResponse<any>>>()

  async allSettled(): Promise<void> {
    return Promise.allSettled(this.pending).then(() => {})
  }

  // The `Data` generic will generally need to be provided and align with the provided `responseType` param
  // e.g. `buffer` => Buffer, `json` => TileJSON, `text` => string
  // I'm sure there's some TS wizardry that could make this inferred or less manual
  async getUpstream<Data>({
    url,
    etag,
    responseType = 'buffer',
  }: {
    url: string
    etag?: string
    responseType: 'buffer' | 'json' | 'text'
  }): Promise<UpstreamResponse<Data>> {
    // If there is already an inflight request for this url, use that
    const inflightRequest = this.inflight.get(url)
    if (inflightRequest) return inflightRequest

    const headers = etag ? { 'If-None-Match': etag } : {}

    const request = got(url, { headers, responseType }).then((response) => {
      if (response.statusCode === 304) throw new Error('Not Modified')

      const etag = response.headers.etag as string | undefined

      // Not ideal but think it's fine in this case
      const data = response.body as Data

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
