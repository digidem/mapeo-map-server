/**
 * From https://github.com/mapbox/mapbox-gl-js/blob/main/src/util/mapbox.js
 * Utils for turning mapbox:// urls into regular urls
 */
import { TileJSON } from './tilejson'

type UrlObject = {
  protocol: string
  authority: string
  path: string
  params: Array<string>
}

const API_URL = 'https://api.mapbox.com'

function makeAPIURL(
  urlObject: UrlObject,
  accessToken: string | null | void
): string {
  const help =
    'See https://www.mapbox.com/api-documentation/#access-tokens-and-token-scopes'
  const apiUrlObject = parseUrl(API_URL)
  urlObject.protocol = apiUrlObject.protocol
  urlObject.authority = apiUrlObject.authority

  if (apiUrlObject.path !== '/') {
    urlObject.path = `${apiUrlObject.path}${urlObject.path}`
  }

  if (!accessToken)
    throw new Error(`An API access token is required to use Mapbox GL. ${help}`)
  if (accessToken[0] === 's')
    throw new Error(
      `Use a public access token (pk.*) with Mapbox GL, not a secret access token (sk.*). ${help}`
    )

  urlObject.params = urlObject.params.filter(
    (d) => d.indexOf('access_token') === -1
  )
  urlObject.params.push(`access_token=${accessToken}`)
  return formatUrl(urlObject)
}

export function normalizeStyleURL(url: string, accessToken?: string): string {
  if (!isMapboxURL(url)) return url
  const urlObject = parseUrl(url)
  urlObject.path = `/styles/v1${urlObject.path}`
  return makeAPIURL(urlObject, accessToken)
}

export function normalizeGlyphsURL(url: string, accessToken?: string): string {
  if (!isMapboxURL(url)) return url
  const urlObject = parseUrl(url)
  urlObject.path = `/fonts/v1${urlObject.path}`
  return makeAPIURL(urlObject, accessToken)
}

export function normalizeSourceURL(url: string, accessToken?: string): string {
  if (!isMapboxURL(url)) return url
  const urlObject = parseUrl(url)
  urlObject.path = `/v4/${urlObject.authority}.json`
  // TileJSON requests need a secure flag appended to their URLs so
  // that the server knows to send SSL-ified resource references.
  urlObject.params.push('secure')
  return makeAPIURL(urlObject, accessToken)
}

export function normalizeSpriteURL(
  url: string,
  format: string,
  extension: string,
  accessToken?: string
): string {
  const urlObject = parseUrl(url)
  if (!isMapboxURL(url)) {
    urlObject.path += `${format}${extension}`
    return formatUrl(urlObject)
  }
  urlObject.path = `/styles/v1${urlObject.path}/sprite${format}${extension}`
  return makeAPIURL(urlObject, accessToken)
}

export function normalizeTileURL(tileURL: string, tileSize?: number): string {
  if (tileURL && !isMapboxURL(tileURL)) return tileURL

  const urlObject = parseUrl(tileURL)
  const imageExtensionRe = /(\.(png|jpg)\d*)(?=$)/
  const tileURLAPIPrefixRe = /^.+\/v4\//

  // The v4 mapbox tile API supports 512x512 image tiles only when @2x
  // is appended to the tile URL. If `tileSize: 512` is specified for
  // a Mapbox raster source force the @2x suffix even if a non hidpi device.
  const suffix = tileSize === 512 ? '@2x' : ''
  urlObject.path = urlObject.path.replace(imageExtensionRe, `${suffix}$1`)
  urlObject.path = urlObject.path.replace(tileURLAPIPrefixRe, '/')
  urlObject.path = `/v4${urlObject.path}`

  const accessToken = getAccessToken(urlObject.params)

  return makeAPIURL(urlObject, accessToken)
}

export function canonicalizeTileURL(url: string): string {
  const version = '/v4/'
  // matches any file extension specified by a dot and one or more alphanumeric characters
  const extensionRe = /\.[\w]+$/

  const urlObject = parseUrl(url)
  // Make sure that we are dealing with a valid Mapbox tile URL.
  // Has to begin with /v4/, with a valid filename + extension
  if (
    !urlObject.path.match(/(^\/v4\/)/) ||
    !urlObject.path.match(extensionRe)
  ) {
    // Not a proper Mapbox tile URL.
    return url
  }
  // Reassemble the canonical URL from the parts we've parsed before.
  let result = 'mapbox://tiles/'
  result += urlObject.path.replace(version, '')

  // Append the query string, minus the access token parameter.
  const params = urlObject.params
  if (params.length) result += `?${params.join('&')}`
  return result
}

export function canonicalizeTileset(tileJSON: TileJSON): string[] {
  const canonical = []
  for (const url of tileJSON.tiles || []) {
    if (isMapboxHTTPURL(url)) {
      canonical.push(canonicalizeTileURL(url))
    } else {
      canonical.push(url)
    }
  }
  return canonical
}

export function isMapboxURL(url: string): boolean {
  return url.indexOf('mapbox:') === 0
}

const mapboxHTTPURLRe = /^((https?:)?\/\/)?([^\/]+\.)?mapbox\.c(n|om)(\/|\?|$)/i
export function isMapboxHTTPURL(url: string): boolean {
  return mapboxHTTPURLRe.test(url)
}

function getAccessToken(params: Array<string>): string | null {
  for (const param of params) {
    const match = param.match(/^access_token=(.*)$/)
    if (match) {
      return match[1]
    }
  }
  return null
}

const urlRe = /^(\w+):\/\/([^/?]*)(\/[^?]+)?\??(.+)?/

function parseUrl(url: string): UrlObject {
  const parts = url.match(urlRe)
  if (!parts) {
    throw new Error('Unable to parse URL object')
  }
  return {
    protocol: parts[1],
    authority: parts[2],
    path: parts[3] || '/',
    params: parts[4] ? parts[4].split('&') : [],
  }
}

function formatUrl(obj: UrlObject): string {
  const params = obj.params.length ? `?${obj.params.join('&')}` : ''
  return `${obj.protocol}://${obj.authority}${obj.path}${params}`
}
