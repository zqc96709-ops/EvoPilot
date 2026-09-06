import type { RecordData } from './model'

export type TaskDashboardPeriod = '7d' | '30d' | '90d' | 'quarter' | 'year'
export type TaskAttentionSeverity = 'high' | 'medium'
export type TaskAttentionKind = 'critical_overdue' | 'project_stalled' | 'decision_without_action' | 'high_priority_unaligned' | 'long_blocked' | 'backlog_growth'

export type TaskExecutionDashboard = {
  period: TaskDashboardPeriod
  generatedAt: string
  summary: { active: number; criticalOverdue: number; blocked: number; alignmentRate: number | null; aligned: number }
  trend: { points: Array<{ key: string; label: string; created: number; completed: number }>; created: number; completed: number; netBacklog: number }
  aging: Array<{ label: string; count: number; share: number; tone: 'normal' | 'watch' | 'risk' }>
  projectLoad: Array<{ project: RecordData; normal: number; overdue: number; blocked: number; total: number }>
  attention: Array<{ id: string; kind: TaskAttentionKind; severity: TaskAttentionSeverity; title: string; detail: string; age: string; record?: RecordData }>
  longAgingCount: number
}

const activeStatuses = new Set(['todo', 'in_progress', 'waiting', 'blocked'])
const dayMs = 86_400_000
const at = (value: unknown) => {
  if (!value) return undefined
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date
}
const localKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const isLive = (record: RecordData) => !record.archivedAt && !record.deletedAt
const isActiveTask = (record: RecordData) => record.entity === 'tasks' && isLive(record) && activeStatuses.has(String(record.status || 'todo'))
const isOverdue = (task: RecordData, now: Date) => {
  const due = at(task.dueAt || task.dueDate)
  return Boolean(due && due.getTime() < now.getTime() && isActiveTask(task))
}
const hasGoalAlignment = (task: RecordData, projectById: Map<string, RecordData>) => Boolean(task.goalId || projectById.get(String(task.projectId || ''))?.goalId)
const periodStart = (period: TaskDashboardPeriod, now: Date) => {
  const start = new Date(now)
  if (period === '7d') start.setDate(start.getDate() - 6)
  if (period === '30d') start.setDate(start.getDate() - 29)
  if (period === '90d') start.setDate(start.getDate() - 89)
  if (period === 'quarter') start.setMonth(start.getMonth() - 3)
  if (period === 'year') start.setFullYear(start.getFullYear() - 1)
  start.setHours(0, 0, 0, 0)
  return start
}
const bucketStarts = (period: TaskDashboardPeriod, now: Date) => {
  const start = periodStart(period, now)
  const daily = period === '7d' || period === '30d'
  const result: Date[] = []
  for (let cursor = new Date(start); cursor <= now; cursor.setDate(cursor.getDate() + (daily ? 1 : 7))) result.push(new Date(cursor))
  return result
}
const bucketKey = (date: Date, period: TaskDashboardPeriod) => {
  if (period === '7d' || period === '30d') return localKey(date)
  const week = new Date(date); week.setHours(0, 0, 0, 0); week.setDate(week.getDate() - ((week.getDay() + 6) % 7))
  return localKey(week)
}
const labelFor = (date: Date, period: TaskDashboardPeriod) => period === '7d' || period === '30d' ? `${date.getMonth() + 1}/${date.getDate()}` : `${date.getMonth() + 1}/${date.getDate()}`
const dateInPeriod = (value: unknown, start: Date, now: Date) => {
  const date = at(value)
  return Boolean(date && date >= start && date <= now)
}
const daysBetween = (from: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - from.getTime()) / dayMs))
const decisionNeedsAction = (decision: RecordData, tasks: RecordData[]) => {
  if (!['decided', 'executed'].includes(String(decision.status))) return false
  return !decision.taskId && !tasks.some((task) => task.decisionId === decision.id)
}

