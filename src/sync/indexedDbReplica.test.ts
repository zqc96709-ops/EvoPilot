import { describe, expect, it } from 'vitest'
import { recordFromSyncChange } from './indexedDbReplica'

describe('IndexedDbReplica sync envelope', () => {
  it('adds stable timestamps when a desktop payload omits its record envelope', () => {
    const record = recordFromSyncChange({
      mutationId: 'm1', workspaceId: 'local', deviceId: 'mac', entityType: 'tasks', entityId: 't1',
      operation: 'CREATE', baseRevision: 0, changedFields: ['title'], payload: { title: 'From Mac' },
      protocolVersion: 1, createdAt: '2026-09-04T15:00:00.000Z', serverRevision: 1, serverSequence: 1,
    })

    expect(record).toMatchObject({ id: 't1', entity: 'tasks', title: 'From Mac', createdAt: '2026-09-04T15:00:00.000Z', updatedAt: '2026-09-04T15:00:00.000Z', revision: 1 })
  })
})
