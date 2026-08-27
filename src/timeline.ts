import type { Entity, RecordData } from './model'

export type TimelineTimeMeaning = 'planned' | 'actual' | 'recorded'
export type TimelineImportance = 'key' | 'normal'
export type TimelineEvidenceLevel = 'REALITY' | 'USER_CONFIRMED' | 'AI_CONFIRMED' | 'AI_SUGGESTION'

export type TimelineProjectionItem = {
  id: string
  record: RecordData
  occurredAt: string
  timeMeaning: TimelineTimeMeaning
  importance: TimelineImportance
  evidenceLevel: TimelineEvidenceLevel
  goalId?: string
  projectId?: string
  taskId?: string
}

export type TimelineCausalKind = 'signal_opportunity' | 'opportunity_decision' | 'decision_project' | 'decision_task' | 'task_time' | 'task_result' | 'result_review' | 'review_insight' | 'insight_principle' | 'insight_mental_model'

export type TimelineCausalEdge = {
  id: string
  kind: TimelineCausalKind
  label: string
  sourceId: string
  targetId: string
  source: RecordData
  target: RecordData
}

export const timelineEntityTypes: Entity[] = ['goals', 'projects', 'tasks', 'timeLogs', 'events', 'results', 'deliverables', 'resultPackages', 'workflowRuns', 'workflowRunSteps', 'workflowImprovementProposals', 'reviews', 'insights', 'principles', 'mentalModels', 'decisions', 'signals', 'opportunities', 'intelligenceBriefs', 'financialTransactions', 'timelineEvents']

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : ''
const first = (...values: unknown[]) => values.map(text).find(Boolean) || ''
const ids = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
const contextRelationFields = ['taskId', 'resultId', 'reviewId', 'insightId', 'decisionId', 'opportunityId', 'sourceDecisionId', 'sourceOpportunityId', 'signalIds', 'sourceSignalIds', 'reviewIds', 'insightIds']

function timelineContextResolver(records: RecordData[], field: 'projectId' | 'goalId') {
  const byId = new Map(records.map((record) => [record.id, record]))
  const cache = new Map<string, string | null>()
  const resolve = (record: RecordData, visited = new Set<string>()): string | undefined => {
    if (cache.has(record.id)) return cache.get(record.id) || undefined
    if (visited.has(record.id)) return undefined
    const direct = text(record[field])
    if (direct) { cache.set(record.id, direct); return direct }
    if (field === 'projectId' && record.entity === 'projects') { cache.set(record.id, record.id); return record.id }
    if (field === 'goalId' && record.entity === 'goals') { cache.set(record.id, record.id); return record.id }
    const nextVisited = new Set(visited); nextVisited.add(record.id)
    const candidates = [...new Set(contextRelationFields.flatMap((key) => ids(record[key])).map((id) => byId.get(id)).filter((related): related is RecordData => Boolean(related)).map((related) => resolve(related, nextVisited)).filter((value): value is string => Boolean(value)))]
    const resolved = candidates.length === 1 ? candidates[0] : undefined
    cache.set(record.id, resolved || null)
    return resolved
  }
  return resolve
}

export function timelineOccurredAt(record: Partial<RecordData>): string {
  const explicit = text(record.occurredAt)
  if (explicit) return explicit
  if (record.entity === 'timeLogs' || record.entity === 'events') return first(record.startAt, record.createdAt)
  if (record.entity === 'financialTransactions') return first(record.occurredAt, record.createdAt)
  if (record.entity === 'decisions') return first(record.date, record.decisionDate, record.createdAt)
  if (record.entity === 'results') return first(record.date, record.completedAt, record.createdAt)
  if (record.entity === 'deliverables') return first(record.finalizedAt, record.createdAt)
  if (record.entity === 'workflowRuns' || record.entity === 'workflowRunSteps') return first(record.startedAt, record.completedAt, record.createdAt)
  if (record.entity === 'signals') return first(record.detectedAt, record.createdAt)
  if (record.entity === 'intelligenceBriefs') return first(record.generatedAt, record.createdAt)
  if (record.entity === 'tasks') {
    if (record.status === 'completed') return first(record.completedAt, record.createdAt)
    return first(record.dueAt, record.dueDate, record.createdAt)
  }
  return first(record.createdAt, record.updatedAt)
}

export function timelineTimeMeaning(record: Partial<RecordData>): TimelineTimeMeaning {
  if (record.timeMeaning === 'planned' || record.timeMeaning === 'actual' || record.timeMeaning === 'recorded') return record.timeMeaning
  if (record.entity === 'tasks') return record.status === 'completed' ? 'actual' : record.dueAt || record.dueDate ? 'planned' : 'recorded'
  if (record.entity === 'timeLogs' || record.entity === 'results' || record.entity === 'deliverables' || record.entity === 'workflowRuns' || record.entity === 'workflowRunSteps' || record.entity === 'financialTransactions' || record.entity === 'timelineEvents') return 'actual'
  if (record.entity === 'events') return 'planned'
  return 'recorded'
}

