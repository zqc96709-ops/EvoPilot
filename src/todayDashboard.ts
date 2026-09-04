import { financeDashboard } from './finance'
import { durationMinutes, localDateKey, titleFor, type RecordData } from './model'

export type TodayTaskFilter = 'all' | 'open' | 'done'
export type TodayScheduleItem = { id: string; kind: 'task' | 'time'; at: string; label: string; detail: string; record: RecordData }
export type TodayAllocation = { id: string; label: string; minutes: number; share: number; record?: RecordData }

const dateKey = (value: unknown) => {
  const raw = String(value || '')
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : localDateKey(raw)
}
const sameDay = (value: unknown, day: string) => dateKey(value) === day
const completed = (record: RecordData) => ['completed', 'cancelled'].includes(String(record.status).toLowerCase())
const resultDay = (record: RecordData) => record.date || record.completedAt || record.endDate || record.createdAt
const reviewDay = (record: RecordData) => record.periodEnd || record.updatedAt || record.createdAt
const noteDay = (record: RecordData) => record.createdAt || record.updatedAt
const displayTime = (value: unknown) => {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export type TodayDashboard = {
  day: string
  tasks: RecordData[]
  coreTasks: RecordData[]
  logs: RecordData[]
  results: RecordData[]
  reviews: RecordData[]
  notes: RecordData[]
  allocations: TodayAllocation[]
  categoryAllocations: TodayAllocation[]
  schedule: TodayScheduleItem[]
  expenseMinor: bigint
  totalMinutes: number
  focusMinutes: number
  doneTasks: number
  plannedMinutes: number
}

const allocationsFor = (logs: RecordData[], projects: Map<string, RecordData>, by: 'project' | 'category') => {
  const group = new Map<string, TodayAllocation>()
  logs.forEach((record) => {
    const project = record.projectId ? projects.get(String(record.projectId)) : undefined
    const id = by === 'project' ? project?.id || '__unassigned__' : String(record.category || '__unassigned__')
    const label = by === 'project' ? project ? titleFor(project) : '未分配项目' : String(record.category || '未分类')
    const item = group.get(id) || { id, label, minutes: 0, share: 0, record: by === 'project' ? project : undefined }
    item.minutes += durationMinutes(record)
    group.set(id, item)
  })
  const total = logs.reduce((sum, record) => sum + durationMinutes(record), 0)
  return [...group.values()].sort((left, right) => right.minutes - left.minutes).map((item) => ({ ...item, share: total ? item.minutes / total : 0 }))
}

export function todayDashboard(records: RecordData[], day: string): TodayDashboard {
  const projects = new Map(records.filter((record) => record.entity === 'projects').map((record) => [record.id, record]))
  const tasks = records.filter((record) => record.entity === 'tasks' && (sameDay(record.dueDate, day) || sameDay(record.dueAt, day))).sort((left, right) => String(left.dueAt || left.createdAt).localeCompare(String(right.dueAt || right.createdAt)))
  const coreTasks = [...tasks].sort((left, right) => ({ high: 0, medium: 1, low: 2 }[String(left.priority)] ?? 1) - ({ high: 0, medium: 1, low: 2 }[String(right.priority)] ?? 1)).slice(0, 3)
  const logs = records.filter((record) => record.entity === 'timeLogs' && sameDay(record.startAt, day)).sort((left, right) => String(left.startAt).localeCompare(String(right.startAt)))
  const results = records.filter((record) => record.entity === 'results' && sameDay(resultDay(record), day))
  const reviews = records.filter((record) => record.entity === 'reviews' && sameDay(reviewDay(record), day))
  const notes = records.filter((record) => record.entity === 'notes' && sameDay(noteDay(record), day)).sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)))
  const totalMinutes = logs.reduce((total, record) => total + durationMinutes(record), 0)
  const focusMinutes = logs.filter((record) => String(record.category || '').includes('专注') || String(record.category || '').toLowerCase().includes('focus')).reduce((total, record) => total + durationMinutes(record), 0)
  const allocations = allocationsFor(logs, projects, 'project')
  const categoryAllocations = allocationsFor(logs, projects, 'category')
  const schedule: TodayScheduleItem[] = [
    ...tasks.filter((task) => task.dueAt).map((task) => ({ id: task.id, kind: 'task' as const, at: displayTime(task.dueAt), label: titleFor(task), detail: completed(task) ? '已完成' : '计划任务', record: task })),
    ...logs.map((log) => ({ id: log.id, kind: 'time' as const, at: displayTime(log.startAt), label: titleFor(log), detail: `${durationMinutes(log)} 分钟 · ${String(log.category || '时间记录')}`, record: log })),
  ].sort((left, right) => left.at.localeCompare(right.at))
  const finance = financeDashboard(records, { from: day, to: day })
  return { day, tasks, coreTasks, logs, results, reviews, notes, allocations, categoryAllocations, schedule, expenseMinor: finance.economics.expenseMinor, totalMinutes, focusMinutes, doneTasks: tasks.filter(completed).length, plannedMinutes: tasks.reduce((total, task) => total + Number(task.estimateMinutes || 0), 0) }
}

export const isCompletedTodayTask = completed
