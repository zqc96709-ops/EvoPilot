import type { RecordData } from './model'

export type DecisionPeriod = '30d' | '90d' | 'quarter' | 'year'
type Period = { start: Date; end: Date; label: string }
export type ValidationStatus = 'PENDING' | 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'CONTRADICTED' | 'INCONCLUSIVE'
export type AttentionSeverity = 'high' | 'medium'

const day = 86_400_000
const live = (record: RecordData) => !record.archivedAt && !record.deletedAt
const text = (value: unknown) => String(value || '').trim()
const at = (value: unknown) => { const raw = typeof value === 'number' ? value : String(value || ''); const parsed = raw && /^\d+$/.test(String(raw)) ? new Date(Number(raw)) : raw ? new Date(raw) : undefined; return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined }
const inPeriod = (value: unknown, period: Period) => { const point = at(value); return Boolean(point && point >= period.start && point <= period.end) }
const periodFor = (preset: DecisionPeriod, now: Date): Period => {
  const start = new Date(now); const end = new Date(now); end.setHours(23, 59, 59, 999)
  if (preset === '30d') start.setDate(start.getDate() - 29)
  if (preset === '90d') start.setDate(start.getDate() - 89)
  if (preset === 'quarter') start.setMonth(start.getMonth() - 2, 1)
  if (preset === 'year') start.setMonth(0, 1)
  start.setHours(0, 0, 0, 0)
  return { start, end, label: ({ '30d': '近30天', '90d': '近90天', quarter: '本季度', year: '今年' } as const)[preset] }
}
const title = (record: RecordData) => text(record.title) || '未命名决策'
const dateOf = (decision: RecordData) => decision.decisionAt || decision.date || decision.createdAt
// Importance is a human confirmation. Legacy/AI classification must never turn a
// draft into an "important decision" in this dashboard by itself.
const level = (decision: RecordData) => text(decision.importance)
const isImportant = (decision: RecordData) => ['HIGH', 'CRITICAL'].includes(level(decision))
const isHighRisk = (decision: RecordData) => ['HIGH', 'CRITICAL'].includes(text(decision.riskLevel))
const choiceMade = (decision: RecordData) => Boolean(text(decision.selectedOption) || text(decision.ceoDecision) || text(decision.choiceStatus) === 'DECIDED' || ['decided', 'monitoring', 'validated', 'partially_correct', 'wrong', 'unknown'].includes(text(decision.status)))
const executed = (decision: RecordData) => Boolean(decision.executedAt || text(decision.executionStatus) === 'EXECUTED')
const validation = (decision: RecordData): ValidationStatus => {
  const explicit = text(decision.validationStatus)
  if (['PENDING', 'SUPPORTED', 'PARTIALLY_SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'].includes(explicit)) return explicit as ValidationStatus
  const legacy = text(decision.status)
  if (legacy === 'partially_correct') return 'PARTIALLY_SUPPORTED'
  if (legacy === 'wrong') return 'CONTRADICTED'
  if (legacy === 'validated' || legacy === 'unknown') return 'INCONCLUSIVE'
  return 'PENDING'
}
const calibrated = (decision: RecordData) => validation(decision) !== 'PENDING'
const evidenceLevel = (decision: RecordData) => text(decision.evidenceAssessment)
const daysFrom = (value: unknown, now: Date) => { const point = at(value); return point ? Math.floor((now.getTime() - point.getTime()) / day) : undefined }
const linked = (record: RecordData, decision: RecordData) => String(record.decisionId || '') === decision.id || String(decision.resultId || '') === record.id || String(decision.reviewId || '') === record.id
const importanceRank = (decision: RecordData) => ({ LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[level(decision)] || 0)
const riskRank = (decision: RecordData) => ({ LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[text(decision.riskLevel)] || 0)
const dueAt = (decision: RecordData) => decision.validationDueAt || decision.reviewDueDate
const owner = (decision: RecordData, people: Map<string, RecordData>) => people.get(String(decision.ownerId || '')) ? title(people.get(String(decision.ownerId || ''))!) : '我'
const impact = (decision: RecordData) => text(decision.expectedImpact) || text(decision.expectedOutcome) || (decision.expectedRevenueMinor ? `预期 ${text(decision.currency) || 'CNY'} ${text(decision.expectedRevenueMinor)}` : '—')
const evidenceLabels = [
  ['VERY_SUFFICIENT', '非常充分'], ['SUFFICIENT', '比较充分'], ['MODERATE', '一般'], ['INSUFFICIENT', '不足'], ['NONE', '几乎没有'],
] as const

export function decisionDashboard(records: RecordData[], preset: DecisionPeriod = '30d', now = new Date()) {
  const period = periodFor(preset, now); const all = records.filter(live); const decisions = all.filter((record) => record.entity === 'decisions'); const results = all.filter((record) => record.entity === 'results'); const reviews = all.filter((record) => record.entity === 'reviews'); const people = new Map(all.filter((record) => record.entity === 'people').map((record) => [record.id, record])); const tasks = all.filter((record) => record.entity === 'tasks')
  const resultFor = (decision: RecordData) => results.filter((result) => linked(result, decision)); const reviewFor = (decision: RecordData) => reviews.filter((review) => linked(review, decision) || resultFor(decision).some((result) => String(review.resultId || '') === result.id))
  const current = decisions.filter((decision) => inPeriod(dateOf(decision), period)); const validations = decisions.filter((decision) => calibrated(decision) && inPeriod(decision.validatedAt || decision.updatedAt, period));
  const eligible = validations.filter((decision) => ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'CONTRADICTED'].includes(validation(decision))); const supported = eligible.filter((decision) => validation(decision) === 'SUPPORTED')
  const cycles = validations.map((decision) => { const start = at(decision.executedAt); const end = at(decision.validatedAt); return start && end && end >= start ? (end.getTime() - start.getTime()) / day : undefined }).filter((value): value is number => value !== undefined)
  const pending = decisions.filter((decision) => {
    const due = at(dueAt(decision)); return !calibrated(decision) && choiceMade(decision) && Boolean(due && due <= now)
  }).sort((a, b) => (riskRank(b) + importanceRank(b) + Math.max(0, daysFrom(dueAt(b), now) || 0)) - (riskRank(a) + importanceRank(a) + Math.max(0, daysFrom(dueAt(a), now) || 0)))
  const critical = [...current.filter(isImportant)].sort((a, b) => importanceRank(b) - importanceRank(a) || riskRank(b) - riskRank(a) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
  const trendPoints = Array.from({ length: 6 }, (_, index) => { const point = new Date(period.start); point.setTime(period.start.getTime() + (period.end.getTime() - period.start.getTime()) / 5 * index); point.setHours(23, 59, 59, 999); const slice = validations.filter((decision) => { const when = at(decision.validatedAt || decision.updatedAt); return Boolean(when && when >= period.start && when <= point) }); const comparable = slice.filter((decision) => ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'CONTRADICTED'].includes(validation(decision))); const assessed = current.filter((decision) => { const when = at(dateOf(decision)); return Boolean(when && when <= point && evidenceLevel(decision)) }); const created = current.filter((decision) => { const when = at(dateOf(decision)); return Boolean(when && when <= point) }); return { label: `${point.getMonth() + 1}/${point.getDate()}`, hitRate: comparable.length ? Math.round(comparable.filter((decision) => validation(decision) === 'SUPPORTED').length / comparable.length * 100) : null, evidenceRate: created.length ? Math.round(assessed.length / created.length * 100) : null } })
  const funnel = [
    { label: '问题', count: decisions.filter((decision) => Boolean(text(decision.problem))).length },
    { label: '证据 / 假设', count: decisions.filter((decision) => Boolean(text(decision.evidence) || text(decision.evidenceSnapshot) || text(decision.assumptions))).length },
    { label: '选择', count: decisions.filter(choiceMade).length },
    { label: '执行结果', count: decisions.filter((decision) => resultFor(decision).length > 0).length },
    { label: '校准', count: decisions.filter(calibrated).length },
  ]
  const evidence = evidenceLabels.map(([key, label]) => { const count = decisions.filter((decision) => evidenceLevel(decision) === key).length; return { key, label, count, share: decisions.length ? Math.round(count / decisions.length * 100) : 0 } })
  const misjudgments = decisions.filter((decision) => validation(decision) === 'CONTRADICTED' && reviewFor(decision).some((review) => ['MISJUDGMENT', 'WRONG_ASSUMPTION', 'BIAS'].includes(text(review.decisionErrorClassification)))).map((decision) => ({ decision, review: reviewFor(decision).find((review) => ['MISJUDGMENT', 'WRONG_ASSUMPTION', 'BIAS'].includes(text(review.decisionErrorClassification)))! })).sort((a, b) => String(b.decision.validatedAt || b.decision.updatedAt).localeCompare(String(a.decision.validatedAt || a.decision.updatedAt)))
  const attention = decisions.flatMap((decision) => {
    const due = at(dueAt(decision)); const overdue = due ? Math.floor((now.getTime() - due.getTime()) / day) : 0; const age = daysFrom(dateOf(decision), now) || 0; const hasTask = tasks.some((task) => String(task.decisionId || '') === decision.id || String(decision.taskId || '') === task.id)
    if (isImportant(decision) && !choiceMade(decision) && due && due.getTime() <= now.getTime() + 3 * day) return [{ id: `choice-${decision.id}`, decision, severity: 'high' as AttentionSeverity, title: `${title(decision)} 尚待 CEO 选择`, detail: overdue > 0 ? `验证/决策节点已逾期 ${overdue} 天；重要性为${level(decision)}。` : '验证/决策节点临近，仍未记录选择。' }]
    if (pending.includes(decision) && (isImportant(decision) || isHighRisk(decision)) && overdue >= 7) return [{ id: `validation-${decision.id}`, decision, severity: 'high' as AttentionSeverity, title: `${title(decision)} 已逾期验证`, detail: `已逾期 ${overdue} 天，且风险/重要性需要 CEO 完成校准。` }]
    if (isImportant(decision) && choiceMade(decision) && !hasTask && age >= 7) return [{ id: `action-${decision.id}`, decision, severity: 'medium' as AttentionSeverity, title: `${title(decision)} 尚无执行行动`, detail: `已做出选择 ${age} 天，但未关联任何行动任务。` }]
    if (isImportant(decision) && executed(decision) && resultFor(decision).length === 0 && age >= 7) return [{ id: `result-${decision.id}`, decision, severity: 'medium' as AttentionSeverity, title: `${title(decision)} 缺少实际结果`, detail: '已标记执行，但没有关联真实 Result / Outcome；不会自动判定失败。' }]
    return []
  }).sort((a, b) => Number(b.severity === 'high') - Number(a.severity === 'high') || importanceRank(b.decision) - importanceRank(a.decision)).slice(0, 5)
  return {
    period, generatedAt: now.toISOString(), decisions, summary: { important: current.filter(isImportant).length, validated: validations.length, pending: pending.length, highRisk: decisions.filter(isHighRisk).length, hitRate: eligible.length ? Math.round(supported.length / eligible.length * 100) : null, hitCoverage: eligible.length, averageCycleDays: cycles.length ? Math.round(cycles.reduce((sum, value) => sum + value, 0) / cycles.length * 10) / 10 : null, cycleCoverage: cycles.length },
    funnel, trend: trendPoints, critical, pending, evidence, misjudgments, attention, people, owner, impact, validation, resultFor, reviewFor,
  }
}
