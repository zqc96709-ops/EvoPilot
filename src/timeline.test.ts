import { describe, expect, it } from 'vitest'
import { filterTimelineItems, groupTimelineItems, timelineCausalEdges, timelineImportance, timelineOccurredAt, timelineProjection, timelineTimeMeaning, timelineTimestamp, visibleTimelineCausalEdges } from './timeline'
import type { RecordData } from './model'

const record = (entity: RecordData['entity'], id: string, data: Record<string, unknown> = {}) => ({ id, entity, createdAt: '2026-08-01T10:00:00-07:00', updatedAt: '2026-08-11T10:00:00-07:00', ...data }) as RecordData

describe('timeline evidence foundation', () => {
  it('keeps legacy records anchored to createdAt instead of moving on edit', () => {
    expect(timelineOccurredAt(record('reviews', 'r1'))).toBe('2026-08-01T10:00:00-07:00')
  })

  it('separates planned task dates from actual completion', () => {
    expect(timelineOccurredAt(record('tasks', 'planned', { dueDate: '2026-08-12', status: 'todo' }))).toBe('2026-08-12')
    expect(timelineTimeMeaning(record('tasks', 'planned', { dueDate: '2026-08-12', status: 'todo' }))).toBe('planned')
    expect(timelineOccurredAt(record('tasks', 'done', { dueDate: '2026-08-12', completedAt: '2026-08-11T09:00', status: 'completed' }))).toBe('2026-08-11T09:00')
    expect(timelineTimeMeaning(record('tasks', 'done', { completedAt: '2026-08-11T09:00', status: 'completed' }))).toBe('actual')
  })

  it('marks decisions, results, reviews and insights as key evidence', () => {
    expect(['decisions', 'results', 'reviews', 'insights', 'principles', 'mentalModels'].map((entity) => timelineImportance(record(entity as RecordData['entity'], entity)))).toEqual(['key', 'key', 'key', 'key', 'key', 'key'])
  })

  it('parses date-only values in local time and sorts by occurredAt', () => {
    expect(new Date(timelineTimestamp('2026-08-11')).getDate()).toBe(11)
    const items = timelineProjection([record('reviews', 'old'), record('tasks', 'future', { dueDate: '2026-08-12', status: 'todo' })])
    expect(items.map((item) => item.id)).toEqual(['future', 'old'])
  })

  it('filters key items by range, project and goal without leaking other projects', () => {
    const items = timelineProjection([
      record('decisions', 'd1', { occurredAt: '2026-08-11T09:00:00-07:00', projectId: 'p1', goalId: 'g1' }),
      record('results', 'r1', { occurredAt: '2026-08-10T09:00:00-07:00', projectId: 'p2', goalId: 'g2' }),
      record('tasks', 't1', { occurredAt: '2026-08-11T10:00:00-07:00', projectId: 'p1', goalId: 'g1', status: 'todo' }),
    ])
    const filtered = filterTimelineItems(items, { mode: 'key', range: 'week', entity: 'all', projectId: 'p1', goalId: 'g1' }, new Date(2026, 7, 11))
    expect(filtered.map((item) => item.id)).toEqual(['d1'])
  })

  it('groups filtered items by local calendar date', () => {
    const groups = groupTimelineItems(timelineProjection([
      record('decisions', 'd1', { occurredAt: '2026-08-11T09:00:00' }),
      record('results', 'r1', { occurredAt: '2026-08-11T08:00:00' }),
      record('reviews', 'v1', { occurredAt: '2026-08-10T08:00:00' }),
    ]), new Date(2026, 7, 11))
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([['今天', 2], ['昨天', 1]])
  })

  it('builds the explicit Decision to MentalModel chain without duplicating mirrored links', () => {
    const records = [
      record('goals', 'g1'), record('projects', 'p1', { goalId: 'g1' }),
      record('decisions', 'd1', { projectId: 'p1', goalId: 'g1', taskId: 't1' }),
      record('tasks', 't1', { projectId: 'p1', goalId: 'g1', decisionId: 'd1' }),
      record('timeLogs', 'l1', { taskId: 't1' }), record('results', 'r1', { taskId: 't1' }),
      record('reviews', 'v1', { resultId: 'r1' }), record('insights', 'i1', { reviewId: 'v1' }),
      record('principles', 'pr1', { insightIds: ['i1'] }), record('mentalModels', 'm1', { insightId: 'i1' }),
    ]
    const edges = timelineCausalEdges(records)
    expect(edges.map((edge) => edge.kind)).toEqual(['decision_task', 'task_time', 'task_result', 'result_review', 'review_insight', 'insight_principle', 'insight_mental_model'])
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length)
  })

  it('inherits project and goal context through explicit causal records', () => {
    const records = [
      record('goals', 'g1'), record('projects', 'p1', { goalId: 'g1' }), record('tasks', 't1', { projectId: 'p1', goalId: 'g1' }),
      record('results', 'r1', { taskId: 't1' }), record('reviews', 'v1', { resultId: 'r1' }), record('insights', 'i1', { reviewId: 'v1' }),
      record('principles', 'pr1', { insightIds: ['i1'] }), record('mentalModels', 'm1', { insightId: 'i1' }),
    ]
    const projected = timelineProjection(records)
    for (const id of ['r1', 'v1', 'i1', 'pr1', 'm1']) {
      expect(projected.find((item) => item.id === id)).toMatchObject({ projectId: 'p1', goalId: 'g1' })
    }
  })

  it('does not infer causality from time proximity or connect conflicting projects', () => {
    const records = [
      record('decisions', 'd1', { projectId: 'p1', occurredAt: '2026-08-11T09:00:00-07:00' }),
      record('tasks', 'unlinked', { projectId: 'p1', occurredAt: '2026-08-11T09:01:00-07:00' }),
      record('tasks', 'conflict', { projectId: 'p2', decisionId: 'd1' }),
    ]
    expect(timelineCausalEdges(records)).toEqual([])
  })

  it('keeps causal display inside the current filtered timeline', () => {
    const records = [record('tasks', 't1'), record('results', 'r1', { taskId: 't1' }), record('reviews', 'v1', { resultId: 'r1' })]
    const items = timelineProjection(records).filter((item) => item.id !== 'v1')
    expect(visibleTimelineCausalEdges(timelineCausalEdges(records), items).map((edge) => edge.kind)).toEqual(['task_result'])
  })

})
