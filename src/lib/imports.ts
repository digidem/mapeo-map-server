import { Database } from 'better-sqlite3'
import { Static, Type as T } from '@sinclair/typebox'

import { NullableSchema } from './utils'

const ImportErrorSchema = T.Union([T.Literal('TIMEOUT'), T.Literal('UNKNOWN')])
export type ImportError = Static<typeof ImportErrorSchema>

const ImportState = T.Union([
  T.Literal('complete'),
  T.Literal('active'),
  T.Literal('error'),
])
export type ImportState = Static<typeof ImportState>

const BASE_RECORD_SCHEMA_INPUT = {
  // error: NullableSchema(ImportErrorSchema),
  started: T.String(),
  // lastUpdated: NullableSchema(T.String()),
  // finished: NullableSchema(T.String()),
  importedResources: T.Number({ minimum: 0 }),
  totalResources: T.Number({ minimum: 0 }),
  importedBytes: NullableSchema(T.Number({ minimum: 0 })),
  totalBytes: NullableSchema(T.Number({ minimum: 0 })),
}

const ActiveImportRecordSchema = T.Object({
  ...BASE_RECORD_SCHEMA_INPUT,
  state: T.Literal('active'),
  error: T.Null(),
  lastUpdated: NullableSchema(T.String()),
  finished: T.Null(),
})
type ActiveImportRecord = Static<typeof ActiveImportRecordSchema>

const CompleteImportRecordSchema = T.Object({
  ...BASE_RECORD_SCHEMA_INPUT,
  state: T.Literal('complete'),
  error: T.Null(),
  lastUpdated: T.String(),
  finished: T.Null(),
})
type CompleteImportRecord = Static<typeof CompleteImportRecordSchema>

const ErrorImportRecordSchema = T.Object({
  ...BASE_RECORD_SCHEMA_INPUT,
  state: T.Literal('error'),
  error: ImportErrorSchema,
  lastUpdated: T.String(),
  finished: T.Null(),
})
type ErrorImportRecord = Static<typeof ErrorImportRecordSchema>

export const ImportRecordSchema = T.Union([
  ActiveImportRecordSchema,
  CompleteImportRecordSchema,
  ErrorImportRecordSchema,
])
export type ImportRecord = Static<typeof ImportRecordSchema>

export function convertActiveToError(db: Database) {
  db.prepare(
    "UPDATE Import SET state = 'error', error = 'UNKNOWN', finished = CURRENT_TIMESTAMP WHERE state = 'active'"
  ).run()
}
