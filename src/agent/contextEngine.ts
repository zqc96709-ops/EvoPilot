import { durationMinutes, entities, linkedTo, titleFor, type Entity, type RecordData } from '../model'
import { projectEconomics } from '../finance'
import { workChainScorecard } from '../workchain'
import type { AgentContext, ChatMessage, ContextBudget, ContextGap, ContextReference, GlobalContextIntent, GlobalContextPackage } from './types'

const routeEntity: Partial<Record<string, Entity>> = { tasks: 'tasks', time: 'timeLogs', projects: 'projects', outcomes: 'results', finance: 'financialTransactions', knowledge: 'knowledge', reviews: 'reviews', insights: 'insights', principles: 'principles', mentalModels: 'mentalModels', notebook: 'notes', decisions: 'decisions', events: 'events', people: 'people', externalIntelligence: 'signals' }
const stringValue = (value: unknown) => typeof value === 'string' && value ? value : undefined

export type ContextRelationIndex = Map<string, string[]>

const active = (record: RecordData) => !record.archivedAt && !record.deletedAt
const short = (value: unknown, limit = 220) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
const reference = (record: RecordData, source: ContextReference['source']): ContextReference => ({ id: record.id, entity: record.entity, title: titleFor(record), status: stringValue(record.status), summary: short(record.summary || record.description || record.content || record.whatHappened || record.problem || record.notes), source })
const IDs = (value: unknown) => Array.isArray(value) ? value.map(String) : String(value || '').split(',').map((item) => item.trim()).filter(Boolean)

export function buildContextRelationIndex(records: RecordData[]): ContextRelationIndex {
  const index = new Map<string, Set<string>>()
  const known = new Set(records.filter(active).map((record) => record.id))
  const connect = (left: string, right: string) => {
    if (!known.has(left) || !known.has(right) || left === right) return
    if (!index.has(left)) index.set(left, new Set())
    if (!index.has(right)) index.set(right, new Set())
    index.get(left)?.add(right); index.get(right)?.add(left)
  }
  records.filter(active).forEach((record) => {
    const config = entities.find((item) => item.entity === record.entity)
    config?.fields.filter((field) => field.relation).forEach((field) => IDs(record[field.key]).forEach((id) => connect(record.id, id)))
  })
  return new Map([...index].map(([id, related]) => [id, [...related]]))
}

export function detectGlobalIntent(query: string, route = ''): GlobalContextIntent {
  const text = `${query} ${route}`.toLowerCase()
  if (/(创建|新增|保存|记录|修改|更新|完成|开始计时|停止计时)/.test(text)) return 'EXECUTION'
  if (/(ceo|周报|简报|投入高|最应该关注|表现最差|资源|机会成本)/.test(text)) return 'CEO_ANALYSIS'
  if (/(工作链|workflow|v\d+|流程|改进提案)/.test(text)) return 'WORKFLOW_ANALYSIS'
  if (/(决策|值得继续|继续投入|暂停|停止)/.test(text)) return 'DECISION_ANALYSIS'
  if (/(复盘|失败原因|哪些有效|哪些无效)/.test(text)) return 'REVIEW_ANALYSIS'
  if (/(知识|经验|笔记|notebook|想法|收纳箱|inbox)/.test(text)) return 'KNOWLEDGE_RETRIEVAL'
  if (/(长期方向|我是谁|我的偏好|个人背景)/.test(text)) return 'PERSONAL_CONTEXT'
  if (/(项目|时间|资金|成果|结果|任务)/.test(text) || route === 'projects') return 'PROJECT_ANALYSIS'
  return 'RETRIEVAL'
}

export const shouldRetrieveGlobalContext = (intent: GlobalContextIntent) => intent !== 'EXECUTION' && intent !== 'PERSONAL_CONTEXT'
export const explicitlyIncludesInbox = (query: string) => /(收纳箱|inbox|随手写|随手记|快速收集|收纳内容)/i.test(query)

