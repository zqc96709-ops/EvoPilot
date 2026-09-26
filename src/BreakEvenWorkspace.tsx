import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import {
  blankDefaults, calculate, createModel, douyinDefaults, duplicateModel, emptyState, inputDefinitions, money,
  scenariosFrom, validateScenario, type BreakEvenModel, type BreakEvenState, type CalculationType,
  type CustomMetric, type InputKey, type SavedTemplate, type Scenario,
} from './breakEven'
import './breakEven.css'

const roles = [
  { name: '抖音渠道负责人', subtitle: '直播带货 / 内容电商', icon: '◩', templateType: 'douyin' },
  { name: '直播运营', subtitle: '直播场次经营模型', icon: '▣', templateType: 'blank' },
  { name: '短视频运营', subtitle: '内容投放经营模型', icon: '▤', templateType: 'blank' },
  { name: '跨境运营', subtitle: '跨境电商经营模型', icon: '◎', templateType: 'blank' },
  { name: '销售岗位', subtitle: 'To B 销售经营模型', icon: '♙', templateType: 'blank' },
] as const

const calculationTypes: { value: CalculationType; label: string; unit: 'money' | 'percent' }[] = [
  { value: 'FIXED_COST', label: '固定成本', unit: 'money' },
  { value: 'RATE_OF_PAID_GMV', label: '支付 GMV 费率', unit: 'percent' },
  { value: 'RATE_OF_NET_SALES', label: '退款后销售额费率', unit: 'percent' },
  { value: 'PER_ORDER_COST', label: '每单成本', unit: 'money' },
  { value: 'INFORMATION_ONLY', label: '仅供参考', unit: 'money' },
]

type Dialog = { type: 'new'; roleLabel: string; templateType: string } | { type: 'metric'; metric?: CustomMetric } | { type: 'template' } | { type: 'reset' } | { type: 'deleteMetric'; metric: CustomMetric }

