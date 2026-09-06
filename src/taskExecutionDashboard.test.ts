import { describe, expect, it } from 'vitest'
import { taskExecutionDashboard } from './taskExecutionDashboard'
import type { Entity, RecordData } from './model'

let sequence = 0
const record = (entity: Entity, data: Partial<RecordData> = {}): RecordData => ({ id: `${entity}-${++sequence}`, entity, createdAt: '2026-08-10T09:00:00Z', updatedAt: '2026-08-10T09:00:00Z', ...data } as RecordData)
const now = new Date('2026-09-06T12:00:00Z')

describe('taskExecutionDashboard', () => {
  it('derives execution metrics from task facts without fabricated values', () => {
    const goal = record('goals', { title: '增长目标', status: 'active' })
    const project = record('projects', { title: '增长项目', goalId: goal.id, status: 'active' })
    const stalled = record('projects', { title: '停滞项目', status: 'active' })
    const aligned = record('tasks', { title: '推进增长', projectId: project.id, status: 'todo', createdAt: '2026-09-02T09:00:00Z' })
    const overdue = record('tasks', { title: '高优先级逾期', projectId: project.id, priority: 'high', dueDate: '2026-09-01', status: 'todo', createdAt: '2026-08-20T09:00:00Z' })
    const blocked = record('tasks', { title: '受阻任务', projectId: project.id, status: 'blocked', blockedSince: '2026-09-01T09:00:00Z', createdAt: '2026-08-16T09:00:00Z' })
    const unaligned = record('tasks', { title: '未对齐高优', priority: 'high', status: 'todo', createdAt: '2026-09-03T09:00:00Z' })
    const stalledTask = record('tasks', { title: '停滞高优', projectId: stalled.id, priority: 'high', status: 'todo', createdAt: '2026-08-23T09:00:00Z' })
    const completed = record('tasks', { title: '已完成', status: 'completed', completedAt: '2026-09-05T10:00:00Z', createdAt: '2026-08-31T09:00:00Z' })
    const decision = record('decisions', { title: '已决定但未行动', status: 'decided' })
    const dashboard = taskExecutionDashboard([goal, project, stalled, aligned, overdue, blocked, unaligned, stalledTask, completed, decision], '30d', now)

    expect(dashboard.summary).toMatchObject({ active: 5, criticalOverdue: 1, blocked: 1, alignmentRate: 60, aligned: 3 })
    expect(dashboard.trend.created).toBe(6)
    expect(dashboard.trend.completed).toBe(1)
    expect(dashboard.projectLoad[0]).toMatchObject({ project, normal: 1, overdue: 1, blocked: 1, total: 3 })
    expect(dashboard.attention.map((item) => item.kind)).toEqual(expect.arrayContaining(['critical_overdue', 'long_blocked', 'high_priority_unaligned', 'decision_without_action', 'project_stalled']))
  })

  it('keeps current-state metrics stable when the trend period changes', () => {
    const task = record('tasks', { title: '当前任务', priority: 'high', dueDate: '2026-09-01', status: 'todo', createdAt: '2026-08-01T09:00:00Z' })
    const short = taskExecutionDashboard([task], '7d', now)
    const long = taskExecutionDashboard([task], '90d', now)
    expect(short.summary).toEqual(long.summary)
    expect(short.trend.created).toBe(0)
    expect(long.trend.created).toBe(1)
  })

  it('does not count inbox, completed, cancelled, or archived tasks as active WIP', () => {
    const records = [
      record('tasks', { status: 'inbox' }), record('tasks', { status: 'completed' }), record('tasks', { status: 'cancelled' }), record('tasks', { status: 'todo', archivedAt: '2026-09-01T00:00:00Z' }),
    ]
    expect(taskExecutionDashboard(records, '30d', now).summary.active).toBe(0)
  })
})
