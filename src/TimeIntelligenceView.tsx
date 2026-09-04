import { useMemo, useState } from 'react'
import type { RecordData } from './model'
import { buildTimeDashboard, filterTimeLogs, TIME_BUCKETS, WEEKDAYS, type TimeConsumerMode, type TimeDashboardDTO, type TimeDrilldownFilter, type TimePeriod, type TimeTrendMetric } from './timeIntelligence'

type Props = {
  records: RecordData[]
  running?: RecordData
  onStartTimer: () => void
  onStopTimer: () => void
  onOpen: (record: RecordData) => void
  onEdit: (record: RecordData) => void
  onCreate: (initial?: Partial<RecordData>) => void
}

const hours = (minutes: number) => minutes < 60 ? `${Math.round(minutes)} 分钟` : `${(minutes / 60).toFixed(1)} 小时`
const shortHours = (minutes: number) => `${(minutes / 60).toFixed(1)}`
const percent = (value: number) => `${Math.round(value * 100)}%`
const localDateTimeInput = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const deltaCopy = (current: number, previous: number) => {
  if (!previous && !current) return '暂无上期数据'
  if (!previous) return `本期新增 ${hours(current)}`
  const change = current - previous
  return `较上期 ${change >= 0 ? '+' : ''}${(change / 60).toFixed(1)} 小时 ${change >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(change / previous * 100))}%`
}

function Sparkline({ values, negative = false }: { values: number[]; negative?: boolean }) {
  const data = values.length > 1 ? values : [0, values[0] || 0]
  const max = Math.max(...data, 1); const min = Math.min(...data); const span = Math.max(1, max - min)
  const points = data.map((value, index) => `${index / (data.length - 1) * 62},${20 - (value - min) / span * 17}`).join(' ')
  return <svg className={`ti-spark ${negative ? 'negative' : ''}`} viewBox="0 0 62 22" aria-hidden="true"><polyline points={points} /></svg>
}

function Kpi({ label, value, hint, spark, tone, onClick }: { label: string; value: string; hint: string; spark: number[]; tone?: 'down' | 'neutral'; onClick: () => void }) {
  return <button className="ti-kpi" onClick={onClick}><span>{label}</span><strong>{value}</strong><small className={tone === 'down' ? 'down' : ''}>{hint}</small><Sparkline values={spark} negative={tone === 'down'} /></button>
}

function Donut({ items, total, onSelect }: { items: TimeDashboardDTO['timeByCategory']; total: number; onSelect: (id: string) => void }) {
  const colors = ['#b8ec4b', '#76bd57', '#e1d75d', '#ef9a76', '#75c9b8', '#b8bcbc']
  let offset = 0
  const gradient = items.length ? `conic-gradient(${items.slice(0, 6).map((item, index) => { const start = offset; offset += item.share * 100; return `${colors[index]} ${start}% ${offset}%` }).join(',')})` : 'conic-gradient(#30362d 0 100%)'
  return <div className="ti-donut-wrap"><button className="ti-donut" style={{ background: gradient }} onClick={() => onSelect(items[0]?.id || '')} aria-label="查看时间花费结构"><i><small>总计</small><strong>{hours(total)}</strong></i></button><div className="ti-legend">{items.slice(0, 6).map((item, index) => <button key={item.id} onClick={() => onSelect(item.id)}><i style={{ background: colors[index] }} /><span>{item.label}</span><b>{percent(item.share)}</b><small>{shortHours(item.minutes)}h</small></button>)}</div></div>
}

function ProjectBars({ items, onOpen }: { items: TimeDashboardDTO['timeByProject']; onOpen: (item: TimeDashboardDTO['timeByProject'][number]) => void }) {
  const max = Math.max(...items.map((item) => item.minutes), 1)
  return <div className="ti-project-bars">{items.length ? items.slice(0, 7).map((item) => <button key={item.id} title={`${item.label} · ${hours(item.minutes)} · ${percent(item.share)}`} onClick={() => onOpen(item)}><span style={{ height: `${Math.max(8, item.minutes / max * 100)}%` }} /><b>{shortHours(item.minutes)}</b><small>{item.label}</small></button>) : <Empty text="尚无项目时间记录" />}</div>
}

