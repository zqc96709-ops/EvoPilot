import { describe, expect, it } from 'vitest'
import { decisionDashboard } from './decisionDashboard'
import type { RecordData } from './model'

const now = new Date('2026-09-06T10:00:00.000Z')
const record = (id: string, entity: RecordData['entity'], data: Record<string, unknown> = {}): RecordData => ({ id, entity, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', ...data })

describe('decisionDashboard', () => {
  it('only counts explicit importance, risk and completed calibration facts', () => {
    const decision = record('d-1', 'decisions', { title: '进入新市场', date: '2026-09-02', importance: 'HIGH', riskLevel: 'HIGH', selectedOption: '进入', choiceStatus: 'DECIDED', executionStatus: 'EXECUTED', executedAt: '2026-09-02T10:00:00Z', validationStatus: 'SUPPORTED', validatedAt: '2026-09-05T10:00:00Z', successCriteria: '首月完成验证', evidenceAssessment: 'SUFFICIENT' })
    const dashboard = decisionDashboard([decision, record('r-1', 'results', { decisionId: 'd-1', title: '首月结果', evidenceStatus: 'VERIFIED' })], '30d', now)
    expect(dashboard.summary.important).toBe(1)
    expect(dashboard.summary.highRisk).toBe(1)
    expect(dashboard.summary.validated).toBe(1)
    expect(dashboard.summary.hitRate).toBe(100)
    expect(dashboard.summary.averageCycleDays).toBe(3)
    expect(dashboard.funnel.map((item) => item.count)).toEqual([0, 0, 1, 1, 1])
  })

  it('excludes inconclusive calibration from hit-rate denominator and does not treat done status as a hit', () => {
    const inconclusive = record('d-a', 'decisions', { title: '不确定', status: 'validated', validationStatus: 'INCONCLUSIVE', validatedAt: '2026-09-04T10:00:00Z' })
    const doneOnly = record('d-b', 'decisions', { title: '仅已决定', status: 'decided', selectedOption: '做', validationStatus: 'PENDING' })
    const dashboard = decisionDashboard([inconclusive, doneOnly], '30d', now)
    expect(dashboard.summary.validated).toBe(1)
    expect(dashboard.summary.hitRate).toBeNull()
    expect(dashboard.summary.pending).toBe(0)
  })

  it('requires a due date for pending validation and produces deterministic, deduplicated attention', () => {
    const overdue = record('d-overdue', 'decisions', { title: '待校准', date: '2026-08-01', importance: 'HIGH', riskLevel: 'HIGH', selectedOption: '执行', choiceStatus: 'DECIDED', validationDueAt: '2026-08-25', validationStatus: 'PENDING' })
    const noAction = record('d-action', 'decisions', { title: '缺执行', date: '2026-08-01', importance: 'HIGH', selectedOption: '执行', choiceStatus: 'DECIDED', validationStatus: 'PENDING' })
    const dashboard = decisionDashboard([overdue, noAction], '30d', now)
    expect(dashboard.summary.pending).toBe(1)
    expect(dashboard.attention).toHaveLength(2)
    expect(dashboard.attention.map((item) => item.id)).toEqual(['validation-d-overdue', 'action-d-action'])
  })

  it('shows a misjudgment only after contradicted validation and explicit review confirmation', () => {
    const decision = record('d-wrong', 'decisions', { title: '错误假设', validationStatus: 'CONTRADICTED', validatedAt: '2026-09-04T10:00:00Z' })
    const review = record('review-1', 'reviews', { decisionId: 'd-wrong', decisionErrorClassification: 'WRONG_ASSUMPTION', whatFailed: '样本不具代表性' })
    expect(decisionDashboard([decision], '30d', now).misjudgments).toHaveLength(0)
    expect(decisionDashboard([decision, review], '30d', now).misjudgments).toHaveLength(1)
  })
})
