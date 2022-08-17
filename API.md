# API Documentation

A less verbose variation of this documentation can be found at the `/docs` endpoint of the map server when it is run.

Params of interest are prefixed by a colon (`:`) in the listed endpoint.

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

## Imports

### `GET /imports/:importId`

- Params:
  - `importId`: The ID for the desired import.

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
  - `importId`: The ID for the desired import.

Subscribe to progress information for an import. This is an Server-Sent Events (SSE) endpoint, so its expected to be used with an EventSource by the client.
