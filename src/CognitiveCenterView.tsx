import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { RecordData } from './model'
import { titleFor } from './model'
import { buildCognitiveDashboard, type CognitivePeriod, type CognitiveTab } from './cognitiveIntelligence'

type Props = { records: RecordData[]; tab: CognitiveTab; period: CognitivePeriod; onPeriod: (value: CognitivePeriod) => void; onTab: (tab: CognitiveTab) => void; onOpen: (record: RecordData) => void; onCreate: () => void; onAi: () => void; domainContent?: ReactNode }
const tabs: Array<[CognitiveTab, string]> = [['overview', '总览'], ['insights', '洞见'], ['reviews', '复盘'], ['knowledge', '知识'], ['principles', '原则'], ['mentalModels', '思维模型']]
const date = (record: RecordData) => { const value = record.validatedAt || record.createdAt || record.updatedAt || ''; const parsed = new Date(Number(value) || String(value)); return Number.isNaN(parsed.getTime()) ? '日期未记录' : parsed.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) }
const validation = (record: RecordData) => ['SUPPORTED', 'VALIDATED'].includes(String(record.validationStatus || record.status || '').toUpperCase()) ? '已验证' : String(record.validationStatus || '').toUpperCase() === 'CONTRADICTED' ? '已反驳' : '待验证'
const periodLabels: Record<CognitivePeriod, string> = { '7d': '近 7 天', '30d': '近 30 天', quarter: '本季度', year: '今年', custom: '自定义' }
const isoDay = (date: Date) => date.toISOString().slice(0, 10)
const Sparkline = ({ values }: { values: number[] }) => {
  const peak = Math.max(...values, 0)
  if (!peak) return <svg className="ci-sparkline empty" viewBox="0 0 74 28" aria-label="暂无趋势数据"><path d="M2 21 C18 20 24 22 37 21 S57 20 72 21" /></svg>
  const points = values.map((value, index) => `${2 + index * 10},${25 - value / peak * 20}`).join(' ')
  return <svg className="ci-sparkline" viewBox="0 0 74 28" aria-label="真实记录趋势"><polyline points={points} /></svg>
}
const Empty = ({ icon, title, detail }: { icon: string; title: string; detail: string }) => <div className="ci-empty"><i>{icon}</i><div><strong>{title}</strong><small>{detail}</small></div></div>