export function timelineImportance(record: Partial<RecordData>): TimelineImportance {
  if (record.timelineImportance === 'key' || record.timelineImportance === 'normal') return record.timelineImportance
  if (['decisions', 'results', 'deliverables', 'resultPackages', 'workflowRuns', 'workflowImprovementProposals', 'reviews', 'insights', 'principles', 'mentalModels', 'signals', 'opportunities', 'intelligenceBriefs'].includes(String(record.entity))) return 'key'
  if (record.entity === 'projects' && ['blocked', 'completed'].includes(String(record.status))) return 'key'
  if (record.entity === 'projects' && ['at_risk', 'blocked'].includes(String(record.health))) return 'key'
  if (record.entity === 'goals' && ['completed', 'paused'].includes(String(record.status))) return 'key'
  if (record.entity === 'tasks' && record.status === 'completed' && (record.priority === 'high' || record.importance === 'important')) return 'key'
  return 'normal'
}

export function timelineEvidenceLevel(record: Partial<RecordData>): TimelineEvidenceLevel {
  if (['REALITY', 'USER_CONFIRMED', 'AI_CONFIRMED', 'AI_SUGGESTION'].includes(String(record.evidenceLevel))) return record.evidenceLevel as TimelineEvidenceLevel
  if (record.entity === 'timeLogs' || record.entity === 'results' || record.entity === 'deliverables' || record.entity === 'workflowRuns' || record.entity === 'workflowRunSteps' || record.entity === 'financialTransactions' || record.entity === 'timelineEvents') return 'REALITY'
  return record.agentActionId ? 'AI_CONFIRMED' : 'USER_CONFIRMED'
}

export function timelineProjection(records: RecordData[]): TimelineProjectionItem[] {
  const projectIdFor = timelineContextResolver(records, 'projectId')
  const goalIdFor = timelineContextResolver(records, 'goalId')
  return records.filter((record) => timelineEntityTypes.includes(record.entity)).map((record) => ({
    id: record.id,
    record,
    occurredAt: timelineOccurredAt(record),
    timeMeaning: timelineTimeMeaning(record),
    importance: timelineImportance(record),
    evidenceLevel: timelineEvidenceLevel(record),
    goalId: goalIdFor(record),
    projectId: projectIdFor(record),
    taskId: text(record.taskId) || undefined,
  })).sort((a, b) => timelineTimestamp(b.occurredAt) - timelineTimestamp(a.occurredAt))
}

const causalLabels: Record<TimelineCausalKind, string> = {
  signal_opportunity: '信号形成机会',
  opportunity_decision: '机会进入决策',
  decision_project: '决策形成项目',
  decision_task: '决策形成任务',
  task_time: '任务的实际投入',
  task_result: '任务产生结果',
  result_review: '基于结果复盘',
  review_insight: '从复盘提炼洞见',
  insight_principle: '洞见沉淀为原则',
  insight_mental_model: '洞见形成思维模型',
}

const causalEntities: Record<TimelineCausalKind, [Entity, Entity]> = {
  signal_opportunity: ['signals', 'opportunities'],
  opportunity_decision: ['opportunities', 'decisions'],
  decision_project: ['decisions', 'projects'],
  decision_task: ['decisions', 'tasks'],
  task_time: ['tasks', 'timeLogs'],
  task_result: ['tasks', 'results'],
  result_review: ['results', 'reviews'],
  review_insight: ['reviews', 'insights'],
  insight_principle: ['insights', 'principles'],
  insight_mental_model: ['insights', 'mentalModels'],
}

