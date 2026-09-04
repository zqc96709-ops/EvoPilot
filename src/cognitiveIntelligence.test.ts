import { describe, expect, it } from 'vitest'
import type { RecordData } from './model'
import { buildCognitiveDashboard } from './cognitiveIntelligence'

const now = new Date('2026-09-01T12:00:00')
const record = (entity: RecordData['entity'], id: string, data: Partial<RecordData> = {}): RecordData => ({ entity, id, createdAt: '2026-08-28T10:00:00', updatedAt: '2026-08-28T10:00:00', ...data })

describe('cognitive intelligence', () => {
  it('keeps review, insight and principle as independent domains', () => {
    const review = record('reviews', 'r1', { title: '复盘' })
    const insight = record('insights', 'i1', { statement: '洞见', reviewId: review.id, validationStatus: 'SUPPORTED' })
    const principle = record('principles', 'p1', { statement: '原则', insightIds: [insight.id], status: 'ACTIVE' })
    const dashboard = buildCognitiveDashboard([review, insight, principle], '30d', now)
    expect(dashboard.funnel.map((item) => item.count)).toEqual([1, 1, 1, 1])
    expect(review.entity).toBe('reviews'); expect(insight.entity).toBe('insights'); expect(principle.entity).toBe('principles')
  })

  it('allows a review without creating an insight and a validated insight without creating a principle', () => {
    const dashboard = buildCognitiveDashboard([
      record('reviews', 'r1', { title: '独立复盘' }),
      record('insights', 'i1', { statement: '只验证不升级', validationStatus: 'SUPPORTED' }),
    ], '30d', now)
    expect(dashboard.funnel.map((item) => item.count)).toEqual([1, 1, 1, 0])
  })

  it('preserves contradicted insight history without counting it as validated', () => {
    const contradicted = record('insights', 'i1', { statement: '被反驳', validationStatus: 'CONTRADICTED', evidence: '反证' })
    const dashboard = buildCognitiveDashboard([contradicted], '30d', now)
    expect(dashboard.newInsights).toContain(contradicted)
    expect(dashboard.funnel[2].count).toBe(0)
    expect(dashboard.pendingValidation).not.toContain(contradicted)
  })

  it('counts real application relations once and supports principle revalidation and retirement', () => {
    const active = record('principles', 'p1', { statement: '需复验', status: 'ACTIVE', revalidationDueAt: '2026-08-31' })
    const retired = record('principles', 'p2', { statement: '已退役', status: 'RETIRED', revalidationDueAt: '2026-08-31' })
    const decision = record('decisions', 'd1', { title: '决策', principleIds: ['p1', 'p1'] })
    const dashboard = buildCognitiveDashboard([active, retired, decision], '30d', now)
    expect(dashboard.applications.find((item) => item.type === '决策')?.count).toBe(1)
    expect(dashboard.pendingValidation).toContain(active)
    expect(dashboard.pendingValidation).not.toContain(retired)
  })

  it('handles 10000 records without serious client-side delay', () => {
    const records = Array.from({ length: 10000 }, (_, index) => record('insights', `i${index}`, { statement: `洞见 ${index}`, validationStatus: index % 2 ? 'SUPPORTED' : 'PENDING' }))
    const started = performance.now(); buildCognitiveDashboard(records, '30d', now)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
