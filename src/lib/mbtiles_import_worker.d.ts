import { Statement } from 'better-sqlite3'

export interface ImportWorkerOptions {
  dbPath: string
  importId: string
  mbTilesDbPath: string
  styleId: string
  tilesetId: string
  port: MessagePort
}

export interface Queries {
  getMbTilesImportTotals(): { bytes: number; tiles: number }
  getMbTilesTileRows(): IterableIterator<{
    data: Buffer
    z: number
    y: number
    x: number
  }>
  upsertOfflineArea: Statement<{
    id: string
    zoomLevel: string
    boundingBox: string
    name: string
    styleId: string
  }>
  insertImport: Statement<{
    id: string
    totalResources: number
    totalBytes: number
    areaId: string
    tilesetId?: string
  }>
  updateImport: Statement<{
    id: string
    importedResources: number
    importedBytes: number
    isComplete: number
  }>
  upsertTileData: Statement<{
    data: Buffer
    tileHash: string
    tilesetId: string
  }>
  upsertTile: Statement<{
    quadKey: string
    tileHash: string
    tilesetId: string
  }>
}

export type MessageProgress = {
  type: 'progress'
  importId: string
  soFar: number
  total: number
}

// Message types received by the port (main thread)
export type PortMessage = MessageProgress