const traverse = (rootId: string | undefined, index: ContextRelationIndex, byId: Map<string, RecordData>, includeInbox: boolean, budget: ContextBudget) => {
  if (!rootId || !byId.has(rootId)) return [] as RecordData[]
  const visited = new Set([rootId]); const queue = [{ id: rootId, depth: 0 }]; const related: RecordData[] = []
  while (queue.length && related.length < budget.maxRelatedEntities) {
    const current = queue.shift()!
    if (current.depth >= budget.maxRelationDepth) continue
    for (const id of index.get(current.id) || []) {
      if (visited.has(id)) continue
      visited.add(id)
      const record = byId.get(id)
      if (!record || (!includeInbox && record.entity === 'inbox')) continue
      related.push(record); queue.push({ id, depth: current.depth + 1 })
      if (related.length >= budget.maxRelatedEntities) break
    }
  }
  return related
}

const goalAlignment = (tasks: RecordData[], project: RecordData | undefined, goals: RecordData[]): GlobalContextPackage['goalAlignment'] => {
  const projectGoalId = stringValue(project?.goalId)
  const counts = { aligned: 0, weaklyAligned: 0, unknown: 0, unaligned: 0 }
  const examples: ContextReference[] = []
  tasks.forEach((task) => {
    const taskGoalId = stringValue(task.goalId)
    const state = taskGoalId && (taskGoalId === projectGoalId || goals.some((goal) => goal.id === taskGoalId)) ? 'aligned' : projectGoalId && !taskGoalId ? 'weaklyAligned' : !taskGoalId && !projectGoalId ? 'unknown' : 'unaligned'
    counts[state] += 1
    if (state !== 'aligned' && examples.length < 4) examples.push({ ...reference(task, 'relation'), summary: state === 'unknown' ? '暂无明确 Goal / Project 上下文，不代表没有价值。' : state === 'weaklyAligned' ? '通过项目间接服务目标。' : '当前记录的 Goal 与项目目标不一致，建议人工检查。' })
  })
  return { ...counts, examples }
}

export function detectContextGaps(records: RecordData[]): ContextGap[] {
  const live = records.filter(active); const hasRelated = (record: RecordData, entitiesToFind: Entity[]) => live.some((candidate) => entitiesToFind.includes(candidate.entity) && linkedTo(candidate, record.id))
  const gaps: ContextGap[] = []
  live.filter((record) => record.entity === 'projects' && record.status === 'completed' && !hasRelated(record, ['results'])).forEach((record) => gaps.push({ id: `project-result:${record.id}`, kind: 'PROJECT_WITHOUT_RESULT', title: titleFor(record), detail: '项目已完成，但尚未记录最终结果。', entityId: record.id, entity: record.entity, priority: 100 }))
  live.filter((record) => record.entity === 'results' && ['SUCCESS', 'PARTIAL', 'FAILED', 'ACHIEVED', 'PARTIALLY_ACHIEVED', 'MISSED'].includes(String(record.status)) && !hasRelated(record, ['reviews'])).forEach((record) => gaps.push({ id: `result-review:${record.id}`, kind: 'RESULT_WITHOUT_REVIEW', title: titleFor(record), detail: '已有最终结果，但尚未复盘。', entityId: record.id, entity: record.entity, priority: 90 }))
  live.filter((record) => record.entity === 'decisions' && record.status === 'decided' && String(record.executionPlan || '').trim() && !hasRelated(record, ['results'])).forEach((record) => gaps.push({ id: `decision-result:${record.id}`, kind: 'DECISION_WITHOUT_RESULT', title: titleFor(record), detail: '决策已有执行计划，但尚未记录实际结果。', entityId: record.id, entity: record.entity, priority: 80 }))
  live.filter((record) => record.entity === 'workflowRuns' && record.status === 'COMPLETED' && !hasRelated(record, ['workflowImprovementProposals'])).forEach((record) => gaps.push({ id: `workflow-evaluation:${record.id}`, kind: 'WORKFLOW_WITHOUT_EVALUATION', title: titleFor(record), detail: '工作链运行已完成，但尚未记录流程评价或改进提案。', entityId: record.id, entity: record.entity, priority: 70 }))
  live.filter((record) => record.entity === 'workflowImprovementProposals' && record.status === 'IMPLEMENTED' && !hasRelated(record, ['workflowRuns', 'reviews'])).forEach((record) => gaps.push({ id: `improvement-validation:${record.id}`, kind: 'IMPROVEMENT_WITHOUT_VALIDATION', title: titleFor(record), detail: '流程改进已实施，但尚未记录验证证据。', entityId: record.id, entity: record.entity, priority: 60 }))
  live.filter((record) => record.entity === 'deliverables' && record.status === 'FINAL' && !['projectId', 'resultId', 'decisionId'].some((key) => stringValue(record[key]))).forEach((record) => gaps.push({ id: `deliverable-source:${record.id}`, kind: 'DELIVERABLE_WITHOUT_SOURCE', title: titleFor(record), detail: '正式成果缺少项目、结果或决策来源上下文。', entityId: record.id, entity: record.entity, priority: 50 }))
  return gaps.sort((left, right) => right.priority - left.priority).slice(0, 5)
}

