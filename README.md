# Mapeo Map Server

An in-progress offline map style and tile server for Mapeo

## Technical Details

- [Fastify](https://fastify.io/) for creating the server.
- [SQLite](https://sqlite.org/index.html) as the underlying persistence layer.
- [Prisma](https://www.prisma.io/) as a **build** tool for updating the schema, creating migration scripts, and generating schema assets.
  - Schema diagram can be found [here](/prisma/ERD.svg).
  - Due to the distributed and local-first nature of Mapeo, migrations are performed at runtime by the server on initialization. See the [migrations implementation](/src/lib/migrations.ts) for more details. It roughly follows the logic that Prisma uses for build-time migrations.

## Features

- [ ] Manages tiles and tilesets (TileJSON)

- [ ] Manages Mapbox map styles

- [ ] Supports importing MBTile files as tilesets

- [ ] Generate styles for raster tilesets

- [ ] Provides info related to downloads and storage

## Developing

Some notes before working on this locally:

- If you make any changes to the schema via `schema.prisma`, run the following commands afterwards:
  - `npm run prisma:migrate:dev -- --name MIGRATION_NAME_HERE` - creates a new migration in the `prisma/migrations/` directory, which is used by tests and the server if running locally
