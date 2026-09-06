import { useMemo } from 'react'
import { taskExecutionDashboard, type TaskDashboardPeriod } from './taskExecutionDashboard'
import { titleFor, type RecordData } from './model'

const periodLabels: Record<TaskDashboardPeriod, string> = { '7d': '近7天', '30d': '近30天', '90d': '近90天', quarter: '本季度', year: '今年' }
const number = (value: number | null) => value === null ? '—' : String(value)

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  const points = values.length > 1 ? values.map((value, index) => `${index / (values.length - 1) * 100},${28 - value / max * 24}`).join(' ') : '0,14 100,14'
  return <svg className="task-sparkline" viewBox="0 0 100 30" aria-hidden="true"><polyline points={points} /></svg>
}

function TrendChart({ points }: { points: Array<{ key: string; label: string; created: number; completed: number }> }) {
  const max = Math.max(...points.flatMap((point) => [point.created, point.completed]), 1)
  const visible = points.length > 16 ? points.filter((_, index) => index % Math.ceil(points.length / 12) === 0 || index === points.length - 1) : points
  return <div className="task-trend-chart" aria-label="新增任务和完成任务趋势"><div className="task-chart-grid"><i /><i /><i /><i /></div><div className="task-trend-bars">{points.map((point) => <div className="task-trend-bar" key={point.key} title={`${point.label}：新增 ${point.created}，完成 ${point.completed}`}><span className="created" style={{ height: `${Math.max(point.created ? 7 : 2, point.created / max * 100)}%` }} /><span className="completed" style={{ height: `${Math.max(point.completed ? 7 : 2, point.completed / max * 100)}%` }} /></div>)}</div><div className="task-chart-axis">{visible.map((point) => <span key={point.key}>{point.label}</span>)}</div></div>
}

export default function TaskExecutionDashboardView({ records, period, onPeriod, onOpen }: { records: RecordData[]; period: TaskDashboardPeriod; onPeriod: (period: TaskDashboardPeriod) => void; onOpen: (record: RecordData) => void }) {
  const dashboard = useMemo(() => taskExecutionDashboard(records, period), [records, period])
  const trendValues = dashboard.trend.points.map((point) => point.created + point.completed)
  const metrics = [
    { icon: '☷', label: '活跃任务 / WIP', value: number(dashboard.summary.active), meta: '当前可执行或推进中的任务', tone: 'neutral' },
    { icon: '◷', label: '关键逾期', value: number(dashboard.summary.criticalOverdue), meta: '当前高优先级逾期任务', tone: 'danger' },
    { icon: '⊘', label: '阻塞任务', value: number(dashboard.summary.blocked), meta: dashboard.summary.blocked ? `${dashboard.attention.filter((item) => item.kind === 'long_blocked').length} 项阻塞超过 3 天` : '当前无受阻任务', tone: 'warn' },
    { icon: '◎', label: '目标一致率', value: dashboard.summary.alignmentRate === null ? '—' : `${dashboard.summary.alignmentRate}%`, meta: dashboard.summary.active ? `${dashboard.summary.aligned}/${dashboard.summary.active} 活跃任务已对齐` : '当前没有活跃任务', tone: 'positive' },
  ]
  const projectMax = Math.max(...dashboard.projectLoad.map((item) => item.total), 1)
  return <section className="task-execution-dashboard" aria-label="任务执行总览">
    <header className="task-dashboard-head"><div><p>执行健康 · 积压风险 · 目标对齐</p><small>当前状态与所选周期内真实任务流</small></div><label className="task-period-select"><span className="sr-only">任务统计周期</span><select value={period} onChange={(event) => onPeriod(event.target.value as TaskDashboardPeriod)}>{(Object.keys(periodLabels) as TaskDashboardPeriod[]).map((key) => <option key={key} value={key}>{periodLabels[key]}</option>)}</select></label></header>
    <div className="task-kpi-grid">{metrics.map((metric) => <article className={`task-kpi ${metric.tone}`} key={metric.label}><i>{metric.icon}</i><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.meta}</small><Sparkline values={trendValues} /></article>)}</div>
    <div className="task-dashboard-row task-analytics-row"><section className="task-dashboard-panel task-trend-panel"><header><div><h2>新增任务 vs 完成任务趋势</h2><span><i className="created" />新增任务 <i className="completed" />完成任务</span></div><small>{periodLabels[period]}</small></header><TrendChart points={dashboard.trend.points} /><footer className="task-trend-summary"><span><b>{dashboard.trend.created}</b>本期新增</span><span><b>{dashboard.trend.completed}</b>本期完成</span><span className={dashboard.trend.netBacklog > 0 ? 'pressure' : dashboard.trend.netBacklog < 0 ? 'positive' : ''}><b>{dashboard.trend.netBacklog > 0 ? '+' : ''}{dashboard.trend.netBacklog}</b>净积压变化</span></footer></section>
      <section className="task-dashboard-panel task-aging-panel"><header><div><h2>任务老化分布</h2><small>活跃任务按创建时间统计</small></div><span>共 {dashboard.summary.active} 个活跃任务</span></header><div className="task-aging-list">{dashboard.aging.map((bucket) => <div key={bucket.label}><span>{bucket.label}</span><em><b className={bucket.tone} style={{ width: `${bucket.share * 100}%` }} /></em><strong>{bucket.count} <small>({Math.round(bucket.share * 100)}%)</small></strong></div>)}</div>{dashboard.longAgingCount > 0 ? <button className="task-aging-callout" onClick={() => dashboard.attention.find((item) => item.kind === 'critical_overdue')?.record && onOpen(dashboard.attention.find((item) => item.kind === 'critical_overdue')!.record!)}>有 {dashboard.longAgingCount} 个任务已超过 14 天未完成 <b>查看详情 →</b></button> : <p className="task-panel-empty">当前没有超过 14 天的活跃任务。</p>}</section></div>
    <div className="task-dashboard-row task-diagnosis-row"><section className="task-dashboard-panel task-project-load"><header><h2>各项目执行负载</h2><span>正常 · 逾期 · 阻塞</span></header>{dashboard.projectLoad.length ? <div>{dashboard.projectLoad.map((item) => <button key={item.project.id} onClick={() => onOpen(item.project)}><span><i>◈</i><strong>{titleFor(item.project)}</strong></span><em><b className="normal" style={{ width: `${item.normal / projectMax * 100}%` }} /><b className="overdue" style={{ width: `${item.overdue / projectMax * 100}%` }} /><b className="blocked" style={{ width: `${item.blocked / projectMax * 100}%` }} /></em><strong>{item.total}</strong></button>)}</div> : <p className="task-panel-empty">没有关联项目的活跃任务。</p>}</section>
      <section className="task-dashboard-panel task-attention"><header><h2>Execution Attention <small>需要关注的异常信号</small></h2><span>{dashboard.attention.length ? `${dashboard.attention.length} 项` : '正常'}</span></header>{dashboard.attention.length ? <div>{dashboard.attention.map((item) => <button key={item.id} onClick={() => item.record && onOpen(item.record)} disabled={!item.record}><i className={item.severity}>{item.severity === 'high' ? '!' : '•'}</i><span><strong>{item.title}</strong><small>{item.detail}</small></span><em className={item.severity}>{item.age}</em><b>›</b></button>)}</div> : <p className="task-panel-empty">当前没有需要升级处理的执行异常。</p>}</section></div>
    <footer className="task-dashboard-foot">数据更新于 {new Date(dashboard.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · 指标由本地任务、项目、目标、决策、时间与成果事实实时派生</footer>
  </section>
}
