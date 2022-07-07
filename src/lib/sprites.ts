export interface Sprite {
  id: string
  data: Buffer
  pixelDensity: number
  layout: string
  etag: string | null
  upstreamUrl: string | null
}
