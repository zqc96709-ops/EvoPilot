import { describe, expect, it } from 'vitest'
import type { Entity, RecordData } from './model'
import { buildTimeDashboard, filterTimeLogs, splitTimeLog } from './timeIntelligence'

const record = (entity: Entity, id: string, data: Partial<RecordData> = {}): RecordData => ({ id, entity, createdAt: '2026-08-31T00:00:00', updatedAt: '2026-08-31T00:00:00', ...data })
const anchor = new Date(2026, 7, 31, 12)

describe('Time Intelligence analytics', () => {
  it('resolves goal and project through Time → Task → Project without double counting', () => {
    const records = [
      record('goals', 'g1', { title: 'Goal A' }),
      record('projects', 'p1', { title: 'Project A', goalId: 'g1' }),
      record('tasks', 't1', { title: 'Task A', projectId: 'p1', goalId: 'g1' }),
      record('timeLogs', 'l1', { title: 'Deep work', taskId: 't1', projectId: 'p1', goalId: 'g1', startAt: '2026-08-31T09:00:00', durationMinutes: 120, workMode: 'DEEP_WORK', category: '项目' }),
    ]
    const dashboard = buildTimeDashboard(records, 'today', anchor)
    expect(dashboard.summary.totalMinutes).toBe(120)
    expect(dashboard.summary.goalAlignedMinutes).toBe(120)
    expect(dashboard.summary.projectMinutes).toBe(120)
    expect(dashboard.summary.deepWorkMinutes).toBe(120)
  })

  it('counts direct goal time without treating it as project time', () => {
    const dashboard = buildTimeDashboard([
      record('goals', 'g2', { title: 'Goal B' }),
      record('timeLogs', 'l2', { goalId: 'g2', startAt: '2026-08-31T10:00:00', durationMinutes: 60 }),
    ], 'today', anchor)
    expect(dashboard.summary.goalAlignedMinutes).toBe(60)
    expect(dashboard.summary.projectMinutes).toBe(0)
    expect(dashboard.unlinkedMinutes).toBe(0)
  })

  it('keeps truly unlinked time visible and filterable', () => {
    const records = [record('timeLogs', 'l3', { startAt: '2026-08-31T11:00:00', durationMinutes: 45 })]
    const dashboard = buildTimeDashboard(records, 'today', anchor)
    expect(dashboard.unlinkedMinutes).toBe(45)
    expect(filterTimeLogs(dashboard, records, { kind: 'unlinked' }).map((item) => item.id)).toEqual(['l3'])
  })

  it('splits cross-midnight records at local day boundaries', () => {
    const log = record('timeLogs', 'cross', { startAt: '2026-08-30T23:00:00', durationMinutes: 120 })
    const slices = splitTimeLog(log)
    expect(slices).toHaveLength(2)
    expect(slices.map((slice) => Math.round(slice.minutes))).toEqual([60, 60])
    expect(slices.map((slice) => slice.dayKey)).toEqual(['2026-08-30', '2026-08-31'])
  })

  it('uses explicit plan and work mode instead of task estimate inference', () => {
    const dashboard = buildTimeDashboard([
      record('tasks', 't2', { estimateMinutes: 999 }),
      record('timeLogs', 'l4', { taskId: 't2', startAt: '2026-08-31T09:00:00', durationMinutes: 90, plannedMinutes: 60, workMode: 'NORMAL', category: '任务' }),
      record('timeLogs', 'l5', { startAt: '2026-08-31T14:00:00', durationMinutes: 30, workMode: 'DEEP_WORK', category: '学习' }),
    ], 'today', anchor)
    expect(dashboard.summary.plannedMinutes).toBe(60)
    expect(dashboard.summary.deepWorkMinutes).toBe(30)
    expect(dashboard.summary.planActualRatio).toBe(2)
  })

  it('aggregates 10,000 time records without changing the production data model', () => {
    const records = Array.from({ length: 10_000 }, (_, index) => record('timeLogs', `log-${index}`, { startAt: `2026-08-${String(25 + index % 7).padStart(2, '0')}T09:00:00`, durationMinutes: 30, category: index % 3 ? '项目' : '会议', projectId: index % 2 ? 'p1' : undefined }))
    records.push(record('projects', 'p1', { title: 'Project A' }))
    const started = performance.now()
    const dashboard = buildTimeDashboard(records, '7d', anchor)
    expect(dashboard.summary.totalMinutes).toBe(300_000)
    expect(dashboard.timeByCategory).toHaveLength(2)
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})