export function timelineCausalEdges(records: RecordData[]): TimelineCausalEdge[] {
  const byId = new Map(records.map((record) => [record.id, record]))
  const projectIdFor = timelineContextResolver(records, 'projectId')
  const goalIdFor = timelineContextResolver(records, 'goalId')
  const seen = new Set<string>()
  const edges: TimelineCausalEdge[] = []
  const add = (sourceId: string, targetId: string, kind: TimelineCausalKind) => {
    const source = byId.get(sourceId); const target = byId.get(targetId)
    if (!source || !target || source.id === target.id) return
    const [sourceEntity, targetEntity] = causalEntities[kind]
    if (source.entity !== sourceEntity || target.entity !== targetEntity) return
    const sourceProject = projectIdFor(source); const targetProject = projectIdFor(target)
    if (sourceProject && targetProject && sourceProject !== targetProject) return
    const sourceGoal = goalIdFor(source); const targetGoal = goalIdFor(target)
    if (sourceGoal && targetGoal && sourceGoal !== targetGoal) return
    const id = `${kind}:${sourceId}:${targetId}`
    if (seen.has(id)) return
    seen.add(id)
    edges.push({ id, kind, label: causalLabels[kind], sourceId, targetId, source, target })
  }
  records.forEach((record) => {
    if (record.entity === 'opportunities') ids(record.signalIds).forEach((signalId) => add(signalId, record.id, 'signal_opportunity'))
    if (record.entity === 'decisions') add(text(record.opportunityId), record.id, 'opportunity_decision')
    if (record.entity === 'projects') add(text(record.sourceDecisionId), record.id, 'decision_project')
    if (record.entity === 'tasks') add(text(record.decisionId), record.id, 'decision_task')
    if (record.entity === 'decisions') add(record.id, text(record.taskId), 'decision_task')
    if (record.entity === 'timeLogs') add(text(record.taskId), record.id, 'task_time')
    if (record.entity === 'results') add(text(record.taskId), record.id, 'task_result')
    if (record.entity === 'reviews') add(text(record.resultId), record.id, 'result_review')
    if (record.entity === 'insights') add(text(record.reviewId), record.id, 'review_insight')
    if (record.entity === 'principles') ids(record.insightIds).forEach((insightId) => add(insightId, record.id, 'insight_principle'))
    if (record.entity === 'mentalModels') add(text(record.insightId), record.id, 'insight_mental_model')
  })
  return edges
}

export function visibleTimelineCausalEdges(edges: TimelineCausalEdge[], items: TimelineProjectionItem[]) {
  const visible = new Set(items.map((item) => item.record.id))
  return edges.filter((edge) => visible.has(edge.sourceId) && visible.has(edge.targetId))
}

export function timelineTimestamp(value: string): number {
  if (!value) return 0
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day).getTime()
  }
  if (/^\d+$/.test(value)) {
    const raw = Number(value)
    return raw > 1e12 ? raw : raw * 1000
  }
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

export const timelineRecords = (records: RecordData[]) => timelineProjection(records).map((item) => item.record)

export type TimelineMode = 'key' | 'all'
export type TimelineRange = 'today' | 'week' | 'month' | '90d' | 'all'
export type TimelineFilter = {
  mode: TimelineMode
  range: TimelineRange
  entity: Entity | 'all'
  projectId: string | 'all' | 'unlinked'
  goalId: string | 'all' | 'unlinked'
}

export function timelineProjectId(item: TimelineProjectionItem): string | undefined {
  return item.projectId || (item.record.entity === 'projects' ? item.record.id : undefined)
}

export function timelineGoalId(item: TimelineProjectionItem): string | undefined {
  return item.goalId || (item.record.entity === 'goals' ? item.record.id : undefined)
}

export function timelineRangeBounds(range: TimelineRange, anchor = new Date()): { start: number; end: number } | null {
  if (range === 'all') return null
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  const end = new Date(start)
  if (range === 'week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    end.setTime(start.getTime()); end.setDate(end.getDate() + 6)
  } else if (range === 'month') {
    start.setDate(1)
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 0)
  } else if (range === '90d') {
    start.setDate(start.getDate() - 89)
  }
  end.setHours(23, 59, 59, 999)
  return { start: start.getTime(), end: end.getTime() }
}

export function filterTimelineItems(items: TimelineProjectionItem[], filter: TimelineFilter, anchor = new Date()): TimelineProjectionItem[] {
  const bounds = timelineRangeBounds(filter.range, anchor)
  return items.filter((item) => {
    if (filter.mode === 'key' && item.importance !== 'key') return false
    if (filter.entity !== 'all' && item.record.entity !== filter.entity) return false
    const projectId = timelineProjectId(item)
    if (filter.projectId === 'unlinked' ? projectId : filter.projectId !== 'all' && projectId !== filter.projectId) return false
    const goalId = timelineGoalId(item)
    if (filter.goalId === 'unlinked' ? goalId : filter.goalId !== 'all' && goalId !== filter.goalId) return false
    if (bounds) { const timestamp = timelineTimestamp(item.occurredAt); if (timestamp < bounds.start || timestamp > bounds.end) return false }
    return true
  })
}

export function timelineDateKey(value: string): string {
  const timestamp = timelineTimestamp(value)
  if (!timestamp) return 'unknown'
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function timelineDateLabel(key: string, anchor = new Date()): string {
  if (key === 'unknown') return '时间未知'
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const today = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  const delta = Math.round((today.getTime() - date.getTime()) / 86_400_000)
  if (delta === 0) return '今天'
  if (delta === 1) return '昨天'
  return date.toLocaleDateString('zh-CN', { year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

export function groupTimelineItems(items: TimelineProjectionItem[], anchor = new Date()) {
  const groups = new Map<string, TimelineProjectionItem[]>()
  items.forEach((item) => { const key = timelineDateKey(item.occurredAt); groups.set(key, [...(groups.get(key) || []), item]) })
  return [...groups.entries()].map(([key, groupedItems]) => ({ key, label: timelineDateLabel(key, anchor), items: groupedItems }))
}
