import { describe, expect, it } from 'vitest'
import { decisionStage, filterDecisionLogRecords } from './decisionLog'
import type { RecordData } from './model'

const decision = (id: string, patch: Partial<RecordData> = {}) => ({ id, entity: 'decisions', title: id, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...patch } as RecordData)

describe('decision repository lifecycle', () => {
  it('uses the single persisted lifecycle instead of a second status', () => {
    expect(decisionStage(decision('question'))).toBe('PENDING')
    expect(decisionStage(decision('choice', { choiceStatus: 'DECIDED' }))).toBe('DECIDED')
    expect(decisionStage(decision('execution', { executionStatus: 'IN_PROGRESS' }))).toBe('IN_PROGRESS')
    expect(decisionStage(decision('result', { executionStatus: 'EXECUTED' }))).toBe('VALIDATING')
    expect(decisionStage(decision('calibrated', { validationStatus: 'SUPPORTED' }))).toBe('CALIBRATED')
  })

  it('filters and pages 2,000 decision records without loading them into a React list', () => {
    const records = Array.from({ length: 2000 }, (_, index) => decision(`decision-${index}`, { importance: index % 2 ? 'HIGH' : 'LOW', choiceStatus: index % 3 ? 'PENDING' : 'DECIDED' }))
    const page = filterDecisionLogRecords(records, { importance: 'HIGH', limit: 50, offset: 50 })
    expect(page.total).toBe(1000)
    expect(page.records).toHaveLength(50)
    expect(page.records.every((item) => item.importance === 'HIGH')).toBe(true)
  })
})
