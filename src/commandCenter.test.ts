import { describe, expect, it } from 'vitest'
import { commandCenterDashboard, resolveCommandPeriod } from './commandCenter'
import type { Entity, RecordData } from './model'

const now = new Date('2026-08-30T12:00:00-07:00')
const period = resolveCommandPeriod('30d', now)
let sequence = 0
const record = (entity: Entity, data: Partial<RecordData> = {}): RecordData => ({ id: `${entity}-${++sequence}`, entity, createdAt: '2026-08-10T10:00:00Z', updatedAt: '2026-08-20T10:00:00Z', ...data } as RecordData)

describe('commandCenterDashboard', () => {
  it('does not fabricate production facts for an empty database', () => {
    const dashboard = commandCenterDashboard([], period, now)
    expect(dashboard.kpis.goalAchievement.value).toBe('数据不足')
    expect(dashboard.kpis.cashResult.value).toBe('未记录')
    expect(dashboard.kpis.resourceEfficiency.value).toBe('数据不足')
    expect(dashboard.projectPortfolio).toEqual([])
    expect(dashboard.attention).toEqual([])
  })

  it('uses measurable key results before goal progress', () => {
    const dashboard = commandCenterDashboard([
      record('goals', { status: 'active', progress: 10 }),
      record('keyResults', { status: 'active', currentValue: 80, targetValue: 100 }),
    ], period, now)
    expect(dashboard.kpis.goalAchievement.numeric).toBe(80)
  })

  it('counts only material or high-impact pending decisions', () => {
    const strategic = record('decisions', { title: '扩张决策', status: 'pending', decisionLevel: 'STRATEGIC', reviewDueDate: '2026-09-02' })
    const routine = record('decisions', { title: '普通采购', status: 'pending', decisionLevel: 'OPERATIONAL' })
    const dashboard = commandCenterDashboard([strategic, routine], period, now)
    expect(dashboard.kpis.pendingDecisions.numeric).toBe(1)
    expect(dashboard.decisionTimeline.map((item) => item.id)).toEqual([strategic.id])
  })

  it('excludes transfers from operating cash result', () => {
    const dashboard = commandCenterDashboard([
      record('financialTransactions', { status: 'POSTED', transactionType: 'INCOME', amountMinor: '3000000', occurredAt: '2026-08-20', accountId: 'cash' }),
      record('financialTransactions', { status: 'POSTED', transactionType: 'EXPENSE', amountMinor: '900000', occurredAt: '2026-08-21', accountId: 'cash' }),
      record('financialTransactions', { status: 'POSTED', transactionType: 'TRANSFER', amountMinor: '8000000', occurredAt: '2026-08-22', accountId: 'cash', destinationAccountId: 'bank' }),
    ], period, now)
    expect(dashboard.kpis.cashResult.numeric).toBe(21_000)
  })

  it('shows only linked high-impact external signals', () => {
    const project = record('projects', { title: '美国 TikTok', status: 'active' })
    const linkedHigh = record('signals', { title: '政策变化', impactLevel: 'HIGH', projectId: project.id, detectedAt: '2026-08-24' })
    const unlinkedHigh = record('signals', { title: '未关联变化', impactLevel: 'HIGH', detectedAt: '2026-08-24' })
    const linkedLow = record('signals', { title: '低影响变化', impactLevel: 'LOW', projectId: project.id, detectedAt: '2026-08-24' })
    const dashboard = commandCenterDashboard([project, linkedHigh, unlinkedHigh, linkedLow], period, now)
    expect(dashboard.externalSignals.map((item) => item.id)).toEqual([linkedHigh.id])
  })

  it('derives project risk and resource allocation from real records', () => {
    const risk = record('projects', { title: '风险项目', status: 'active', health: 'at_risk', blockers: '供应中断' })
    const healthy = record('projects', { title: '健康项目', status: 'active', health: 'healthy' })
    const dashboard = commandCenterDashboard([
      risk, healthy,
      record('timeLogs', { projectId: risk.id, startAt: '2026-08-20T09:00:00Z', durationMinutes: 120 }),
      record('timeLogs', { projectId: healthy.id, startAt: '2026-08-20T09:00:00Z', durationMinutes: 60 }),
      record('financialTransactions', { status: 'POSTED', transactionType: 'EXPENSE', amountMinor: '100000', projectId: risk.id, occurredAt: '2026-08-20' }),
    ], period, now)
    expect(dashboard.kpis.projectRisks.numeric).toBe(1)
    expect(dashboard.projectPortfolio[0].record.id).toBe(risk.id)
    expect(dashboard.timeAllocation.find((item) => item.id === risk.id)?.share).toBeCloseTo(66.67, 1)
    expect(dashboard.moneyAllocation.find((item) => item.id === risk.id)?.share).toBe(100)
  })
})
