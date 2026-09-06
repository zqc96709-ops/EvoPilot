import type { RecordData } from './model'

export type ProjectDashboardPeriod = 'month' | 'lastMonth' | '90d' | 'quarter' | 'year'
export type ProjectHealth = 'healthy' | 'warning' | 'blocked'

type Period = { start: Date; end: Date; label: string }
type ProjectFact = { project: RecordData; health: ProjectHealth; progress: number | null; weeklyMinutes: number; blocker: string; nextAction: string; upcomingMilestone?: RecordData }

export type ProjectIntelligenceDashboard = {
  period: Period
  generatedAt: string
  summary: { active: number; highRisk: number; progressRate: number | null; totalMinutes: number; results: number; alignmentRate: number | null; aligned: number }
  health: Array<{ key: ProjectHealth; label: string; count: number }>
  lifecycle: Array<{ key: string; label: string; count: number; record?: RecordData }>
  focus: ProjectFact[]
  investment: Array<{ project: ProjectFact; minutes: number; results: number }>
  progressTrend: Array<{ key: string; label: string; completed: number; planned: number; rate: number | null }>
  attention: Array<{ id: string; severity: 'high' | 'medium'; title: string; detail: string; record: RecordData }>
  milestones: Array<{ milestone: RecordData; project?: RecordData; state: 'completed' | 'upcoming' | 'risk' }>
}

const dayMs = 86_400_000
const activeProjectStatuses = new Set(['active', 'blocked'])
const activeTaskStatuses = new Set(['todo', 'in_progress', 'waiting', 'blocked'])
const live = (record: RecordData) => !record.archivedAt && !record.deletedAt
const date = (value: unknown) => {
  if (!value) return undefined
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}
const key = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const inPeriod = (value: unknown, period: Period) => { const parsed = date(value); return Boolean(parsed && parsed >= period.start && parsed <= period.end) }
const daysAgo = (value: unknown, now: Date) => { const parsed = date(value); return parsed ? Math.floor((now.getTime() - parsed.getTime()) / dayMs) : undefined }
const isActiveTask = (record: RecordData) => record.entity === 'tasks' && activeTaskStatuses.has(String(record.status || 'todo'))
const number = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined }
const text = (value: unknown) => String(value || '').trim()
const recordDate = (record: RecordData) => record.entity === 'timeLogs' ? record.startAt || record.createdAt : record.entity === 'results' ? record.completedAt || record.date || record.createdAt : record.entity === 'projectMilestones' ? record.completedAt || record.dueDate || record.createdAt : record.createdAt
const periodFor = (preset: ProjectDashboardPeriod, now: Date): Period => {
  const end = new Date(now); end.setHours(23, 59, 59, 999)
  const start = new Date(now)
  let label = '本月'
  if (preset === 'month') start.setDate(1)
  if (preset === 'lastMonth') { start.setMonth(start.getMonth() - 1, 1); end.setMonth(end.getMonth(), 0) ; label = '上月' }
  if (preset === '90d') { start.setDate(start.getDate() - 89); label = '近90天' }
  if (preset === 'quarter') { start.setMonth(start.getMonth() - 2, 1); label = '本季度' }
  if (preset === 'year') { start.setMonth(0, 1); label = '今年' }
  start.setHours(0, 0, 0, 0)
  return { start, end, label }
}
const healthOrder: Record<ProjectHealth, number> = { blocked: 3, warning: 2, healthy: 1 }

