import { Worker } from 'worker_threads'
import { TypedEmitter } from 'tiny-typed-emitter'

interface ImportEvents {
  progress: (data: ImportData) => void
}

interface ProgressData {
  type: 'progress'
  importId: string
  soFar: number
  total: number
}

// TODO: Add more discriminate union types as needed
type ImportData = ProgressData

export class ImportProgressEmitter extends TypedEmitter<ImportEvents> {
  constructor(worker: Worker, importIds: string[]) {
    super()

    worker.postMessage({ type: 'subscribe', importIds })

    worker.on('message', (data: ImportData) => {
      switch (data.type) {
        case 'progress':
          if (!importIds.includes(data.importId)) return
          this.emit('progress', data)
          return
      }
    })
  }
}
