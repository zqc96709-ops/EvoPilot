import type { RecordData } from './model'

export type TimePeriod = 'today' | 'week' | 'month' | '7d' | '30d'
export type TimeConsumerMode = 'project' | 'task'
export type TimeTrendMetric = 'total' | 'deep' | 'goal'

export type TimePeriodBounds = { start: Date; end: Date; previousStart: Date; previousEnd: Date }
export type TimeSlice = { log: RecordData; start: Date; end: Date; minutes: number; dayKey: string; weekday: number }
export type TimeBreakdownItem = { id: string; label: string; minutes: number; share: number; record?: RecordData }
export type TimeTrendPoint = { date: string; label: string; total: number; deep: number; goal: number; topProject?: string }
export type TimePlanActual = { id: string; label: string; planned: number; actual: number }
export type TimeHeatmapCell = { weekday: number; bucket: number; minutes: number; deepMinutes: number; logIds: string[] }
export type TimeEfficiencySignal = {
  id: string
  type: 'MEETING_SHARE_HIGH' | 'DEEP_WORK_DECLINE' | 'UNALIGNED_TIME_HIGH' | 'PROJECT_TIME_OVERRUN' | 'FRAGMENTATION_HIGH' | 'PLAN_ACTUAL_DEVIATION'
  severity: 'high' | 'medium' | 'low'
  title: string
  reason: string
  actionLabel: string
  entityId?: string
  filter?: TimeDrilldownFilter
}
export type TimeDrilldownFilter = { kind: 'all' | 'category' | 'project' | 'task' | 'unlinked' | 'heatmap'; value?: string; weekday?: number; bucket?: number }

export type TimeDashboardDTO = {
  period: TimePeriod
  periodLabel: string
  updatedAt: string
  bounds: TimePeriodBounds
  summary: {
    totalMinutes: number
    goalAlignedMinutes: number
    projectMinutes: number
    deepWorkMinutes: number
    plannedMinutes: number
    actualMinutes: number
    planActualRatio?: number
    previousTotalMinutes: number
    previousGoalAlignedMinutes: number
    previousProjectMinutes: number
    previousDeepWorkMinutes: number
    sparkline: { total: number[]; goal: number[]; project: number[]; deep: number[]; ratio: number[] }
  }
  timeByCategory: TimeBreakdownItem[]
  timeByProject: TimeBreakdownItem[]
  dailyTrend: TimeTrendPoint[]
  plannedVsActual: TimePlanActual[]
  heatmap: TimeHeatmapCell[]
  topProjects: TimeBreakdownItem[]
  topTasks: TimeBreakdownItem[]
  efficiencySignals: TimeEfficiencySignal[]
  unlinkedMinutes: number
  linkedMinutes: number
  nonProjectMinutes: number
  bestDeepWorkBuckets: number[]
  logs: RecordData[]
}

const DAY = 86_400_000
export const TIME_BUCKETS = ['06:00–09:00', '09:00–12:00', '12:00–14:00', '14:00–17:00', '17:00–20:00', '20:00–23:00']
export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
export const TIME_SIGNAL_THRESHOLDS = { meetingShare: .15, unalignedShare: .25, deepDecline: .2, projectOverrun: .2, fragmentShare: .35, fragmentMinutes: 25, planDeviation: .25 }

const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate())
const endOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1)
const addDays = (value: Date, days: number) => { const next = new Date(value); next.setDate(next.getDate() + days); return next }
const dayKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const mondayIndex = (value: Date) => (value.getDay() + 6) % 7
const minutes = (value: unknown) => Math.max(0, Number(value || 0))
const recordTitle = (record?: RecordData) => String(record?.title || record?.name || '未命名')

export function timePeriodBounds(period: TimePeriod, anchor = new Date()): TimePeriodBounds {
  const today = startOfDay(anchor)
  let start = today
  let end = endOfDay(today)
  if (period === 'week') { start = addDays(today, -mondayIndex(today)); end = addDays(start, 7) }
  if (period === 'month') { start = new Date(today.getFullYear(), today.getMonth(), 1); end = new Date(today.getFullYear(), today.getMonth() + 1, 1) }
  if (period === '7d' || period === '30d') { const days = period === '7d' ? 7 : 30; end = endOfDay(today); start = addDays(end, -days) }
  const span = end.getTime() - start.getTime()
  return { start, end, previousStart: new Date(start.getTime() - span), previousEnd: new Date(start) }
}