function TrendChart({ dashboard, metric, onMetric, onSelect }: { dashboard: TimeDashboardDTO; metric: TimeTrendMetric; onMetric: (value: TimeTrendMetric) => void; onSelect: (date: string) => void }) {
  const values = dashboard.dailyTrend.map((point) => point[metric])
  const max = Math.max(...values, 60)
  const points = values.map((value, index) => `${24 + index * 43},${116 - value / max * 86}`).join(' ')
  const peak = values.indexOf(Math.max(...values))
  return <div className="ti-trend"><label><span className="sr-only">趋势指标</span><select value={metric} onChange={(event) => onMetric(event.target.value as TimeTrendMetric)}><option value="total">总投入时间</option><option value="deep">深度工作时间</option><option value="goal">目标一致时间</option></select></label><svg viewBox="0 0 310 145" role="img" aria-label="近7天时间趋势"><defs><linearGradient id="timeTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#aedd54" stopOpacity=".32"/><stop offset="1" stopColor="#aedd54" stopOpacity="0"/></linearGradient></defs>{[30, 58, 87, 116].map((y) => <line key={y} x1="20" x2="296" y1={y} y2={y} />)}<polygon points={`24,116 ${points} 282,116`} fill="url(#timeTrendFill)"/><polyline className="series" points={points}/>{dashboard.dailyTrend.map((point, index) => <g key={point.date} className="ti-trend-point" onClick={() => onSelect(point.date)}><circle cx={24 + index * 43} cy={116 - values[index] / max * 86} r="4"><title>{point.date} · {hours(values[index])}{point.topProject ? ` · ${point.topProject}` : ''}</title></circle><text x={24 + index * 43} y="137">{point.label}</text>{index === peak && values[index] > 0 && <text className="peak" x={24 + index * 43} y={Math.max(14, 106 - values[index] / max * 86)}>周中高峰</text>}</g>)}</svg><footer><span>7日平均 <b>{hours(values.reduce((sum, value) => sum + value, 0) / 7)}</b></span><span>{deltaCopy(values.reduce((sum, value) => sum + value, 0), metric === 'deep' ? dashboard.summary.previousDeepWorkMinutes : metric === 'goal' ? dashboard.summary.previousGoalAlignedMinutes : dashboard.summary.previousTotalMinutes)}</span></footer></div>
}

function PlanActual({ items, ratio, onSelect }: { items: TimeDashboardDTO['plannedVsActual']; ratio?: number; onSelect: (id: string) => void }) {
  const max = Math.max(...items.flatMap((item) => [item.planned, item.actual]), 60)
  if (!items.some((item) => item.planned)) return <Empty text="计划数据不足。请在时间记录中填写明确计划时长。" />
  return <div className="ti-plan"><div className="ti-plan-legend"><span>□ 计划时间</span><span>■ 实际时间</span></div>{items.map((item) => <button key={item.id} onClick={() => onSelect(item.id)} title={`${item.label}：计划 ${hours(item.planned)}，实际 ${hours(item.actual)}`}><span>{item.label}</span><i><b className="planned" style={{ width: `${item.planned / max * 100}%` }} /><b className="actual" style={{ width: `${item.actual / max * 100}%` }} /></i><small>{shortHours(item.actual)}h</small></button>)}<footer>计划完成度 <strong>{ratio === undefined ? '—' : percent(ratio)}</strong><span>{ratio && ratio > 1.2 ? '实际明显超出计划' : '按明确计划时长计算'}</span></footer></div>
}

