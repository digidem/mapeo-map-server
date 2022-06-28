import { Database } from 'better-sqlite3'

export type ImportError = 'TIMEOUT' | 'UNKNOWN'
export type ImportState = 'complete' | 'active' | 'error'

type BaseRecord = {
  error: ImportError | null
  started: string
  lastUpdated: string | null
  finished: string | null
  importedResources: number
  totalResources: number
  importedBytes: number | null
  totalBytes: number | null
}

type ActiveImportRecord = BaseRecord & {
  state: 'active'
  error: null
  lastUpdated: string | null
  finished: null
}

type CompleteImportRecord = BaseRecord & {
  state: 'complete'
  error: null
  lastUpdated: string
  finished: string
}

type ErrorImportRecord = BaseRecord & {
  state: 'error'
  error: ImportError
  lastUpdated: string
  finished: string
}

export type ImportRecord =
  | ActiveImportRecord
  | CompleteImportRecord
  | ErrorImportRecord

export function convertActiveToError(db: Database) {
  // TODO: Should we set `finished` to Import.lastUpdated instead here?
  db.prepare(
    "UPDATE Import SET state = 'error', error = 'UNKNOWN', finished = CURRENT_TIMESTAMP WHERE state = 'active'"
  ).run()
}
