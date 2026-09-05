import { describe, expect, it } from 'vitest'
import { recordFromSyncChange, supersededNoteMutationIds } from './indexedDbReplica'

describe('IndexedDbReplica sync envelope', () => {
  it('adds stable timestamps when a desktop payload omits its record envelope', () => {
    const record = recordFromSyncChange({
      mutationId: 'm1', workspaceId: 'local', deviceId: 'mac', entityType: 'tasks', entityId: 't1',
      operation: 'CREATE', baseRevision: 0, changedFields: ['title'], payload: { title: 'From Mac' },
      protocolVersion: 1, createdAt: '2026-09-04T15:00:00.000Z', serverRevision: 1, serverSequence: 1,
    })

    expect(record).toMatchObject({ id: 't1', entity: 'tasks', title: 'From Mac', createdAt: '2026-09-04T15:00:00.000Z', updatedAt: '2026-09-04T15:00:00.000Z', revision: 1 })
  })

  it('coalesces only pending updates for the same note', () => {
    const mutation = (mutationId: string, entityType: string, entityId: string, operation: 'CREATE' | 'UPDATE') => ({ mutationId, workspaceId: 'local', deviceId: 'web', entityType, entityId, operation, baseRevision: 0, changedFields: ['content'], payload: {}, protocolVersion: 1, createdAt: mutationId })
    const latest = mutation('m4', 'notes', 'note-1', 'UPDATE')
    expect(supersededNoteMutationIds([
      mutation('m1', 'notes', 'note-1', 'CREATE'),
      mutation('m2', 'notes', 'note-1', 'UPDATE'),
      mutation('m3', 'notes', 'note-2', 'UPDATE'),
    ], latest)).toEqual(['m2'])
  })
})
