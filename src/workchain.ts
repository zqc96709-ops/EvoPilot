import { durationMinutes, type RecordData } from './model'

export type WorkChainScorecard = {
  timeMinutes: number
  costMinor: bigint
  resultCount: number
  verifiedResultCount: number
  completedStepCount: number
  stepCount: number
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  guardrails: { title: string; state: 'PASS' | 'FAIL' | 'MISSING'; value?: number; target?: number }[]
}

const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined
const integer = (value: unknown) => /^-?\d+$/.test(String(value ?? '')) ? BigInt(String(value)) : 0n

export function workChainScorecard(records: RecordData[], workflowRun: RecordData): WorkChainScorecard {
  const runId = workflowRun.id
  const steps = records.filter((record) => record.entity === 'workflowRunSteps' && record.workflowRunId === runId)
  const results = records.filter((record) => record.entity === 'results' && record.workflowRunId === runId)
  const timeMinutes = records.filter((record) => record.entity === 'timeLogs' && record.excludedFromTotals !== true && record.workflowRunId === runId).reduce((total, record) => total + durationMinutes(record), 0)
  const costMinor = records.filter((record) => record.entity === 'financialTransactions' && record.workflowRunId === runId && record.status === 'POSTED').reduce((total, record) => total + (integer(record.amountMinor || record.baseAmountMinor) < 0n ? -integer(record.amountMinor || record.baseAmountMinor) : integer(record.amountMinor || record.baseAmountMinor)), 0n)
  const completedStepCount = steps.filter((record) => record.status === 'COMPLETED').length
  const verifiedResultCount = results.filter((record) => record.evidenceStatus === 'VERIFIED').length
  const confidence: WorkChainScorecard['confidence'] = !results.length ? 'LOW' : verifiedResultCount === results.length && steps.length > 0 && completedStepCount === steps.length ? 'HIGH' : 'MEDIUM'
  const metrics = records.filter((record) => record.entity === 'workflowMetricDefinitions' && record.workflowVersionId === workflowRun.workflowVersionId)
  const values: Record<string, number> = { timeMinutes, costMinor: Number(costMinor), resultCount: results.length, verifiedResultCount, completionRate: steps.length ? completedStepCount / steps.length : 0 }
  const guardrails = metrics.filter((metric) => String(metric.isGuardrail) === 'true').map((metric) => {
    const value = values[String(metric.metricKey || '')]
    const minimum = number(metric.minimumAcceptable); const maximum = number(metric.maximumAcceptable)
    const target = minimum ?? maximum
    const state: WorkChainScorecard['guardrails'][number]['state'] = value === undefined ? 'MISSING' : minimum !== undefined && value < minimum ? 'FAIL' : maximum !== undefined && value > maximum ? 'FAIL' : 'PASS'
    return { title: String(metric.title || metric.metricKey || 'Guardrail'), state, value, target }
  })
  return { timeMinutes, costMinor, resultCount: results.length, verifiedResultCount, completedStepCount, stepCount: steps.length, confidence, guardrails }
}

export function compareWorkChainRuns(records: RecordData[], baseline: RecordData, candidate: RecordData) {
  const left = workChainScorecard(records, baseline); const right = workChainScorecard(records, candidate)
  return {
    timeDeltaMinutes: right.timeMinutes - left.timeMinutes,
    costDeltaMinor: right.costMinor - left.costMinor,
    resultDelta: right.resultCount - left.resultCount,
    comparable: baseline.workflowVersionId === candidate.workflowVersionId || Boolean(baseline.contextSnapshot && candidate.contextSnapshot),
    note: '仅对已记录的时间、资金、结果与步骤进行比较；不自动决定 Promote 或 Rollback。',
  }
}
