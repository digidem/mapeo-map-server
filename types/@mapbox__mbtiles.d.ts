declare module '@mapbox/mbtiles' {
  export default MBTiles

  class MBTiles {
    constructor(path: string, callback: (err: Error, mbtiles: MBTiles) => void)
    getTile(
      z: number,
      x: number,
      y: number,
      callback: (err: Error, data: Buffer, headers: Headers) => void
    ): void
    getInfo(callback: (err: Error, info: MetadataGet) => void): void
    startWriting(callback: (err: Error) => void): void
    stopWriting(callback: (err: Error) => void): void
    putTile(
      z: number,
      x: number,
      y: number,
      buffer: Buffer,
      callback: (err: Error) => void
    ): void
    putInfo(info: Metadata, callback: (err: Error) => void): void
  }

  export interface Headers {
    'Last-Modified'?: string
    Etag?: string
    'Content-Type'?: string
    'Content-Encoding'?: string
  }

  /**
   * MBTiles metadata
   * See https://github.com/mapbox/mbtiles-spec/blob/master/1.3/spec.md
   */
  export interface Metadata {
    /** The human-readable name of the tileset */
    name: string
    /** The file format of the tile data: `pbf`, `jpg`, `png`, `webp`, or an
     * [IETF media
     * type](https://www.iana.org/assignments/media-types/media-types.xhtml) for
     * other formats */
    format: 'pbf' | 'jpg' | 'png' | 'webp' // TODO: IETF media types
    /** The maximum extent of the rendered map area. Bounds must define an area
     * covered by all zoom levels. The bounds are represented as `WGS 84`
     * latitude and longitude values, in the OpenLayers Bounds format (left,
     * bottom, right, top). For example, the `bounds` of the full Earth, minus
     * the poles, would be: `-180.0,-85,180,85` */
    bounds?: [number, number, number, number]
    /** The longitude, latitude, and zoom level of the default view of the map. */
    center?: [number, number, number]
    /** The lowest zoom level for which the tileset provides data */
    minzoom?: number
    /** The highest zoom level for which the tileset provides data */
    maxzoom?: number
    /** An attribution string, which explains the sources of data and/or style for the map */
    attribution?: string
    /** A description of the tileset's content */
    description?: string
    type?: 'overlay' | 'baselayer'
    /** The version of the tileset. This refers to a revision of the tileset
     * itself, not of the MBTiles specification. The MBTiles Spec says this
     * should be a number, but node-mbtiles implements this as a string, which
     * is the same as TileJSON */
    version?: string
    json?: string
  }

  /** mbtiles getInfo returns Metadata without the `json` key and can have any
   * number of additional keys */
  export type MetadataGet = Omit<Metadata, 'json'> & { [key: string]: any }
}
