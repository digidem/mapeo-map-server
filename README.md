# Mapeo Map Server

![Build Status](https://github.com/digidem/mapeo-mapserver/actions/workflows/node.yml/badge.svg)

An in-progress offline map style and tile server for Mapeo.

`npm install @mapeo/mapserver`

## Features

- [X] Manages tiles and tilesets (TileJSON)

- [X] Manages Mapbox map styles

- [X] Supports importing MBTile files as tilesets
  - [ ] Supports getting import progress

- [ ] Provides info related to downloads and storage


## Usage

The default export is a function that creates a map server instance, which is built on top of [Fastify](https://www.fastify.io/). Basic usage is as follows:

```js
// If you're using TypeScript, you may want to use one of the following import syntaxes to get type definitions:
// - `require('@mapeo/mapserver').default`
// - `import createMapServer from '@mapeo/mapServer'
const createMapServer = require('@mapeo/mapserver')

// Create the map server instance
const mapServer = createMapServer({ logger: true }, { dbPath: "./example.db" });

// Run the server!
mapServer.listen(3000, function (err) {
  if (err) {
    maspServer.log.error(err);
    process.exit(1);
  }
});
```

### `createMapServer(fastifyOpts, mapServerOpts)`

Creates the map server instance.

- `fastifyOpts (optional)`: Options to customize the Fastify instance. Refer to the [official Fastify documentation](https://www.fastify.io/docs/latest/Reference/Server/) for more details.
- `mapServerOpts (optional)`: Options to customize the map server instance. Options include:
  - `dbPath: string (optional)`: File path that points to the SQLite database to use. If the file does not exist, it will be created. If not specified, the database will be created in memory.

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
