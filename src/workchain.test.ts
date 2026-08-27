import { describe, expect, it } from 'vitest'
import { compareWorkChainRuns, workChainScorecard } from './workchain'
import type { RecordData } from './model'

const record = (entity: RecordData['entity'], data: Record<string, unknown>): RecordData => ({ id: Math.random().toString(), entity, createdAt: '', updatedAt: '', ...data }) as RecordData

describe('Work Chain scorecard', () => {
  it('aggregates only facts explicitly linked to a run', () => {
    const run = record('workflowRuns', { workflowVersionId: 'v1' })
    const records = [run, record('timeLogs', { workflowRunId: run.id, durationMinutes: 90 }), record('financialTransactions', { workflowRunId: run.id, status: 'POSTED', amountMinor: '2500' }), record('results', { workflowRunId: run.id, evidenceStatus: 'VERIFIED' }), record('workflowRunSteps', { workflowRunId: run.id, status: 'COMPLETED' }), record('workflowMetricDefinitions', { workflowVersionId: 'v1', metricKey: 'timeMinutes', isGuardrail: 'true', maximumAcceptable: 120 })]
    const score = workChainScorecard(records, run)
    expect(score.timeMinutes).toBe(90); expect(score.costMinor).toBe(2500n); expect(score.verifiedResultCount).toBe(1); expect(score.confidence).toBe('HIGH'); expect(score.guardrails[0].state).toBe('PASS')
  })

  it('does not turn a comparison into an automatic workflow decision', () => {
    const baseline = record('workflowRuns', { workflowVersionId: 'v1', contextSnapshot: '{}' }); const candidate = record('workflowRuns', { workflowVersionId: 'v2', contextSnapshot: '{}' })
    const comparison = compareWorkChainRuns([baseline, candidate, record('results', { workflowRunId: candidate.id })], baseline, candidate)
    expect(comparison.resultDelta).toBe(1); expect(comparison.comparable).toBe(true); expect(comparison.note).toContain('不自动')
  })
})
