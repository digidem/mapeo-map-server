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