function ProfitCurve({ model }: { model: BreakEvenModel }) {
  const values = model.scenarios[model.selectedScenario]
  const result = calculate(values, model.customMetrics)
  if (!result) return <div className="be-chart-empty">请修正输入，利润曲线将随即更新。</div>
  const current = Number(values.inputs.paidGmv)
  const breakEven = result.breakEvenPaidGmv
  const maxGmv = Math.max(1, current * 1.8, breakEven === null ? 0 : breakEven * 1.25)
  const points = Array.from({ length: 9 }, (_, index) => {
    const gmv = maxGmv * index / 8
    return { gmv, profit: calculate(values, model.customMetrics, gmv)!.operatingProfit }
  })
  const low = Math.min(0, ...points.map((point) => point.profit))
  const high = Math.max(0, ...points.map((point) => point.profit))
  const span = Math.max(1, high - low)
  const x = (gmv: number) => 55 + gmv / maxGmv * 645
  const y = (profit: number) => 240 - (profit - low) / span * 200
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.gmv).toFixed(2)} ${y(point.profit).toFixed(2)}`).join(' ')
  const zero = y(0)
  return <div className="be-chart-wrap"><svg viewBox="0 0 740 295" role="img" aria-label="经营利润随支付 GMV 变化的曲线">
    {[0, .25, .5, .75, 1].map((fraction) => { const py = 40 + fraction * 200; const amount = high - fraction * span; return <g key={fraction}><line x1="55" x2="700" y1={py} y2={py} className="be-grid-line" /><text x="48" y={py + 4} textAnchor="end">{Math.round(amount).toLocaleString('en-US')}</text></g> })}
    {[0, .25, .5, .75, 1].map((fraction) => <g key={fraction}><line x1={x(maxGmv * fraction)} x2={x(maxGmv * fraction)} y1="40" y2="240" className="be-grid-line" /><text x={x(maxGmv * fraction)} y="263" textAnchor="middle">{Math.round(maxGmv * fraction).toLocaleString('en-US')}</text></g>)}
    <line x1="55" x2="700" y1={zero} y2={zero} className="be-zero-line" />
    <path d={line} className="be-profit-line" />
    {breakEven !== null && breakEven <= maxGmv && <g><circle cx={x(breakEven)} cy={zero} r="6" className="be-marker" /><rect x={Math.max(58, Math.min(x(breakEven) - 54, 580))} y={Math.max(6, zero - 68)} width="120" height="49" rx="7" className="be-marker-label" /><text x={Math.max(58, Math.min(x(breakEven) - 54, 580)) + 10} y={Math.max(6, zero - 68) + 20} className="be-marker-text">盈亏平衡点</text><text x={Math.max(58, Math.min(x(breakEven) - 54, 580)) + 10} y={Math.max(6, zero - 68) + 39} className="be-marker-value">{money(breakEven)}</text></g>}
    <text x="700" y="287" textAnchor="end">支付 GMV（元）</text>
  </svg>{breakEven === null && <p className="be-no-solution">当前经营结构下，每增加销售额仍无法产生正贡献，因此不存在有限盈亏平衡点。</p>}</div>
}

export default function BreakEvenWorkspace({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<BreakEvenState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('抖音渠道负责人')
  const [newTemplateType, setNewTemplateType] = useState('douyin')
  const [metricName, setMetricName] = useState('')
  const [metricKey, setMetricKey] = useState('')
  const [metricValue, setMetricValue] = useState('0')
  const [metricCalculation, setMetricCalculation] = useState<CalculationType>('FIXED_COST')
  const [dialogError, setDialogError] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateRole, setTemplateRole] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const saveQueue = useRef(Promise.resolve())

  useEffect(() => {
    let active = true
    api.getBreakEvenState().then((loaded) => {
      if (!active) return
      const next = loaded || emptyState()
      const routeId = decodeURIComponent(window.location.hash.match(/^#finance\/break-even\/([^/]+)/)?.[1] || '')
      setState(routeId && next.models.some((item) => item.id === routeId) ? { ...next, selectedModelId: routeId } : next)
    }).catch((error) => { if (active) setLoadError(String(error)) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!state) return
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => api.saveBreakEvenState(state)).then(() => setSaveError('')).catch((error) => setSaveError(String(error)))
  }, [state])
  useEffect(() => {
    const onRoute = () => {
      const id = decodeURIComponent(window.location.hash.match(/^#finance\/break-even\/([^/]+)/)?.[1] || '')
      if (id) setState((current) => current && current.models.some((model) => model.id === id) ? { ...current, selectedModelId: id } : current)
    }
    window.addEventListener('popstate', onRoute); window.addEventListener('hashchange', onRoute); onRoute()
    return () => { window.removeEventListener('popstate', onRoute); window.removeEventListener('hashchange', onRoute) }
  }, [])

  const model = state?.models.find((item) => item.id === state.selectedModelId) || state?.models[0]
  const values = model?.scenarios[model.selectedScenario]
  const errors = values && model ? validateScenario(values, model.customMetrics) : {}
  const result = useMemo(() => model ? calculate(model.scenarios[model.selectedScenario], model.customMetrics) : null, [model])
  const updateModel = (change: (next: BreakEvenModel) => void) => setState((current) => {
    if (!current || !model) return current
    return { ...current, models: current.models.map((item) => {
      if (item.id !== model.id) return item
      const next = structuredClone(item); change(next); next.updatedAt = new Date().toISOString(); return next
    }) }
  })
  const chooseModel = (id: string) => {
    window.history.pushState({}, '', `#finance/break-even/${encodeURIComponent(id)}`)
    setState((current) => current ? { ...current, selectedModelId: id } : current)
  }
  const openNew = (roleLabel = '抖音渠道负责人', templateType = 'douyin') => {
    setNewRole(roleLabel); setNewTemplateType(templateType); setNewName(`${roleLabel} · 经营盈亏平衡模型`); setDialogError(''); setDialog({ type: 'new', roleLabel, templateType })
  }
  const addModel = () => {
    const name = newName.trim()
    if (!name) { setDialogError('请输入模型名称'); return }
    const template = state?.templates.find((item) => item.id === newTemplateType.replace(/^saved:/, ''))
    const created = createModel(name, newRole.trim() || '自定义岗位', newTemplateType, template)
    setState((current) => current ? { ...current, models: [...current.models, created], selectedModelId: created.id } : current)
    window.history.pushState({}, '', `#finance/break-even/${encodeURIComponent(created.id)}`)
    setDialog(null)
  }
  const openMetric = (metric?: CustomMetric) => {
    setMetricName(metric?.name || ''); setMetricKey(metric?.key || ''); setMetricCalculation(metric?.calculationType || 'FIXED_COST')
    setMetricValue(metric && values ? values.customValues[metric.id] : '0'); setDialogError(''); setDialog({ type: 'metric', metric })
  }
  const saveMetric = () => {
    if (!model) return
    const name = metricName.trim(); const key = metricKey.trim()
    if (!name || !/^[a-z][a-z0-9_]*$/.test(key) || model.customMetrics.some((metric) => metric.key === key && metric.id !== (dialog?.type === 'metric' ? dialog.metric?.id : undefined))) { setDialogError('请输入名称及唯一的英文 variable key（小写字母、数字、下划线）'); return }
    const definition = calculationTypes.find((item) => item.value === metricCalculation)!
    const number = Number(metricValue)
    if (metricValue.trim() === '' || !Number.isFinite(number) || number < 0 || (definition.unit === 'percent' && number > 100)) { setDialogError('指标值必须是有效非负数；费率为 0–100%'); return }
    const id = dialog?.type === 'metric' && dialog.metric ? dialog.metric.id : crypto.randomUUID()
    updateModel((next) => {
      const metric = { id, key, name, unit: definition.unit, calculationType: metricCalculation }
      next.customMetrics = dialog?.type === 'metric' && dialog.metric ? next.customMetrics.map((item) => item.id === id ? metric : item) : [...next.customMetrics, metric]
      next.scenarios[next.selectedScenario].customValues[id] = metricValue
      for (const scenario of ['BEAR', 'BASE', 'BULL'] as Scenario[]) if (!(id in next.scenarios[scenario].customValues)) next.scenarios[scenario].customValues[id] = metricValue
    })
    setDialog(null)
  }
  const saveTemplate = () => {
    if (!state || !model || !templateName.trim()) { setDialogError('请输入模板名称'); return }
    const template: SavedTemplate = { id: crypto.randomUUID(), name: templateName.trim(), roleLabel: templateRole.trim() || model.roleLabel, description: templateDescription.trim(), scenarios: structuredClone(model.scenarios), customMetrics: structuredClone(model.customMetrics) }
    setState({ ...state, templates: [...state.templates, template] }); setDialog(null)
  }
  if (loadError) return <div className="be-workspace"><p role="alert">模型读取失败：{loadError}</p><button className="button" onClick={onBack}>返回财务</button></div>
  if (!state) return <div className="be-workspace">正在读取本地模型…</div>
  return <div className="be-workspace">
    <div className="be-back-row"><button onClick={onBack}>← 财务总览</button><span>财务 / 盈亏平衡模型</span></div>
    {!model ? <div className="be-empty"><h2>盈亏平衡模型</h2><p>在项目启动前，通过经营假设预演达到什么程度才能实现盈亏平衡。</p><button className="button primary" onClick={() => openNew()}>＋ 新建盈亏平衡模型</button><button className="button" onClick={() => openNew('抖音渠道负责人', 'douyin')}>使用抖音渠道负责人模板</button></div> : <>
      <header className="be-header"><div><h1>{model.roleLabel} · 经营盈亏平衡模型</h1><p>根据岗位经营假设，预演做到什么程度才能回本</p><label className="be-model-select">模型 <select aria-label="切换盈亏平衡模型" value={model.id} onChange={(event) => chooseModel(event.target.value)}>{state.models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="be-header-actions"><div className="be-scenarios" role="group" aria-label="情景选择">{([['BEAR','悲观'],['BASE','基准'],['BULL','乐观']] as const).map(([key, label]) => <button key={key} className={model.selectedScenario === key ? 'active' : ''} onClick={() => updateModel((next) => { next.selectedScenario = key })}>{label}</button>)}</div><button className="button" onClick={() => { setTemplateName(`${model.name}模板`); setTemplateRole(model.roleLabel); setTemplateDescription(''); setDialogError(''); setDialog({ type: 'template' }) }}>保存模板</button><button className="button" onClick={() => { const copy = duplicateModel(model); setState((current) => current ? { ...current, models: [...current.models, copy], selectedModelId: copy.id } : current); window.history.pushState({}, '', `#finance/break-even/${encodeURIComponent(copy.id)}`) }}>复制模型</button><button className="button primary" onClick={() => openNew()}>＋ 新建模型</button></div></header>
      {saveError && <p className="be-error" role="alert">保存失败：{saveError}</p>}
      <section className="be-kpis"><article><small>当前预计利润</small><strong className={result && result.operatingProfit < 0 ? 'negative' : ''}>{result ? money(result.operatingProfit) : '—'}</strong><span>基于当前经营假设</span></article><article><small>盈亏平衡支付 GMV</small><strong>{result ? money(result.breakEvenPaidGmv) : '—'}</strong><span>Profit = 0</span></article><article><small>盈亏平衡退款后销售额</small><strong>{result ? money(result.breakEvenNetSales) : '—'}</strong><span>退款后销售额</span></article><article><small>盈亏平衡订单量</small><strong>{result ? result.breakEvenOrders === null ? '无法达到' : `${result.breakEvenOrders.toLocaleString('en-US')} 单` : '—'}</strong><span>按支付客单价计算</span></article></section>
      <div className="be-main-row"><section className="be-panel be-assumptions"><header><div><h2>经营假设输入</h2><p>设置核心经营参数，系统将自动计算盈亏平衡点。</p></div><button className="button" onClick={() => setDialog({ type: 'reset' })}>重置</button></header><div className="be-input-grid">{inputDefinitions.map((definition) => <label key={definition.key}><span>{definition.label}</span><div className="be-input"><b>{definition.unit === 'money' ? '¥' : ''}</b><input aria-label={definition.label} inputMode="decimal" value={values!.inputs[definition.key]} onChange={(event) => updateModel((next) => { next.scenarios[next.selectedScenario].inputs[definition.key] = event.target.value })} /><b>{definition.unit === 'percent' ? '%' : ''}</b></div>{errors[definition.key] && <em>{errors[definition.key]}</em>}</label>)}</div><div className="be-custom-metrics">{model.customMetrics.map((metric) => <div key={metric.id}><label>{metric.name}<input aria-label={metric.name} inputMode="decimal" value={values!.customValues[metric.id] ?? ''} onChange={(event) => updateModel((next) => { next.scenarios[next.selectedScenario].customValues[metric.id] = event.target.value })} />{metric.unit === 'percent' ? '%' : '¥'}</label><button onClick={() => openMetric(metric)}>编辑</button><button onClick={() => setDialog({ type: 'deleteMetric', metric })}>删除</button>{errors[metric.id] && <em>{errors[metric.id]}</em>}</div>)}</div><button className="button be-add-metric" onClick={() => openMetric()}>＋ 添加指标</button></section>
      <section className="be-panel be-curve"><header><div><h2>利润曲线 / 盈亏平衡点</h2><p>展示不同支付 GMV 下的预计经营利润，及盈亏平衡点位置。</p></div><span>━ 预计利润曲线　 ┄ 0 利润线</span></header><ProfitCurve model={model} /></section></div>
      <div className="be-second-row"><section className="be-panel"><header><div><h2>参数预演</h2><p>调整关键参数，快速查看对盈亏平衡点的影响。</p></div></header>{([['refundRate','退款率'],['grossMarginRate','毛利率'],['adCostRate','投流费率']] as [InputKey,string][]).map(([key,label]) => <label className="be-slider" key={key}><span>{label}</span><input aria-label={`${label}预演`} type="range" min="0" max="100" step="0.5" value={Math.max(0, Math.min(100, Number(values!.inputs[key]) || 0))} onChange={(event) => updateModel((next) => { next.scenarios[next.selectedScenario].inputs[key] = event.target.value })} /><output>{values!.inputs[key]}%</output></label>)}<p>调整参数后，右侧盈亏平衡点实时变化。</p></section>
      <section className="be-panel be-formulas"><header><div><h2>关键公式</h2><p>基于以上经营假设，核心计算逻辑如下：</p></div></header><div><p>退款后销售额 = 支付 GMV × (1 − 退款率)</p><p>商品毛利 = 退款后销售额 × 毛利率</p><p>平台成本 = 退款后销售额 × 平台扣点</p><p>投流成本 = 支付 GMV × 投流费率</p><p>物流成本 = 退款后销售额 × 物流费率</p><p>经营利润 = 商品毛利 − 平台成本 − 投流成本 − 物流成本 − 固定成本 − 自定义指标成本</p><p>经营利润 = 0，即达到盈亏平衡。</p></div></section>
      <section className="be-panel be-conclusion"><header><div><h2>结论建议</h2><p>只根据当前参数进行确定性计算。</p></div></header>{result ? <div>{result.operatingProfit < 0 ? <p><b>当前假设下尚未回本</b><br />预计亏损 {money(-result.operatingProfit)}</p> : result.operatingProfit > 0 ? <p><b>当前假设下已超过盈亏平衡点</b><br />预计利润 {money(result.operatingProfit)}</p> : <p><b>当前处于盈亏平衡点附近</b></p>}{result.breakEvenPaidGmv === null ? <p>当前经营结构不存在有限盈亏平衡点。</p> : <p>{Number(values!.inputs.paidGmv) < result.breakEvenPaidGmv ? '预计需将支付 GMV 提高至约 ' : '当前支付 GMV 已达到盈亏平衡门槛（约 '}<b>{money(result.breakEvenPaidGmv)}</b>{Number(values!.inputs.paidGmv) < result.breakEvenPaidGmv ? ' 才能达到盈亏平衡。' : '）。'}</p>}<p>可通过降低退款率、提高毛利率、控制投流费率或降低固定成本，改善计算结果。</p><p className="be-scope">该模型用于项目启动前经营预演，不用于替代实际经营数据分析。</p></div> : <p>请修正输入后查看结论。</p>}</section></div>
    </>}
    <section className="be-roles"><div><h2>岗位模板</h2><p>选择不同岗位的预设模型，快速应用经营参数。</p></div><div className="be-role-cards">{roles.map((role) => <button key={role.name} onClick={() => openNew(role.name, role.templateType)}><i>{role.icon}</i><span><b>{role.name}</b><small>{role.subtitle}</small></span>{model?.roleLabel === role.name && <em>当前模板</em>}</button>)}</div>{state.templates.length > 0 && <div className="be-saved-templates"><h3>已保存模板</h3>{state.templates.map((template) => <button className="button" key={template.id} onClick={() => openNew(template.roleLabel, `saved:${template.id}`)}>{template.name}</button>)}</div>}</section>
    {dialog && <div className="be-dialog-backdrop" role="presentation"><section className="be-dialog" role="dialog" aria-modal="true" aria-label={dialog.type === 'new' ? '新建盈亏平衡模型' : dialog.type === 'metric' ? '添加指标' : dialog.type === 'template' ? '保存为岗位模板' : '确认操作'}>
      {dialog.type === 'new' && <><h2>新建盈亏平衡模型</h2><label>模型名称<input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} /></label><label>岗位 / 场景<input value={newRole} onChange={(event) => setNewRole(event.target.value)} /></label><label>模型来源<select value={newTemplateType} onChange={(event) => setNewTemplateType(event.target.value)}><option value="douyin">抖音渠道负责人模板</option><option value="blank">空白模型（不预设岗位经营数据）</option>{state.templates.map((template) => <option key={template.id} value={`saved:${template.id}`}>{template.name}</option>)}</select></label><p>其他岗位先使用空白模型，经营指标由你自行填写。</p></>}
      {dialog.type === 'metric' && <><h2>{dialog.metric ? '编辑指标' : '添加指标'}</h2><label>指标名称<input autoFocus value={metricName} onChange={(event) => setMetricName(event.target.value)} /></label><label>variable key<input value={metricKey} onChange={(event) => setMetricKey(event.target.value)} placeholder="storage_rate" /></label><label>计算方式<select value={metricCalculation} onChange={(event) => setMetricCalculation(event.target.value as CalculationType)}>{calculationTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>当前值（{calculationTypes.find((item) => item.value === metricCalculation)?.unit === 'percent' ? '%' : '¥'}）<input value={metricValue} inputMode="decimal" onChange={(event) => setMetricValue(event.target.value)} /></label></>}
      {dialog.type === 'template' && <><h2>保存为岗位模板</h2><label>模板名称<input autoFocus value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></label><label>岗位 / 场景<input value={templateRole} onChange={(event) => setTemplateRole(event.target.value)} /></label><label>说明<textarea value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} /></label></>}
      {dialog.type === 'reset' && <><h2>重置当前情景？</h2><p>是否将“{model?.selectedScenario}”恢复为模板默认值？其他情景不受影响。</p></>}
      {dialog.type === 'deleteMetric' && <><h2>删除指标？</h2><p>将删除“{dialog.metric.name}”及三个情景中的对应值。</p></>}
      {dialogError && <p className="be-error" role="alert">{dialogError}</p>}
      <footer><button className="button" onClick={() => setDialog(null)}>取消</button><button className="button primary" onClick={() => {
        if (dialog.type === 'new') addModel()
        if (dialog.type === 'metric') saveMetric()
        if (dialog.type === 'template') saveTemplate()
        if (dialog.type === 'reset') { updateModel((next) => { const template = state.templates.find((item) => `saved:${item.id}` === next.templateType); next.scenarios[next.selectedScenario] = structuredClone(template?.scenarios[next.selectedScenario] || scenariosFrom(next.templateType === 'douyin' ? douyinDefaults : blankDefaults)[next.selectedScenario]); for (const metric of next.customMetrics) next.scenarios[next.selectedScenario].customValues[metric.id] ??= '0' }); setDialog(null) }
        if (dialog.type === 'deleteMetric') { updateModel((next) => { next.customMetrics = next.customMetrics.filter((metric) => metric.id !== dialog.metric.id); for (const scenario of ['BEAR','BASE','BULL'] as Scenario[]) delete next.scenarios[scenario].customValues[dialog.metric.id] }); setDialog(null) }
      }}>确认</button></footer>
    </section></div>}
  </div>
}
