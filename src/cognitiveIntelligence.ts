import type { RecordData } from './model'

export type CognitivePeriod = '7d' | '30d' | 'quarter' | 'year' | 'custom'
export type CognitiveTab = 'overview' | 'insights' | 'reviews' | 'knowledge' | 'principles' | 'mentalModels'
export type CognitiveAttention = { id: string; title: string; detail: string; tone: 'danger' | 'warning' | 'neutral'; record?: RecordData }
export type CognitiveApplication = { type: '决策' | '项目' | '工作流' | '复盘'; count: number; records: RecordData[] }
export type CognitiveDashboard = {
  pendingReviews: RecordData[]
  newInsights: RecordData[]
  principleCandidates: RecordData[]
  pendingValidation: RecordData[]
  importantInsights: RecordData[]
  attention: CognitiveAttention[]
  recentPrinciples: Array<{ record: RecordData; usageCount: number }>
  funnel: Array<{ label: string; count: number }>
  applications: CognitiveApplication[]
  commonModels: Array<{ record: RecordData; count: number; latest?: RecordData }>
  kpiSeries: [number[], number[], number[], number[]]
}

const dateOf = (record: RecordData) => { const value = record.validatedAt || record.createdAt || record.updatedAt || 0; return new Date(Number(value) || String(value)).getTime() }
const ids = (value: unknown) => Array.isArray(value) ? value.map(String) : value ? [String(value)] : []
const active = (record: RecordData) => !record.deletedAt && !record.archivedAt
const status = (record: RecordData) => String(record.validationStatus || record.status || '').toUpperCase()
const periodStart = (period: CognitivePeriod, now: Date, customStart?: string) => {
  if (period === 'custom' && customStart) return new Date(`${customStart}T00:00:00`).getTime()
  const start = new Date(now)
  if (period === '7d' || period === '30d' || period === 'custom') start.setDate(start.getDate() - Number(period === 'custom' ? 30 : period.slice(0, -1)))
  if (period === 'quarter') start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1)
  if (period === 'year') start.setMonth(0, 1)
  start.setHours(0, 0, 0, 0)
  return start.getTime()
}
const sparkline = (records: RecordData[], since: number, until: number) => {
  const bins = Array(8).fill(0) as number[]
  const span = Math.max(1, until - since)
  records.forEach((record) => {
    const value = dateOf(record)
    if (value < since || value > until) return
    bins[Math.min(7, Math.floor((value - since) / span * 8))] += 1
  })
  return bins
}
const hasReview = (record: RecordData, reviews: RecordData[]) => reviews.some((review) => review.projectId === record.id || review.resultId === record.id || review.decisionId === record.id || review.workflowRunId === record.id)
const completed = (record: RecordData) => ['COMPLETED', 'DONE', 'ACHIEVED', 'SUCCESS', 'EXECUTED', 'DECIDED'].includes(String(record.status || '').toUpperCase())
const applicationTargets = (record: RecordData) => new Set([
  ...ids(record.insightIds), ...ids(record.principleIds), ...ids(record.insightId), ...ids(record.principleId),
])