export function taskExecutionDashboard(records: RecordData[], period: TaskDashboardPeriod = '30d', now = new Date()): TaskExecutionDashboard {
  const live = records.filter(isLive)
  const tasks = live.filter((record) => record.entity === 'tasks')
  const active = tasks.filter(isActiveTask)
  const projects = live.filter((record) => record.entity === 'projects')
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const start = periodStart(period, now)
  const criticalOverdue = active.filter((task) => task.priority === 'high' && isOverdue(task, now))
  const blocked = active.filter((task) => task.status === 'blocked')
  const aligned = active.filter((task) => hasGoalAlignment(task, projectById)).length
  const starts = bucketStarts(period, now)
  const points = starts.map((date) => ({ key: bucketKey(date, period), label: labelFor(date, period), created: 0, completed: 0 }))
  const pointByKey = new Map(points.map((point) => [point.key, point]))
  for (const task of tasks) {
    if (dateInPeriod(task.createdAt, start, now)) pointByKey.get(bucketKey(at(task.createdAt)!, period))!.created += 1
    if (dateInPeriod(task.completedAt, start, now)) pointByKey.get(bucketKey(at(task.completedAt)!, period))!.completed += 1
  }
  const created = points.reduce((total, point) => total + point.created, 0)
  const completed = points.reduce((total, point) => total + point.completed, 0)
  const ageBuckets = [
    ['0–3天', 0, 3, 'normal'], ['4–7天', 4, 7, 'normal'], ['8–14天', 8, 14, 'watch'], ['15–30天', 15, 30, 'risk'], ['>30天', 31, Infinity, 'risk'],
  ] as const
  const aging = ageBuckets.map(([label, minimum, maximum, tone]) => ({ label, count: active.filter((task) => {
    const createdAt = at(task.createdAt)
    const age = createdAt ? daysBetween(createdAt, now) : 0
    return age >= minimum && age <= maximum
  }).length, share: 0, tone }))
  for (const bucket of aging) bucket.share = active.length ? bucket.count / active.length : 0
  const projectLoad = projects.map((project) => {
    const projectTasks = active.filter((task) => task.projectId === project.id)
    const blockedCount = projectTasks.filter((task) => task.status === 'blocked').length
    const overdueCount = projectTasks.filter((task) => task.status !== 'blocked' && isOverdue(task, now)).length
    return { project, blocked: blockedCount, overdue: overdueCount, normal: projectTasks.length - blockedCount - overdueCount, total: projectTasks.length }
  }).filter((item) => item.total).sort((left, right) => right.total - left.total || (right.blocked + right.overdue) - (left.blocked + left.overdue)).slice(0, 5)
  const attention: TaskExecutionDashboard['attention'] = []
  if (criticalOverdue.length) attention.push({ id: 'critical-overdue', kind: 'critical_overdue', severity: 'high', title: `${criticalOverdue.length} 个关键任务已逾期`, detail: '高优先级任务已超过截止日期，建议先处理或重新规划。', age: '当前', record: criticalOverdue[0] })
  const longBlocked = blocked.filter((task) => {
    const since = at(task.blockedSince)
    return Boolean(since && daysBetween(since, now) > 3)
  })
  if (longBlocked.length) attention.push({ id: 'long-blocked', kind: 'long_blocked', severity: 'high', title: `${longBlocked.length} 个任务阻塞超过 3 天`, detail: '阻塞时长基于任务进入“受阻”状态的真实时间。', age: `${Math.max(...longBlocked.map((task) => daysBetween(at(task.blockedSince)!, now)))} 天`, record: longBlocked[0] })
  const highUnaligned = active.filter((task) => task.priority === 'high' && !hasGoalAlignment(task, projectById))
  if (highUnaligned.length) attention.push({ id: 'high-priority-unaligned', kind: 'high_priority_unaligned', severity: 'medium', title: `${highUnaligned.length} 个高优先级任务未对齐目标`, detail: '这些任务未直接关联目标，也没有通过所属项目关联目标。', age: '当前', record: highUnaligned[0] })
  const decisions = live.filter((record) => record.entity === 'decisions')
  const actionlessDecision = decisions.find((decision) => decisionNeedsAction(decision, tasks))
  if (actionlessDecision) attention.push({ id: `decision-${actionlessDecision.id}`, kind: 'decision_without_action', severity: 'medium', title: `决策「${String(actionlessDecision.title || '未命名')}」尚未创建行动`, detail: '已决定的事项需要建立关联任务或项目步骤。', age: '待处理', record: actionlessDecision })
  const stalled = projects.find((project) => {
    const highTasks = active.filter((task) => task.projectId === project.id && task.priority === 'high')
    if (!highTasks.length) return false
    const evidence = live.filter((record) => (record.entity === 'timeLogs' || record.entity === 'results') && record.projectId === project.id)
      .map((record) => at(record.entity === 'timeLogs' ? record.startAt : record.completedAt || record.date)).filter((date): date is Date => Boolean(date))
    const latest = evidence.sort((left, right) => right.getTime() - left.getTime())[0]
    return !latest || daysBetween(latest, now) >= 7
  })
  if (stalled) attention.push({ id: `stalled-${stalled.id}`, kind: 'project_stalled', severity: 'high', title: `项目「${String(stalled.title || '未命名')}」缺少执行证据`, detail: '存在高优先级活跃任务，但 7 天内没有完成、时间记录或结果证据。', age: '≥ 7 天', record: stalled })
  const weekly = points.filter((_, index) => index > 0).slice(-2)
  if (weekly.length === 2 && weekly.every((point) => point.created > point.completed)) attention.push({ id: 'backlog-growth', kind: 'backlog_growth', severity: 'medium', title: '积压连续增长', detail: '最近两个时间桶新增任务均多于完成任务。', age: '近两期' })
  attention.sort((left, right) => Number(right.severity === 'high') - Number(left.severity === 'high')).splice(5)
  return { period, generatedAt: now.toISOString(), summary: { active: active.length, criticalOverdue: criticalOverdue.length, blocked: blocked.length, alignmentRate: active.length ? Math.round(aligned / active.length * 100) : null, aligned }, trend: { points, created, completed, netBacklog: created - completed }, aging, projectLoad, attention, longAgingCount: aging.filter((bucket) => bucket.label === '15–30天' || bucket.label === '>30天').reduce((total, bucket) => total + bucket.count, 0) }
}
