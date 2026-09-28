export type NoteSaveState = 'CLEAN' | 'DIRTY' | 'SAVING' | 'SAVED' | 'ERROR'

export type NoteDraftSnapshot = {
  noteId: string
  title: string
  content: string
  contentHtml: string
  fileIds: string[]
  tags: string[]
  editSequence: number
  capturedAt: number
}

type Options = {
  idleMs?: number
  maxWaitMs?: number
  persist: (snapshot: NoteDraftSnapshot) => Promise<void>
  recover: (snapshot: NoteDraftSnapshot | null) => void
  onState?: (state: NoteSaveState) => void
}

export class NoteAutosaveController {
  private readonly idleMs: number
  private readonly maxWaitMs: number
  private readonly persist: Options['persist']
  private readonly recover: Options['recover']
  private readonly onState?: Options['onState']
  private latest: NoteDraftSnapshot | null = null
  private sequence = 0
  private savedSequence = 0
  private queuedSequence = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<void> = Promise.resolve()
  private inFlight: Promise<void> | null = null

  constructor(options: Options) {
    this.idleMs = options.idleMs ?? 600
    this.maxWaitMs = options.maxWaitMs ?? 2_000
    this.persist = options.persist
    this.recover = options.recover
    this.onState = options.onState
  }

  update(snapshot: Omit<NoteDraftSnapshot, 'editSequence' | 'capturedAt'>) {
    this.sequence += 1
    this.latest = { ...snapshot, editSequence: this.sequence, capturedAt: Date.now() }
    try { this.recover(this.latest) } catch { /* Local recovery must not prevent the durable database save. */ }
    this.onState?.('DIRTY')
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => { void this.flush().catch(() => {}) }, this.idleMs)
    if (!this.maxTimer) this.maxTimer = setTimeout(() => { void this.flush().catch(() => {}) }, this.maxWaitMs)
  }

  flush(): Promise<void> {
    if (!this.latest || this.savedSequence >= this.sequence) return this.queue
    if (this.queuedSequence >= this.sequence) return this.inFlight ?? this.queue
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.maxTimer) clearTimeout(this.maxTimer)
    this.idleTimer = null
    this.maxTimer = null
    const snapshot = this.latest
    this.queuedSequence = snapshot.editSequence
    this.onState?.('SAVING')
    const task = this.queue.then(async () => {
      try {
        await this.persist(snapshot)
        this.savedSequence = Math.max(this.savedSequence, snapshot.editSequence)
        if (this.savedSequence === this.sequence) {
          try { this.recover(null) } catch { /* The SQLite save already succeeded. */ }
          this.onState?.('SAVED')
        } else {
          this.onState?.('DIRTY')
        }
      } catch (error) {
        if (this.queuedSequence === snapshot.editSequence) this.queuedSequence = this.savedSequence
        this.onState?.('ERROR')
        throw error
      }
    })
    this.inFlight = task
    void task.finally(() => { if (this.inFlight === task) this.inFlight = null }).catch(() => {})
    this.queue = task.catch(() => {})
    return task
  }

  dispose() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.maxTimer) clearTimeout(this.maxTimer)
    this.idleTimer = null
    this.maxTimer = null
  }
}

export const recoveryKey = (noteId: string) => `jason-os-note-recovery:${noteId}`

export function readNoteRecovery(noteId: string): NoteDraftSnapshot | null {
  try {
    const value = localStorage.getItem(recoveryKey(noteId))
    if (!value) return null
    const parsed = JSON.parse(value) as NoteDraftSnapshot
    return parsed.noteId === noteId ? parsed : null
  } catch { return null }
}

export function writeNoteRecovery(noteId: string, snapshot: NoteDraftSnapshot | null) {
  if (snapshot) localStorage.setItem(recoveryKey(noteId), JSON.stringify(snapshot))
  else localStorage.removeItem(recoveryKey(noteId))
}
