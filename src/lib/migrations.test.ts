import { beforeEach, test } from 'tap'
import tmp from 'tmp'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import Database, { Database as DatabaseInstance } from 'better-sqlite3'

import { Migration, migrate } from './migrations'

type TestContext = {
  buildMigration: (name: string, query: string) => void
  db: DatabaseInstance
  getSQLiteTableInfo: (tableName?: string) => any[]
  runMigrations: () => void
}

tmp.setGracefulCleanup()

const TEST_TABLE_NAME = 'Developers'

function generateMigrationChecksum(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function migrationRecordedAsSuccess({
  finished_at,
  logs,
  rolled_back_at,
}: Migration) {
  return finished_at !== null && logs === null && rolled_back_at === null
}

const fixtures = {
  initial: `
    CREATE TABLE "${TEST_TABLE_NAME}" (
        "id" TEXT NOT NULL,
        "first_name" STRING NOT NULL,
        "last_name" STRING NOT NULL,
    
        PRIMARY KEY ("id")
    );
    `,
  migrationOk: `ALTER TABLE "${TEST_TABLE_NAME}" ADD COLUMN "years_of_experience" INTEGER NOT NULL DEFAULT 0;`,
  // This migration references a non-existing column, "age". Should throw an error because of this.
  migrationBad: `
    PRAGMA foreign_keys=OFF;
    CREATE TABLE "new_${TEST_TABLE_NAME}" (
        "id" TEXT NOT NULL,
        "first_name" STRING NOT NULL,
        "last_name" STRING NOT NULL,
        "age" INTEGER NOT NULL
    );
    INSERT INTO "new_${TEST_TABLE_NAME}" ("id", "first_name", "last_name", "age") SELECT "id", "first_name", "last_name", "age" FROM "${TEST_TABLE_NAME}";
    DROP TABLE "${TEST_TABLE_NAME}";
    ALTER TABLE "new_${TEST_TABLE_NAME}" RENAME TO "${TEST_TABLE_NAME}";
    PRAGMA foreign_key_check;
    PRAGMA foreign_keys=ON;
  `,
}

beforeEach((t) => {
  const { name: dataDir } = tmp.dirSync({ unsafeCleanup: true })

  const allMigrationsDir = path.resolve(dataDir, './prisma/migrations')

  fs.mkdirSync(allMigrationsDir, { recursive: true })

  const db = new Database(path.resolve(dataDir, 'migrations-test.db'))

  function buildMigration(name: string, query: string) {
    const migrationDir = path.resolve(allMigrationsDir, name)

    fs.mkdirSync(migrationDir)

    fs.writeFileSync(path.resolve(migrationDir, 'migration.sql'), query)
  }

  function getSQLiteTableInfo(tableName: string = TEST_TABLE_NAME) {
    // https://www.sqlite.org/pragma.html#pragma_table_info
    return db.pragma(`table_info(${tableName})`)
  }

  function runMigrations() {
    migrate(db, allMigrationsDir)
  }

  t.context = {
    buildMigration,
    db,
    getSQLiteTableInfo,
    runMigrations,
  }
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
    migrationRecordedAsSuccess(persistedMigration),
    'Migration recorded as successful'
  )

  t.end()
})

test('Works when a subsequent migration is run', (t) => {
  const { buildMigration, db, getSQLiteTableInfo, runMigrations } =
    t.context as TestContext

  buildMigration('init', fixtures.initial)

  runMigrations()

  const tableInfoBefore = getSQLiteTableInfo()

  const migrationName = 'add_column'

  buildMigration(migrationName, fixtures.migrationOk)

  t.doesNotThrow(runMigrations, 'Subsequent migration runs without error')

  const allPersistedMigrations: Migration[] = db
    .prepare("SELECT * FROM '_prisma_migrations'")
    .all()

  t.equal(
    allPersistedMigrations.length,
    2,
    'Both migration records inserted into db'
  )

  t.ok(
    allPersistedMigrations.every((migration) =>
      t.ok(
        migrationRecordedAsSuccess(migration),
        `Migration with name "${migration.migration_name}" recorded as successful`
      )
    ),
    'All migrations recorded as successful'
  )

  const tableInfoAfter = getSQLiteTableInfo()

  t.notSame(
    tableInfoBefore,
    tableInfoAfter,
    'Table schema successfully changed after subsequent migration'
  )

  t.end()
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

  t.same(
    migrationsBefore,
    migrationsAfter,
    'Persisted migrations are unchanged after empty migration run'
  )

  t.end()
})

test('Applies multiple migrations sequentially if necessary', (t) => {
  const { buildMigration, db, runMigrations } = t.context as TestContext

  const firstMigrationName = 'init'
  const secondMigrationName = 'add_column'
  buildMigration(firstMigrationName, fixtures.initial)
  buildMigration(secondMigrationName, fixtures.migrationOk)

  t.doesNotThrow(runMigrations, 'Runs migrations with no errors')

  const allMigrations: Migration[] = db
    .prepare("SELECT * FROM '_prisma_migrations' ORDER BY finished_at ASC;")
    .all()

  t.equal(allMigrations.length, 2, 'All migrations recorded in db')

  t.ok(
    allMigrations[0].migration_name === firstMigrationName &&
      allMigrations[1].migration_name === secondMigrationName,
    'Migration order matches expected execution order'
  )

  t.ok(
    allMigrations.every((migration) =>
      t.ok(
        migrationRecordedAsSuccess(migration),
        `Migration with name "${migration.migration_name}" recorded as successful`
      )
    ),
    'All migrations recorded as successful'
  )

  t.end()
})

test('Only updates migrations table when bad migration is attempted', (t) => {
  const { buildMigration, db, getSQLiteTableInfo, runMigrations } =
    t.context as TestContext

  buildMigration('init', fixtures.initial)

  runMigrations()

  const tableInfoBefore = getSQLiteTableInfo()

  const badMigrationName = 'bad'

  buildMigration(badMigrationName, fixtures.migrationBad)

  t.throws(runMigrations, 'Bad migration throws an error')

  const tableInfoAfter = getSQLiteTableInfo()

  const failedMigration: Migration = db
    .prepare("SELECT * FROM '_prisma_migrations' WHERE migration_name = ?;")
    .get(badMigrationName)

  t.ok(failedMigration, 'Bad migration recorded in db')

  t.notOk(
    migrationRecordedAsSuccess(failedMigration),
    'Bad migration recorded as unsuccessful'
  )

  t.same(
    tableInfoBefore,
    tableInfoAfter,
    'Table info unchanged after failed migration attempt'
  )

  t.end()
})
