import { describe, expect, it } from 'vitest'
import { projectIntelligenceDashboard } from './projectIntelligence'
import type { Entity, RecordData } from './model'

let sequence = 0
const record = (entity: Entity, data: Partial<RecordData> = {}): RecordData => ({ id: `${entity}-${++sequence}`, entity, createdAt: '2026-09-01T09:00:00Z', updatedAt: '2026-09-01T09:00:00Z', ...data } as RecordData)
const now = new Date('2026-09-06T12:00:00Z')

describe('projectIntelligenceDashboard', () => {
  it('derives health, progress, time and results from facts without double counting', () => {
    const goal = record('goals', { title: '增长目标' })
    const healthy = record('projects', { title: '健康项目', status: 'active', goalId: goal.id, progress: 42 })
    const blocked = record('projects', { title: '受阻项目', status: 'active', blockers: '供应商未确认', priority: 'high' })
    const task = record('tasks', { title: '项目任务', projectId: healthy.id, status: 'todo' })
    const milestoneA = record('projectMilestones', { title: '交付 A', projectId: healthy.id, dueDate: '2026-09-04', status: 'completed', completedAt: '2026-09-04T11:00:00Z' })
    const milestoneB = record('projectMilestones', { title: '交付 B', projectId: healthy.id, dueDate: '2026-09-06T23:59:59Z', status: 'planned' })
    const log = record('timeLogs', { title: '真实投入', projectId: healthy.id, taskId: task.id, startAt: '2026-09-05T09:00:00Z', durationMinutes: 90 })
    const result = record('results', { title: '真实结果', projectId: healthy.id, date: '2026-09-05', status: 'SUCCESS' })
    const dashboard = projectIntelligenceDashboard([goal, healthy, blocked, task, milestoneA, milestoneB, log, result], 'month', now)
    expect(dashboard.summary).toMatchObject({ active: 2, highRisk: 1, progressRate: 100, totalMinutes: 90, results: 1, alignmentRate: 50, aligned: 1 })
    expect(dashboard.health).toEqual(expect.arrayContaining([{ key: 'healthy', label: '健康', count: 1 }, { key: 'blocked', label: '受阻', count: 1 }]))
    expect(dashboard.focus.find((item) => item.project.id === healthy.id)?.progress).toBe(42)
    expect(dashboard.investment.find((item) => item.project.project.id === healthy.id)?.minutes).toBe(90)
  })

  it('uses null rather than a fabricated progress rate when no milestones are planned', () => {
    const project = record('projects', { title: '无计划项目', status: 'active' })
    const dashboard = projectIntelligenceDashboard([project], 'month', now)
    expect(dashboard.summary.progressRate).toBeNull()
    expect(dashboard.progressTrend.every((point) => point.rate === null)).toBe(true)
  })

  it('derives lifecycle only from dated facts and creates one attention item per project', () => {
    const project = record('projects', { title: '项目 A', status: 'active', priority: 'high', createdAt: '2026-09-02T09:00:00Z' })
    const timeline = record('timelineEvents', { title: '项目状态变化', sourceEntityId: project.id, eventType: 'project_status_changed', afterValue: 'active', occurredAt: '2026-09-03T09:00:00Z' })
    const blockedTask = record('tasks', { title: '阻塞任务', projectId: project.id, priority: 'high', status: 'blocked', updatedAt: '2026-09-04T09:00:00Z' })
    const overdueMilestone = record('projectMilestones', { title: '逾期里程碑', projectId: project.id, status: 'planned', dueDate: '2026-09-01', importance: 'high' })
    const dashboard = projectIntelligenceDashboard([project, timeline, blockedTask, overdueMilestone], 'month', now)
    expect(dashboard.lifecycle.find((stage) => stage.key === 'initiated')?.count).toBe(1)
    expect(dashboard.lifecycle.find((stage) => stage.key === 'executing')?.count).toBe(1)
    expect(dashboard.lifecycle.find((stage) => stage.key === 'riskHandling')?.count).toBe(1)
    expect(dashboard.attention).toHaveLength(1)
    expect(dashboard.attention[0]).toMatchObject({ severity: 'high', record: project })
  })
})