export function buildGlobalContext({ query, currentRoute, records, context, relationIndex, retrievedRecords = [] }: { query: string; currentRoute: string; records: RecordData[]; context: AgentContext; relationIndex: ContextRelationIndex; retrievedRecords?: RecordData[] }): GlobalContextPackage {
  const intent = detectGlobalIntent(query, currentRoute); const includeInbox = explicitlyIncludesInbox(query)
  const budget: ContextBudget = { maxRelationDepth: 2, maxRelatedEntities: 24, maxSearchResults: 8, usedRelatedEntities: 0, usedSearchResults: 0 }
  const live = records.filter(active); const byId = new Map(live.map((record) => [record.id, record]))
  const primary = byId.get(context.currentEntityId || '') || byId.get(context.currentProjectId || '')
  const related = traverse(primary?.id, relationIndex, byId, includeInbox, budget)
  budget.usedRelatedEntities = related.length
  const retrieved = retrievedRecords.filter((record) => active(record) && (includeInbox || record.entity !== 'inbox') && record.id !== primary?.id && !related.some((item) => item.id === record.id)).slice(0, budget.maxSearchResults)
  budget.usedSearchResults = retrieved.length
  const scoped = [primary, ...related].filter(Boolean) as RecordData[]
  const project = primary?.entity === 'projects' ? primary : scoped.find((record) => record.entity === 'projects') || (context.currentProjectId ? byId.get(context.currentProjectId) : undefined)
  const scopedForProject = project ? [...scoped, ...related.filter((record) => linkedTo(record, project.id))] : scoped
  const unique = [...new Map(scopedForProject.map((record) => [record.id, record])).values()]
  const tasks = unique.filter((record) => record.entity === 'tasks'); const results = unique.filter((record) => record.entity === 'results'); const workflowRuns = unique.filter((record) => record.entity === 'workflowRuns')
  const economics = project ? projectEconomics(unique, project.id) : undefined
  const workflowScorecards = workflowRuns.slice(0, 2).map((run) => ({ title: titleFor(run), status: String(run.status || 'UNKNOWN'), scorecard: workChainScorecard(unique, run) }))
  const profiles = intent === 'CEO_ANALYSIS' || intent === 'DECISION_ANALYSIS' || intent === 'PERSONAL_CONTEXT' ? live.filter((record) => record.entity === 'profiles').slice(0, 1) : []
  const profile = profiles[0]
  const personalContext = profile ? Object.fromEntries(['role', 'workDomains', 'longTermDirection', 'currentFocus', 'workStyle', 'decisionStyle', 'aiAssistancePreference', 'aiResponsePreference', 'aiDecisionPreference', 'aiOtherContext'].map((key) => [key, short(profile[key], 160)]).filter(([, value]) => Boolean(value))) : undefined
  const confidence: GlobalContextPackage['confidence'] = project && (economics?.dataCoverage || 0) >= 75 && results.length ? 'HIGH' : primary || related.length || retrieved.length ? 'MEDIUM' : 'LOW'
  return {
    userQuery: query, intent, includeInbox, primaryContext: primary ? reference(primary, 'current') : undefined,
    relatedEntities: related.map((record) => reference(record, 'relation')), retrievedEntities: retrieved.map((record) => reference(record, 'search')),
    personalContext, goalAlignment: goalAlignment(tasks, project, unique.filter((record) => record.entity === 'goals')),
    summaries: {
      project: project ? reference(project, 'current') : undefined,
      tasks: { total: tasks.length, completed: tasks.filter((record) => record.status === 'completed').length },
      time: { totalMinutes: unique.filter((record) => record.entity === 'timeLogs').reduce((total, record) => total + durationMinutes(record), 0) },
      finance: economics && { incomeMinor: economics.incomeMinor.toString(), expenseMinor: economics.expenseMinor.toString(), cashNetMinor: economics.cashNetMinor.toString(), timeMinutes: economics.timeMinutes, dataCoverage: economics.dataCoverage },
      results: { total: results.length, verified: results.filter((record) => record.evidenceStatus === 'VERIFIED').length, final: results.filter((record) => ['SUCCESS', 'ACHIEVED', 'PARTIAL', 'PARTIALLY_ACHIEVED', 'FAILED', 'MISSED'].includes(String(record.status))).map((record) => reference(record, 'relation')).slice(0, 4) },
      deliverables: unique.filter((record) => record.entity === 'deliverables' && record.status === 'FINAL').map((record) => reference(record, 'relation')).slice(0, 4),
      decisions: unique.filter((record) => record.entity === 'decisions').map((record) => reference(record, 'relation')).slice(0, 4),
      reviews: unique.filter((record) => record.entity === 'reviews').map((record) => reference(record, 'relation')).slice(0, 4),
      workflows: workflowScorecards,
    },
    gaps: detectContextGaps(live), confidence, contextBudget: budget,
  }
}