function Heatmap({ dashboard, onCell }: { dashboard: TimeDashboardDTO; onCell: (weekday: number, bucket: number) => void }) {
  const max = Math.max(...dashboard.heatmap.map((cell) => cell.minutes), 1)
  const color = (value: number) => { const level = value / max; return level > .8 ? '#d87657' : level > .6 ? '#d7aa49' : level > .38 ? '#9fbd43' : level > .12 ? '#4d6b35' : '#222a20' }
  return <div className="ti-heatmap"><div className="ti-heat-head"><span />{WEEKDAYS.map((day) => <b key={day}>{day}</b>)}</div>{TIME_BUCKETS.map((label, bucket) => <div className="ti-heat-row" key={label}><span>{label}</span>{WEEKDAYS.map((day, weekday) => { const cell = dashboard.heatmap.find((item) => item.weekday === weekday && item.bucket === bucket)!; return <button key={day} style={{ background: color(cell.minutes) }} onClick={() => onCell(weekday, bucket)} title={`${day} ${label} · ${hours(cell.minutes)}${cell.deepMinutes ? ` · 深度工作 ${hours(cell.deepMinutes)}` : ''}`}>{cell.minutes ? (cell.minutes / 60).toFixed(1) : ''}</button> })}</div>)}<footer><span>低投入</span><i /><i /><i /><i /><span>高投入</span></footer><p>{dashboard.bestDeepWorkBuckets.length ? <>★ 最佳深度工作时段：{dashboard.bestDeepWorkBuckets.map((bucket) => TIME_BUCKETS[bucket]).join('、')}</> : '记录更多深度工作类型时间后，可识别最佳时段。'}</p></div>
}

function ConsumerList({ items, mode, onMode, onOpen }: { items: TimeDashboardDTO['topProjects']; mode: TimeConsumerMode; onMode: (mode: TimeConsumerMode) => void; onOpen: (item: TimeDashboardDTO['topProjects'][number]) => void }) {
  return <div className="ti-consumers"><nav><button className={mode === 'project' ? 'active' : ''} onClick={() => onMode('project')}>项目</button><button className={mode === 'task' ? 'active' : ''} onClick={() => onMode('task')}>任务</button></nav>{items.length ? items.map((item, index) => <button key={item.id} onClick={() => onOpen(item)}><i>{index + 1}</i><span>{item.label}</span><b>{shortHours(item.minutes)}h</b><small>{percent(item.share)}</small></button>) : <Empty text={`尚无关联${mode === 'project' ? '项目' : '任务'}的时间`} />}</div>
}

function Unlinked({ dashboard, onOpen }: { dashboard: TimeDashboardDTO; onOpen: () => void }) {
  const share = dashboard.summary.totalMinutes ? dashboard.unlinkedMinutes / dashboard.summary.totalMinutes : 0
  return <div className="ti-unlinked"><button className="ti-ring" style={{ background: `conic-gradient(#b9e66d 0 ${share * 100}%,#676d64 ${share * 100}% 100%)` }} onClick={onOpen}><i><strong>{hours(dashboard.unlinkedMinutes)}</strong><small>{percent(share)}</small></i></button><div><span><i className="unlinked" />未关联时间 <b>{hours(dashboard.unlinkedMinutes)}</b></span><span><i />已关联时间 <b>{hours(dashboard.linkedMinutes)}</b></span></div><footer>未关联时间较上期仅作事实提示<button onClick={onOpen}>去关联</button></footer></div>
}

function Empty({ text }: { text: string }) { return <p className="ti-empty">{text}</p> }