export function buildCognitiveDashboard(records: RecordData[], period: CognitivePeriod = '30d', now = new Date(), custom?: { start?: string; end?: string }): CognitiveDashboard {
  const live = records.filter(active)
  const since = periodStart(period, now, custom?.start)
  const until = period === 'custom' && custom?.end ? new Date(`${custom.end}T23:59:59.999`).getTime() : now.getTime()
  const inPeriod = (record: RecordData) => dateOf(record) >= since && dateOf(record) <= until
  const reviews = live.filter((record) => record.entity === 'reviews')
  const insights = live.filter((record) => record.entity === 'insights')
  const principles = live.filter((record) => record.entity === 'principles')
  const models = live.filter((record) => record.entity === 'mentalModels')
  const usages = live.filter((record) => record.entity === 'mentalModelUsages')
  const reviewEligible = live.filter((record) => ['projects', 'results', 'decisions', 'workflowRuns'].includes(record.entity) && completed(record) && !hasReview(record, reviews))
  const newInsights = insights.filter(inPeriod)
  const candidates = principles.filter((record) => ['CANDIDATE', 'DRAFT'].includes(status(record)))
  const pendingInsights = insights.filter((record) => !['SUPPORTED', 'VALIDATED', 'CONTRADICTED', 'INSUFFICIENT'].includes(status(record)))
  const revalidation = principles.filter((record) => record.revalidationDueAt && new Date(String(record.revalidationDueAt)).getTime() <= now.getTime() && !['RETIRED', 'REJECTED'].includes(status(record)))
  const pendingValidation = [...new Map([...pendingInsights, ...candidates, ...revalidation].map((record) => [record.id, record])).values()]
  const importance = (record: RecordData) => Number(record.pinned ? 100 : 0) + Number(record.importance || 0) + Number(record.confidence || 0) + (record.decisionId ? 30 : 0) + (record.projectId ? 15 : 0) + Math.max(0, 20 - (now.getTime() - dateOf(record)) / 86_400_000)
  const importantInsights = [...insights].sort((a, b) => importance(b) - importance(a)).slice(0, 3)
  const attention: CognitiveAttention[] = [
    ...reviewEligible.map((record) => ({ id: `review:${record.id}`, title: `${String(record.title || '重要事项')}已完成但尚未复盘`, detail: '需要确认是否进入复盘闭环', tone: 'danger' as const, record })),
    ...pendingInsights.filter((record) => dateOf(record) < now.getTime() - 7 * 86_400_000).map((record) => ({ id: `validation:${record.id}`, title: String(record.statement || '洞见尚未验证'), detail: '已等待验证超过 7 天', tone: 'warning' as const, record })),
    ...candidates.map((record) => ({ id: `candidate:${record.id}`, title: String(record.statement || '原则候选待确认'), detail: '需要用户确认，不会由 AI 自动升级', tone: 'neutral' as const, record })),
    ...revalidation.map((record) => ({ id: `revalidate:${record.id}`, title: String(record.statement || '原则需要重新验证'), detail: '原则已到重新验证日期', tone: 'warning' as const, record })),
  ].slice(0, 4)
  const applicationEntities = [
    ['决策', 'decisions'], ['项目', 'projects'], ['工作流', 'workflowRuns'], ['复盘', 'reviews'],
  ] as const
  const applications = applicationEntities.map(([type, entity]) => {
    const linked = live.filter((record) => record.entity === entity && inPeriod(record) && applicationTargets(record).size > 0)
    return { type, count: linked.length, records: linked }
  })
  const principleUsage = (principle: RecordData) => applications.reduce((sum, item) => sum + item.records.filter((record) => applicationTargets(record).has(principle.id)).length, 0)
  const recentPrinciples = principles.filter((record) => ['ACTIVE', 'VALIDATED', 'SUPPORTED'].includes(status(record))).sort((a, b) => dateOf(b) - dateOf(a)).slice(0, 3).map((record) => ({ record, usageCount: principleUsage(record) }))
  const modelUsage = new Map<string, RecordData[]>()
  usages.filter(inPeriod).forEach((usage) => { const id = String(usage.mentalModelId || ''); if (id) modelUsage.set(id, [...(modelUsage.get(id) || []), usage]) })
  live.filter((record) => record.entity === 'decisions' && inPeriod(record)).forEach((decision) => ids(decision.mentalModelIds).forEach((id) => modelUsage.set(id, [...(modelUsage.get(id) || []), decision])))
  const commonModels = models.map((record) => ({ record, count: modelUsage.get(record.id)?.length || 0, latest: [...(modelUsage.get(record.id) || [])].sort((a, b) => dateOf(b) - dateOf(a))[0] })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 6)
  const validated = insights.filter((record) => ['SUPPORTED', 'VALIDATED'].includes(status(record)))
  return {
    pendingReviews: reviewEligible, newInsights, principleCandidates: candidates, pendingValidation, importantInsights, attention, recentPrinciples,
    funnel: [{ label: 'Review（复盘）', count: reviews.length }, { label: 'Insight（洞见）', count: insights.length }, { label: 'Validated（已验证）', count: validated.length }, { label: 'Principle（原则）', count: principles.filter((record) => ['ACTIVE', 'VALIDATED', 'SUPPORTED'].includes(status(record))).length }],
    applications, commonModels,
    kpiSeries: [sparkline(reviewEligible, since, until), sparkline(newInsights, since, until), sparkline(candidates, since, until), sparkline(pendingValidation, since, until)],
  }
}
