/**
 * Currently assumes that we will use Prisma migrate's directory structure when it comes to migrations.
 *
 * Prisma persists migration history in a table called `_prisma_migrations` with the following structure [^1]:
 *
 *   id: text [^2]
 *   checksum: text [^3]
 *   finished_at: datetime (nullable)
 *   logs: text (nullable)
 *   rolled_back_at: datetime (nullable)
 *   started_at: datetime
 *   applied_steps_count: integer (unsigned)
 *
 * [^1] Reference: https://github.com/prisma/prisma-engines/blob/e1a51505ab49d6b3e3d1884d4c74b304d56eed15/migration-engine/connectors/migration-connector/src/migration_persistence.rs#L87
 * [^2] A UUID v4 string
 * [^3] A SHA-256 hash of the generated SQL migration file content
 *
 * Might be worth exploring how to potentially use that for maintaining migration history (https://www.prisma.io/docs/concepts/components/prisma-migrate#migration-history)
 */
import path from 'path'
import fs from 'fs'
import process from 'process'
import { Database } from 'better-sqlite3'

const BASE_MIGRATIONS_DIR_PATH = path.resolve(
  process.cwd(),
  './prisma/migrations'
)

export function migrate(db: Database) {
  // TODO: We'll need to persist unique names somewhere if we want to support migrations properly.
  // Maybe use the `_prisma_migrations` table or create a table that's initialized from that?
  // We could theoretically store this in the db or maybe just persist as a JSON file?
  const mostRecentMigrationName = 'TEST'

  const migrationFilePaths = getMigrationFilePaths(mostRecentMigrationName)

  migrationFilePaths.forEach((p) => {
    const migration = fs.readFileSync(p, 'utf8')
    db.exec(migration)

    // TODO: Persist the name of the migration that's been applied
  })
}

// TODO: At the moment, there's really only ever gonna be a single migration to read.
// However, we should be able to support multiple to make things easier later on
function getMigrationFilePaths(mostRecentMigrationName?: string): string[] {
  const prismaMigrateDirents = fs.readdirSync(BASE_MIGRATIONS_DIR_PATH, {
    withFileTypes: true,
  })

  const sortedMigrationDirectories = prismaMigrateDirents
    .filter((dirent) => dirent.isDirectory())
    .sort((dir1, dir2) => {
      const dir1Stat = fs.statSync(
        path.resolve(BASE_MIGRATIONS_DIR_PATH, dir1.name)
      )
      const dir2Stat = fs.statSync(
        path.resolve(BASE_MIGRATIONS_DIR_PATH, dir2.name)
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
    .map((dirent) =>
      path.resolve(BASE_MIGRATIONS_DIR_PATH, dirent.name, 'migration.sql')
    )
}
