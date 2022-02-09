/**
 * Currently assumes that we will use Prisma migrate's directory structure when it comes to migrations.
 *
 * Prisma persists migration history in a table called `_prisma_migrations`:
 * https://github.com/prisma/prisma-engines/blob/main/migration-engine/ARCHITECTURE.md#the-_prisma_migrations-table
 *
 * Docs on migration history: https://www.prisma.io/docs/concepts/components/prisma-migrate#migration-history
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { Database, SqliteError } from 'better-sqlite3'

export function migrate(db: Database, dataDir: string) {
  // Determine whether the initial setup has been completed before
  const migrationsTableExists =
    db
      .prepare(
        "SELECT COUNT(name) as count FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'"
      )
      .get().count > 0

  if (!migrationsTableExists) {
    // Taken from `prisma-engines` with a slight alteration to how we store dates (we want more granular):
    // https://github.com/prisma/prisma-engines/blob/863b4a98c22936a01efd27ab814b452f6a62cd73/migration-engine/connectors/sql-migration-connector/src/flavour/sqlite.rs#L61
    db.prepare(
      `CREATE TABLE "_prisma_migrations" (
        "id"                    TEXT PRIMARY KEY NOT NULL,
        "checksum"              TEXT NOT NULL,
        "finished_at"           DATETIME,
        "migration_name"        TEXT NOT NULL,
        "logs"                  TEXT,
        "rolled_back_at"        DATETIME,
        "started_at"            DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', current_timestamp)),
        "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
      );`
    ).run()
  }

  const mostRecentMigrationName: string | undefined = db
    // Note that `finished_at` must have millisecond granularity in order for the ORDER BY to work as expected
    // Otherwise, it won't work in the case where multiple migrations are applied in one go
    .prepare(
      `SELECT migration_name as name FROM '_prisma_migrations'
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY finished_at DESC LIMIT 1;`
    )
    .get()?.name

  const migrationsToApply = getUnappliedMigrations(
    dataDir,
    mostRecentMigrationName
  )

  migrationsToApply.forEach((migration) => {
    const migrationFile = fs.readFileSync(migration.path, 'utf8')

    const migrationId = uuidv4()

    db.prepare<{
      id: string
      checksum: string
      migration_name: string
    }>(
      "INSERT INTO '_prisma_migrations' (id, checksum, migration_name) VALUES (:id, :checksum, :migration_name);"
    ).run({
      id: migrationId,
      checksum: crypto
        .createHash('sha256')
        .update(migrationFile.toString())
        .digest('hex'),
      migration_name: migration.name,
    })

    const executeMigration = db.transaction(() => {
      db.exec(migrationFile)
    })

    try {
      executeMigration()

      // Reference for SQLite date functions: https://www.sqlite.org/lang_datefunc.html
      db.prepare<{
        id: string
        finished_at: number
      }>(
        `UPDATE '_prisma_migrations' 
        SET
          finished_at = strftime('%Y-%m-%d %H:%M:%f', :finished_at / 1000, 'unixepoch'),
          applied_steps_count = 1
        WHERE id = :id;`
      ).run({
        id: migrationId,
        finished_at: Date.now().valueOf(),
      })
    } catch (err) {
      if (err instanceof SqliteError) {
        db.prepare<{
          id: string
          logs: string
          rolled_back_at: number
        }>(
          `UPDATE '_prisma_migrations' 
          SET
            logs = :logs,
            rolled_back_at = strftime('%Y-%m-%d %H:%M:%f', :rolled_back_at / 1000, 'unixepoch')
          WHERE id = :id;`
        ).run({
          id: migrationId,
          logs: err.message,
          rolled_back_at: Date.now().valueOf(),
        })
      }

      throw err
    }
  })
}

function getUnappliedMigrations(
  dataDir: string,
  mostRecentMigrationName?: string
): { path: string; name: string }[] {
  const migrationsDirectoryPath = path.resolve(dataDir, 'migrations')

  const prismaMigrateDirents = fs.readdirSync(migrationsDirectoryPath, {
    withFileTypes: true,
  })

  // TODO: Kind of a lazy approach: we sort the directories (each of which is a migration name) based on their creation date
  // and then use the provided `mostRecentMigrationName` to determine which migrations we want to apply
  // i.e. any migration directory that was created after the directory named `mostRecentMigrationName`
  const sortedMigrationDirectories = prismaMigrateDirents
    .filter((dirent) => dirent.isDirectory())
    .sort((dir1, dir2) => {
      const dir1Stat = fs.statSync(
        path.resolve(migrationsDirectoryPath, dir1.name)
      )
      const dir2Stat = fs.statSync(
        path.resolve(migrationsDirectoryPath, dir2.name)
      )

      // Sort from oldest to newest created date
      return dir1Stat.ctimeMs - dir2Stat.ctimeMs
    })

  const currentMigrationIndex = mostRecentMigrationName
    ? sortedMigrationDirectories.findIndex(
        (dir) => dir.name === mostRecentMigrationName
      )
    : -1

  return sortedMigrationDirectories
    .slice(currentMigrationIndex + 1, sortedMigrationDirectories.length)
    .map((dirent) => ({
      name: dirent.name,
      path: path.resolve(migrationsDirectoryPath, dirent.name, 'migration.sql'),
    }))
}
