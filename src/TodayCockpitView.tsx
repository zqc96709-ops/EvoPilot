import { useMemo, useState } from 'react'
import { formatMoneyMinor } from './finance'
import { descriptionFor, priorityLabel, titleFor, type Entity, type RecordData } from './model'
import { isCompletedTodayTask, todayDashboard, type TodayTaskFilter } from './todayDashboard'

type Props = {
  records: RecordData[]
  running?: RecordData
  onOpen: (record: RecordData) => void
  onComplete: (record: RecordData) => void
  onRestore: (record: RecordData) => void
  onStartTimer: (record?: Partial<RecordData>) => void
  onStopTimer: () => void
  onCreate: (entity: Entity, initial?: Partial<RecordData>) => void
}

type AllocationMode = 'project' | 'category'
type TaskSort = 'priority' | 'time' | 'project' | 'status'

const dateInput = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const formatHours = (minutes: number) => minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 6) / 10}h`
const relativeDay = (day: string) => day === dateInput() ? '今天' : day < dateInput() ? '历史执行' : '计划视图'
const weekDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' })
const dateLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

function AllocationDonut({ items }: { items: ReturnType<typeof todayDashboard>['allocations'] }) {
  const colors = ['#74d35e', '#467cf1', '#e5b73f', '#a36bf2', '#53c2c8']
  let offset = 0
  return <div className="today-allocation"><svg viewBox="0 0 42 42" aria-label="今日时间分配">{items.length ? items.map((item, index) => { const length = item.share * 100; const dash = `${length} ${100 - length}`; const node = <circle key={item.id} cx="21" cy="21" r="15.9155" fill="transparent" stroke={colors[index % colors.length]} strokeWidth="4" strokeDasharray={dash} strokeDashoffset={-offset} />; offset += length; return node }) : <circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="#283127" strokeWidth="4" />}</svg><div><strong>{formatHours(items.reduce((sum, item) => sum + item.minutes, 0))}</strong><small>总计</small></div></div>
}

export default function TodayCockpitView({ records, running, onOpen, onComplete, onRestore, onStartTimer, onStopTimer, onCreate }: Props) {
  const [day, setDay] = useState(dateInput)
  const [filter, setFilter] = useState<TodayTaskFilter>('all')
  const [allocationMode, setAllocationMode] = useState<AllocationMode>('project')
  const [taskSort, setTaskSort] = useState<TaskSort>('priority')
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem('jason-os-today-focus') === 'true')
  const dashboard = useMemo(() => todayDashboard(records, day), [records, day])
  const profile = records.find((record) => record.entity === 'profiles')
  const name = String(profile?.nickname || profile?.name || '你')
  const tasks = dashboard.tasks.filter((task) => filter === 'all' ? true : filter === 'done' ? isCompletedTodayTask(task) : !isCompletedTodayTask(task)).sort((left, right) => {
    if (taskSort === 'time') return String(left.dueAt || left.createdAt).localeCompare(String(right.dueAt || right.createdAt))
    if (taskSort === 'project') return titleFor(records.find((record) => record.id === left.projectId) || left).localeCompare(titleFor(records.find((record) => record.id === right.projectId) || right))
    if (taskSort === 'status') return Number(isCompletedTodayTask(left)) - Number(isCompletedTodayTask(right))
    return ({ high: 0, medium: 1, low: 2 }[String(left.priority)] ?? 1) - ({ high: 0, medium: 1, low: 2 }[String(right.priority)] ?? 1)
  })
  const allocations = allocationMode === 'project' ? dashboard.allocations : dashboard.categoryAllocations
  const nextDay = (amount: number) => { const value = new Date(`${day}T12:00:00`); value.setDate(value.getDate() + amount); setDay(dateInput(value)) }
  const toggleFocus = () => { const next = !focusMode; setFocusMode(next); localStorage.setItem('jason-os-today-focus', String(next)) }
  const progress = dashboard.coreTasks.length ? Math.round(dashboard.coreTasks.filter(isCompletedTodayTask).length / dashboard.coreTasks.length * 100) : 0
  const primaryTask = dashboard.tasks.find((task) => !isCompletedTodayTask(task))
  const review = dashboard.reviews[0]
  const reviewBlocks = review ? [['做得好的', String(review.whatWorked || '暂无记录')], ['需要改进', String(review.whatFailed || '暂无记录')], ['明日重点', String(review.nextAction || review.doDifferently || review.lesson || '暂无下一步行动')]] : []
  const kpis = [
    { label: '今日核心目标', value: `${dashboard.coreTasks.filter(isCompletedTodayTask).length}/${dashboard.coreTasks.length}`, hint: dashboard.coreTasks.length ? `${progress}% 已完成` : '尚未安排', onClick: () => dashboard.coreTasks[0] ? onOpen(dashboard.coreTasks[0]) : onCreate('tasks', { dueDate: day, priority: 'high' }) },
    { label: '今日关键任务', value: `${dashboard.doneTasks}/${dashboard.tasks.length}`, hint: dashboard.tasks.length ? '已完成 / 已安排' : '尚无任务', onClick: () => primaryTask ? onOpen(primaryTask) : onCreate('tasks', { dueDate: day, priority: 'medium' }) },
    { label: '今日时间投入', value: formatHours(dashboard.totalMinutes), hint: dashboard.plannedMinutes ? `目标 ${formatHours(dashboard.plannedMinutes)}` : '尚未设置计划', onClick: () => onStartTimer(primaryTask) },
    { label: '今日专注时长', value: formatHours(dashboard.focusMinutes), hint: dashboard.focusMinutes ? '专注分类记录' : '尚未记录', onClick: () => onStartTimer(primaryTask) },
    { label: '今日支出', value: formatMoneyMinor(dashboard.expenseMinor), hint: dashboard.expenseMinor ? '已入账支出' : '无已入账支出', onClick: () => onCreate('financialTransactions', { occurredAt: `${day}T12:00`, transactionType: 'EXPENSE', status: 'POSTED' }) },
    { label: '今日成果', value: String(dashboard.results.length), hint: dashboard.results.length ? '已记录 Outcome' : '尚未记录成果', onClick: () => onCreate('results', { date: day, status: 'PLANNED' }) },
  ]
  return <div className={`today-cockpit ${focusMode ? 'focus-mode' : ''}`}>
    <header className="today-cockpit-header"><div><h2>{relativeDay(day)}，{name} <span>☀</span></h2><p>专注执行 · 推进关键结果 · 创造价值</p></div><div className="today-date-controls"><button aria-label="前一天" onClick={() => nextDay(-1)}>‹</button><label className="today-date-picker"><input aria-label="选择日期" type="date" value={day} onChange={(event) => setDay(event.target.value)} /><span>{dateLabel(day)}</span></label><span>{weekDay(day)}</span><button aria-label="后一天" onClick={() => nextDay(1)}>›</button></div><div className="today-mode-controls"><button className={focusMode ? 'active' : ''} onClick={toggleFocus}>专注模式 <i aria-hidden="true" /></button><span title="自动跟踪尚未实现，避免提供不可用开关">自动跟踪 · 未启用</span></div></header>
    <section className="today-kpi-grid">{kpis.map(({ label, value, hint, onClick }) => <button key={label} onClick={onClick}><span>{label}</span><strong>{value}</strong><small>{hint}</small>{label === '今日核心目标' && <i style={{ width: `${progress}%` }} />}</button>)}</section>
    <div className="today-workspace">
      <aside className="today-left-column"><section className="today-panel"><header><h3>今日时间分配</h3><label className="today-select"> <span className="sr-only">时间分配方式</span><select aria-label="时间分配方式" value={allocationMode} onChange={(event) => setAllocationMode(event.target.value as AllocationMode)}><option value="project">按项目</option><option value="category">按工作类型</option></select></label></header>{allocations.length ? <div className="today-allocation-content"><AllocationDonut items={allocations} /><div>{allocations.slice(0, 5).map((item, index) => <button key={item.id} disabled={!item.record} title={item.record ? '查看关联项目' : '当前工作类型没有可打开的项目'} onClick={() => item.record && onOpen(item.record)}><i className={`c${index + 1}`} /><span>{item.label}</span><b>{formatHours(item.minutes)} · {Math.round(item.share * 100)}%</b></button>)}</div></div> : <p className="today-empty">今天还没有时间记录。开始计时后将按项目或分类展示。</p>}</section>
      <section className="today-panel today-schedule"><header><h3>今日日程安排</h3><span>{dashboard.schedule.length ? '真实记录' : '暂无安排'}</span></header>{dashboard.schedule.length ? <div>{dashboard.schedule.map((item) => <button key={`${item.kind}-${item.id}`} onClick={() => onOpen(item.record)}><time>{item.at || '全天'}</time><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</div> : <p className="today-empty">为任务设置具体时间，或开始计时后，日程将显示在这里。</p>}</section></aside>
      <section className="today-panel today-tasks"><header><div><h3>今日任务清单</h3><nav>{([['all', `全部 (${dashboard.tasks.length})`], ['open', `未完成 (${dashboard.tasks.length - dashboard.doneTasks})`], ['done', `已完成 (${dashboard.doneTasks})`]] as [TodayTaskFilter, string][]).map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>)}</nav></div><div className="today-task-actions"><label className="today-select"><span className="sr-only">任务排序</span><select aria-label="任务排序" value={taskSort} onChange={(event) => setTaskSort(event.target.value as TaskSort)}><option value="priority">按优先级</option><option value="time">按时间</option><option value="project">按项目</option><option value="status">按状态</option></select></label><button className="today-add-task" onClick={() => onCreate('tasks', { dueDate: day, priority: 'medium' })}>＋ 添加任务</button></div></header>{running && <button className="today-running" onClick={onStopTimer}><i />正在计时：{titleFor(running)} <span>停止并记录</span></button>}<div className="today-task-list">{tasks.length ? tasks.map((task) => { const done = isCompletedTodayTask(task); return <article key={task.id} className={done ? 'done' : ''}><button className="today-task-check" aria-label={done ? '恢复任务' : '完成任务'} onClick={() => done ? onRestore(task) : onComplete(task)}>{done ? '✓' : ''}</button><button className="today-task-copy" onClick={() => onOpen(task)}><strong>{titleFor(task)}</strong><small>{String(task.projectId ? records.find((record) => record.id === task.projectId)?.title || '项目' : '未分配项目')} · {Number(task.estimateMinutes || 0) ? `${task.estimateMinutes} 分钟` : '未估时'}</small></button><em className={String(task.priority || 'medium')}>{priorityLabel(task.priority)}</em><button className="today-task-start" onClick={() => onStartTimer(task)}>{running?.taskId === task.id ? '计时中' : '开始'}</button></article> }) : <div className="today-empty-action"><p>{filter === 'done' ? '今天还没有完成的任务。' : '今天还没有任务。'}</p><button onClick={() => onCreate('tasks', { dueDate: day, priority: 'medium' })}>＋ 添加任务</button></div>}</div></section>
      <aside className="today-right-column"><section className="today-panel today-results"><header><h3>今日关键成果 <small>(Key Results)</small></h3><button onClick={() => onCreate('results', { date: day, status: 'PLANNED' })}>记录成果 ↗</button></header>{dashboard.results.length ? dashboard.results.slice(0, 3).map((result) => { const progress = Number(result.achievementBps || 0) / 100; return <button key={result.id} onClick={() => onOpen(result)}><i>✓</i><span><strong>{titleFor(result)}</strong><small>{descriptionFor(result) || '已记录 Outcome'}</small>{progress > 0 && <em><b style={{ width: `${Math.min(100, progress)}%` }} /></em>}</span><b>{progress > 0 ? `${Math.round(progress)}%` : String(result.status || '已记录')}</b></button> }) : <div className="today-empty-action"><p>今天还没有记录关键成果。</p><button onClick={() => onCreate('results', { date: day, status: 'PLANNED' })}>记录成果</button></div>}</section>
      <section className="today-panel today-review"><header><h3>今日复盘速览</h3><button onClick={() => onCreate('reviews', { title: `${day} 日复盘`, periodStart: day, periodEnd: day })}>开始复盘 ↗</button></header>{review ? <button onClick={() => onOpen(review)} className="today-review-summary">{reviewBlocks.map(([label, content]) => <span key={label}><b>{label}</b><small>{content}</small></span>)}</button> : <div className="today-review-grid"><div><b>做得好的</b><span>暂无复盘记录</span></div><div><b>需要改进</b><span>完成后可沉淀经验</span></div><div><b>明日重点</b><span>从复盘创建下一步</span></div></div>}</section>
      <section className="today-panel today-focus-chart"><header><h3>今日专注时间分布</h3><span>专注 / 轻度工作</span></header><div>{Array.from({ length: 12 }, (_, index) => { const log = dashboard.logs[index]; return <i key={index} className={log ? String(log.category || '').includes('专注') ? 'focus' : 'light' : ''} style={{ height: `${log ? Math.max(14, Math.min(100, Math.round((Number(log.durationMinutes || 0) / 120) * 100))) : 4}%` }} /> })}</div><small>{formatHours(dashboard.focusMinutes)} 专注 · {formatHours(Math.max(0, dashboard.totalMinutes - dashboard.focusMinutes))} 其他</small></section></aside>
    </div>
    {!focusMode && <section className="today-notes"><header><h3>今日笔记 & 灵感</h3><button onClick={() => onCreate('notes', { type: 'JOURNAL', status: 'ACTIVE' })}>＋ 快速记录</button></header>{dashboard.notes.length ? <div>{dashboard.notes.slice(0, 3).map((note) => <button key={note.id} onClick={() => onOpen(note)}><strong>{titleFor(note)}</strong><span>{descriptionFor(note) || '空白笔记'}</span></button>)}</div> : <p>没有新增笔记。记录一个想法、观察或今天的判断。</p>}</section>}
  </div>
}
