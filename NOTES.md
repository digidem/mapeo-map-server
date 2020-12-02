# Implementation notes

tilelive is deprecated, and does not provide any streaming API - every tile is loaded into memory.

sqlite / mbtiles also do not have a streams API.

Better: use hyperdrive for local storage/cache of tiles, it will allow the tiles to be replicated at a later stage.

Store etag from request in order to check for stale tiles / re-download. We can write this to the file metadata in the hyperdrive.

Still have the issue with hyperdrive not supporting deletes -- if tiles do update then could end up with filesize growing, since old versions will remain on disk.

Need also hash of tiles to dedupe writes. Solution: pipe tile downloads through a hash stream, then write to an index (leveldb?) that maps hash to filename. Split readstream from upstream server: (1) passthrough to response, (2) collect-stream + hash, check for existing hash: NO --> Write to hyperdrive and write to index; YES --> Write symlink to hyperdrive.

Index should be attached to the metadata `append` listener, so that it also regenerates during replication. Index should store metadata.length, to know when to start listening / what to read on first load. E.g. load hyperdrive, compare index length with metadata.length, update as needed.

## TODO

- Lazy creation of mbtiles caches
- Don't require format on tilejson, guess it from URLs