export function buildAgentContext({ currentRoute, records, selectedProjectId, detailId, conversation }: { currentRoute: string; records: RecordData[]; selectedProjectId: string | null; detailId: string | null; conversation: ChatMessage[] }): AgentContext {
  const current = records.find((record) => record.id === detailId) || records.find((record) => record.id === selectedProjectId)
  const project = current?.entity === 'projects' ? current : records.find((record) => record.entity === 'projects' && record.id === current?.projectId)
  const task = current?.entity === 'tasks' ? current : records.find((record) => record.entity === 'tasks' && record.id === current?.taskId)
  const goalId = stringValue(current?.goalId) || stringValue(project?.goalId) || (current?.entity === 'goals' ? current.id : undefined)
  return {
    currentRoute,
    currentEntityType: current?.entity || routeEntity[currentRoute],
    currentEntityId: current?.id,
    currentGoalId: goalId,
    currentProjectId: current?.entity === 'projects' ? current.id : stringValue(current?.projectId) || project?.id,
    currentTaskId: task?.id,
    currentUser: 'local-user',
    selectedItems: [selectedProjectId, detailId].filter((value): value is string => Boolean(value)),
    recentConversation: conversation.slice(-10).map(({ role, content }) => ({ role, content })),
    recentActions: records.filter((record) => record.entity === 'agentActions').slice(0, 10).map((record) => ({
      id: record.id,
      entity: record.entity,
      actionType: record.actionType,
      intent: record.intent,
      status: record.status,
      previewTitle: record.previewTitle,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
    })),
    localDate: new Date().toLocaleDateString('en-CA'),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}
