# Mapeo Map Server

![Build Status](https://github.com/digidem/mapeo-map-server/actions/workflows/node.yml/badge.svg)

An in-progress offline map style and tile server for Mapeo.

`npm install @mapeo/map-server`

_⚠️ This is alpha software. No guarantees can be made about the stability of the API at the moment, so proceed with caution. 😄_

## Features

- [x] Manages tiles and tilesets (TileJSON)

- [x] Manages Mapbox map styles

- [x] Supports importing MBTile files as tilesets

  - [x] Supports getting import progress

- [ ] Provides info related to downloads and storage

## Usage

The default export is a function for creating a map server instance. Basic usage is as follows:

```js
// If you're using TypeScript, you may want to use one of the following import syntaxes to get type definitions:
// - `require('@mapeo/map-server').default`
// - `import createMapServer from '@mapeo/map-server'
const createMapServer = require('@mapeo/map-server')

// Create the server instance
const mapServer = createMapServer({ storagePath: './map-server-example.db' })

// Run the server!
await mapServer.listen(3000)
```

### `createServer(opts): MapServer`

Creates the map server instance

- `opts (required)`: Options object to customize the map server instance. Options include:
  - `storagePath: string (required)`: Path to use for persistent map server storage. Happens to be a SQLite database under the hood, but consumers should treat this as an opaque path managed exclusively by the map server.

## API Documentation

API documentation is available in [API.md](/API.md).

## Technical Details

- [Fastify](https://fastify.io/) for creating the server.
- [SQLite](https://sqlite.org/index.html) as the underlying persistence layer.
- [Prisma](https://www.prisma.io/) as a **build** tool for updating the schema, creating migration scripts, and generating schema assets.
  - Schema diagram can be found [here](/prisma/ERD.svg).
  - Due to the distributed and local-first nature of Mapeo, migrations are performed at runtime by the server on initialization. See the [migrations implementation](/src/lib/migrations.ts) for more details. It roughly follows the logic that Prisma uses for build-time migrations.

## Developing

Some notes before working on this locally:

- If you make any changes to the schema via `schema.prisma`, run the following commands afterwards:
  - `npm run prisma:migrate-dev -- --name MIGRATION_NAME_HERE` - creates a new migration in the `prisma/migrations/` directory, which is used by tests and the server if running locally

## License

MIT
