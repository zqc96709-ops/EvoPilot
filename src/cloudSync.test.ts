import { describe, expect, it } from 'vitest'
import { syncRecordWinner } from './cloudSync'
import type { RecordData } from './model'

const record = (id: string, updatedAt: string): RecordData => ({ id, entity: 'notes', createdAt: updatedAt, updatedAt, title: id })

describe('syncRecordWinner', () => {
  it('keeps the newest desktop millisecond revision', () => {
    expect(syncRecordWinner(record('a', '100'), record('a', '101'))?.updatedAt).toBe('101')
  })

  it('understands browser ISO timestamps and keeps a deterministic local winner for ties', () => {
    const local = record('a', '2026-08-23T10:00:00.000Z')
    const remote = record('a', '2026-08-23T09:00:00.000Z')
    expect(syncRecordWinner(local, remote)).toBe(local)
    expect(syncRecordWinner(local, { ...remote, updatedAt: local.updatedAt })).toBe(local)
  })
})
