import { describe, expect, it } from 'vitest'
import type { Entity, RecordData } from './model'
import { resultsIntelligence } from './resultsIntelligence'

let sequence = 0
const record = (entity: Entity, data: Partial<RecordData> = {}): RecordData => ({ id: `${entity}-${++sequence}`, entity, createdAt: '2026-09-01T09:00:00Z', updatedAt: '2026-09-01T09:00:00Z', ...data } as RecordData)
const now = new Date('2026-09-06T12:00:00Z')

describe('resultsIntelligence', () => {
  it('derives verified, high-value, cycle and asset metrics from Result and Final Deliverable facts', () => {
    const project = record('projects', { title: '增长项目' })
    const high = record('results', { title: '高价值成果', projectId: project.id, date: '2026-09-05', outcomeType: 'MILESTONE', status: 'SUCCESS', evidenceStatus: 'VERIFIED', validatedAt: '2026-09-05T09:00:00Z', valueClassification: 'HIGH', cycleStartedAt: '2026-09-01T09:00:00Z' })
    const learning = record('results', { title: '学习成果', projectId: project.id, date: '2026-09-04', outcomeType: 'LEARNING', status: 'SUCCESS', cycleStartedAt: '2026-09-02T09:00:00Z' })
    const asset = record('deliverables', { title: '正式模板', projectId: project.id, resultId: high.id, status: 'FINAL', assetType: 'TEMPLATE', finalizedAt: '2026-09-05T10:00:00Z' })
    const dashboard = resultsIntelligence([project, high, learning, asset], '30d', now)
    expect(dashboard.summary).toMatchObject({ total: 2, verified: 1, high: 1, failed: 0, assetRate: 50, averageCycleDays: 2.6 })
    expect(dashboard.funnel).toEqual(expect.arrayContaining([{ label: '已交付', count: 2 }, { label: '资产化', count: 1 }]))
    expect(dashboard.highResults).toEqual([high])
    expect(dashboard.reusable).toEqual([asset])
  })

  it('uses validatedAt for verification trend and produces one highest-priority CEO issue per project', () => {
    const project = record('projects', { title: '项目 A' })
    const highUnverified = record('results', { title: '待验证高价值', projectId: project.id, date: '2026-09-02', outcomeType: 'STRATEGIC', valueClassification: 'HIGH', evidenceStatus: 'RECORDED', status: 'SUCCESS' })
    const failed = record('results', { title: '失败成果', projectId: project.id, date: '2026-09-03', status: 'FAILED', failureReason: '真实原因' })
    const verifiedLate = record('results', { title: '后验证成果', projectId: project.id, date: '2026-09-02', status: 'SUCCESS', evidenceStatus: 'VERIFIED', validatedAt: '2026-09-05T09:00:00Z' })
    const dashboard = resultsIntelligence([project, highUnverified, failed, verifiedLate], '7d', now)
    expect(dashboard.attention).toHaveLength(1)
    expect(dashboard.attention[0]).toMatchObject({ record: highUnverified, severity: 'high' })
    expect(dashboard.failures).toEqual([failed])
    expect(dashboard.trend.find((point) => point.label === '9/4')?.verified).toBe(0)
    expect(dashboard.trend.at(-1)?.verified).toBe(1)
    const review = record('reviews', { title: '失败复盘', resultId: failed.id })
    const reviewed = resultsIntelligence([project, failed, review], '7d', now)
    expect(reviewed.attention).toHaveLength(0)
  })

  it('keeps unavailable metrics null rather than fabricating history or reusable assets', () => {
    const result = record('results', { title: '普通量化结果', createdAt: String(now.getTime()), outcomeType: 'QUANTITATIVE', status: 'SUCCESS' })
    const dashboard = resultsIntelligence([result], '30d', now)
    expect(dashboard.summary.assetRate).toBeNull()
    expect(dashboard.summary.averageCycleDays).toBeNull()
    expect(dashboard.summary.previousTotal).toBe(0)
  })
})
