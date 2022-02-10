import { beforeEach, test } from 'tap'
import tmp from 'tmp'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs-extra'
import Database, { Database as DatabaseInstance } from 'better-sqlite3'

import { Migration, migrate } from './migrations'

tmp.setGracefulCleanup()

function generateMigrationChecksum(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function isMigrationRecordedAsSuccessful({
  finished_at,
  logs,
  rolled_back_at,
}: Migration) {
  return finished_at !== null && logs === null && rolled_back_at === null
}

const fixtures = {
  initial: `
    CREATE TABLE "Developers" (
        "id" TEXT NOT NULL,
        "first_name" STRING NOT NULL,
        "last_name" STRING NOT NULL,
    
        PRIMARY KEY ("id")
    );
    `,
  migrationAddColumn: `ALTER TABLE "Developers" ADD COLUMN "years_of_experience" INTEGER NOT NULL DEFAULT 0;`,
}

type TestContext = {
  buildMigration: (name: string, query: string) => void
  db: DatabaseInstance
  runMigrations: () => void
}

beforeEach((done, t) => {
  const { name: dataDir } = tmp.dirSync({ unsafeCleanup: true })

  const allMigrationsDir = path.resolve(dataDir, 'migrations')

  fs.mkdirSync(allMigrationsDir)

  const db = new Database(path.resolve(dataDir, 'migrations-test.db'))

  function buildMigration(name: string, query: string) {
    const migrationDir = path.resolve(allMigrationsDir, name)

    fs.mkdirSync(migrationDir)

    fs.writeFileSync(path.resolve(migrationDir, 'migration.sql'), query)
  }

  function runMigrations() {
    migrate(db, dataDir)
  }

  t.context = {
    buildMigration,
    db,
    runMigrations,
  }

  done()
})

test('Works when database schema is not initialized', (t) => {
  const { buildMigration, db, runMigrations } = t.context as TestContext

  const migrationName = 'init'

  function migrationsTableExists() {
    return (
      db
        .prepare(
          "SELECT COUNT(name) as count FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'"
        )
        .get().count > 0
    )
  }

  t.notOk(migrationsTableExists(), 'Migrations table does not exist')

  buildMigration(migrationName, fixtures.initial)

  t.doesNotThrow(runMigrations, 'Initial migration runs without error')

  t.ok(migrationsTableExists(), 'Migrations table now exists')

  const allPersistedMigrations: Migration[] = db
    .prepare("SELECT * FROM '_prisma_migrations'")
    .all()

  t.ok(allPersistedMigrations.length === 1, 'Migration record inserted into db')

  const persistedMigration = allPersistedMigrations[0]

  t.equal(
    persistedMigration?.migration_name,
    migrationName,
    'Migration name persisted sucessfully'
  )

  t.equal(
    persistedMigration?.checksum,
    generateMigrationChecksum(fixtures.initial),
    'Checksum for migration matches hash of migration file'
  )

  t.ok(
    isMigrationRecordedAsSuccessful(persistedMigration),
    'Migration recorded as successful'
  )

  t.done()
})

test('Works when a subsequent migration is run', (t) => {
  const { buildMigration, db, runMigrations } = t.context as TestContext

  buildMigration('init', fixtures.initial)

  runMigrations()

  const migrationName = 'add_column'

  buildMigration(migrationName, fixtures.migrationAddColumn)

  t.doesNotThrow(runMigrations, 'Subsequent migration runs without error')

  const allPersistedMigrations: Migration[] = db
    .prepare("SELECT * FROM '_prisma_migrations'")
    .all()

  t.equal(
    allPersistedMigrations.length,
    2,
    'Both migration records inserted into db'
  )

  allPersistedMigrations.forEach((migration) => {
    t.ok(
      isMigrationRecordedAsSuccessful(migration),
      `Migration with name "${migration.migration_name}" recorded as successful`
    )
  })

  t.done()
})

test('Does nothing when no new migrations need to be applied (idempotency)', (t) => {
  const { buildMigration, db, runMigrations } = t.context as TestContext

  buildMigration('init', fixtures.initial)

  runMigrations()

  const allMigrationsStatement = db.prepare(
    "SELECT * FROM '_prisma_migrations'"
  )

  const migrationsBefore: Migration[] = allMigrationsStatement.all()

  t.doesNotThrow(
    runMigrations,
    'Subsequent and unecessary migration runs without error'
  )

  const migrationsAfter: Migration[] = allMigrationsStatement.all()

  t.deepEquals(
    migrationsBefore,
    migrationsAfter,
    'Persisted migrations are unchanged after empty migration run'
  )

  t.done()
})