export function projectIntelligenceDashboard(records: RecordData[], preset: ProjectDashboardPeriod = 'month', now = new Date()): ProjectIntelligenceDashboard {
  const period = periodFor(preset, now)
  const all = records.filter(live)
  const projects = all.filter((record) => record.entity === 'projects')
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const tasks = all.filter((record) => record.entity === 'tasks')
  const milestones = all.filter((record) => record.entity === 'projectMilestones')
  const results = all.filter((record) => record.entity === 'results')
  const timeLogs = all.filter((record) => record.entity === 'timeLogs')
  const timeline = all.filter((record) => record.entity === 'timelineEvents')
  const reviews = all.filter((record) => record.entity === 'reviews')
  const active = projects.filter((project) => activeProjectStatuses.has(String(project.status || 'active')))
  const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 6); weekStart.setHours(0, 0, 0, 0)
  const projectForTime = (log: RecordData) => text(log.projectId) || text(tasks.find((task) => task.id === log.taskId)?.projectId)
  const minutesFor = (projectId: string, range?: Period) => timeLogs.filter((log) => projectForTime(log) === projectId && (!range || inPeriod(log.startAt || log.createdAt, range))).reduce((sum, log) => sum + Math.max(0, number(log.durationMinutes) || 0), 0)
  const taskFor = (projectId: string) => tasks.filter((task) => text(task.projectId) === projectId)
  const milestoneFor = (projectId: string) => milestones.filter((milestone) => text(milestone.projectId) === projectId)
  const overdue = (value: unknown) => { const parsed = date(value); return Boolean(parsed && parsed < now) }
  const projectFacts = active.map((project): ProjectFact => {
    const projectTasks = taskFor(project.id)
    const projectMilestones = milestoneFor(project.id)
    const blockedTask = projectTasks.find((task) => isActiveTask(task) && task.status === 'blocked' && task.priority === 'high')
    const overdueTask = projectTasks.find((task) => isActiveTask(task) && task.priority === 'high' && overdue(task.dueAt || task.dueDate))
    const blockedMilestone = projectMilestones.find((milestone) => milestone.status === 'blocked' || (milestone.importance === 'high' && milestone.status !== 'completed' && overdue(milestone.dueDate)))
    const dueMilestone = projectMilestones.filter((milestone) => milestone.status !== 'completed' && milestone.status !== 'cancelled' && date(milestone.dueDate)).sort((left, right) => date(left.dueDate)!.getTime() - date(right.dueDate)!.getTime())[0]
    const explicitProgress = number(project.progress)
    const plannedMilestones = projectMilestones.filter((milestone) => milestone.status !== 'cancelled')
    const progress = explicitProgress === undefined ? (plannedMilestones.length ? Math.round(plannedMilestones.filter((milestone) => milestone.status === 'completed').length / plannedMilestones.length * 100) : null) : Math.max(0, Math.min(100, Math.round(explicitProgress)))
    const blocker = text(project.blockers) || text(blockedTask?.title) || text(blockedMilestone?.title)
    let health: ProjectHealth = 'healthy'
    if (project.status === 'blocked' || project.health === 'blocked' || blocker) health = 'blocked'
    else if (project.health === 'at_risk' || overdueTask || (dueMilestone && overdue(dueMilestone.dueDate))) health = 'warning'
    const nextAction = text(dueMilestone?.title) || text(project.nextAction) || text(projectTasks.find((task) => isActiveTask(task) && task.priority === 'high')?.title) || '未定义下一步行动'
    return { project, health, progress, weeklyMinutes: minutesFor(project.id, { start: weekStart, end: now, label: '本周' }), blocker, nextAction, upcomingMilestone: dueMilestone }
  })
  const scheduledMilestones = milestones.filter((milestone) => milestone.status !== 'cancelled' && inPeriod(milestone.dueDate, period))
  const completedMilestones = scheduledMilestones.filter((milestone) => milestone.status === 'completed')
  const health = ([['healthy', '健康'], ['warning', '关注'], ['blocked', '受阻']] as Array<[ProjectHealth, string]>).map(([status, label]) => ({ key: status, label, count: projectFacts.filter((fact) => fact.health === status).length }))
  const hasTimeline = (projectId: string, event: string, values: string[] = []) => timeline.some((item) => item.sourceEntityId === projectId && item.eventType === event && inPeriod(item.occurredAt || item.createdAt, period) && (!values.length || values.includes(text(item.afterValue))))
  const lifecycleIds = {
    initiated: projects.filter((project) => inPeriod(project.createdAt, period)).map((project) => project.id),
    executing: projects.filter((project) => minutesFor(project.id, period) > 0 || hasTimeline(project.id, 'project_status_changed', ['active'])).map((project) => project.id),
    riskHandling: projects.filter((project) => hasTimeline(project.id, 'project_health_changed', ['at_risk', 'blocked']) || hasTimeline(project.id, 'project_status_changed', ['blocked']) || tasks.some((task) => task.projectId === project.id && task.status === 'blocked' && inPeriod(task.updatedAt, period))).map((project) => project.id),
    delivered: projects.filter((project) => hasTimeline(project.id, 'project_status_changed', ['completed'])).map((project) => project.id),
    reviewed: [...new Set(reviews.filter((review) => text(review.projectId) && inPeriod(review.createdAt, period)).map((review) => text(review.projectId)))],
  }
  const lifecycle = ([['initiated', '启动'], ['executing', '执行中'], ['riskHandling', '风险处理'], ['delivered', '完成交付'], ['reviewed', '复盘']] as const).map(([stage, label]) => ({ key: stage, label, count: lifecycleIds[stage].length, record: projectById.get(lifecycleIds[stage][0]) }))
  const focus = [...projectFacts].sort((left, right) => healthOrder[right.health] - healthOrder[left.health] || Number(right.project.priority === 'high') - Number(left.project.priority === 'high') || Number(Boolean(right.upcomingMilestone)) - Number(Boolean(left.upcomingMilestone)) || right.weeklyMinutes - left.weeklyMinutes).slice(0, 6)
  const investment = [...projectFacts].map((fact) => ({ project: fact, minutes: minutesFor(fact.project.id, period), results: new Set(results.filter((result) => result.projectId === fact.project.id && inPeriod(recordDate(result), period)).map((result) => result.id)).size })).sort((left, right) => right.minutes - left.minutes || right.results - left.results).slice(0, 6)
  const trendDates = Array.from({ length: 5 }, (_, index) => { const point = new Date(period.start); point.setDate(point.getDate() + Math.round((period.end.getTime() - period.start.getTime()) / dayMs / 4) * index); point.setHours(23, 59, 59, 999); return point })
  const progressTrend = trendDates.map((point) => { const planned = scheduledMilestones.filter((milestone) => date(milestone.dueDate)! <= point); const completed = planned.filter((milestone) => milestone.status === 'completed' && (!date(milestone.completedAt) || date(milestone.completedAt)! <= point)); return { key: key(point), label: `${point.getMonth() + 1}/${point.getDate()}`, completed: completed.length, planned: planned.length, rate: planned.length ? Math.round(completed.length / planned.length * 100) : null } })
  const attention: ProjectIntelligenceDashboard['attention'] = []
  for (const fact of projectFacts) {
    const highPriority = fact.project.priority === 'high'
    const stale = !minutesFor(fact.project.id, { start: new Date(now.getTime() - 7 * dayMs), end: now, label: '7天' }) && !results.some((result) => result.projectId === fact.project.id && (daysAgo(recordDate(result), now) ?? 999) <= 7)
    if (fact.health === 'blocked') attention.push({ id: `blocked-${fact.project.id}`, severity: 'high', title: `项目「${text(fact.project.title) || '未命名'}」受阻`, detail: fact.blocker || '项目状态为受阻，需要先清除阻塞。', record: fact.project })
    else if (fact.upcomingMilestone && overdue(fact.upcomingMilestone.dueDate)) attention.push({ id: `milestone-${fact.upcomingMilestone.id}`, severity: 'high', title: `里程碑「${text(fact.upcomingMilestone.title) || '未命名'}」已逾期`, detail: `所属项目：${text(fact.project.title) || '未命名项目'}`, record: fact.upcomingMilestone })
    else if (highPriority && !text(fact.project.goalId)) attention.push({ id: `goal-${fact.project.id}`, severity: 'medium', title: `高优先级项目「${text(fact.project.title) || '未命名'}」未对齐目标`, detail: '请关联一个目标，确认这项投入的方向。', record: fact.project })
    else if (fact.nextAction === '未定义下一步行动') attention.push({ id: `action-${fact.project.id}`, severity: 'medium', title: `项目「${text(fact.project.title) || '未命名'}」没有下一步行动`, detail: '请将下一步落实为任务或里程碑。', record: fact.project })
    else if (highPriority && stale) attention.push({ id: `stale-${fact.project.id}`, severity: 'medium', title: `高优先级项目「${text(fact.project.title) || '未命名'}」缺少近7天推进证据`, detail: '没有时间投入或成果记录，请确认是否需要重新规划。', record: fact.project })
  }
  attention.sort((left, right) => Number(right.severity === 'high') - Number(left.severity === 'high'))
  const milestoneItems = milestones.filter((milestone) => milestone.status !== 'cancelled' && (inPeriod(milestone.dueDate, period) || (milestone.status !== 'completed' && date(milestone.dueDate) && date(milestone.dueDate)! >= now))).sort((left, right) => date(left.dueDate)!.getTime() - date(right.dueDate)!.getTime()).slice(0, 5).map((milestone) => ({ milestone, project: projectById.get(text(milestone.projectId)), state: milestone.status === 'completed' ? 'completed' as const : overdue(milestone.dueDate) ? 'risk' as const : 'upcoming' as const }))
  const totalMinutes = timeLogs.filter((log) => inPeriod(log.startAt || log.createdAt, period)).reduce((sum, log) => sum + Math.max(0, number(log.durationMinutes) || 0), 0)
  const periodResults = new Set(results.filter((result) => inPeriod(recordDate(result), period)).map((result) => result.id)).size
  const aligned = projectFacts.filter((fact) => text(fact.project.goalId)).length
  return { period, generatedAt: now.toISOString(), summary: { active: projectFacts.length, highRisk: projectFacts.filter((fact) => fact.health !== 'healthy').length, progressRate: scheduledMilestones.length ? Math.round(completedMilestones.length / scheduledMilestones.length * 100) : null, totalMinutes, results: periodResults, alignmentRate: projectFacts.length ? Math.round(aligned / projectFacts.length * 100) : null, aligned }, health, lifecycle, focus, investment, progressTrend, attention: attention.slice(0, 5), milestones: milestoneItems }
}
