import { invoke } from '@tauri-apps/api/core'
import type { SyncChange, SyncConflict, SyncMutation } from './protocol'
import type { SyncReplica } from './client'

export class TauriSqliteReplica implements SyncReplica {
  pending(limit: number) { return invoke<SyncMutation[]>('list_sync_outbox', { limit }) }
  acknowledge(ids: string[], cursor: number) { return invoke<void>('acknowledge_sync_mutations', { mutationIds: ids, serverCursor: cursor }) }
  async cursor() { return (await invoke<{ serverCursor: number }>('get_sync_status')).serverCursor }
  apply(changes: SyncChange[], cursor: number) { return invoke<void>('apply_sync_changes', { changes, serverCursor: cursor }) }
  saveConflict(conflict: SyncConflict) { return invoke<void>('save_sync_conflict', { conflict }) }
}
