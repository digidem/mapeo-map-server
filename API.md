# API Documentation

Params of interest are prefixed by a colon (`:`) in the listed endpoint.

## Table of contents

- [Styles](#styles)
- [Sprites](#sprites)
- [Fonts](#fonts)
- [Tilesets](#tilesets)
- [Tiles](#tiles)
- [Imports](#imports)

---

## Styles

### `GET /styles`

Retrieve a list of information about all styles. Each item has the following fields:

- `id: string`: ID of the style
- `bytesStored: number`: The number of bytes that the style occupies. This currently only accounts for the tiles that are associated with the style. In the future, this should include other assets such as glyphs and sprites.
- `name: string`: The name of the style.
- `url: string`: The map server URL that points to the style resource.

### `GET /styles/:styleId`

- Params
  - `styleId: string`: The ID for the style.

Retrieve the StyleJSON for a style. Adheres to the [StyleJSON spec](https://docs.mapbox.com/mapbox-gl-js/style-spec/root/).

### `GET /styles/:styleId/preview`

- Params
  - `styleId: string`: The ID for the style.

Fetch the assets used to preview a style in a web page. Uses [Mapbox GL JS](https://github.com/mapbox/mapbox-gl-js/) for rendering. Mostly helpful for debugging purposes.

### `DELETE /styles/:styleId`

- Params
  - `styleId: string`: The ID for the style.

Delete a style. Returns a `204 No Content` code if successful.

### `POST /styles`

- Body
  - `accessToken?: string`: Access token used to make upstream requests to the provider. Note that this access token will be persisted in the database and used for subsequent upstream requests.
  - `url: string`: The upstream URL to fetch the style from.
  - `style: StyleJSON`: A valid [StyleJSON](https://docs.mapbox.com/mapbox-gl-js/style-spec/root/) payload. **Note that this will be ignored if the `url` param is provided**.
  - `id?: string`: The ID to assign the created. If not provided, one will be randomly generated. This will only be used if the `style` param is provided. **Note that this will be ignored if the `url` param is provided**.

Create a style, either by fetching a StyleJSON definition from an upstream source, or providing the raw payload of a valid definition. Returns the resulting StyleJSON that adheres to the [StyleJSON spec](https://docs.mapbox.com/mapbox-gl-js/style-spec/root/).

---

## Sprites

### `GET /styles/:styleId/sprites/:spriteInfo.png`

- Params
  - `styleId: string`: The ID of the style.
  - `spriteInfo: string`: The name of the sprite asset. May or may not include a scale factor at the end, such as `@2x`, `@3x`, etc. See [Mapbox docs](https://docs.mapbox.com/api/maps/styles/#retrieve-a-sprite-image-or-json) for more information.

Retrieve a sprite image for a style. Note that this is usually used by a map client (based on a style definition) and not directly by the end user ([more info](https://docs.mapbox.com/mapbox-gl-js/style-spec/sprite/#loading-sprite-files)).

### `GET /styles/:styleId/sprites/:spriteInfo.json`

- Params
  - `styleId: string`: The ID of the style.
  - `spriteInfo: string`: The name of the sprite asset. May or may not include a scale factor at the end, such as `@2x`, `@3x`, etc. See [Mapbox docs](https://docs.mapbox.com/api/maps/styles/#retrieve-a-sprite-image-or-json) for more information.

Retrieve the sprite JSON document for a style. Note that this is usually used by a map client (based on a style definition) and not directly by the end user ([more info](https://docs.mapbox.com/mapbox-gl-js/style-spec/sprite/#loading-sprite-files)).

---

## Fonts

#### `GET /fonts/:fontstack/:start-:end.pbf?styleId=:styleId&access_token=:access_token`

- Params:
  - `fontstack`: A comma-separated list of font names. Ensure that this string is URL-encoded.
  - `start`: A multiple of `256` between `0` and `65280`
  - `end`: `start` plus `255`
- Query:
  - `styleId` (optional): The ID of the style requesting the glyphs. This is used to determine the upstream url to use for fetching glyphs from a remote service if necessary. If not provided, the server will only attempt to find a locally available match.
  - `access_token` (optional): An access token that may be needed to make upstream requests to a remote service.

Get a glyph range. This is typically used by a map renderer and most end-users will not directly make requests to this endpoint.

A successful response will return the protocol buffer-encoded sdf value for the requested range i.e. a `Content-Type` header of `application/x-protobuf`.

This endpoint goes through the following steps to determine what to respond with:

1. Check if there any matches for a locally stored font.
   - If there is a match, return the glyphs using that font.
   - If there is no match, proceed to step 2.
2. If `styleId` is provided, look up the associated upstream fonts url for the style and use that to make an upstream request. The upstream request can potentially fail if an access token is needed and `access_token` is not provided.
   - If the upstream request succeeds, forward that response.
   - If the upstream request fails due to:
     - a non-404 upstream HTTP error, forward the error
     - lack of internet connection or a `440 Not Found` error, go to step 3
3. Return the glyph range using the default pre-bundled font ([Opens Sans](https://www.opensans.com/))

---

## Tilesets

### `GET /tilesets`

Retrieve a list of all tilesets. Each tileset adheres to the [TileJSON spec](https://github.com/mapbox/tilejson-spec) with a guarantee of an `id` field.

### `GET /tilesets/:tilesetId`

- Params
  - `tilesetId: string`: The ID of the tileset.

Retrieve the tilejson definition of a tileset. Adheres to the [TileJSON spec](https://github.com/mapbox/tilejson-spec).

### `POST /tilesets`

- Body
  - A valid TileJSON definition that adheres to the [TileJSON spec](https://github.com/mapbox/tilejson-spec).

Create a tileset. Returns the created tileset TileJSON if successful.

### `PUT /tilesets/:tilesetId`

- Params
  - `tilesetId: string`: The ID of the tileset.
- Body
  - A valid TileJSON definition that adheres to the [TileJSON spec](https://github.com/mapbox/tilejson-spec).

Update a tileset. Returns the updated tileset TileJSON if successful.

### `POST /tilesets/import`

- Body
  - `filePath: string`: An absolute path to the location of the file to import.

Create a tileset by importing an existing file. If successful, a response with the following payload will be returned:

- `import: { id: string }`: Information about the import that is created. The `id` can be used to get the information about the import or its progress (see [Imports](#imports)).
- `style: { id: string } | null`: Information about the style that is created. As of now, a style is automatically generated for a MBTiles import. There may be cases where this behavior changes based on import type, so this field can potentially be `null`.
- `tileset: TileJSON`: The tileset that is created, adhering to the [TileJSON spec](https://github.com/mapbox/tilejson-spec).

As of now, only [MBTiles](https://github.com/mapbox/mbtiles-spec) files are supported, although there are plans to support other kinds of imports in the future.

---

## Tiles

### `GET /tilesets/:tilesetId/:zoom/:x/:y`

- Params
  - `tilesetId: string`: The ID of the tileset.
  - `zoom: number`: The zoom level of the tile.
  - `x: number`: The x coordinate of the tile.
  - `y: number`: The y coordinate of the tile.

Retrieve a tile for a given tileset. Note that this is usually used by a map client (based on a style definition) and not directly by the end user ([more info](https://docs.mapbox.com/mapbox-gl-js/style-spec/sources/)).

---

## Imports

### `GET /imports/progress/:importId`

- Params:
  - `importId: string`: The ID for the desired import.

Subscribe to progress information for an import. This is a [Server-Sent Events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) endpoint, so it's expected to be used with an [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) by the client.

Messages that are received will have a `data` field with the following structure when deserialized:

- `type: string`: Type indicating the type of progress message. Can be one of the following values:
  - `"progress"`: Import is still in progress
  - `"complete"`: Import is complete
  - `"error"`: Error occurred during import
- `importId: string`: ID for import
- `soFar: number`: Number of assets successfully imported so far
- `total: number`: Total number of assets to be imported

If a requested import is already completed or has errored, responds with `204 No Content`, which should prevent the event source from attempting to reconnect. Generally, the client should explicitly close the event source when:

1. Receiving a message and the deserialized `type` value in the event data is either `"complete"` or `"error"`.
2. Receiving an error

```js
const evtSource = new EventSource(
  'http://localhost:3000/imports/progress/some-import-id'
)

evtSource.onmessage = (event) => {
  const message = JSON.parse(event.data)

  if (message.type === 'complete' || message.type === 'error') {
    evtSource.close()
    return
  }

  // Do something with message...
}

evtSource.onerror = (event) => {
  evtSource.close()
}
```
