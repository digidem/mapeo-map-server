import TypedEmitter from 'typed-emitter'
import { EventEmitter } from 'events'

export interface ImportProgressData {
  soFar: number
  total: number
}

/**
 * An EventEmitter with a specific interface designed to support
 * getting tileset import info via a subscription and triggering actions based on defined events
 */
export class ImportProgressEmitter extends (EventEmitter as new () => TypedEmitter<{
  started: (size: number) => void
  error: (message: string) => void
  progress: (data: ImportProgressData) => void
  finished: (error?: string) => void
}>) {
  private soFar = 0
  private total?: number
  private error?: string
  public id: string

  constructor(id: string) {
    super()

    this.id = id

    this.on('error', (message) => {
      this.error = message
      this.stopListeningToProgress()
    })

    this.on('progress', ({ soFar, total }) => {
      if (this.status === 'IDLE') {
        this.emit('started', total)
      }

      this.soFar = soFar
      this.total = total

      if (this.soFar === this.total) this.finish()
    })
  }

  get status() {
    if (this.error) return 'ERROR'
    if (this.total === undefined) return 'IDLE'
    return this.soFar === this.total ? 'FINISHED' : 'ACTIVE'
  }

  get size() {
    return this.total
  }

  private stopListeningToProgress() {
    this.removeAllListeners('progress')
  }

  private finish() {
    this.stopListeningToProgress()
    this.emit('finished', this.error)
  }
}
