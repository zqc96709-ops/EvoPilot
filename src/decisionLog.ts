import type { RecordData } from './model'

export type DecisionStage = 'PENDING' | 'DECIDED' | 'IN_PROGRESS' | 'VALIDATING' | 'CALIBRATED'
export type DecisionLogQuery = {
  search?: string
  stage?: DecisionStage | 'ALL'
  importance?: string
  riskLevel?: string
  projectId?: string
  validationStatus?: string
  period?: 'ALL' | '30d' | '90d' | 'YEAR'
  sort?: 'DECISION_DATE' | 'UPDATED_AT' | 'IMPORTANCE' | 'VALIDATION_DUE'
  offset?: number
  limit?: number
}
export type DecisionLogPage = { records: RecordData[]; total: number }

const text = (value: unknown) => String(value || '').trim()
const dateValue = (decision: RecordData) => text(decision.decisionAt || decision.date || decision.createdAt || decision.updatedAt)

export const decisionValidation = (decision: RecordData) => {
  const explicit = text(decision.validationStatus)
  if (explicit) return explicit
  return ({ validated: 'SUPPORTED', partially_correct: 'PARTIALLY_SUPPORTED', wrong: 'CONTRADICTED', unknown: 'INCONCLUSIVE' } as Record<string, string>)[text(decision.status)] || 'PENDING'
}

export const decisionStage = (decision: RecordData): DecisionStage => {
  if (decisionValidation(decision) !== 'PENDING') return 'CALIBRATED'
  if (text(decision.actualOutcome || decision.outcome) || text(decision.executionStatus) === 'EXECUTED') return 'VALIDATING'
  if (text(decision.executionStatus) === 'IN_PROGRESS') return 'IN_PROGRESS'
  if (text(decision.selectedOption || decision.ceoDecision) || text(decision.choiceStatus) === 'DECIDED' || text(decision.status) === 'decided') return 'DECIDED'
  return 'PENDING'
}

export const decisionStageLabel = (stage: DecisionStage) => ({ PENDING: '待决策', DECIDED: '已决策', IN_PROGRESS: '执行中', VALIDATING: '待验证', CALIBRATED: '已校准' })[stage]
export const decisionValidationLabel = (status: string) => ({ PENDING: '待验证', SUPPORTED: '得到支持', PARTIALLY_SUPPORTED: '部分支持', CONTRADICTED: '被现实反驳', INCONCLUSIVE: '证据不足' }[status] || '待验证')
export const decisionLevelLabel = (value: unknown) => ({ LOW: '低', MEDIUM: '中', HIGH: '高', CRITICAL: '关键' }[text(value).toUpperCase()] || '—')

const inPeriod = (record: RecordData, period: DecisionLogQuery['period']) => {
  if (!period || period === 'ALL') return true
  const date = new Date(dateValue(record)); if (Number.isNaN(date.getTime())) return true
  const now = new Date(); const days = period === '30d' ? 30 : period === '90d' ? 90 : 365
  return date >= new Date(now.getTime() - days * 86_400_000)
}

export const filterDecisionLogRecords = (records: RecordData[], query: DecisionLogQuery): DecisionLogPage => {
  const search = text(query.search).toLowerCase()
  const all = records.filter((record) => record.entity === 'decisions' && !record.archivedAt && !record.deletedAt)
    .filter((record) => !search || JSON.stringify(record).toLowerCase().includes(search))
    .filter((record) => !query.stage || query.stage === 'ALL' || decisionStage(record) === query.stage)
    .filter((record) => !query.importance || query.importance === 'ALL' || text(record.importance).toUpperCase() === query.importance)
    .filter((record) => !query.riskLevel || query.riskLevel === 'ALL' || text(record.riskLevel).toUpperCase() === query.riskLevel)
    .filter((record) => !query.projectId || query.projectId === 'ALL' || text(record.projectId) === query.projectId)
    .filter((record) => !query.validationStatus || query.validationStatus === 'ALL' || decisionValidation(record) === query.validationStatus)
    .filter((record) => inPeriod(record, query.period))
  const rank = (value: unknown) => ({ LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[text(value).toUpperCase()] || 0)
  const sorted = [...all].sort((left, right) => {
    if (query.sort === 'IMPORTANCE') return rank(right.importance) - rank(left.importance) || dateValue(right).localeCompare(dateValue(left))
    if (query.sort === 'VALIDATION_DUE') return text(left.validationDueAt || left.reviewDueDate || '9999').localeCompare(text(right.validationDueAt || right.reviewDueDate || '9999'))
    const key = query.sort === 'UPDATED_AT' ? 'updatedAt' : 'decisionAt'
    return text(right[key] || right.date || right.updatedAt).localeCompare(text(left[key] || left.date || left.updatedAt))
  })
  const offset = Math.max(0, Number(query.offset || 0)); const limit = Math.max(1, Math.min(100, Number(query.limit || 50)))
  return { records: sorted.slice(offset, offset + limit), total: sorted.length }
}