function logInterval(log: RecordData): { start: Date; end: Date } | null {
  const start = new Date(String(log.startAt || ''))
  if (Number.isNaN(start.getTime())) return null
  const duration = minutes(log.durationMinutes)
  const explicitEnd = new Date(String(log.endAt || ''))
  const end = duration > 0 ? new Date(start.getTime() + duration * 60_000) : explicitEnd
  if (Number.isNaN(end.getTime()) || end <= start) return null
  return { start, end }
}

export function splitTimeLog(log: RecordData, bounds?: { start: Date; end: Date }): TimeSlice[] {
  const interval = logInterval(log)
  if (!interval) return []
  let cursor = bounds && interval.start < bounds.start ? new Date(bounds.start) : interval.start
  const finalEnd = bounds && interval.end > bounds.end ? bounds.end : interval.end
  if (cursor >= finalEnd) return []
  const slices: TimeSlice[] = []
  while (cursor < finalEnd) {
    const nextDay = endOfDay(cursor)
    const sliceEnd = nextDay < finalEnd ? nextDay : finalEnd
    slices.push({ log, start: new Date(cursor), end: new Date(sliceEnd), minutes: (sliceEnd.getTime() - cursor.getTime()) / 60_000, dayKey: dayKey(cursor), weekday: mondayIndex(cursor) })
    cursor = sliceEnd
  }
  return slices
}

function relatedIds(log: RecordData, byId: Map<string, RecordData>) {
  const task = log.taskId ? byId.get(String(log.taskId)) : undefined
  const projectId = String(log.projectId || task?.projectId || '') || undefined
  const project = projectId ? byId.get(projectId) : undefined
  const goalId = String(log.goalId || task?.goalId || project?.goalId || '') || undefined
  return { task, taskId: task?.id || (log.taskId ? String(log.taskId) : undefined), project, projectId, goalId }
}

const categoryFor = (log: RecordData) => String(log.category || (log.workMode === 'DEEP_WORK' ? '深度工作' : log.workMode === 'MEETING' ? '会议' : '未分类'))
const isDeep = (log: RecordData) => log.workMode === 'DEEP_WORK' || log.focusLevel === 'DEEP'
const isMeeting = (log: RecordData) => log.workMode === 'MEETING' || /会议|meeting/i.test(String(log.category || ''))

function aggregate(items: { id: string; label: string; minutes: number; record?: RecordData }[], total: number): TimeBreakdownItem[] {
  const map = new Map<string, TimeBreakdownItem>()
  for (const item of items) { const old = map.get(item.id); map.set(item.id, { ...item, minutes: (old?.minutes || 0) + item.minutes, share: 0, record: item.record || old?.record }) }
  return [...map.values()].map((item) => ({ ...item, share: total ? item.minutes / total : 0 })).sort((a, b) => b.minutes - a.minutes)
}

function heatmapFor(slices: TimeSlice[]): TimeHeatmapCell[] {
  const cells = Array.from({ length: 42 }, (_, index) => ({ weekday: index % 7, bucket: Math.floor(index / 7), minutes: 0, deepMinutes: 0, logIds: [] as string[] }))
  const ranges = [[6, 9], [9, 12], [12, 14], [14, 17], [17, 20], [20, 23]]
  for (const slice of slices) {
    const base = startOfDay(slice.start)
    ranges.forEach(([from, to], bucket) => {
      const start = new Date(base); start.setHours(from)
      const end = new Date(base); end.setHours(to)
      const overlap = Math.max(0, Math.min(slice.end.getTime(), end.getTime()) - Math.max(slice.start.getTime(), start.getTime())) / 60_000
      if (!overlap) return
      const cell = cells[bucket * 7 + slice.weekday]
      cell.minutes += overlap
      if (isDeep(slice.log)) cell.deepMinutes += overlap
      if (!cell.logIds.includes(slice.log.id)) cell.logIds.push(slice.log.id)
    })
  }
  return cells
}

function delta(current: number, previous: number) { return previous ? (current - previous) / previous : current ? 1 : 0 }

