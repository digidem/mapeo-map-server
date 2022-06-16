import { RunResult } from 'better-sqlite3'

export interface WorkerData {
  dbPath: string
  importId: string
  mbTilesDbPath: string
  styleId: string
  tilesetId: string
}

export interface Queries {
  getMbTilesImportTotals: () => { bytes: number; tiles: number }
  getMbTileTileRows: () => IterableIterator<{
    data: Buffer
    z: number
    y: number
    x: number
  }>
  upsertOfflineArea: (params: {
    id: string
    zoomLevel: string
    boundingBox: string
    name: string
    styleId: string
  }) => RunResult
  insertImport: (params: {
    id: string
    totalResources: number
    totalBytes: number
    areaId: string
    tilesetId?: string
  }) => RunResult
  updateImport: (params: {
    id: string
    importedResources: number
    importedBytes: number
    isComplete: number
  }) => RunResult
  upsertTileData: (params: {
    data: Buffer
    tileHash: string
    tilesetId: string
  }) => RunResult
  upsertTile: (params: {
    quadKey: string
    tileHash: string
    tilesetId: string
  }) => RunResult
}

export type MessageComplete = {
  type: 'complete'
  importId: string
}
export type MessageProgress = {
  type: 'progress'
  importId: string
  soFar: number
  total: number
}
export type MessageStart = { type: 'start' }

// Message types received by the port (main thread)
export type PortMessage = MessageProgress | MessageComplete

// Message types received by the worker
export type WorkerMessage = MessageStart
