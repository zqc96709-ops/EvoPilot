import type { RecordData } from '../model'
import type { SyncChange, SyncConflict, SyncMutation } from './protocol'
import type { SyncReplica } from './client'

const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error) })

export const recordFromSyncChange = (change: SyncChange): RecordData => {
  const syncedAt = change.createdAt || new Date(0).toISOString()
  return {
    ...change.payload,
    id: change.entityId,
    entity: change.entityType,
    createdAt: String(change.payload.createdAt || syncedAt),
    updatedAt: String(change.payload.updatedAt || syncedAt),
    revision: change.serverRevision,
  } as RecordData
}

export const supersededNoteMutationIds = (pending: SyncMutation[], latest: SyncMutation) => latest.entityType === 'notes' && latest.operation === 'UPDATE'
  ? pending.filter((item) => item.entityType === 'notes' && item.entityId === latest.entityId && item.operation === 'UPDATE' && item.mutationId !== latest.mutationId).map((item) => item.mutationId)
  : []

export class IndexedDbReplica implements SyncReplica {
  private db: IDBDatabase
  private constructor(db: IDBDatabase) { this.db = db }
  static async open(name = 'jason-os-working-replica') {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('records', { keyPath: 'id' })
      db.createObjectStore('outbox', { keyPath: 'mutationId' })
      db.createObjectStore('meta')
      db.createObjectStore('conflicts', { keyPath: 'conflictId' })
    }
    return new IndexedDbReplica(await requestValue(request))
  }
  async save(record: RecordData, mutation: SyncMutation) {
    const transaction = this.db.transaction(['records', 'outbox'], 'readwrite')
    transaction.objectStore('records').put(record)
    const outbox = transaction.objectStore('outbox')
    if (mutation.entityType === 'notes' && mutation.operation === 'UPDATE') {
      const pending = outbox.getAll()
      pending.onsuccess = () => {
        for (const id of supersededNoteMutationIds(pending.result as SyncMutation[], mutation)) outbox.delete(id)
        outbox.put(mutation)
      }
    } else outbox.put(mutation)
    await transactionDone(transaction)
  }
  async records() {
    const records = await requestValue(this.db.transaction('records').objectStore('records').getAll()) as RecordData[]
    return records.map((record) => ({ ...record, createdAt: String(record.createdAt || record.updatedAt || ''), updatedAt: String(record.updatedAt || record.createdAt || '') }))
  }
  async record(id: string) { return (await requestValue(this.db.transaction('records').objectStore('records').get(id)) as RecordData | undefined) || null }
  async importLegacy(records: RecordData[]) {
    if (!records.length || (await this.records()).length) return
    const transaction = this.db.transaction('records', 'readwrite')
    for (const record of records) transaction.objectStore('records').put(record)
    await transactionDone(transaction)
  }
  async mutate(records: Array<{ record: RecordData; mutation: SyncMutation }>) {
    const transaction = this.db.transaction(['records', 'outbox'], 'readwrite')
    for (const item of records) {
      transaction.objectStore('records').put(item.record)
      transaction.objectStore('outbox').put(item.mutation)
    }
    await transactionDone(transaction)
  }
  async pending(limit: number) {
    const all = await requestValue(this.db.transaction('outbox').objectStore('outbox').getAll()) as SyncMutation[]
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit)
  }
  async acknowledge(ids: string[], cursor: number) {
    const transaction = this.db.transaction(['outbox', 'meta'], 'readwrite')
    ids.forEach((id) => transaction.objectStore('outbox').delete(id))
    transaction.objectStore('meta').put(cursor, 'serverCursor')
    await transactionDone(transaction)
  }
  async cursor() { return (await requestValue(this.db.transaction('meta').objectStore('meta').get('serverCursor')) as number | undefined) || 0 }
  async conflictCount() { return requestValue(this.db.transaction('conflicts').objectStore('conflicts').count()) }
  async apply(changes: SyncChange[], cursor: number) {
    const transaction = this.db.transaction(['records', 'meta'], 'readwrite')
    for (const change of changes) transaction.objectStore('records').put(recordFromSyncChange(change))
    transaction.objectStore('meta').put(cursor, 'serverCursor')
    await transactionDone(transaction)
  }
  async saveConflict(conflict: SyncConflict) {
    const transaction = this.db.transaction('conflicts', 'readwrite')
    transaction.objectStore('conflicts').put(conflict)
    await transactionDone(transaction)
  }
}
