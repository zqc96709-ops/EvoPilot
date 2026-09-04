import { describe, expect, it } from 'vitest'
import { synchronize, type SyncReplica, type SyncTransport } from './client'
import type { SyncConflict, SyncMutation } from './protocol'

describe('sync client', () => {
  it('pushes, acknowledges, then pulls using the committed cursor', async () => {
    const pending: SyncMutation[] = [{ mutationId: 'm1', workspaceId: 'local', deviceId: 'mac', entityType: 'tasks', entityId: 't1', operation: 'CREATE', baseRevision: 0, changedFields: ['title'], payload: { title: 'A' }, protocolVersion: 1, createdAt: '1' }]
    let cursor = 0; const conflicts: SyncConflict[] = []
    const replica: SyncReplica = { pending: async () => pending, acknowledge: async (ids, next) => { expect(ids).toEqual(['m1']); cursor = next }, cursor: async () => cursor, apply: async (_changes, next) => { cursor = next }, saveConflict: async (value) => { conflicts.push(value) } }
    const transport: SyncTransport = { health: async () => ({ protocolVersion: 1, minSupportedVersion: 1 }), push: async () => ({ results: [{ mutationId: 'm1', status: 'APPLIED', serverSequence: 3 }] }), pull: async (from) => { expect(from).toBe(3); return { changes: [], nextCursor: 3 } } }
    await expect(synchronize(replica, transport)).resolves.toMatchObject({ pushed: 1, pulled: 0 })
    expect(conflicts).toHaveLength(0)
  })

  it('keeps the local outbox intact when the server is unavailable', async () => {
    let acknowledged = false
    const mutation: SyncMutation = { mutationId: 'offline', workspaceId: 'local', deviceId: 'mac', entityType: 'tasks', entityId: 't1', operation: 'UPDATE', baseRevision: 1, changedFields: ['title'], payload: { title: 'offline' }, protocolVersion: 1, createdAt: '1' }
    const replica: SyncReplica = { pending: async () => [mutation], acknowledge: async () => { acknowledged = true }, cursor: async () => 0, apply: async () => {}, saveConflict: async () => {} }
    const transport: SyncTransport = { health: async () => ({ protocolVersion: 1, minSupportedVersion: 1 }), push: async () => { throw new Error('ECONNREFUSED') }, pull: async () => ({ changes: [], nextCursor: 0 }) }
    await expect(synchronize(replica, transport)).rejects.toThrow('ECONNREFUSED')
    expect(acknowledged).toBe(false)
  })
})
