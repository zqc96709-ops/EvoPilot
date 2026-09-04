import { describe, expect, it } from 'vitest'
import type { RecordData } from '../model'
import { assertProtocolCompatible, mergeConcurrentRecord } from './protocol'

const task = (extra: Partial<RecordData> = {}) => ({
  id: 'task-1', entity: 'tasks', title: 'Old', priority: 'MEDIUM', createdAt: '1', updatedAt: '1', revision: 1, ...extra,
}) as RecordData

describe('Jason Sync Protocol', () => {
  it('merges edits to disjoint fields without trusting device clocks', () => {
    const result = mergeConcurrentRecord(task(), task({ title: 'Mac title', updatedAt: '999' }), task({ priority: 'HIGH', updatedAt: '1' }))
    expect(result.kind).toBe('merged')
    if (result.kind === 'merged') expect(result.value).toMatchObject({ title: 'Mac title', priority: 'HIGH' })
  })

  it('keeps a recoverable conflict when both devices edit the same field', () => {
    const result = mergeConcurrentRecord(task(), task({ title: 'Mac' }), task({ title: 'iOS' }))
    expect(result.kind).toBe('conflict')
    if (result.kind === 'conflict') expect(result.conflict.fields).toEqual(['title'])
  })

  it('lets tombstones win over stale edits', () => {
    const result = mergeConcurrentRecord(task(), task({ title: 'stale edit' }), task({ deletedAt: 'now' }))
    expect(result.kind === 'merged' && result.value.deletedAt).toBe('now')
  })

  it('rejects incompatible protocol versions', () => {
    expect(() => assertProtocolCompatible({ protocolVersion: 2, minSupportedVersion: 2 })).toThrow('UPGRADE_REQUIRED')
  })
})
