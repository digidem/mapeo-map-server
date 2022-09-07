# API Documentation

A less verbose (although incomplete) variation of this documentation can be found at the `/docs` endpoint of the map server when it is run.

Params of interest are prefixed by a colon (`:`) in the listed endpoint.

## Table of contents

- [Styles](#styles)
- [Sprites](#sprites)
- [Fonts](#fonts)
- [Tilesets](#tilesets)
- [Tiles](#tiles)

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

Create a style, either by fetching a StyleJSON definition from an upstream source, or providing the raw payload of valid definition. Returns the resulting StyleJSON that adheres to the [StyleJSON spec](https://docs.mapbox.com/mapbox-gl-js/style-spec/root/).

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
     - lack of internet connection or a Not Found error (404), go to step 3
3. Return the glyph range using the default pre-bundled font (Opens Sans)

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
- `tileset: TileJSON`: The tileset that is created, adhering to the [TileJSON spec](https://github.com/mapbox/tilejson-spec).

As of now, only [MBTiles](https://github.com/mapbox/mbtiles-spec) files are supported, although there are plans to support other kinds of imports in the future.

---

## Tiles

### `GET /tilesets/:tilesetId/:zoom/:x/:y`

- Params
  - `tilesetId`: The ID of the tileset.
  - `zoom: number`: The zoom level of the tile.
  - `x: number`: The x coordinate of the tile.
  - `y: number`: The y coordinate of the tile.

Retrieve a tile for a given tileset. Note that this is usually used by a map client (based on a style definition) and not directly by the end user ([more info](https://docs.mapbox.com/mapbox-gl-js/style-spec/sources/)).

---

## Imports

### `GET /imports/:importId`

- Params:
  - `importId: string`: The ID for the desired import.

Get information about an import that has occurred or is occurring. This is a subset of what's represented in the database, which includes information such as the type of import, its state and progress, and important timestamps. An import can represent a variety of different assets, such as tiles or style-related assets like fonts, glyphs, etc. The payload will look like this:

- `state: string`: the state of the import that was executed. Currently one of the following values:
  - `"active"`: The import is currently running and in progress.
  - `"complete"`: The import finished succesfully without error.
  - `"error"`: The import stopped due to some error. If the server is stopped while an import is running, an import will be marked as with this state on the next startup.
- `error: string | null`: An error code that describes what kind of error occurred with an import. This will have a non-null value only if the the `state` is `"error"`. Currently one of the following values:
  - `"TIMEOUT"`: A timeout error occurred during the import.
  - `"UNKNOWN"`: Error occurred for an unknown reason, usually causing the server to shut down unexpectedly.
- `importedResources: number`: The number of assets (for example, tiles) that have been successfully imported so far.
- `totalResources: number`: The total number of assets (for example, tiles) that have been detected for import.
- `importedBytes: number | null`: Similar to `importedResources`, but for the storage amount if applicable.
- `totalBytes: number | null`: Similar to `totalResources`, but for the storage amount if applicable.
- `started: string`: An ISO 8601 formatted timestamp indicating when the import started.
- `lastUpdated: string | null`: An ISO 8601 formatted timestamp indicating when the import record was last updated.
- `finished: string | null`: An ISO 8601 formatted timestamp indicating when the import finished. The will be a non-null value if the import completed or errored i.e. a `state ` of either `"complete"` or `"error"`.

### `GET /imports/progress/:importId`

- Params:
  - `importId: string`: The ID for the desired import.

Subscribe to progress information for an import. This is a [Server-Sent Events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) endpoint, so it's expected to be used with an [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) by the client.

Messages that are received will have a `data` field with the following structure when deserialized:

- `type: string`: Type indicating the type of progress message. Can be one of the following values:
  - `"progress"`: Import is still in progress
  - `"complete"`: Import is complete
- `importId: string`: ID for import
- `soFar: number`: Number of assets successfully imported so far
- `total: number`: Total number of assets to be imported

If a requested import is already completed or has errored, responds with `204 No Content`, which should prevent the event source from attempting to reconnect. Generally, the client should explicitly close the event source when:

1. Receiving a message and the deserialized `type` value in the event data is either `"complete"` or `"progress"`.
2. Receiving an error

```js
const evtSource = new EventSource(
  'http://localhost:3000/imports/progress/some-import-id'
)

evtSource.onmessage = (event) => {
  const message = JSON.parse(event.data)

  if (message.type === 'complete') {
    evtSource.close()
    return
  }

  // Do something with message...
}

evtSource.onerror = (event) => {
  evtSource.close()
}
```