export default function TimeIntelligenceView({ records, running, onStartTimer, onStopTimer, onOpen, onEdit, onCreate }: Props) {
  const [period, setPeriod] = useState<TimePeriod>('week')
  const [trendMetric, setTrendMetric] = useState<TimeTrendMetric>('total')
  const [consumerMode, setConsumerMode] = useState<TimeConsumerMode>('project')
  const [drilldown, setDrilldown] = useState<{ title: string; filter: TimeDrilldownFilter } | null>(null)
  const dashboard = useMemo(() => buildTimeDashboard(records, period), [records, period])
  const drilldownLogs = drilldown ? filterTimeLogs(dashboard, records, drilldown.filter) : []
  const show = (title: string, filter: TimeDrilldownFilter) => setDrilldown({ title, filter })
  const openConsumer = (item: TimeDashboardDTO['topProjects'][number]) => item.record ? onOpen(item.record) : show(item.label, { kind: consumerMode, value: item.id })

  return <div className="time-intelligence">
    <header className="ti-header"><div><h2>时间</h2><p>洞察时间分配、聚焦高价值工作、驱动更好的 CEO 决策。</p></div><label><span className="sr-only">分析周期</span><select aria-label="分析周期" value={period} onChange={(event) => setPeriod(event.target.value as TimePeriod)}><option value="today">今天</option><option value="week">本周</option><option value="month">本月</option><option value="7d">近7天</option><option value="30d">近30天</option></select></label><div><button onClick={() => onCreate({ startAt: localDateTimeInput(), workMode: 'NORMAL' })}>＋ 手动记录</button>{running ? <button className="danger" onClick={onStopTimer}>■ 停止计时</button> : <button className="primary" onClick={onStartTimer}>▶ 开始计时</button>}<button className="primary" onClick={() => onCreate({ title: '计划时间', startAt: localDateTimeInput(), plannedMinutes: 60, isPlan: true, workMode: 'NORMAL' })}>＋ 计划时间</button></div></header>

    <section className="ti-kpis"><Kpi label="总投入时间" value={hours(dashboard.summary.totalMinutes)} hint={deltaCopy(dashboard.summary.totalMinutes, dashboard.summary.previousTotalMinutes)} spark={dashboard.summary.sparkline.total} onClick={() => show('全部时间记录', { kind: 'all' })}/><Kpi label="目标一致时间" value={hours(dashboard.summary.goalAlignedMinutes)} hint={deltaCopy(dashboard.summary.goalAlignedMinutes, dashboard.summary.previousGoalAlignedMinutes)} spark={dashboard.summary.sparkline.goal} onClick={() => show('目标一致时间', { kind: 'all' })}/><Kpi label="项目时间" value={hours(dashboard.summary.projectMinutes)} hint={deltaCopy(dashboard.summary.projectMinutes, dashboard.summary.previousProjectMinutes)} spark={dashboard.summary.sparkline.project} onClick={() => show('项目时间', { kind: 'all' })}/><Kpi label="深度工作时间" value={dashboard.summary.deepWorkMinutes ? hours(dashboard.summary.deepWorkMinutes) : '尚未记录'} hint={dashboard.summary.deepWorkMinutes ? deltaCopy(dashboard.summary.deepWorkMinutes, dashboard.summary.previousDeepWorkMinutes) : '需明确选择深度工作模式'} spark={dashboard.summary.sparkline.deep} tone={dashboard.summary.deepWorkMinutes < dashboard.summary.previousDeepWorkMinutes ? 'down' : 'neutral'} onClick={() => show('深度工作记录', { kind: 'category', value: '深度工作' })}/><Kpi label="计划 / 实际" value={dashboard.summary.planActualRatio === undefined ? '计划不足' : percent(dashboard.summary.planActualRatio)} hint={dashboard.summary.plannedMinutes ? `${hours(dashboard.summary.plannedMinutes)} / ${hours(dashboard.summary.actualMinutes)}` : '请填写明确计划时长'} spark={dashboard.summary.sparkline.ratio} tone={dashboard.summary.planActualRatio && Math.abs(dashboard.summary.planActualRatio - 1) > .2 ? 'down' : 'neutral'} onClick={() => show('计划与实际', { kind: 'all' })}/></section>

    <section className="ti-grid ti-primary-grid"><article className="ti-card"><header><h3>时间花费结构</h3></header>{dashboard.summary.totalMinutes ? <><Donut items={dashboard.timeByCategory} total={dashboard.summary.totalMinutes} onSelect={(id) => show(id, { kind: 'category', value: id })}/><footer>非项目时间占比 <b>{percent(dashboard.nonProjectMinutes / dashboard.summary.totalMinutes)}</b><span>事实，不代表浪费</span></footer></> : <Empty text="开始记录时间后，这里将显示时间类别结构。" />}</article><article className="ti-card"><header><h3>各项目时间投入 <small>（小时）</small></h3><span>{dashboard.periodLabel}</span></header><ProjectBars items={dashboard.timeByProject} onOpen={(item) => item.record ? onOpen(item.record) : show(item.label, { kind: 'project', value: item.id })}/></article><article className="ti-card"><header><h3>近7天时间趋势 <small>（小时）</small></h3></header><TrendChart dashboard={dashboard} metric={trendMetric} onMetric={setTrendMetric} onSelect={(date) => show(date, { kind: 'all' })}/></article><article className="ti-card"><header><h3>计划 vs 实际 <small>（小时）</small></h3></header><PlanActual items={dashboard.plannedVsActual} ratio={dashboard.summary.planActualRatio} onSelect={(id) => show(id, { kind: 'category', value: id })}/></article></section>

    <section className="ti-grid ti-diagnostic-grid"><article className="ti-card"><header><h3>时间热力图 <small>（小时）</small></h3></header><Heatmap dashboard={dashboard} onCell={(weekday, bucket) => show(`${WEEKDAYS[weekday]} ${TIME_BUCKETS[bucket]}`, { kind: 'heatmap', weekday, bucket })}/></article><article className="ti-card"><header><h3>最耗时项目 / 任务</h3></header><ConsumerList items={consumerMode === 'project' ? dashboard.topProjects : dashboard.topTasks} mode={consumerMode} onMode={setConsumerMode} onOpen={openConsumer}/></article><article className="ti-card"><header><h3>时间效率信号</h3></header><div className="ti-signals">{dashboard.efficiencySignals.length ? dashboard.efficiencySignals.map((signal) => <button key={signal.id} onClick={() => signal.entityId && records.find((record) => record.id === signal.entityId) ? onOpen(records.find((record) => record.id === signal.entityId)!) : show(signal.title, signal.filter || { kind: 'all' })}><i className={signal.severity}>!</i><span><strong>{signal.title}</strong><small>{signal.reason}</small></span><b>{signal.actionLabel}</b></button>) : <Empty text="暂无足够数据生成时间效率信号。" />}</div></article><article className="ti-card"><header><h3>未关联时间</h3></header><Unlinked dashboard={dashboard} onOpen={() => show('未关联时间', { kind: 'unlinked' })}/></article></section>

    <footer className="ti-footer"><span>提示：将更多时间与核心目标和关键项目关联，可以提升执行方向与成果确定性。</span><small>数据更新于 {new Date(dashboard.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small></footer>

    {drilldown && <div className="ti-drilldown-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDrilldown(null)}><aside className="ti-drilldown"><header><div><small>TIME RECORDS</small><h3>{drilldown.title}</h3></div><button onClick={() => setDrilldown(null)}>×</button></header><div>{drilldownLogs.length ? drilldownLogs.map((log) => <article key={log.id}><button onClick={() => onOpen(log)}><strong>{String(log.title || '时间记录')}</strong><small>{new Date(String(log.startAt)).toLocaleString('zh-CN')} · {hours(Number(log.durationMinutes || 0))}</small></button><button onClick={() => onEdit(log)}>{drilldown.filter.kind === 'unlinked' ? '关联 / 编辑' : '编辑'}</button></article>) : <Empty text="当前筛选没有时间记录。" />}</div><footer><button onClick={() => onCreate({ startAt: localDateTimeInput(), workMode: 'NORMAL' })}>＋ 手动记录</button><button className="primary" onClick={() => setDrilldown(null)}>完成</button></footer></aside></div>}
  </div>
}