export default function CognitiveCenterView({ records, tab, period, onPeriod, onTab, onOpen, onCreate, onAi, domainContent }: Props) {
  const [periodOpen, setPeriodOpen] = useState(false)
  const [customRange, setCustomRange] = useState(() => { const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - 30); return { start: isoDay(start), end: isoDay(end) } })
  const periodRef = useRef<HTMLDivElement>(null)
  useEffect(() => { const close = (event: MouseEvent) => { if (!periodRef.current?.contains(event.target as Node)) setPeriodOpen(false) }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close) }, [])
  const dashboard = buildCognitiveDashboard(records, period, new Date(), customRange)
  const openTab = (next: CognitiveTab) => onTab(next)
  const kpis = [
    { icon: '▣', label: '待复盘', value: dashboard.pendingReviews.length, meta: '当前', state: dashboard.pendingReviews.length ? '需要处理' : '—', pressure: dashboard.pendingReviews.length > 0, tab: 'reviews' as CognitiveTab },
    { icon: '◉', label: '新洞见', value: dashboard.newInsights.length, meta: period === 'custom' ? '自定义周期' : periodLabels[period], state: dashboard.newInsights.length ? '真实记录' : '—', tab: 'insights' as CognitiveTab },
    { icon: '✦', label: '原则候选', value: dashboard.principleCandidates.length, meta: '当前', state: dashboard.principleCandidates.length ? '待确认' : '—', tab: 'principles' as CognitiveTab },
    { icon: '⌕', label: '待验证认知', value: dashboard.pendingValidation.length, meta: '当前', state: dashboard.pendingValidation.length ? '去重后' : '—', pressure: dashboard.pendingValidation.length > 0, tab: 'insights' as CognitiveTab },
  ]
  return <div className="cognition-center">
    <header className="ci-header"><div><h1>认知中心</h1><p>把经历转化为可复用的判断能力，驱动更好的决策与行动</p></div><div><button onClick={onAi}>✦ AI 洞察推荐</button><button className="primary" onClick={onCreate}>＋ 新建</button></div></header>
    <div className="ci-toolbar"><nav>{tabs.map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => openTab(key)}>{label}</button>)}</nav><div className="ci-period" ref={periodRef}><button aria-label="认知分析周期" aria-expanded={periodOpen} onClick={() => setPeriodOpen((value) => !value)}><span>▣</span>{periodLabels[period]}<i>⌄</i></button>{periodOpen && <div className="ci-period-menu" role="listbox">{(Object.keys(periodLabels) as CognitivePeriod[]).map((value) => <button role="option" aria-selected={period === value} key={value} onClick={() => { onPeriod(value); if (value !== 'custom') setPeriodOpen(false) }}>{periodLabels[value]}<b>{period === value ? '✓' : ''}</b></button>)}{period === 'custom' && <div className="ci-period-custom"><label>开始<input aria-label="自定义开始日期" type="date" value={customRange.start} onChange={(event) => setCustomRange((range) => ({ ...range, start: event.target.value }))} /></label><label>结束<input aria-label="自定义结束日期" type="date" value={customRange.end} onChange={(event) => setCustomRange((range) => ({ ...range, end: event.target.value }))} /></label><button onClick={() => setPeriodOpen(false)}>应用</button></div>}</div>}</div></div>
    {tab !== 'overview' ? <section className="ci-domain-content">{domainContent}</section> : <>
      <section className="ci-kpis">{kpis.map((item, index) => <button key={item.label} onClick={() => openTab(item.tab)}><i>{item.icon}</i><span>{item.label}</span><strong>{item.value}</strong><small>{item.meta} <b className={item.pressure ? 'pressure' : ''}>{item.state}</b></small><Sparkline values={dashboard.kpiSeries[index]} /></button>)}</section>
      <section className="ci-grid ci-middle">
        <article className="ci-card"><header><h2>最近重要洞见</h2><button onClick={() => openTab('insights')}>查看全部</button></header><div className="ci-list">{dashboard.importantInsights.length ? dashboard.importantInsights.map((record) => <button key={record.id} onClick={() => onOpen(record)}><i>◉</i><span><strong>{titleFor(record)}</strong><small>来源：{String(record.source || '真实记录')} · {date(record)}</small><small>影响：{String(record.projectId ? '关联项目' : record.decisionId ? '关联决策' : '尚未关联')}</small></span><b>{validation(record)}</b></button>) : <Empty icon="◉" title="尚无重要洞见" detail="完成复盘并沉淀洞见后，将在这里显示。" />}</div><footer>共 {dashboard.newInsights.length} 条周期洞见</footer></article>
        <article className="ci-card"><header><h2>认知待处理 <small>(Cognitive Attention)</small></h2><span>最多 4 项</span></header><div className="ci-attention">{dashboard.attention.length ? dashboard.attention.map((item) => <button key={item.id} onClick={() => item.record && onOpen(item.record)}><i className={item.tone}>◇</i><span><strong>{item.title}</strong><small>{item.detail}</small></span><b>{item.tone === 'danger' ? '需复盘' : '待处理'}</b></button>) : <Empty icon="◇" title="暂无待处理认知" detail="需要复盘、验证或重验的事项会集中到这里。" />}</div><footer>共 {dashboard.attention.length} 项待处理</footer></article>
        <article className="ci-card"><header><h2>最近形成的原则</h2><button onClick={() => openTab('principles')}>查看全部</button></header><div className="ci-list principles">{dashboard.recentPrinciples.length ? dashboard.recentPrinciples.map(({ record, usageCount }) => <button key={record.id} onClick={() => onOpen(record)}><i>◇</i><span><strong>{titleFor(record)}</strong><small>使用 {usageCount} 次 · 最近验证：{date(record)}</small></span><b>已验证</b></button>) : <Empty icon="◇" title="尚无已验证原则" detail="经用户确认的原则会在这里形成可复用判断。" />}</div></article>
      </section>
      <section className="ci-grid ci-bottom">
        <article className="ci-card"><header><h2>认知沉淀路径</h2></header><div className="ci-pipeline"><div className="ci-funnel-visual" aria-label="认知沉淀漏斗">{dashboard.funnel.map((item, index) => <button key={item.label} aria-label={`${item.label} ${item.count}`} onClick={() => openTab((['reviews', 'insights', 'insights', 'principles'] as CognitiveTab[])[index])} style={{ width: `${100 - index * 17}%` }} />)}</div><div className="ci-funnel-stats">{dashboard.funnel.map((item, index) => <button key={item.label} onClick={() => openTab((['reviews', 'insights', 'insights', 'principles'] as CognitiveTab[])[index])}><span>{item.label}</span><strong>{item.count}</strong><b>—</b></button>)}</div></div><footer>认知正在向可复用能力沉淀</footer></article>
        <article className="ci-card"><header><h2>认知应用情况 <small>（所选周期）</small></h2></header><div className="ci-applications">{dashboard.applications.map((item) => <button key={item.type} disabled={!item.records.length} title={item.records.length ? `查看用于${item.type}的真实关系` : `当前周期没有用于${item.type}的真实关系`} onClick={() => item.records[0] && onOpen(item.records[0])}><span>用于{item.type}</span><i><b style={{ width: `${Math.max(item.count ? 10 : 0, item.count / Math.max(...dashboard.applications.map((entry) => entry.count), 1) * 100)}%` }} /></i><strong>{item.count}</strong><em>—</em></button>)}</div><footer>只统计真实关系，不等同于业务影响</footer></article>
        <article className="ci-card"><header><h2>常用思维模型</h2><button onClick={() => openTab('mentalModels')}>查看全部</button></header><div className="ci-models">{dashboard.commonModels.length ? dashboard.commonModels.map((item) => <button key={item.record.id} onClick={() => onOpen(item.record)}><i>◇</i><strong>{titleFor(item.record)}</strong><small>使用 {item.count} 次</small><span>最近用于：{item.latest ? titleFor(item.latest) : '—'}</span></button>) : <Empty icon="◇" title="尚无模型使用记录" detail="在决策中使用思维模型后，将显示真实使用情况。" />}</div></article>
      </section>
    </>}
  </div>
}
