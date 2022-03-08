import { ImportProgressEmitter } from './import_progress_emitter'

/**
 * Very simple (for now) manager of several tileset import emitters.
 * There may be a need to add persistence here, but for now it just keeps them in memory.
 */
export class TilesetImportManager {
  // A map of tileset ids to their respective progress emitter
  private imports = new Map<string, ImportProgressEmitter>()

  public add(id: string, emitter: ImportProgressEmitter) {
    this.imports.set(id, emitter)
  }

  public get(id: string) {
    const result = this.imports.get(id)
    if (!result) throw new Error()
    return result
  }

  public remove(id: string) {
    this.imports.delete(id)
  }
}
