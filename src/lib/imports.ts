import type { Database } from 'better-sqlite3'

export const IMPORT_ERRORS = {
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const

/**
 * An error code that describes what kind of error occurred with an import. Currently one of the following values:
 *
 * - "TIMEOUT": A timeout error occurred during the import.
 * - "UNKNOWN": Error occurred for an unknown reason, usually causing the server to shut down unexpectedly.
 */
type ImportError = keyof typeof IMPORT_ERRORS

type ImportRecordBase = {
  /**
   * The id of the import as represented in the database. This should be the same as the `:importId` param that is provided in this case.
   */
  id: string
  /**
   * An ISO 8601 formatted timestamp indicating when the import started.
   */
  started: string
  /**
   * The number of assets (for example, tiles) that have been successfully imported so far.
   */
  importedResources: number
  /**
   * The total number of assets (for example, tiles) that have been detected for import.
   */
  totalResources: number
  /**
   * Similar to `importedResources`, but for the storage amount if applicable.
   */
  importedBytes: null | number
  /**
   * Similar to `totalResources`, but for the storage amount if applicable.
   */
  totalBytes: null | number
}

type ActiveImportRecord = ImportRecordBase & {
  /**
   * "active" when this import is currently in progress.
   */
  state: 'active'
  error: null
  /**
   * An ISO 8601 formatted timestamp indicating when the import was last updated. Can be `null` if the import hasn't started yet.
   */
  lastUpdated: null | string
  /**
   * An ISO 8601 formatted timestamp indicating when the import finished.
   * The will be a non-null value if the import completed or errored i.e. a `state` of either "complete" or "error".
   */
  finished: null
}

type CompleteImportRecord = ImportRecordBase & {
  /**
   * "complete" when this import finished successfully.
   */
  state: 'complete'
  error: null
  lastUpdated: string
  finished: string
}

type ErrorImportRecord = ImportRecordBase & {
  /**
   * "error" when this import stopped due to some error.
   * If the server is stopped while an import is running, the import will be marked as "error".
   */
  state: 'error'
  /**
   * The error that caused this import to stop. Only present if the state is "error".
   */
  error: ImportError
  lastUpdated: string
  finished: string
}

export type ImportRecord =
  | ActiveImportRecord
  | CompleteImportRecord
  | ErrorImportRecord

export function convertActiveToError(db: Database) {
  db.prepare(
    "UPDATE Import SET state = 'error', error = 'UNKNOWN', finished = CURRENT_TIMESTAMP WHERE state = 'active'"
  ).run()
}