export function buildTimeDashboard(records: RecordData[], period: TimePeriod = 'week', anchor = new Date()): TimeDashboardDTO {
  const bounds = timePeriodBounds(period, anchor)
  const byId = new Map(records.map((record) => [record.id, record]))
  const allLogs = records.filter((record) => record.entity === 'timeLogs' && !record.archivedAt && !record.deletedAt && !record.isPlan && record.excludedFromTotals !== true)
  const currentSlices = allLogs.flatMap((log) => splitTimeLog(log, bounds))
  const previousSlices = allLogs.flatMap((log) => splitTimeLog(log, { start: bounds.previousStart, end: bounds.previousEnd }))
  const currentLogIds = new Set(currentSlices.map((slice) => slice.log.id))
  const logs = allLogs.filter((log) => currentLogIds.has(log.id))
  const actualByLog = new Map<string, number>()
  currentSlices.forEach((slice) => actualByLog.set(slice.log.id, (actualByLog.get(slice.log.id) || 0) + slice.minutes))
  const previousByLog = new Map<string, number>()
  previousSlices.forEach((slice) => previousByLog.set(slice.log.id, (previousByLog.get(slice.log.id) || 0) + slice.minutes))
  const total = [...actualByLog.values()].reduce((sum, value) => sum + value, 0)
  const previousTotal = [...previousByLog.values()].reduce((sum, value) => sum + value, 0)
  const goal = logs.reduce((sum, log) => sum + (relatedIds(log, byId).goalId ? actualByLog.get(log.id) || 0 : 0), 0)
  const project = logs.reduce((sum, log) => sum + (relatedIds(log, byId).projectId ? actualByLog.get(log.id) || 0 : 0), 0)
  const deep = logs.reduce((sum, log) => sum + (isDeep(log) ? actualByLog.get(log.id) || 0 : 0), 0)
  const previousLogs = allLogs.filter((log) => previousByLog.has(log.id))
  const previousGoal = previousLogs.reduce((sum, log) => sum + (relatedIds(log, byId).goalId ? previousByLog.get(log.id) || 0 : 0), 0)
  const previousProject = previousLogs.reduce((sum, log) => sum + (relatedIds(log, byId).projectId ? previousByLog.get(log.id) || 0 : 0), 0)
  const previousDeep = previousLogs.reduce((sum, log) => sum + (isDeep(log) ? previousByLog.get(log.id) || 0 : 0), 0)
  const planned = logs.reduce((sum, log) => sum + minutes(log.plannedMinutes), 0) + records.filter((record) => record.entity === 'timeLogs' && record.isPlan && new Date(String(record.startAt || '')).getTime() >= bounds.start.getTime() && new Date(String(record.startAt || '')).getTime() < bounds.end.getTime()).reduce((sum, log) => sum + minutes(log.plannedMinutes), 0)

  const categoryItems = aggregate(logs.map((log) => ({ id: categoryFor(log), label: categoryFor(log), minutes: actualByLog.get(log.id) || 0 })), total)
  const projectItems = aggregate(logs.flatMap((log) => { const relation = relatedIds(log, byId); return relation.projectId ? [{ id: relation.projectId, label: recordTitle(relation.project), minutes: actualByLog.get(log.id) || 0, record: relation.project }] : [] }), total)
  const taskItems = aggregate(logs.flatMap((log) => { const relation = relatedIds(log, byId); return relation.taskId ? [{ id: relation.taskId, label: recordTitle(relation.task), minutes: actualByLog.get(log.id) || 0, record: relation.task }] : [] }), total)

  const trendStart = addDays(endOfDay(startOfDay(anchor)), -7)
  const trend = Array.from({ length: 7 }, (_, index) => { const date = addDays(trendStart, index); return { date: dayKey(date), label: `${date.getMonth() + 1}/${date.getDate()}`, total: 0, deep: 0, goal: 0 } as TimeTrendPoint })
  const trendMap = new Map(trend.map((point) => [point.date, point]))
  allLogs.flatMap((log) => splitTimeLog(log, { start: trendStart, end: addDays(trendStart, 7) })).forEach((slice) => { const point = trendMap.get(slice.dayKey); if (!point) return; point.total += slice.minutes; if (isDeep(slice.log)) point.deep += slice.minutes; if (relatedIds(slice.log, byId).goalId) point.goal += slice.minutes })
  trend.forEach((point) => { const dayStart = new Date(`${point.date}T00:00:00`); const dayProjects = allLogs.flatMap((log) => splitTimeLog(log, { start: dayStart, end: addDays(dayStart, 1) }).map((slice) => ({ log, minutes: slice.minutes }))); const top = aggregate(dayProjects.flatMap(({ log, minutes: value }) => { const relation = relatedIds(log, byId); return relation.projectId ? [{ id: relation.projectId, label: recordTitle(relation.project), minutes: value }] : [] }), point.total)[0]; point.topProject = top?.label })

  const plannedByCategory = new Map<string, number>()
  const actualByCategory = new Map(categoryItems.map((item) => [item.id, item.minutes]))
  records.filter((record) => record.entity === 'timeLogs' && (record.isPlan || minutes(record.plannedMinutes) > 0)).forEach((log) => { const date = new Date(String(log.startAt || '')); if (date >= bounds.start && date < bounds.end) plannedByCategory.set(categoryFor(log), (plannedByCategory.get(categoryFor(log)) || 0) + minutes(log.plannedMinutes)) })
  const planKeys = new Set([...plannedByCategory.keys(), ...actualByCategory.keys()])
  const plannedVsActual = [...planKeys].map((id) => ({ id, label: id, planned: plannedByCategory.get(id) || 0, actual: actualByCategory.get(id) || 0 })).sort((a, b) => Math.max(b.planned, b.actual) - Math.max(a.planned, a.actual)).slice(0, 5)

  const heatmap = heatmapFor(currentSlices)
  const bestDeepWorkBuckets = heatmap.reduce((map, cell) => map.set(cell.bucket, (map.get(cell.bucket) || 0) + cell.deepMinutes), new Map<number, number>())
  const unlinked = logs.reduce((sum, log) => { const relation = relatedIds(log, byId); return sum + (!relation.goalId && !relation.projectId && !relation.taskId ? actualByLog.get(log.id) || 0 : 0) }, 0)
  const meeting = logs.reduce((sum, log) => sum + (isMeeting(log) ? actualByLog.get(log.id) || 0 : 0), 0)
  const fragments = logs.filter((log) => (actualByLog.get(log.id) || 0) < TIME_SIGNAL_THRESHOLDS.fragmentMinutes).reduce((sum, log) => sum + (actualByLog.get(log.id) || 0), 0)
  const signals: TimeEfficiencySignal[] = []
  if (total && meeting / total > TIME_SIGNAL_THRESHOLDS.meetingShare) signals.push({ id: 'meeting-share', type: 'MEETING_SHARE_HIGH', severity: 'high', title: '会议占比偏高', reason: `会议占比 ${Math.round(meeting / total * 100)}%，高于当前阈值 ${Math.round(TIME_SIGNAL_THRESHOLDS.meetingShare * 100)}%。`, actionLabel: '查看', filter: { kind: 'category', value: '会议' } })
  if (previousDeep && delta(deep, previousDeep) < -TIME_SIGNAL_THRESHOLDS.deepDecline) signals.push({ id: 'deep-decline', type: 'DEEP_WORK_DECLINE', severity: 'medium', title: '深度工作下降', reason: `较上期下降 ${Math.round(Math.abs(delta(deep, previousDeep)) * 100)}%。`, actionLabel: '查看', filter: { kind: 'all' } })
  if (total && unlinked / total > TIME_SIGNAL_THRESHOLDS.unalignedShare) signals.push({ id: 'unaligned', type: 'UNALIGNED_TIME_HIGH', severity: 'medium', title: '未关联时间偏高', reason: `${Math.round(unlinked / total * 100)}% 的时间目前无法通过目标、项目或任务解释。`, actionLabel: '去关联', filter: { kind: 'unlinked' } })
  if (total && fragments / total > TIME_SIGNAL_THRESHOLDS.fragmentShare) signals.push({ id: 'fragmented', type: 'FRAGMENTATION_HIGH', severity: 'low', title: '碎片化时间偏多', reason: `${Math.round(fragments / total * 100)}% 来自少于 ${TIME_SIGNAL_THRESHOLDS.fragmentMinutes} 分钟的记录。`, actionLabel: '查看', filter: { kind: 'all' } })
  projectItems.forEach((item) => { const projectLogs = logs.filter((log) => relatedIds(log, byId).projectId === item.id); const projectPlan = projectLogs.reduce((sum, log) => sum + minutes(log.plannedMinutes), 0); if (projectPlan && item.minutes > projectPlan * (1 + TIME_SIGNAL_THRESHOLDS.projectOverrun)) signals.push({ id: `overrun-${item.id}`, type: 'PROJECT_TIME_OVERRUN', severity: 'high', title: `${item.label} 实际时间超过计划`, reason: `计划 ${(projectPlan / 60).toFixed(1)}h，实际 ${(item.minutes / 60).toFixed(1)}h，偏差 +${Math.round((item.minutes / projectPlan - 1) * 100)}%。`, actionLabel: '查看项目', entityId: item.id, filter: { kind: 'project', value: item.id } }) })
  if (planned && Math.abs(total - planned) / planned > TIME_SIGNAL_THRESHOLDS.planDeviation && !signals.some((signal) => signal.type === 'PROJECT_TIME_OVERRUN')) signals.push({ id: 'plan-deviation', type: 'PLAN_ACTUAL_DEVIATION', severity: 'medium', title: '计划与实际偏差较大', reason: `计划 ${(planned / 60).toFixed(1)}h，实际 ${(total / 60).toFixed(1)}h。`, actionLabel: '查看', filter: { kind: 'all' } })

  const periodDays = Math.max(1, Math.round((bounds.end.getTime() - bounds.start.getTime()) / DAY))
  const sparkDays = Array.from({ length: Math.min(periodDays, 14) }, (_, index) => dayKey(addDays(bounds.start, index)))
  const spark = (metric: 'total' | 'goal' | 'project' | 'deep') => sparkDays.map((key) => currentSlices.filter((slice) => slice.dayKey === key).reduce((sum, slice) => { if (metric === 'deep' && !isDeep(slice.log)) return sum; const relation = relatedIds(slice.log, byId); if (metric === 'goal' && !relation.goalId) return sum; if (metric === 'project' && !relation.projectId) return sum; return sum + slice.minutes }, 0))

  return {
    period, periodLabel: ({ today: '今天', week: '本周', month: '本月', '7d': '近7天', '30d': '近30天' } as const)[period], updatedAt: new Date().toISOString(), bounds,
    summary: { totalMinutes: total, goalAlignedMinutes: goal, projectMinutes: project, deepWorkMinutes: deep, plannedMinutes: planned, actualMinutes: total, planActualRatio: planned ? total / planned : undefined, previousTotalMinutes: previousTotal, previousGoalAlignedMinutes: previousGoal, previousProjectMinutes: previousProject, previousDeepWorkMinutes: previousDeep, sparkline: { total: spark('total'), goal: spark('goal'), project: spark('project'), deep: spark('deep'), ratio: spark('total') } },
    timeByCategory: categoryItems, timeByProject: projectItems.slice(0, 8), dailyTrend: trend, plannedVsActual, heatmap, topProjects: projectItems.slice(0, 5), topTasks: taskItems.slice(0, 5), efficiencySignals: signals.sort((a, b) => ({ high: 3, medium: 2, low: 1 }[b.severity] - { high: 3, medium: 2, low: 1 }[a.severity])).slice(0, 4), unlinkedMinutes: unlinked, linkedMinutes: total - unlinked, nonProjectMinutes: total - project, bestDeepWorkBuckets: [...bestDeepWorkBuckets.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([bucket]) => bucket), logs,
  }
}

export function filterTimeLogs(dashboard: TimeDashboardDTO, records: RecordData[], filter: TimeDrilldownFilter): RecordData[] {
  const byId = new Map(records.map((record) => [record.id, record]))
  return dashboard.logs.filter((log) => {
    const relation = relatedIds(log, byId)
    if (filter.kind === 'category') return categoryFor(log) === filter.value || (filter.value === '会议' && isMeeting(log))
    if (filter.kind === 'project') return relation.projectId === filter.value
    if (filter.kind === 'task') return relation.taskId === filter.value
    if (filter.kind === 'unlinked') return !relation.goalId && !relation.projectId && !relation.taskId
    if (filter.kind === 'heatmap') return splitTimeLog(log, dashboard.bounds).some((slice) => slice.weekday === filter.weekday && heatmapFor([slice]).some((cell) => cell.bucket === filter.bucket && cell.minutes > 0))
    return true
  })
}
