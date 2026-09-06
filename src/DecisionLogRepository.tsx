import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { decisionLevelLabel, decisionStage, decisionStageLabel, decisionValidation, decisionValidationLabel, type DecisionLogQuery, type DecisionStage } from './decisionLog'
import { titleFor, type RecordData } from './model'

const stages: Array<DecisionStage | 'ALL'> = ['ALL', 'PENDING', 'DECIDED', 'IN_PROGRESS', 'VALIDATING', 'CALIBRATED']
const dates = (record: RecordData) => {
  const raw = record.decisionAt || record.date || record.createdAt
  const date = new Date(String(raw || ''))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}
const initialQuery = (): DecisionLogQuery => {
  try { return { stage: 'ALL', period: 'ALL', sort: 'DECISION_DATE', limit: 50, ...JSON.parse(sessionStorage.getItem('jason-os-decision-log-query') || '{}') } } catch { return { stage: 'ALL', period: 'ALL', sort: 'DECISION_DATE', limit: 50 } }
}

export default function DecisionLogRepository({ records, onOpen }: { records: RecordData[]; onOpen: (record: RecordData) => void }) {
  const [query, setQuery] = useState<DecisionLogQuery>(initialQuery)
  const [page, setPage] = useState<{ records: RecordData[]; total: number }>({ records: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const projects = useMemo(() => records.filter((record) => record.entity === 'projects'), [records])
  useEffect(() => { sessionStorage.setItem('jason-os-decision-log-query', JSON.stringify(query)) }, [query])
  useEffect(() => {
    let current = true; setLoading(true)
    const timer = window.setTimeout(() => {
      void api.queryDecisions(query).then((result) => { if (current) setPage(result) }).catch(() => { if (current) setPage({ records: [], total: 0 }) }).finally(() => { if (current) setLoading(false) })
    }, 120)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query, records.length])
  const update = (patch: Partial<DecisionLogQuery>) => setQuery((value) => ({ ...value, ...patch, offset: 0 }))
  const stageLabel = (stage: DecisionStage | 'ALL') => stage === 'ALL' ? '全部' : decisionStageLabel(stage)
  return <section className="decision-log-repository" aria-label="决策日志">
    <div className="decision-log-toolbar">
      <input aria-label="搜索决策日志" value={String(query.search || '')} onChange={(event) => update({ search: event.target.value })} placeholder="搜索决策、问题、项目或证据…" />
      <select aria-label="重要性" value={query.importance || 'ALL'} onChange={(event) => update({ importance: event.target.value })}><option value="ALL">全部重要性</option><option value="CRITICAL">关键</option><option value="HIGH">高</option><option value="MEDIUM">中</option><option value="LOW">低</option></select>
      <select aria-label="风险" value={query.riskLevel || 'ALL'} onChange={(event) => update({ riskLevel: event.target.value })}><option value="ALL">全部风险</option><option value="CRITICAL">关键风险</option><option value="HIGH">高风险</option><option value="MEDIUM">中风险</option><option value="LOW">低风险</option></select>
      <select aria-label="项目" value={query.projectId || 'ALL'} onChange={(event) => update({ projectId: event.target.value })}><option value="ALL">全部项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{titleFor(project)}</option>)}</select>
      <select aria-label="验证状态" value={query.validationStatus || 'ALL'} onChange={(event) => update({ validationStatus: event.target.value })}><option value="ALL">全部验证</option><option value="PENDING">待验证</option><option value="SUPPORTED">得到支持</option><option value="PARTIALLY_SUPPORTED">部分支持</option><option value="CONTRADICTED">被现实反驳</option><option value="INCONCLUSIVE">证据不足</option></select>
      <select aria-label="时间范围" value={query.period || 'ALL'} onChange={(event) => update({ period: event.target.value as DecisionLogQuery['period'] })}><option value="ALL">全部时间</option><option value="30d">近30天</option><option value="90d">近90天</option><option value="YEAR">近一年</option></select>
      <select aria-label="排序" value={query.sort || 'DECISION_DATE'} onChange={(event) => update({ sort: event.target.value as DecisionLogQuery['sort'] })}><option value="DECISION_DATE">按决策时间</option><option value="UPDATED_AT">按更新时间</option><option value="IMPORTANCE">按重要性</option><option value="VALIDATION_DUE">按验证节点</option></select>
    </div>
    <div className="decision-log-stage-tabs">{stages.map((stage) => <button key={stage} className={query.stage === stage ? 'active' : ''} onClick={() => update({ stage })}>{stageLabel(stage)}</button>)}</div>
    <div className="decision-log-summary"><span>{loading ? '正在查询本地决策库…' : `共 ${page.total} 条决策`}</span><button onClick={() => setQuery({ stage: 'ALL', period: 'ALL', sort: 'DECISION_DATE', limit: 50 })}>重置筛选</button></div>
    {page.records.length ? <div className="decision-log-table"><div className="decision-log-head"><span>决策</span><span>项目</span><span>重要性</span><span>决策时间</span><span>当前阶段</span><span>验证状态</span></div>{page.records.map((decision) => <button key={decision.id} onClick={() => onOpen(decision)}><strong>{titleFor(decision)}</strong><span>{projects.find((project) => project.id === decision.projectId) ? titleFor(projects.find((project) => project.id === decision.projectId)!) : '未关联项目'}</span><i className={`level-${String(decision.importance || 'medium').toLowerCase()}`}>{decisionLevelLabel(decision.importance)}</i><span>{dates(decision)}</span><em className={`stage-${String(decision.validationStatus || 'pending').toLowerCase()}`}>{decisionStageLabel(decisionStage(decision))}</em><span>{decisionValidationLabel(decisionValidation(decision))}</span></button>)}</div> : !loading && <div className="decision-log-empty"><strong>暂无符合条件的决策记录</strong><p>调整筛选条件，或创建一条需要在未来校准的真实决策。</p></div>}
    {page.records.length < page.total && <button className="decision-log-more" onClick={() => setQuery((value) => ({ ...value, offset: Number(value.offset || 0) + Number(value.limit || 50) }))}>加载更多</button>}
  </section>
}
