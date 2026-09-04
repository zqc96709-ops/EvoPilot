import { describe, expect, it } from 'vitest'
import { todayDashboard } from './todayDashboard'
import type { RecordData } from './model'

const record = (entity: RecordData['entity'], extra: Record<string, unknown> = {}) => ({ id: `${entity}-${Math.random()}`, entity, createdAt: '2026-08-30T09:00:00', updatedAt: '2026-08-30T09:00:00', ...extra }) as RecordData

describe('today dashboard', () => {
  it('aggregates the selected local day from existing records only', () => {
    const project = record('projects', { title: '美国 TikTok' })
    const dashboard = todayDashboard([project, record('tasks', { title: '完成方案', dueDate: '2026-08-30', priority: 'high', status: 'completed', estimateMinutes: 90 }), record('timeLogs', { title: '分析数据', projectId: project.id, startAt: '2026-08-30T09:00:00', durationMinutes: 75, category: '专注' }), record('financialTransactions', { title: '广告', occurredAt: '2026-08-30T10:00:00', transactionType: 'EXPENSE', status: 'POSTED', amountMinor: '268000' }), record('results', { title: '首轮结果', date: '2026-08-30', status: 'ACHIEVED' }), record('reviews', { title: '日复盘', periodEnd: '2026-08-30' }), record('notes', { title: '灵感' }), record('timeLogs', { title: '昨天', startAt: '2026-08-29T09:00:00', durationMinutes: 99 })], '2026-08-30')
    expect(dashboard.tasks).toHaveLength(1)
    expect(dashboard.doneTasks).toBe(1)
    expect(dashboard.totalMinutes).toBe(75)
    expect(dashboard.focusMinutes).toBe(75)
    expect(dashboard.expenseMinor).toBe(268000n)
    expect(dashboard.results).toHaveLength(1)
    expect(dashboard.reviews).toHaveLength(1)
    expect(dashboard.notes).toHaveLength(1)
    expect(dashboard.allocations[0]).toMatchObject({ label: '美国 TikTok', minutes: 75 })
    expect(dashboard.categoryAllocations[0]).toMatchObject({ label: '专注', minutes: 75 })
  })
})
