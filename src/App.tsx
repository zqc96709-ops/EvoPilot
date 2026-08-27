import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import './App.css'
import { buildAgentContext, buildContextRelationIndex, buildGlobalContext, detectContextGaps, detectGlobalIntent, shouldRetrieveGlobalContext } from './agent/contextEngine'
import type { AgentAction, AgentContext } from './agent/types'
import { buildRadarData, radarCategories, type RadarCategory, type RadarData, type RadarStory } from './aiNews'
import { mentalModelCategories, modelCategoryLabel, modelDefinition, modelSourcePerson, modelTrigger, type ModelRecommendation } from './mentalModels'
import { runDecisionEngine, impactLabel, urgencyLabel, reversibilityLabel, type DecisionAnalysis } from './decisionIntelligence'
import { accountBalanceMinor, decimalToMinor, formatMoneyMinor, minorToDecimal, projectEconomics } from './finance'
import { briefingSignals, detectExternalSignals, type ExternalItem } from './externalIntelligence'
import { createResearchPlan, parseResearchSources, resolveResearchSources, type ResearchPlan, type ResearchSourcePlan } from './researchPlanner'
import { calendarDateKey, taskCalendarItems, type CalendarScope } from './calendar'
import { taskMatrixQuadrants, taskQuadrant } from './taskMatrix'
import { compareWorkChainRuns, workChainScorecard } from './workchain'
import { filterTimelineItems, groupTimelineItems, timelineCausalEdges, timelineGoalId, timelineProjectId, timelineProjection, timelineTimestamp, timelineEntityTypes, visibleTimelineCausalEdges, type TimelineCausalEdge, type TimelineFilter, type TimelineProjectionItem, type TimelineRange } from './timeline'
import { api, type AiProviderId, type BackupInfo, type CaptureProviderConfig, type CaptureProviderId, type ChatMessage, type HackStartConfig, type NotebookFilePreview } from './api'
import {
  configFor, descriptionFor, durationMinutes, entities, isActive, isOverdue, isToday, linkedTo, localDateKey,
  minutesToday, percent, priorityLabel, recordDate, statusLabel, timeline, titleFor,
  type Entity, type EntityConfig, type FieldOption, type RecordData,
} from './model'

type View = 'command' | 'today' | 'tasks' | 'time' | 'projects' | 'outcomes' | 'finance' | 'notebook' | 'knowledge' | 'reviews' | 'insights' | 'principles' | 'mentalModels' | 'decisions' | 'events' | 'people' | 'timeline' | 'aiNews' | 'settings' | 'profile'
type EditState = { config: EntityConfig; record?: RecordData; initial?: Partial<RecordData> }
type Notice = { text: string; tone?: 'success' | 'danger' }
type TaskView = 'list' | 'kanban' | 'matrix' | 'calendar'
type TimeRange = 'day' | 'week' | 'month'
type ThemePreference = 'dark' | 'light' | 'auto'
const resolvedTheme = (theme: ThemePreference) => theme === 'auto' ? (new Date().getHours() >= 7 && new Date().getHours() < 19 ? 'light' : 'dark') : theme
type ProfileSection = 'basic' | 'personal' | 'ai'

const today = () => localDateKey()
const nowInput = () => new Date().toISOString().slice(0, 16)
const clampAiWidth = (value: number) => Math.max(280, Math.min(Math.max(360, window.innerWidth - 480), value))
const formatDate = (value: unknown, withTime = false) => {
  if (!value) return '—'
  const date = new Date(Number(value) || String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', withTime ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: 'short', day: 'numeric' })
}
const formatMinutes = (minutes: number) => minutes < 60 ? `${Math.round(minutes)} 分钟` : `${Math.floor(minutes / 60)} 小时 ${Math.round(minutes % 60)} 分钟`
const optionParts = (option: FieldOption) => typeof option === 'string' ? { value: option, label: option } : option
const defaultStatus = (entity: Entity) => ({ tasks: 'todo', goals: 'active', projects: 'active', hypotheses: 'untested', experiments: 'planned', decisions: 'pending', inbox: 'unprocessed', notes: 'INBOX', notebookFiles: 'ACTIVE', results: 'PLANNED', deliverables: 'DRAFT', resultPackages: 'ACTIVE', workflows: 'ACTIVE', workflowVersions: 'EXPERIMENTAL', workflowRuns: 'PLANNED', workflowRunSteps: 'PLANNED', workflowImprovementProposals: 'DRAFT', financialAccounts: 'ACTIVE', financialCategories: 'ACTIVE', financialTransactions: 'POSTED' } as Partial<Record<Entity, string>>)[entity] || 'active'
const tagsFor = (record: RecordData) => Array.isArray(record.tags) ? record.tags.map(String).map((tag) => tag.trim()).filter(Boolean) : String(record.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean)
const matchesRange = (record: RecordData, range: TimeRange) => {
  const value = record.startAt || recordDate(record)
  const date = new Date(Number(value) || String(value))
  if (Number.isNaN(date.getTime())) return false
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range === 'day') return localDateKey(date) === localDateKey(now)
  if (range === 'week') { const monday = new Date(start); monday.setDate(start.getDate() - ((start.getDay() + 6) % 7)); return date >= monday && date <= now }
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

type PaneSizes = { left: number; right: number }
const useThreePaneResize = (storageKey: string, defaults: PaneSizes) => {
  const layoutRef = useRef<HTMLDivElement>(null)
  const [sizes, setSizes] = useState<PaneSizes>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '') as Partial<PaneSizes>
      return Number.isFinite(saved.left) && Number.isFinite(saved.right) ? { left: Number(saved.left), right: Number(saved.right) } : defaults
    } catch { return defaults }
  })
  const startResize = (side: keyof PaneSizes) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const initial = sizes
    const startX = event.clientX
    const move = (next: PointerEvent) => {
      const width = layoutRef.current?.getBoundingClientRect().width || window.innerWidth
      setSizes((current) => {
        const delta = next.clientX - startX
        const limit = side === 'left' ? Math.max(160, width - initial.right - 280) : Math.max(260, width - initial.left - 280)
        const value = side === 'left' ? initial.left + delta : initial.right - delta
        return { ...current, [side]: Math.max(side === 'left' ? 160 : 260, Math.min(limit, value)) }
      })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(sizes)) }, [sizes, storageKey])
  return { layoutRef, startResize, style: { '--pane-left': `${sizes.left}px`, '--pane-right': `${sizes.right}px` } as React.CSSProperties }
}

function App() {
  const [records, setRecords] = useState<RecordData[]>([])
  const [view, setView] = useState<View>('command')
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('jason-os-sidebar-open') !== 'false')
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => { const stored = localStorage.getItem('jason-os-theme'); return stored === 'light' || stored === 'auto' ? stored : 'dark' })
  const [sidebarPeek, setSidebarPeek] = useState(false)
  const [aiWidth, setAiWidth] = useState(() => { const value = Number(localStorage.getItem('jason-os-ai-width')); return Number.isFinite(value) ? clampAiWidth(value) : clampAiWidth(430) })
  const [aiResizing, setAiResizing] = useState(false)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [running, setRunning] = useState<RecordData | undefined>()
  const [timerStart, setTimerStart] = useState<Partial<RecordData> | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchEntities, setSearchEntities] = useState<Entity[]>([])
  const [searchResults, setSearchResults] = useState<RecordData[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiConfig, setAiConfig] = useState<HackStartConfig | null>(null)
  const [captureConfig, setCaptureConfig] = useState<CaptureProviderConfig | null>(null)
  const [externalItems, setExternalItems] = useState<ExternalItem[]>([])
  const [chat, setChat] = useState<ChatMessage[]>(() => { try { return JSON.parse(localStorage.getItem('jason-os-ai-chat') || '[]') } catch { return [] } })
  const [aiDraft, setAiDraft] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [decisionModelIds, setDecisionModelIds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('jason-os-decision-model-ids') || '[]') } catch { return [] } })
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [profileSection, setProfileSection] = useState<ProfileSection>('basic')
  const noticeTimer = useRef<number | undefined>(undefined)

  const refresh = async () => {
    const [all, captured] = await Promise.all([api.list('all'), api.listExternalItems(200)])
    setRecords(all); setExternalItems(captured)
    setRunning(all.find((record) => record.entity === 'timeLogs' && record.isRunning === true))
    setChat((current) => { if (current.length) return current; return all.filter((record) => record.entity === 'agentRuns' && record.status === 'completed').slice(0, 6).reverse().flatMap((run) => [{ role: 'user' as const, content: String(run.input || '') }, { role: 'assistant' as const, content: String(run.output || '') }]) })
  }
  const refreshSettings = async () => { const [ai, capture, savedBackups] = await Promise.all([api.getHackStartConfig(), api.getCaptureProviderConfig(), api.backups()]); setAiConfig(ai); setCaptureConfig(capture); setBackups(savedBackups) }
  useEffect(() => { api.initialize().then(async () => { await api.cleanupExternalCache(); await refresh(); await refreshSettings() }).catch((error) => showNotice(String(error), 'danger')) }, [])
  useEffect(() => { localStorage.setItem('jason-os-ai-chat', JSON.stringify(chat.slice(-20))) }, [chat])
  useEffect(() => { localStorage.setItem('jason-os-sidebar-open', String(sidebarOpen)) }, [sidebarOpen])
  useEffect(() => { localStorage.setItem('jason-os-ai-width', String(aiWidth)) }, [aiWidth])
  const activeTheme = resolvedTheme(themePreference)
  useEffect(() => { localStorage.setItem('jason-os-theme', themePreference); document.documentElement.dataset.theme = activeTheme }, [themePreference, activeTheme])
  useEffect(() => {
    if (!aiResizing) return
    const move = (event: PointerEvent) => setAiWidth(clampAiWidth(window.innerWidth - event.clientX))
    const stop = () => setAiResizing(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
  }, [aiResizing])
  useEffect(() => { const resize = () => setAiWidth((width) => clampAiWidth(width)); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(true) }
      if (event.metaKey && event.shiftKey && event.code === 'Space') { event.preventDefault(); setView('notebook') }
      if (event.key === 'Escape') { setPaletteOpen(false); setSearchOpen(false); setAiOpen(false); setDetailId(null) }
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [])
  useEffect(() => {
    if (!searchOpen) return
    const timer = window.setTimeout(() => api.search(searchQuery, searchEntities).then(setSearchResults).catch((error) => showNotice(String(error), 'danger')), 120)
    return () => window.clearTimeout(timer)
  }, [searchQuery, searchEntities, searchOpen])

  const showNotice = (text: string, tone: Notice['tone'] = 'success') => {
    setNotice({ text, tone }); if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4300)
  }
  const openCreate = (entity: Entity, initial?: Partial<RecordData>) => setEditing({ config: configFor(entity), initial })
  const saveRecord = async (entity: Entity, data: Partial<RecordData>) => { const url = entity === 'inbox' ? String(data.content || '').match(/https?:\/\/[^\s]+/)?.[0] : undefined; if (url) { const captured = await api.captureLink(url); await refresh(); setEditing(null); showNotice(`${String(captured.platform || '链接')}内容已读取并保存到收集箱。`); return }
    if (entity === 'deliverables' && data.status === 'FINAL') {
      const sameAsset = records.filter((record) => record.entity === 'deliverables' && record.id !== data.id && record.status === 'FINAL').filter((record) => (data.fileId && record.fileId === data.fileId) || (data.resultId && record.resultId === data.resultId && titleFor(record) === String(data.title || '')))
      await Promise.all(sameAsset.map((record) => api.save('deliverables', { ...record, status: 'SUPERSEDED' })))
    }
    await api.save(entity, data); await refresh(); setEditing(null); showNotice('已保存到本机。') }
  const saveProfile = async (data: Record<string, string>) => {
    const existing = records.find((record) => record.entity === 'profiles')
    const title = data.name || data.nickname || data.role || '我的档案'
    await api.save('profiles', { id: existing?.id, ...data, title })
    await refresh(); showNotice('我的档案已保存到本机。')
  }
  const saveDecisionAnalysis = async (question: string, analysis: DecisionAnalysis, ceoDecision = '') => {
    const { classification, lens, models, frameworks, assumptions, supportingCase, counterCase, biases, tensions, opportunityCost, informationGaps, minimumValidation, options, recommendation, confidence } = analysis
    await api.save('decisions', {
      title: question.slice(0, 80), problem: question, context: `决策类型：${classification.decisionTypeLabel}；决策视角：${lens ? titleFor(lens) : '未匹配'}`,
      decisionType: classification.decisionType, decisionTypeLabel: classification.decisionTypeLabel, impactLevel: classification.impact,
      urgencyLevel: classification.urgency, reversibility: classification.reversibility, confidence,
      decisionLevel: classification.impact === 'high' ? 'STRATEGIC' : classification.impact === 'medium' ? 'MATERIAL' : 'OPERATIONAL',
      status: ceoDecision ? 'decided' : 'pending', date: today(), lensId: lens?.id, mentalModelIds: models.map(({ model }) => model.id), frameworkIds: frameworks.map((framework) => framework.id),
      assumptions: assumptions.join('\n'), evidence: '', options: options.join('\n'), risks: counterCase.join('\n'),
      supportingCase: supportingCase.join('\n'), counterCase: counterCase.join('\n'), biasAnalysis: JSON.stringify(biases), modelTensions: JSON.stringify(tensions),
      opportunityCost, informationGaps: informationGaps.join('\n'), minimumValidation, recommendation, ceoDecision, executionPlan: ceoDecision ? '待创建执行任务：根据 CEO 最终决定拆分下一步行动。' : '', outcome: '', reviewId: '',
      knownUnknowns: informationGaps.join('\n'), expectedOutcome: recommendation,
    })
    await refresh(); setView('decisions'); showNotice('决策草案已保存到“决策日志”，等待 CEO 最终决定。')
  }
  const archiveRecord = async (id: string) => { await api.archive(id); await refresh(); setDetailId(null); if (selectedProjectId === id) setSelectedProjectId(null); showNotice('已归档，可在设置中恢复。') }
  const restoreRecord = async (id: string) => { await api.restore(id); await refresh(); showNotice('记录已恢复。') }
  const completeTask = async (task: RecordData) => { await api.save('tasks', { ...task, status: 'completed', completedAt: new Date().toISOString() }); await refresh(); showNotice('任务已完成。') }
  const startTimer = (context?: Partial<RecordData>) => {
    if (running) { showNotice('已有计时正在运行。', 'danger'); return }
    setTimerStart(context || {})
  }
  const startTimerNow = async (context: Partial<RecordData>) => {
    const log = await api.save('timeLogs', { ...context, startAt: new Date().toISOString(), isRunning: true, status: 'running', category: context.category || '专注' })
    setRunning(log); setTimerStart(null); await refresh(); showNotice('计时已开始，工作上下文已自动关联。')
  }
  const stopTimer = async () => {
    if (!running) return
    const end = new Date(); const start = new Date(String(running.startAt)); const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
    await api.stopTimer(running.id, end.toISOString(), minutes); await refresh(); showNotice(`已记录 ${formatMinutes(minutes)}。`)
  }
  const openRecord = (record: RecordData) => {
    setSearchOpen(false); setPaletteOpen(false)
    if (record.entity === 'projects') { setView('projects'); setSelectedProjectId(record.id); return }
    setDetailId(record.id)
  }
  const agentContext = useMemo(() => buildAgentContext({ currentRoute: view, records, selectedProjectId, detailId, conversation: chat }), [view, records, selectedProjectId, detailId, chat])
  const contextRelationIndex = useMemo(() => buildContextRelationIndex(records), [records])
  const contextRecords = agentContext.selectedItems.map((id) => records.find((record) => record.id === id)).filter(Boolean) as RecordData[]
  const confirmAiAction = async (actionId: string, baseChat = chat) => {
    if (aiBusy) return
    setAiBusy(true)
    try {
      const result = await api.confirmAiAction(actionId); const action = result.action
      const record = result.record; const label = record ? configFor(record.entity).singular : configFor(action.entityType).singular
      const updated = baseChat.map((message) => message.action?.actionId === actionId ? { ...message, action } : message)
      setChat([...updated, { role: 'assistant', content: result.duplicate ? `相同的${label}操作已经完成，没有重复写入。` : `✓ 已保存${label}，Jason OS 已同步更新。` }])
      await refresh(); showNotice(result.duplicate ? '已阻止重复创建。' : `${label}已由 AI Action 保存。`)
    } catch (error) { setChat([...baseChat, { role: 'assistant', content: `执行失败：${String(error)}。没有写入成功。` }]); showNotice(String(error), 'danger') }
    finally { setAiBusy(false) }
  }
  const cancelAiAction = async (actionId: string) => {
    if (aiBusy) return
    setAiBusy(true)
    try { const result = await api.cancelAiAction(actionId); setChat((current) => current.map((message) => message.action?.actionId === actionId ? { ...message, content: '已取消本次操作，没有写入任何记录。', action: result.action } : message)); await refresh() }
    catch (error) { showNotice(String(error), 'danger') }
    finally { setAiBusy(false) }
  }
  const viewAiActionResult = (action: AgentAction) => {
    const record = action.result && 'id' in action.result && 'entity' in action.result ? action.result as RecordData : undefined
    if (!record) return
    const targetView = ({ tasks: 'tasks', timeLogs: 'time', projects: 'projects', results: 'outcomes', deliverables: 'outcomes', resultPackages: 'outcomes', workflows: 'projects', workflowVersions: 'projects', workflowSteps: 'projects', workflowGates: 'projects', workflowRuns: 'projects', workflowRunSteps: 'projects', workflowMetricDefinitions: 'projects', workflowImprovementProposals: 'projects', financialAccounts: 'finance', financialCategories: 'finance', financialTransactions: 'finance', signals: 'notebook', opportunities: 'notebook', externalSources: 'notebook', intelligenceBriefs: 'notebook', knowledge: 'knowledge', reviews: 'reviews', insights: 'insights', principles: 'principles', mentalModels: 'mentalModels', decisions: 'decisions', events: 'events', people: 'people' } as Partial<Record<Entity, View>>)[record.entity]
    if (targetView) setView(targetView)
    setAiOpen(false); openRecord(record)
  }
  const sendAi = async (preset?: string, contextOverride: Partial<AgentContext> = {}) => {
    const question = (preset || aiDraft).trim(); if (!question || aiBusy) return
    if (!aiConfig?.configured) { setView('settings'); setAiOpen(false); showNotice('请先配置任一 AI 服务商的 API Key。', 'danger'); return }
    const nextChat = [...chat, { role: 'user' as const, content: question }]; setChat(nextChat); setAiDraft('')
    const pending = [...chat].reverse().find((message) => message.action?.status === 'CONFIRM_REQUIRED')?.action
    if (pending && /^(确认|确认保存|确认创建|执行|保存|开始执行)[。.!！]?$/.test(question)) { await confirmAiAction(pending.actionId, nextChat); return }
    if (pending && /^(取消|取消操作|不要保存|不保存)[。.!！]?$/.test(question)) { await cancelAiAction(pending.actionId); return }
    const intent = detectGlobalIntent(question, view)
    let retrievedRecords: RecordData[] = []
    if (shouldRetrieveGlobalContext(intent)) {
      try { retrievedRecords = await api.search(question) } catch { /* AI still receives bounded structured context when search is unavailable. */ }
    }
    const baseContext = { ...agentContext, ...contextOverride, recentConversation: nextChat.slice(-10).map(({ role, content }) => ({ role, content })) }
    const requestContext = { ...baseContext, globalContext: buildGlobalContext({ query: question, currentRoute: view, records, context: baseContext, relationIndex: contextRelationIndex, retrievedRecords }) }
    setAiBusy(true)
    try { const result = await api.ask(question, requestContext, nextChat); setChat([...nextChat, { role: 'assistant', content: result.answer, action: result.action }]); await refresh() }
    catch (error) { showNotice(`AI Agent 处理失败：${String(error)}`, 'danger') }
    finally { setAiBusy(false) }
  }
  const saveAiProvider = async (provider: AiProviderId, apiKey: string, model: string) => {
    try { setAiConfig(await api.configureAiProvider(provider, apiKey, model)); showNotice(`${provider === 'deepseek' ? 'DeepSeek' : provider === 'minimax' ? 'MiniMax Token Plan' : provider === 'volc-agent-plan' ? '火山引擎 Agent Plan' : 'HackStart'} 配置已保存，连通性测试通过。`) }
    catch (error) { showNotice(`保存失败：${String(error)}`, 'danger') }
  }
  const saveCaptureProvider = async (provider: CaptureProviderId, apiKey: string) => {
    try { setCaptureConfig(await api.configureCaptureProvider(provider, apiKey)); showNotice(`${provider === 'apify' ? 'Apify' : provider === 'tikhub' ? 'TikHub' : provider === 'scrapecreators' ? 'Scrape Creators' : 'RedFoxHub'} 采集凭据已保存，Token 连通性测试通过。`) }
    catch (error) { showNotice(`采集服务保存失败：${String(error)}`, 'danger') }
  }
  const createBackup = async () => { showNotice(`备份已创建：${await api.backup()}`); setBackups(await api.backups()) }
  const restoreBackup = async (path: string) => {
    if (!window.confirm('恢复备份会先自动创建当前数据库的安全备份，然后替换现有数据。继续吗？')) return
    await api.restoreBackup(path); await refresh(); await refreshSettings(); showNotice('备份已恢复。')
  }

  const addModelToDecision = (modelId: string) => setDecisionModelIds((current) => { const next = current.includes(modelId) ? current : [...current, modelId]; localStorage.setItem('jason-os-decision-model-ids', JSON.stringify(next)); return next })
  const removeModelFromDecision = (modelId: string) => setDecisionModelIds((current) => { const next = current.filter((id) => id !== modelId); localStorage.setItem('jason-os-decision-model-ids', JSON.stringify(next)); return next })

  const nav: { group: string; items: { view: View; label: string; icon: string }[] }[] = [
    { group: '核心', items: [{ view: 'command', label: '指挥中心', icon: '⌂' }] },
    { group: '聚焦', items: [{ view: 'today', label: '今天', icon: '◉' }, { view: 'tasks', label: '任务', icon: '□' }, { view: 'time', label: '时间', icon: '◷' }] },
    { group: '工作', items: [{ view: 'projects', label: '项目', icon: '◈' }, { view: 'outcomes', label: '成果', icon: '✓' }, { view: 'finance', label: '财务', icon: '¥' }] },
    { group: '记忆', items: [{ view: 'knowledge', label: '知识', icon: '⌘' }, { view: 'reviews', label: '复盘', icon: '◑' }, { view: 'insights', label: '洞见', icon: '✦' }, { view: 'principles', label: '原则', icon: '∴' }, { view: 'mentalModels', label: '思维模型', icon: '◇' }] },
    { group: '决策', items: [{ view: 'decisions', label: '决策日志', icon: '◆' }] },
    { group: '情境', items: [{ view: 'events', label: '事件', icon: '●' }, { view: 'people', label: '人物', icon: '♙' }, { view: 'timeline', label: '时间线', icon: '⌁' }] },
  ]
  const pageTitle = view === 'profile' ? '我的档案' : view === 'notebook' ? '收纳箱' : view === 'aiNews' ? 'AI News Radar' : nav.flatMap((group) => group.items).find((item) => item.view === view)?.label || (view === 'settings' ? '设置' : 'Jason OS')

  const effectiveSidebarOpen = sidebarOpen || sidebarPeek
  const toggleSidebar = () => { setSidebarPeek(false); setSidebarOpen((open) => !open) }
  const handleShellPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarOpen) return
    if (event.clientX <= 14) setSidebarPeek(true)
    else if (sidebarPeek && event.clientX > 236) setSidebarPeek(false)
  }
  return <div className={`app-shell ${activeTheme === 'light' ? 'light-theme' : 'dark-theme'} ${effectiveSidebarOpen ? "" : "sidebar-collapsed"} ${sidebarPeek ? "sidebar-peek" : ""} ${aiOpen ? "ai-open" : ""} ${aiResizing ? "ai-resizing" : ""}`} style={{ "--ai-width": `${aiWidth}px` } as React.CSSProperties} onPointerMove={handleShellPointer}>
    <GlobalHeader
      query={searchQuery} onQuery={(value) => { setSearchQuery(value); setSearchOpen(true) }} onSearchFocus={() => setSearchOpen(true)}
      sidebarOpen={effectiveSidebarOpen} onToggleSidebar={toggleSidebar} onProfile={(section) => { setProfileSection(section); setView('profile') }} onSettings={() => setView('settings')} onAiNews={() => setView('aiNews')} aiNewsActive={view === 'aiNews'} onAi={() => setAiOpen(true)} onPalette={() => setPaletteOpen(true)} aiConfigured={Boolean(aiConfig?.configured)}
    />
    <aside className="sidebar">
      <button className="quick-capture" onClick={() => setView('notebook')}><span>▱</span><div><strong>收纳箱</strong><small>收集与笔记 · ⌘ ⇧ Space</small></div></button>
      <nav>{nav.map((group) => <section key={group.group}><p>{group.group}</p>{group.items.map((item) => <button key={item.view} className={view === item.view ? 'active' : ''} onClick={() => { setView(item.view); if (item.view !== 'projects') setSelectedProjectId(null) }}><span>{item.icon}</span>{item.label}</button>)}</section>)}</nav>
      <div className="sidebar-bottom-actions"><button className={`running-card ${running ? 'live' : ''}`} onClick={() => running ? stopTimer() : startTimer()}>{running ? <><span className="pulse" /><div><strong>{titleFor(running)}</strong><small>点击停止并记录时间</small></div></> : <><span>▶</span><div><strong>开始计时</strong><small>记录现实投入</small></div></>}</button><button className={`sidebar-settings ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}><span>⚙</span>设置与数据</button></div>
    </aside>
    <main className="main-content">
      {view !== 'notebook' && <div className="page-heading"><div><p className="eyebrow">JASON OS · PERSONAL OPERATING SYSTEM</p><h1>{pageTitle}</h1></div>{!['command', 'aiNews', 'timeline', 'outcomes', 'finance', 'profile', 'settings'].includes(view) && <button className="button primary" onClick={() => openCreate(viewEntity(view))}>＋ 新建</button>}</div>}
      {view === 'command' && <CommandCenter records={records} externalItems={externalItems} onOpen={openRecord} onCreate={openCreate} onView={setView} onStartTimer={startTimer} onAi={(prompt) => { setAiDraft(prompt); setAiOpen(true) }} />}
      {view === 'today' && <TodayView records={records} running={running} onOpen={openRecord} onEdit={(record) => setEditing({ config: configFor(record.entity), record })} onComplete={completeTask} onStartTimer={startTimer} onStopTimer={stopTimer} onCreate={openCreate} />}
      {view === 'tasks' && <TasksView records={records} onOpen={openRecord} onEdit={(record) => setEditing({ config: configFor('tasks'), record })} onComplete={completeTask} onStartTimer={startTimer} onCreate={(initial) => openCreate('tasks', initial)} />}
      {view === 'time' && <TimeView records={records} running={running} onStartTimer={startTimer} onStopTimer={stopTimer} onEdit={(record) => setEditing({ config: configFor('timeLogs'), record })} onCreate={() => openCreate('timeLogs', { startAt: nowInput() })} />}
      {view === 'projects' && <ProjectsView records={records} selectedId={selectedProjectId} onSelect={setSelectedProjectId} onOpen={openRecord} onCreate={openCreate} onEdit={(record) => setEditing({ config: configFor(record.entity), record })} onStartTimer={startTimer} onAiAnalyze={(question, context) => { setAiOpen(true); void sendAi(question, context) }} />}
      {view === 'outcomes' && <OutcomesView records={records} onOpen={openRecord} onCreate={openCreate} />}
      {view === 'finance' && <FinanceView records={records} onOpen={openRecord} onCreate={openCreate} />}
      {view === 'notebook' && <NotebookView records={records} externalItems={externalItems} captureConfig={captureConfig} onOpen={openRecord} onRefresh={refresh} onNotice={showNotice} onAi={(question, context) => { setAiOpen(true); void sendAi(question, context) }} />}
      {(['knowledge', 'reviews', 'insights', 'principles'] as View[]).includes(view) && <MemoryView entity={view as Entity} records={records} onOpen={openRecord} onCreate={openCreate} />}
      {view === 'mentalModels' && <MentalModelsView records={records} onOpen={openRecord} onCreate={openCreate} onSaveDecision={saveDecisionAnalysis} decisionModelIds={decisionModelIds} onAddModel={addModelToDecision} onRemoveModel={removeModelFromDecision} />}
      {view === 'decisions' && <DecisionsView records={records} onOpen={openRecord} onCreate={() => openCreate('decisions', { date: today(), status: 'pending' })} />}
      {(view === 'events' || view === 'people') && <ContextView entity={view} records={records} onOpen={openRecord} onCreate={openCreate} />}
      {view === 'timeline' && <TimelineView records={records} onOpen={openRecord} onAiAnalyze={(question, context) => { setAiOpen(true); void sendAi(question, context) }} />}
      {view === 'profile' && <ProfileView profile={records.find((record) => record.entity === 'profiles')} initialSection={profileSection} onSave={saveProfile} />}
      {view === 'aiNews' && <AiNewsRadarView />}
      {view === 'settings' && <><CloudSyncPanel onNotice={showNotice} onSynced={refresh} /><SettingsView themePreference={themePreference} activeTheme={activeTheme} onThemeChange={setThemePreference} config={aiConfig} captureConfig={captureConfig} onSaveAiProvider={saveAiProvider} onSaveCaptureProvider={saveCaptureProvider} onExport={async (format) => showNotice(`已导出：${await api.export(format)}`)} onBackup={createBackup} backups={backups} onRestoreBackup={restoreBackup} onRestoreRecord={restoreRecord} /></>}
    </main>
    {notice && <div className={`toast ${notice.tone === 'danger' ? 'danger' : ''}`}>{notice.text}</div>}
    {searchOpen && <SearchOverlay query={searchQuery} results={searchResults} selectedEntities={searchEntities} onToggleEntity={(entity) => setSearchEntities((current) => current.includes(entity) ? current.filter((item) => item !== entity) : [...current, entity])} onOpen={openRecord} onClose={() => setSearchOpen(false)} />}
    {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} actions={paletteActions({ setSearchOpen, setPaletteOpen, openCreate, startTimer, setAiOpen, setView })} />}
    {aiOpen && <><div className="ai-resize-handle" role="separator" aria-label="调整 AI 助理宽度" onPointerDown={(event) => { event.preventDefault(); setAiResizing(true) }} /><AiDrawer config={aiConfig} chat={chat} draft={aiDraft} busy={aiBusy} context={contextRecords} onDraft={setAiDraft} onSend={sendAi} onConfirmAction={confirmAiAction} onCancelAction={cancelAiAction} onViewAction={viewAiActionResult} onSelectModel={(provider, model) => saveAiProvider(provider, '', model)} onClose={() => setAiOpen(false)} onSettings={() => { setAiOpen(false); setView('settings') }} /></>}
    {timerStart && <TimerStartModal initial={timerStart} records={records} onClose={() => setTimerStart(null)} onStart={startTimerNow} />}
    {editing && <RecordModal config={editing.config} record={editing.record} initial={editing.initial} records={records} onClose={() => setEditing(null)} onSave={saveRecord} />}
    {detailId && <RecordDrawer record={records.find((record) => record.id === detailId)} records={records} onClose={() => setDetailId(null)} onEdit={(record) => setEditing({ config: configFor(record.entity), record })} onArchive={archiveRecord} onCreate={openCreate} onOpen={openRecord} onStartTimer={startTimer} onAddModel={addModelToDecision} />}
  </div>
}

const viewEntity = (view: View): Entity => ({ command: 'inbox', today: 'tasks', tasks: 'tasks', time: 'timeLogs', projects: 'projects', outcomes: 'results', finance: 'financialTransactions', notebook: 'notes', knowledge: 'knowledge', reviews: 'reviews', insights: 'insights', principles: 'principles', mentalModels: 'mentalModels', decisions: 'decisions', events: 'events', people: 'people', timeline: 'events', aiNews: 'inbox', settings: 'inbox', profile: 'profiles' }[view] as Entity)

function GlobalHeader({ query, onQuery, onSearchFocus, sidebarOpen, onToggleSidebar, onProfile, onSettings, onAiNews, aiNewsActive, onAi, onPalette, aiConfigured }: { query: string; onQuery: (value: string) => void; onSearchFocus: () => void; sidebarOpen: boolean; onToggleSidebar: () => void; onProfile: (section: ProfileSection) => void; onSettings: () => void; onAiNews: () => void; aiNewsActive: boolean; onAi: () => void; onPalette: () => void; aiConfigured: boolean }) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!profileMenuOpen) return
    const dismiss = (event: PointerEvent) => { if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false) }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setProfileMenuOpen(false) }
    window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', onKeyDown) }
  }, [profileMenuOpen])
  const openProfile = (section: ProfileSection) => { setProfileMenuOpen(false); onProfile(section) }
  return <header className="global-header"><div className="global-brand"><button className={`sidebar-toggle ${sidebarOpen ? 'open' : ''}`} onClick={onToggleSidebar} aria-label={sidebarOpen ? '隐藏边栏' : '展开边栏'} title={sidebarOpen ? '隐藏边栏' : '展开边栏'}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2" /><path d="M7 3v14" /></svg></button><div className="profile-menu-anchor" ref={profileMenuRef}><button className="profile-menu-trigger" onClick={() => setProfileMenuOpen((open) => !open)} aria-expanded={profileMenuOpen} aria-haspopup="menu" title="打开我的档案"><span className="brand-mark">J</span><span className="brand-copy"><strong>JASON OS</strong><small>个人操作系统</small></span></button>{profileMenuOpen && <div className="profile-menu" role="menu"><header><strong>我的档案</strong><small>了解和管理你的个人上下文</small></header><button onClick={() => openProfile('basic')}><span>◌</span><div><strong>基础资料</strong><small>身份、角色与工作领域</small></div></button><button onClick={() => openProfile('personal')}><span>◇</span><div><strong>个人上下文</strong><small>方向、重点与工作方式</small></div></button><button onClick={() => openProfile('ai')}><span>✦</span><div><strong>AI 上下文</strong><small>让 AI 更符合你的工作习惯</small></div></button><footer><button onClick={() => { setProfileMenuOpen(false); onSettings() }}>⚙ 设置与数据</button></footer></div>}</div></div><div className="global-search"><span>⌕</span><input value={query} onFocus={onSearchFocus} onChange={(event) => onQuery(event.target.value)} placeholder="搜索任何内容 / 询问 Jason OS..." /><kbd>⌘ K</kbd></div><div className="global-actions"><button className={`news-radar-shortcut ${aiNewsActive ? 'active' : ''}`} onClick={onAiNews}><span>✺</span>AI News Radar</button><button onClick={onAi}><span className={`ai-status ${aiConfigured ? 'connected' : ''}`} />AI 助理</button><button onClick={onPalette}><kbd>⌘ K</kbd></button></div></header>
}

type ProfileFieldProps = { label: string; field: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean }
function ProfileField({ label, field, value, onChange, placeholder, multiline }: ProfileFieldProps) {
  return <label className={`profile-field ${multiline ? 'multiline' : ''}`}><span>{label}</span>{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={field} /> : <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={field} />}</label>
}
function ProfileTagField({ label, field, value, onChange, placeholder }: Omit<ProfileFieldProps, 'multiline'>) {
  const tags = value.split(/[，,]/).map((item) => item.trim()).filter(Boolean)
  return <label className="profile-field profile-tag-field"><span>{label}</span>{tags.length > 0 && <div className="profile-tags">{tags.map((tag) => <i key={tag}>{tag}</i>)}</div>}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder || '用逗号分隔多个内容'} aria-label={field} /></label>
}
function ProfileView({ profile, initialSection, onSave }: { profile?: RecordData; initialSection: ProfileSection; onSave: (data: Record<string, string>) => Promise<void> }) {
  const profileValues = (record?: RecordData) => Object.fromEntries(['name', 'nickname', 'avatar', 'occupation', 'role', 'organization', 'workDomains', 'longTermDirection', 'currentFocus', 'workStyle', 'decisionStyle', 'commonTools', 'otherContext', 'aiAssistancePreference', 'aiResponsePreference', 'aiDecisionPreference', 'aiOtherContext'].map((key) => [key, String(record?.[key] || '')])) as Record<string, string>
  const [section, setSection] = useState<ProfileSection>(initialSection)
  const [started, setStarted] = useState(Boolean(profile))
  const [draft, setDraft] = useState<Record<string, string>>(() => profileValues(profile))
  const [saving, setSaving] = useState(false)
  useEffect(() => { setSection(initialSection) }, [initialSection])
  useEffect(() => { setDraft(profileValues(profile)); if (profile) setStarted(true) }, [profile])
  const update = (field: string) => (value: string) => setDraft((current) => ({ ...current, [field]: value }))
  const save = async () => { setSaving(true); try { await onSave(draft) } finally { setSaving(false) } }
  if (!started) return <div className="profile-page"><section className="profile-empty"><span>◌</span><div><p className="eyebrow">MY PROFILE · LOCAL ONLY</p><h2>还没有建立你的个人档案</h2><p>建立少量长期信息后，Jason OS AI 可以更准确地理解你的背景、工作方式和协作偏好。</p><button className="button primary" onClick={() => { setStarted(true); setSection('basic') }}>开始建立档案</button></div></section></div>
  const avatar = draft.avatar.trim()
  return <div className="profile-page"><section className="profile-hero"><div className="profile-avatar">{avatar ? <img src={avatar} alt="头像" /> : <span>{(draft.nickname || draft.name || 'J').trim().slice(0, 1)}</span>}</div><div><p className="eyebrow">MY PROFILE · LOCAL CONTEXT</p><h2>{draft.nickname || draft.name || '我的档案'}</h2><p>让 Jason OS 更了解你，并为 AI 提供长期上下文。</p></div><small>仅保存在本机；仅在问题相关时向 AI 提供精简上下文。</small></section><div className="profile-tabs" role="tablist"><button className={section === 'basic' ? 'active' : ''} onClick={() => setSection('basic')}>基础资料</button><button className={section === 'personal' ? 'active' : ''} onClick={() => setSection('personal')}>个人上下文</button><button className={section === 'ai' ? 'active' : ''} onClick={() => setSection('ai')}>AI 上下文</button></div><section className="profile-editor">{section === 'basic' && <><header><div><h3>基础资料</h3><p>只记录对工作与协作有价值的基本背景，不收集证件、联系方式等敏感信息。</p></div></header><div className="profile-grid"><ProfileField label="姓名" field="name" value={draft.name} onChange={update('name')} placeholder="例如：Jason" /><ProfileField label="昵称" field="nickname" value={draft.nickname} onChange={update('nickname')} placeholder="可选" /><ProfileField label="头像 URL" field="avatar" value={draft.avatar} onChange={update('avatar')} placeholder="可选" /><ProfileField label="职业 / 身份" field="occupation" value={draft.occupation} onChange={update('occupation')} placeholder="例如：创业者" /><ProfileField label="当前角色" field="role" value={draft.role} onChange={update('role')} placeholder="例如：CEO / 产品负责人" /><ProfileField label="公司 / 组织" field="organization" value={draft.organization} onChange={update('organization')} placeholder="可选" /><ProfileTagField label="主要工作领域" field="workDomains" value={draft.workDomains} onChange={update('workDomains')} placeholder="跨境电商，AI，产品系统" /></div></>}{section === 'personal' && <><header><div><h3>个人上下文</h3><p>记录相对稳定、能帮助 Jason OS 理解你如何工作的长期信息。</p></div></header><div className="profile-stack"><ProfileField label="长期方向" field="longTermDirection" value={draft.longTermDirection} onChange={update('longTermDirection')} multiline placeholder="例如：打造 AI 驱动的跨境电商业务体系" /><ProfileTagField label="当前重点" field="currentFocus" value={draft.currentFocus} onChange={update('currentFocus')} placeholder="Jason OS，跨境电商业务，AI Agent" /><ProfileField label="我的工作方式" field="workStyle" value={draft.workStyle} onChange={update('workStyle')} multiline placeholder="例如：偏好先建立完整架构，再执行。" /><ProfileField label="我的决策方式" field="decisionStyle" value={draft.decisionStyle} onChange={update('decisionStyle')} multiline placeholder="例如：重视反向思维、风险分析、长期价值。" /><ProfileTagField label="常用工具" field="commonTools" value={draft.commonTools} onChange={update('commonTools')} placeholder="Codex，ChatGPT，Shopify" /><ProfileField label="其他长期背景" field="otherContext" value={draft.otherContext} onChange={update('otherContext')} multiline placeholder="记录其他长期有价值的信息。" /></div></>}{section === 'ai' && <><header><div><h3>AI 上下文</h3><p>这些内容会在相关问题中帮助 AI 理解你，但 AI 修改档案仍必须经过你的确认。</p></div></header><div className="profile-stack"><ProfileField label="我希望 AI 如何帮助我" field="aiAssistancePreference" value={draft.aiAssistancePreference} onChange={update('aiAssistancePreference')} multiline placeholder="例如：从 CEO 和产品架构师角度思考，主动指出风险。" /><ProfileField label="我的回答偏好" field="aiResponsePreference" value={draft.aiResponsePreference} onChange={update('aiResponsePreference')} multiline placeholder="例如：复杂问题先给架构，再给执行方案。" /><ProfileField label="我的决策偏好" field="aiDecisionPreference" value={draft.aiDecisionPreference} onChange={update('aiDecisionPreference')} multiline placeholder="例如：关注长期价值、机会成本、风险和系统协同。" /><ProfileField label="AI 其他上下文" field="aiOtherContext" value={draft.aiOtherContext} onChange={update('aiOtherContext')} multiline placeholder="补充 AI 应长期知道的协作背景。" /></div></>}<footer><span>{profile ? '更改将立即保存到本机。' : '首次建议先填写姓名、角色、长期方向和 AI 协作方式。'}</span><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存档案'}</button></footer></section></div>
}

function CommandCenter({ records, externalItems, onOpen, onCreate, onView, onStartTimer, onAi }: { records: RecordData[]; externalItems: ExternalItem[]; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void; onView: (view: View) => void; onStartTimer: (context?: Partial<RecordData>) => void; onAi: (prompt: string) => void }) {
  const goals = records.filter((record) => record.entity === 'goals' && isActive(record))
  const northStar = [...goals].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))[0]
  const tasks = records.filter((record) => record.entity === 'tasks' && isActive(record))
  const top3 = [...tasks].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))).slice(0, 3)
  const todayTasks = tasks.filter((record) => isToday(record.dueDate))
  const projects = records.filter((record) => record.entity === 'projects' && isActive(record))
  const blockers = projects.filter((record) => record.status === 'blocked' || record.health === 'blocked' || record.blockers)
  const pendingDecisions = records.filter((record) => record.entity === 'decisions' && ['pending', 'monitoring'].includes(String(record.status)))
  const contextGaps = detectContextGaps(records)
  const results = records.filter((record) => record.entity === 'results').slice(0, 4)
  const learning = records.filter((record) => ['reviews', 'insights', 'principles'].includes(record.entity)).slice(0, 4)
  const todayLogs = records.filter((record) => record.entity === 'timeLogs' && isToday(record.startAt))
  const allocated = allocation(todayLogs, records)
  const externalSignals = briefingSignals(detectExternalSignals(externalItems))
  return <div className="command-center">
    <section className="focus-banner"><div><p>{greeting()} · {new Date().toLocaleDateString('zh-CN', { timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'long' })}</p><h2>{northStar ? titleFor(northStar) : '先定义你现在最重要的方向。'}</h2><span>{northStar ? String(northStar.why || northStar.description || '这是当前 North Star。') : '目标不是任务清单，而是帮助今天的行动有方向。'}</span></div><div className="focus-actions">{northStar ? <ProgressRing value={percent(northStar.progress)} /> : <button className="button primary" onClick={() => onCreate('goals')}>创建 North Star</button>}<button className="button ghost" onClick={() => onStartTimer(top3[0])}>▶ 开始专注</button></div></section>
    <div className="metric-strip"><Metric label="今日实际投入" value={formatMinutes(minutesToday(records))} hint={`${todayLogs.length} 条记录`} onClick={() => onView('time')} /><Metric label="今日任务" value={`${todayTasks.length}`} hint={`${tasks.filter(isOverdue).length} 项逾期`} onClick={() => onView('today')} /><Metric label="活跃项目" value={`${projects.length}`} hint={`${blockers.length} 个需关注`} onClick={() => onView('projects')} /><Metric label="待决策" value={`${pendingDecisions.length}`} hint="需要明确下一步" onClick={() => onView('decisions')} /></div>
    <div className="center-grid">
      <DashboardPanel title="Top 3" action="查看今天" onAction={() => onView('today')} className="span-5">{top3.length ? top3.map((task, index) => <TaskRow key={task.id} task={task} records={records} number={index + 1} onOpen={onOpen} onTimer={onStartTimer} />) : <GuidedEmpty icon="□" title="选择今天最重要的三件事" text="Top 3 限制注意力，让任务服务于方向。" action="创建任务" onAction={() => onCreate('tasks', { dueDate: today(), priority: 'high' })} />}</DashboardPanel>
      <DashboardPanel title="活跃项目" action="全部项目" onAction={() => onView('projects')} className="span-7">{projects.length ? <div className="project-compact-grid">{projects.slice(0, 4).map((project) => <ProjectCompact key={project.id} project={project} records={records} onOpen={onOpen} />)}</div> : <GuidedEmpty icon="◈" title="项目把目标变成结果" text="从一个有明确下一步行动的项目开始。" action="创建项目" onAction={() => onCreate('projects')} />}</DashboardPanel>
      <DashboardPanel title="时间分配" action="查看时间" onAction={() => onView('time')} className="span-5"><AllocationList items={allocated} empty="今天还没有时间记录。开始计时后，这里会显示时间真正花在哪里。" /></DashboardPanel>
      <DashboardPanel title="需要关注" action="查看决策" onAction={() => onView('decisions')} className="span-7"><AttentionList blockers={blockers} overdue={tasks.filter(isOverdue)} decisions={pendingDecisions} gaps={contextGaps} records={records} onOpen={onOpen} /></DashboardPanel>
      <DashboardPanel title="Financial Pulse" action="打开财务" onAction={() => onView('finance')} className="span-12"><FinancialPulse records={records} onView={() => onView('finance')} /></DashboardPanel>
      <DashboardPanel title="外部信号" action="查看调研结果" onAction={() => onView('notebook')} className="span-12">{externalSignals.length ? <div className="external-signal-preview">{externalSignals.slice(0, 3).map((signal) => <button key={signal.key} onClick={() => onView('notebook')}><span>{signal.type === 'GROWTH' ? '↑' : '✦'}</span><div><strong>{signal.title}</strong><small>{signal.summary}</small></div></button>)}</div> : <p className="muted">尚无达到样本门槛的外部变化。快速采集和情报源积累数据后，这里只显示少量需要 CEO 关注的信号。</p>}</DashboardPanel>
      <DashboardPanel title="最近结果" action="记录结果" onAction={() => onCreate('results')} className="span-4">{results.length ? results.map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />) : <GuidedEmpty icon="✓" title="结果是现实层的核心资产" text="完成工作后记录预期与实际，而不是只勾选任务。" action="记录结果" onAction={() => onCreate('results')} />}</DashboardPanel>
      <DashboardPanel title="最近学习" action="开始复盘" onAction={() => onCreate('reviews')} className="span-4">{learning.length ? learning.map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />) : <GuidedEmpty icon="◑" title="把经历变成可复用经验" text="从一次结果或重要决策开始复盘。" action="创建复盘" onAction={() => onCreate('reviews')} />}</DashboardPanel>
      <DashboardPanel title="AI 洞察" action="打开 AI" onAction={() => onAi('根据我最近的目标、任务、时间、结果和决策，指出最值得关注的一个模式。')} className="span-4"><div className="ai-insight"><span>AI</span><p>让 AI 基于你的真实记录发现风险、重复模式和下一步，而不是凭空聊天。</p><button onClick={() => onAi('根据我最近的目标、任务、时间、结果和决策，指出最值得关注的一个模式。')}>分析最近上下文 →</button></div></DashboardPanel>
    </div>
  </div>
}

function TodayView({ records, running, onOpen, onEdit, onComplete, onStartTimer, onStopTimer, onCreate }: { records: RecordData[]; running?: RecordData; onOpen: (record: RecordData) => void; onEdit: (record: RecordData) => void; onComplete: (record: RecordData) => void; onStartTimer: (record?: Partial<RecordData>) => void; onStopTimer: () => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void }) {
  const tasks = records.filter((record) => record.entity === 'tasks' && isActive(record))
  const top = [...tasks].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)).slice(0, 3)
  const due = tasks.filter((record) => isToday(record.dueDate))
  const logs = records.filter((record) => record.entity === 'timeLogs' && isToday(record.startAt)).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
  const planned = due.reduce((sum, task) => sum + Number(task.estimateMinutes || 0), 0); const actual = logs.reduce((sum, log) => sum + durationMinutes(log), 0)
  return <div className="focus-page"><section className="today-hero"><div><p>今天的焦点</p><h2>{running ? titleFor(running) : top[0] ? titleFor(top[0]) : '选择下一项真正重要的行动'}</h2><span>{running ? `开始于 ${formatDate(running.startAt, true)}` : 'Focus 不是新实体，而是把现有工作组织成可执行视图。'}</span></div>{running ? <button className="button danger" onClick={onStopTimer}>■ 停止计时</button> : <button className="button primary" onClick={() => onStartTimer(top[0])}>▶ 开始当前任务</button>}</section>
    <div className="two-column"><section className="work-panel"><PanelHeader title="今日 Top 3" action="添加" onAction={() => onCreate('tasks', { dueDate: today(), priority: 'high' })} />{top.length ? top.map((task, index) => <ActionTask key={task.id} task={task} records={records} index={index + 1} onOpen={onOpen} onEdit={onEdit} onComplete={onComplete} onTimer={onStartTimer} />) : <GuidedEmpty icon="◉" title="还没有今日重点" text="添加一项最能推动目标的行动，而不是填满清单。" action="添加 Top 3" onAction={() => onCreate('tasks', { dueDate: today(), priority: 'high' })} />}</section>
    <section className="work-panel"><PanelHeader title="计划 vs 实际" /><div className="compare"><CompareBar label="计划" value={planned} max={Math.max(planned, actual, 60)} /><CompareBar label="实际" value={actual} max={Math.max(planned, actual, 60)} /></div><div className="time-summary"><strong>{formatMinutes(actual)}</strong><span>今天已记录 · {logs.length} 段</span></div>{logs.slice(-3).reverse().map((log) => <CompactRecord key={log.id} record={log} onOpen={() => onEdit(log)} />)}</section></div>
    <section className="work-panel"><PanelHeader title="今天的任务" action="新建任务" onAction={() => onCreate('tasks', { dueDate: today() })} />{due.length ? <div className="task-table">{due.map((task) => <ActionTask key={task.id} task={task} records={records} onOpen={onOpen} onEdit={onEdit} onComplete={onComplete} onTimer={onStartTimer} />)}</div> : <GuidedEmpty icon="□" title="今天没有到期任务" text="这不代表你无事可做。选择一个项目的下一步，明确安排到今天。" action="安排任务" onAction={() => onCreate('tasks', { dueDate: today() })} />}</section>
  </div>
}

function TasksView({ records, onOpen, onEdit, onComplete, onStartTimer, onCreate }: { records: RecordData[]; onOpen: (record: RecordData) => void; onEdit: (record: RecordData) => void; onComplete: (record: RecordData) => void; onStartTimer: (record: RecordData) => void; onCreate: (initial?: Partial<RecordData>) => void }) {
  const [mode, setMode] = useState<TaskView>('list'); const [filter, setFilter] = useState<'all' | 'today' | 'upcoming' | 'overdue'>('all')
  const tasks = records.filter((record) => record.entity === 'tasks' && isActive(record)).filter((task) => filter === 'all' || filter === 'today' && isToday(task.dueDate) || filter === 'upcoming' && Boolean(task.dueDate) && String(task.dueDate) > today() || filter === 'overdue' && isOverdue(task))
  return <div className={`tasks-page ${mode === 'calendar' ? 'calendar-v2-mode' : ''}`}>{mode !== 'calendar' && <div className="toolbar"><div className="segmented">{(['all', 'today', 'upcoming', 'overdue'] as const).map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{{ all: '全部', today: '今天', upcoming: '即将到期', overdue: '已逾期' }[item]}</button>)}</div><div className="segmented">{(['list', 'kanban', 'matrix', 'calendar'] as const).map((item) => <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>{{ list: '列表', kanban: '看板', matrix: '四象限', calendar: '日历' }[item]}</button>)}</div></div>}
    {mode === 'list' && <section className="work-panel">{tasks.length ? tasks.map((task) => <ActionTask key={task.id} task={task} records={records} onOpen={onOpen} onEdit={onEdit} onComplete={onComplete} onTimer={onStartTimer} />) : <GuidedEmpty icon="□" title="这个视图里没有任务" text="任务应该代表可执行的下一步，并关联项目或目标。" action="创建任务" onAction={() => onCreate()} />}</section>}
    {mode === 'kanban' && <div className="kanban">{(['inbox', 'todo', 'in_progress', 'waiting'] as const).map((status) => <section key={status}><header><h3>{statusLabel(status)}</h3><span>{tasks.filter((task) => task.status === status).length}</span></header>{tasks.filter((task) => task.status === status).map((task) => <article key={task.id} onClick={() => onOpen(task)}><strong>{titleFor(task)}</strong><small>{relationName(task.projectId, records) || '未分配项目'}</small><footer><span className={`priority ${task.priority || 'medium'}`}>{priorityLabel(task.priority)}</span><span>{formatDate(task.dueDate)}</span></footer></article>)}</section>)}</div>}
    {mode === 'matrix' && <TaskMatrixBoard tasks={tasks} records={records} onOpen={onOpen} onCreate={onCreate} />}
    {mode === 'calendar' && <TaskCalendarBoard tasks={tasks} records={records} onOpen={onOpen} onCreate={onCreate} onTaskView={setMode} />}
  </div>
}

function TaskMatrixBoard({ tasks, records, onOpen, onCreate }: { tasks: RecordData[]; records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: (initial?: Partial<RecordData>) => void }) {
  return <div className="task-matrix">{taskMatrixQuadrants.map((quadrant, index) => {
    const quadrantTasks = tasks.filter((task) => taskQuadrant(task) === quadrant.id)
    return <section className={`task-quadrant quadrant-${quadrant.id}`} key={quadrant.id}><header><div><span>Q{index + 1}</span><h3>{quadrant.title}</h3><p>{quadrant.action}</p></div><strong>{quadrantTasks.length}</strong></header><div className="quadrant-task-list">{quadrantTasks.map((task) => <button className="matrix-task-card" key={task.id} onClick={() => onOpen(task)}><strong>{titleFor(task)}</strong><small>{[relationName(task.projectId, records), relationName(task.goalId, records)].filter(Boolean).join(' · ') || '未关联项目或目标'}</small><footer><span className={`priority ${task.priority || 'medium'}`}>{priorityLabel(task.priority)}</span><time>{task.dueAt ? formatDate(task.dueAt, true) : task.dueDate ? formatDate(task.dueDate) : '未设截止日期'}</time></footer></button>)}</div><button className="matrix-create" onClick={() => onCreate({ importance: quadrant.importance, urgency: quadrant.urgency, status: 'todo' })}>＋ 添加到「{quadrant.action}」</button></section>
  })}</div>
}

function TaskCalendarBoard({ tasks, records: _records, onOpen, onCreate, onTaskView }: { tasks: RecordData[]; records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: (initial?: Partial<RecordData>) => void; onTaskView: (view: TaskView) => void }) {
  const [anchor, setAnchor] = useState(() => new Date())
  const [scope, setScope] = useState<CalendarScope>('week')
  const dateKey = calendarDateKey
  const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next }
  const weekStart = new Date(anchor); weekStart.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7)); weekStart.setHours(0, 0, 0, 0)
  const visibleDays = scope === 'day' ? [anchor] : Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1); const monthGridStart = addDays(monthStart, -((monthStart.getDay() + 6) % 7)); const monthDays = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index))
  const calendarItems = taskCalendarItems(tasks)
  const taskMap = Object.fromEntries(Object.entries(groupBy(calendarItems.filter((item) => item.allDay), (item) => item.startDateKey)).map(([key, items]) => [key, items.map((item) => item.record)]))
  const move = (direction: number) => setAnchor(addDays(anchor, direction * (scope === 'day' ? 1 : scope === 'week' ? 7 : 30)))
  const rangeLabel = scope === 'day' ? anchor.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : scope === 'week' ? `${visibleDays[0].toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })} - ${visibleDays[6].toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}` : anchor.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
  const miniMonthDays = monthDays.slice(0, 42)
  const scheduledCount = calendarItems.length; const unscheduledCount = tasks.filter((task) => !task.dueDate && !task.dueAt).length
  const calendarHeader = <header className="task-calendar-v2-header"><div><span>JASON OS CALENDAR</span><strong>任务日历</strong><small>{scheduledCount} 项已安排 · {unscheduledCount} 项未安排</small></div><div className="task-calendar-view-switch">{(['list','kanban','matrix','calendar'] as const).map((item) => <button key={item} className={item === 'calendar' ? 'active' : ''} onClick={() => onTaskView(item)}>{{ list:'列表', kanban:'看板', matrix:'四象限', calendar:'日历' }[item]}</button>)}</div><button className="calendar-create-task" onClick={() => onCreate()}>＋ 新建任务</button></header>
  if (scope === 'month') return <div className="task-calendar-v2">{calendarHeader}<div className="feishu-calendar"><MiniTaskMonth anchor={anchor} days={miniMonthDays} selected={dateKey(anchor)} taskMap={taskMap} onSelect={setAnchor} /><section className="calendar-main"><CalendarTopbar label={rangeLabel} scope={scope} onScope={setScope} onToday={() => setAnchor(new Date())} onMove={move} /><div className="calendar-month-grid">{['一','二','三','四','五','六','日'].map((day) => <b key={day}>{day}</b>)}{monthDays.map((day) => <button key={dateKey(day)} className={`${day.getMonth() !== anchor.getMonth() ? 'muted' : ''} ${dateKey(day) === today() ? 'today' : ''}`} onClick={() => setAnchor(day)}><span>{day.getDate()}</span>{(taskMap[dateKey(day)] || []).slice(0, 3).map((task) => <i key={task.id} onClick={(event) => { event.stopPropagation(); onOpen(task) }}>{titleFor(task)}</i>)}</button>)}</div></section></div></div>
  const hours = Array.from({ length: 13 }, (_, index) => index + 7); const now = new Date(); const currentTop = ((now.getHours() + now.getMinutes() / 60) - 7) / 12 * 100
  return <div className="task-calendar-v2">{calendarHeader}<div className="feishu-calendar"><MiniTaskMonth anchor={anchor} days={miniMonthDays} selected={dateKey(anchor)} taskMap={taskMap} onSelect={setAnchor} /><section className="calendar-main"><CalendarTopbar label={rangeLabel} scope={scope} onScope={setScope} onToday={() => setAnchor(new Date())} onMove={move} /><div className="calendar-week"><div className="calendar-timezone">GMT-7</div><div className="calendar-day-heads">{visibleDays.map((day) => <button key={dateKey(day)} className={dateKey(day) === today() ? 'today' : ''} onClick={() => { setAnchor(day); if (scope === 'week') return }}><small>{day.toLocaleDateString('zh-CN', { weekday: 'short' })}</small><strong>{day.getDate()}</strong></button>)}</div><div className="calendar-all-day-label">全天</div><div className="calendar-all-day">{visibleDays.map((day) => <div key={dateKey(day)}>{(taskMap[dateKey(day)] || []).map((task) => <button key={task.id} onClick={() => onOpen(task)}><span className={`priority ${task.priority || 'medium'}`} />{titleFor(task)}</button>)}</div>)}</div><div className="calendar-hours">{hours.map((hour) => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</div><div className="calendar-time-grid">{visibleDays.map((day) => <div key={dateKey(day)} className={dateKey(day) === today() ? 'today-column' : ''}>{calendarItems.filter((item) => !item.allDay && item.startDateKey === dateKey(day)).map((item) => { const top = ((item.start.getHours() + item.start.getMinutes() / 60) - 7) / 12 * 100; const height = Math.max(4, (item.end.getTime() - item.start.getTime()) / 3_600_000 / 12 * 100); return <button className="calendar-timed-task" key={item.id} style={{ top: `${Math.max(0, top)}%`, height: `${height}%` }} onClick={() => onOpen(item.record)}><strong>{titleFor(item.record)}</strong><small>{item.start.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</small></button> })}</div>)}{visibleDays.some((day) => dateKey(day) === today()) && currentTop >= 0 && currentTop <= 100 && <div className="calendar-now" style={{ top: `${currentTop}%` }}><span>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span></div>}</div></div>{!tasks.some((task) => task.dueDate) && <button className="calendar-empty-action" onClick={() => onCreate({ dueDate: today() })}>＋ 创建带截止日期的任务</button>}</section></div></div>
}

function CalendarTopbar({ label, scope, onScope, onToday, onMove }: { label: string; scope: 'day' | 'week' | 'month'; onScope: (scope: 'day' | 'week' | 'month') => void; onToday: () => void; onMove: (direction: number) => void }) { return <header className="calendar-topbar"><button onClick={onToday}>今天</button><button onClick={() => onMove(-1)}>‹</button><button onClick={() => onMove(1)}>›</button><h3>{label}</h3><div>{(['day','week','month'] as const).map((item) => <button key={item} className={scope === item ? 'active' : ''} onClick={() => onScope(item)}>{{ day:'日', week:'周', month:'月' }[item]}</button>)}</div></header> }
function MiniTaskMonth({ anchor, days, selected, taskMap, onSelect }: { anchor: Date; days: Date[]; selected: string; taskMap: Record<string, RecordData[]>; onSelect: (date: Date) => void }) { return <aside className="calendar-mini"><header><strong>{anchor.getFullYear()}年{anchor.getMonth()+1}月</strong><div><button onClick={() => onSelect(new Date(anchor.getFullYear(), anchor.getMonth()-1, 1))}>‹</button><button onClick={() => onSelect(new Date(anchor.getFullYear(), anchor.getMonth()+1, 1))}>›</button></div></header><div className="mini-weekdays">{['一','二','三','四','五','六','日'].map((day) => <span key={day}>{day}</span>)}</div><div className="mini-days">{days.map((day) => { const key=localDateKey(day); return <button key={key} className={`${day.getMonth() !== anchor.getMonth() ? 'muted' : ''} ${key === selected ? 'selected' : ''} ${key === today() ? 'today' : ''}`} onClick={() => onSelect(day)}>{day.getDate()}{taskMap[key]?.length ? <i /> : null}</button> })}</div><div className="calendar-sources"><strong>我的日历</strong><span><i className="blue" />任务截止日期</span><span><i className="green" />Jason OS 任务</span></div></aside> }

function TimeView({ records, running, onStartTimer, onStopTimer, onEdit, onCreate }: { records: RecordData[]; running?: RecordData; onStartTimer: () => void; onStopTimer: () => void; onEdit: (record: RecordData) => void; onCreate: () => void }) {
  const [range, setRange] = useState<TimeRange>('day'); const logs = records.filter((record) => record.entity === 'timeLogs' && matchesRange(record, range)).sort((a, b) => String(b.startAt).localeCompare(String(a.startAt)))
  const total = logs.reduce((sum, log) => sum + durationMinutes(log), 0); const goalAligned = logs.filter((log) => log.goalId).reduce((sum, log) => sum + durationMinutes(log), 0); const projectTime = logs.filter((log) => log.projectId).reduce((sum, log) => sum + durationMinutes(log), 0); const unassigned = logs.filter((log) => !log.projectId && !log.goalId && !log.taskId).reduce((sum, log) => sum + durationMinutes(log), 0)
  const planned = records.filter((record) => record.entity === 'tasks' && matchesRange({ ...record, startAt: record.dueDate } as RecordData, range)).reduce((sum, task) => sum + Number(task.estimateMinutes || 0), 0)
  return <div className="time-page"><div className="toolbar"><div className="segmented">{(['day', 'week', 'month'] as const).map((item) => <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{{ day: '今天', week: '本周', month: '本月' }[item]}</button>)}</div><div className="toolbar-actions"><button className="button ghost" onClick={onCreate}>＋ 手动记录</button>{running ? <button className="button danger" onClick={onStopTimer}>■ 停止计时</button> : <button className="button primary" onClick={onStartTimer}>▶ 开始计时</button>}</div></div><div className="metric-strip five"><Metric label="总时间" value={formatMinutes(total)} /><Metric label="目标一致" value={formatMinutes(goalAligned)} /><Metric label="项目时间" value={formatMinutes(projectTime)} /><Metric label="未分配" value={formatMinutes(unassigned)} /><Metric label="计划 / 实际" value={`${formatMinutes(planned)} / ${formatMinutes(total)}`} /></div><div className="two-column wide"><section className="work-panel"><PanelHeader title="现实时间轴" />{logs.length ? logs.map((log) => <TimeRow key={log.id} log={log} records={records} onEdit={onEdit} />) : <GuidedEmpty icon="◷" title="还没有现实时间记录" text="开始计时或手动添加一段工作，才能知道时间真正花在哪里。" action="手动记录" onAction={onCreate} />}</section><section className="work-panel"><PanelHeader title="时间分配" /><AllocationList items={allocation(logs, records)} empty="记录时间并关联项目、目标或类别后，这里会显示分配结构。" /><div className="compare"><CompareBar label="计划" value={planned} max={Math.max(planned, total, 60)} /><CompareBar label="实际" value={total} max={Math.max(planned, total, 60)} /></div></section></div></div>
}

function ProjectsView({ records, selectedId, onSelect, onOpen, onCreate, onEdit, onStartTimer, onAiAnalyze }: { records: RecordData[]; selectedId: string | null; onSelect: (id: string | null) => void; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void; onEdit: (record: RecordData) => void; onStartTimer: (record: RecordData) => void; onAiAnalyze: (question: string, context: Partial<AgentContext>) => void }) {
  const projects = records.filter((record) => record.entity === 'projects')
  const selected = projects.find((project) => project.id === selectedId)
  if (selected) return <ProjectWorkspace project={selected} records={records} onBack={() => onSelect(null)} onOpen={onOpen} onCreate={onCreate} onEdit={onEdit} onStartTimer={onStartTimer} onAiAnalyze={onAiAnalyze} />
  return <div className="projects-page">{projects.length ? <div className="project-grid">{projects.map((project) => <article className="project-card" key={project.id} onClick={() => onSelect(project.id)}><header><span className={`health ${project.health || 'healthy'}`} /><span>{statusLabel(project.status)}</span><button onClick={(event) => { event.stopPropagation(); onEdit(project) }}>•••</button></header><h2>{titleFor(project)}</h2><p>{String(project.why || project.description || '明确项目为什么值得投入。')}</p><ProgressBar value={percent(project.progress)} /><div className="project-stats"><span><strong>{records.filter((record) => record.entity === 'tasks' && linkedTo(record, project.id)).length}</strong> 任务</span><span><strong>{formatMinutes(records.filter((record) => record.entity === 'timeLogs' && linkedTo(record, project.id)).reduce((sum, log) => sum + durationMinutes(log), 0))}</strong> 投入</span><span><strong>{records.filter((record) => record.entity === 'results' && linkedTo(record, project.id)).length}</strong> 结果</span></div><footer><span>{relationName(project.goalId, records) || '未关联目标'}</span><span>打开工作空间 →</span></footer></article>)}</div> : <GuidedEmpty icon="◈" title="项目是把目标变成结果的工作空间" text="一个好项目应该有明确的为什么、下一步、时间投入和结果。" action="创建第一个项目" onAction={() => onCreate('projects')} />}</div>
}

function ProjectWorkspace({ project, records, onBack, onOpen, onCreate, onEdit, onStartTimer, onAiAnalyze }: { project: RecordData; records: RecordData[]; onBack: () => void; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void; onEdit: (record: RecordData) => void; onStartTimer: (record: RecordData) => void; onAiAnalyze: (question: string, context: Partial<AgentContext>) => void }) {
  const [tab, setTab] = useState<'overview' | Entity | 'timeline' | 'workchain' | 'outcomes'>('overview')
  const map: { key: typeof tab; label: string; entity?: Entity }[] = [{ key: 'overview', label: '概览' }, { key: 'tasks', label: '任务', entity: 'tasks' }, { key: 'workchain', label: '工作链' }, { key: 'timeLogs', label: '时间', entity: 'timeLogs' }, { key: 'financialTransactions', label: '财务', entity: 'financialTransactions' }, { key: 'outcomes', label: '成果' }, { key: 'hypotheses', label: '假设', entity: 'hypotheses' }, { key: 'experiments', label: '实验', entity: 'experiments' }, { key: 'decisions', label: '决策', entity: 'decisions' }, { key: 'reviews', label: '复盘', entity: 'reviews' }, { key: 'timeline', label: '时间线' }]
  const related = records.filter((record) => linkedTo(record, project.id)); const economics = projectEconomics(records, project.id); const tasks = related.filter((record) => record.entity === 'tasks'); const time = related.filter((record) => record.entity === 'timeLogs').reduce((sum, log) => sum + durationMinutes(log), 0)
  const current = map.find((item) => item.key === tab); const items = current?.entity ? related.filter((record) => record.entity === current.entity) : []
  return <div className="project-workspace"><button className="back-link" onClick={onBack}>← 返回项目</button><section className="workspace-hero"><div><div className="meta-line"><span className={`health ${project.health || 'healthy'}`} />{statusLabel(project.status)} · {relationName(project.goalId, records) || '未关联目标'}</div><h2>{titleFor(project)}</h2><p>{String(project.why || project.description || '尚未填写项目为什么值得投入。')}</p></div><div><button className="button ghost" onClick={() => onEdit(project)}>编辑项目</button><button className="button primary" onClick={() => onStartTimer(project)}>▶ 为项目计时</button></div></section><nav className="workspace-tabs">{map.map((item) => <button key={item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>{item.label}{item.entity && <span>{related.filter((record) => record.entity === item.entity).length}</span>}</button>)}</nav>
    {tab === 'overview' && <div className="workspace-overview"><div className="metric-strip"><Metric label="项目进度" value={`${percent(project.progress)}%`} /><Metric label="实际投入" value={formatMinutes(time)} /><Metric label="经营贡献" value={economics.postedTransactions ? formatMoneyMinor(economics.managementContributionMinor) : '未记录'} hint="不等于会计利润" /><Metric label="数据覆盖" value={`${economics.dataCoverage}%`} hint={`${economics.outcomeCount} 个 Outcome`} /></div><DecisionEvidencePacket project={project} records={records} onCreate={onCreate} /><div className="two-column"><section className="work-panel"><PanelHeader title="下一步行动" action="添加任务" onAction={() => onCreate('tasks', { projectId: project.id, goalId: project.goalId })} /><p className="lead-note">{String(project.nextAction || '项目还没有明确下一步。下一步应该是一个可执行任务，而不是模糊目标。')}</p>{tasks.filter(isActive).slice(0, 5).map((task) => <CompactRecord key={task.id} record={task} onOpen={onOpen} />)}</section><section className="work-panel"><PanelHeader title="阻塞与健康" /><div className={`health-callout ${project.health || 'healthy'}`}><strong>{project.blockers ? '当前阻塞' : '项目状态'}</strong><p>{String(project.blockers || '没有记录阻塞。持续比较时间投入、任务进度和真实结果。')}</p></div><PanelHeader title="最近活动" />{timeline([project, ...related]).slice(0, 5).map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />)}</section></div></div>}
    {tab === 'timeline' && <ProjectTimelineView project={project} records={records} related={related} onOpen={onOpen} onAiAnalyze={onAiAnalyze} />}
    {tab === 'workchain' && <ProjectWorkChain project={project} records={records} onOpen={onOpen} onCreate={onCreate} />}
    {tab === 'outcomes' && <ProjectResults project={project} records={records} onOpen={onOpen} onCreate={onCreate} />}
    {current?.entity && <section className="work-panel workspace-list"><PanelHeader title={`${titleFor(project)} · ${current.label}`} action={`新建${configFor(current.entity).singular}`} onAction={() => onCreate(current.entity!, { projectId: project.id, goalId: project.goalId })} />{items.length ? items.map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />) : <GuidedEmpty icon={configFor(current.entity).icon} title={`这里还没有${current.label}`} text={`${configFor(current.entity).description} 记录会自动成为项目时间线与 AI 上下文的一部分。`} action={`新建${configFor(current.entity).singular}`} onAction={() => onCreate(current.entity!, { projectId: project.id, goalId: project.goalId })} />}</section>}
  </div>
}

function ProjectResults({ project, records, onOpen, onCreate }: { project: RecordData; records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void }) {
  const results = records.filter((record) => record.entity === 'results' && linkedTo(record, project.id))
  const resultIds = new Set(results.map((record) => record.id))
  const assets = records.filter((record) => record.entity === 'deliverables' && (record.projectId === project.id || resultIds.has(String(record.resultId || ''))))
  const packages = records.filter((record) => record.entity === 'resultPackages' && record.projectId === project.id)
  return <section className="project-results"><div className="project-results-actions"><button className="button primary" onClick={() => onCreate('results', { projectId: project.id, goalId: project.goalId, status: 'PLANNED', date: today(), evidenceStatus: 'RECORDED' })}>＋ 新建结果</button><button className="button" onClick={() => onCreate('deliverables', { projectId: project.id, goalId: project.goalId, status: 'DRAFT', assetType: 'OTHER', versionNumber: 'v1' })}>＋ 添加成果资产</button><button className="button" onClick={() => onCreate('resultPackages', { projectId: project.id, goalId: project.goalId, status: 'ACTIVE', resultIds: results.map((record) => record.id), deliverableIds: assets.map((record) => record.id) })}>＋ 创建成果包</button></div><div className="three-column"><section className="work-panel"><PanelHeader title="最终结果" />{results.length ? results.map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />) : <p className="empty-copy">结果可以独立存在，不强制要求上传文件。</p>}</section><section className="work-panel"><PanelHeader title="正式成果资产" />{assets.length ? assets.map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />) : <p className="empty-copy">选择 Notebook 文件后创建资产关联，文件不会被复制。</p>}</section><section className="work-panel"><PanelHeader title="成果包" />{packages.length ? packages.map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />) : <p className="empty-copy">项目完成后可稍后整理成果包，不会强制执行。</p>}</section></div></section>
}

function ProjectWorkChain({ project, records, onOpen, onCreate }: { project: RecordData; records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void }) {
  const runs = records.filter((record) => record.entity === 'workflowRuns' && record.projectId === project.id)
  const workflows = records.filter((record) => record.entity === 'workflows')
  const activeRun = runs.find((record) => ['RUNNING', 'PLANNED', 'PAUSED'].includes(String(record.status))) || runs[0]
  const versions = records.filter((record) => record.entity === 'workflowVersions')
  const steps = records.filter((record) => record.entity === 'workflowRunSteps' && record.workflowRunId === activeRun?.id)
  const gates = records.filter((record) => record.entity === 'workflowGates' && record.workflowVersionId === activeRun?.workflowVersionId)
  const improvements = records.filter((record) => record.entity === 'workflowImprovementProposals' && (record.sourceWorkflowRunId === activeRun?.id || record.workflowId === activeRun?.workflowId))
  const scorecard = activeRun ? workChainScorecard(records, activeRun) : undefined
  const previousRun = activeRun ? runs.filter((record) => record.id !== activeRun.id).sort((a, b) => String(b.completedAt || b.updatedAt).localeCompare(String(a.completedAt || a.updatedAt)))[0] : undefined
  const comparison = activeRun && previousRun ? compareWorkChainRuns(records, previousRun, activeRun) : undefined
  const currentVersion = versions.find((record) => record.id === activeRun?.workflowVersionId)
  const startRun = (workflow?: RecordData) => onCreate('workflowRuns', { title: `${titleFor(project)} · ${workflow ? titleFor(workflow) : '工作链运行'}`, projectId: project.id, goalId: project.goalId, workflowId: workflow?.id, workflowVersionId: workflow?.currentVersionId, status: 'PLANNED', startedAt: nowInput(), contextSnapshot: JSON.stringify({ projectType: project.category || '', constraints: project.blockers || '' }, null, 2) })
  return <section className="workchain-panel"><header className="workchain-header"><div><p className="eyebrow">WORK CHAIN · EXECUTION MEMORY</p><h3>项目工作链</h3><p>模板定义与实际运行分开；时间、资金和结果只从已有事实记录聚合。</p></div><div><button className="button" onClick={() => onCreate('workflows', { status: 'ACTIVE' })}>＋ 新建工作链</button>{workflows[0] && <button className="button" onClick={() => onCreate('workflowVersions', { workflowId: workflows[0].id, versionNumber: String(versions.filter((record) => record.workflowId === workflows[0].id).length + 1), maturity: 'EXPERIMENTAL' })}>＋ 新建版本</button>}<button className="button primary" onClick={() => workflows[0] ? startRun(workflows[0]) : onCreate('workflows', { status: 'ACTIVE' })}>{workflows[0] ? '＋ 应用工作链' : '＋ 先新建工作链'}</button></div></header>{activeRun && scorecard ? <><div className="metric-strip four"><Metric label="当前版本" value={currentVersion ? `v${String(currentVersion.versionNumber || '—')}` : '未设置'} hint={currentVersion ? statusLabel(currentVersion.maturity) : '可创建版本'} /><Metric label="运行进度" value={`${scorecard.completedStepCount}/${scorecard.stepCount || 0}`} /><Metric label="实际时间" value={scorecard.timeMinutes ? formatMinutes(scorecard.timeMinutes) : '待关联 Time'} /><Metric label="实际成本" value={scorecard.costMinor ? formatMoneyMinor(scorecard.costMinor) : '待关联 Finance'} /></div><div className="three-column"><section className="work-panel"><PanelHeader title="实际步骤" action="添加运行步骤" onAction={() => onCreate('workflowRunSteps', { workflowRunId: activeRun.id, status: 'PLANNED' })} />{steps.length ? steps.sort((a, b) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0)).map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />) : <p className="empty-copy">运行步骤保留实际执行记录；模板步骤不会被直接改写。</p>}</section><section className="work-panel"><PanelHeader title="决策关口" action="添加关口" onAction={() => onCreate('workflowGates', { workflowVersionId: activeRun.workflowVersionId })} />{gates.length ? gates.map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />) : <p className="empty-copy">可定义 Continue、Adjust、Stop、Escalate；真实判断可关联既有决策。</p>}</section><section className="work-panel"><PanelHeader title="评分与改进" action="创建改进提案" onAction={() => onCreate('workflowImprovementProposals', { title: `${titleFor(project)} · 工作链改进`, workflowId: activeRun.workflowId, sourceWorkflowVersionId: activeRun.workflowVersionId, sourceWorkflowRunId: activeRun.id, status: 'DRAFT' })} /><div className="scorecard-mini"><span>结果 / 已核验 <b>{scorecard.resultCount} / {scorecard.verifiedResultCount}</b></span><span>证据强度 <b>{scorecard.confidence}</b></span><span>Guardrail <b>{scorecard.guardrails.length ? `${scorecard.guardrails.filter((item) => item.state === 'PASS').length}/${scorecard.guardrails.length}` : '未定义'}</b></span><span>改进提案 <b>{improvements.length}</b></span></div>{comparison && <p className="empty-copy">与上次运行：时间 {comparison.timeDeltaMinutes >= 0 ? '+' : ''}{comparison.timeDeltaMinutes} 分钟，成本 {comparison.costDeltaMinor >= 0n ? '+' : ''}{formatMoneyMinor(comparison.costDeltaMinor)}，结果 {comparison.resultDelta >= 0 ? '+' : ''}{comparison.resultDelta}。{comparison.note}</p>}<p className="empty-copy">系统只展示多维证据与 Guardrail；Promote / Rollback 需要用户确认，不会自动认定最佳流程。</p>{improvements.slice(0, 3).map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />)}</section></div></> : <GuidedEmpty icon="⇢" title="项目尚未使用工作链" text="工作链不是强制功能。需要时选择一个模板创建运行，随后记录实际步骤、结果和复盘。" action={workflows.length ? '应用工作链' : '新建工作链'} onAction={() => workflows.length ? startRun(workflows[0]) : onCreate('workflows', { status: 'ACTIVE' })} />}</section>
}

function FinancialPulse({ records, onView }: { records: RecordData[]; onView: () => void }) {
  const economics = projectEconomics(records)
  return <div className="financial-pulse"><button onClick={onView}><span>现金净流动</span><strong>{economics.postedTransactions ? formatMoneyMinor(economics.cashNetMinor) : '未记录'}</strong></button><button onClick={onView}><span>已记录收入</span><strong>{economics.postedTransactions ? formatMoneyMinor(economics.incomeMinor) : '未记录'}</strong></button><button onClick={onView}><span>已记录支出</span><strong>{economics.postedTransactions ? formatMoneyMinor(economics.expenseMinor) : '未记录'}</strong></button><button onClick={onView}><span>决策数据覆盖</span><strong>{economics.dataCoverage}%</strong><small>不是决策正确率</small></button></div>
}

function OutcomesView({ records, onOpen, onCreate }: { records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void }) {
  const [tab, setTab] = useState<'overview' | 'results' | 'assets' | 'packages'>('overview')
  const outcomes = records.filter((record) => record.entity === 'results')
  const assets = records.filter((record) => record.entity === 'deliverables')
  const packages = records.filter((record) => record.entity === 'resultPackages')
  const achieved = outcomes.filter((record) => ['ACHIEVED', 'SUCCESS'].includes(String(record.status))).length
  const verified = outcomes.filter((record) => record.evidenceStatus === 'VERIFIED').length
  const createResult = () => onCreate('results', { status: 'PLANNED', outcomeType: 'QUANTITATIVE', metricKind: 'NUMBER', evidenceStatus: 'RECORDED', currency: 'CNY', date: today() })
  return <div className="outcomes-page results-center"><section className="section-intro"><span>✓</span><div><p className="eyebrow">JASON OS · RESULTS CENTER</p><h2>成果中心</h2><p>正式结果、正式成果资产与成果包；资产只关联 Notebook 文件，不复制原文件。</p></div><div className="results-center-actions"><button className="button" onClick={() => onCreate('deliverables', { status: 'DRAFT', assetType: 'OTHER', versionNumber: 'v1' })}>＋ 添加成果</button><button className="button" onClick={() => onCreate('resultPackages', { status: 'ACTIVE' })}>＋ 创建成果包</button><button className="button primary" onClick={createResult}>＋ 新建结果</button></div></section><div className="metric-strip four"><Metric label="全部结果" value={`${outcomes.length}`} /><Metric label="已达成" value={`${achieved}`} /><Metric label="正式资产" value={`${assets.filter((item) => item.status === 'FINAL').length}`} /><Metric label="成果包" value={`${packages.length}`} hint={`${verified} 条结果已核验`} /></div><nav className="external-tabs results-tabs">{([['overview', '总览'], ['results', '结果'], ['assets', '成果资产'], ['packages', '成果包']] as const).map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {tab === 'overview' && <div className="results-overview"><section className="work-panel"><PanelHeader title="近期成果" action="查看全部结果" onAction={() => setTab('results')} />{outcomes.slice(0, 5).map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />)}{!outcomes.length && <GuidedEmpty icon="✓" title="尚无正式结果" text="结果是事实，允许失败、部分达成和被证伪。" action="新建结果" onAction={createResult} />}</section><section className="work-panel"><PanelHeader title="最新 Final 成果" action="查看资产" onAction={() => setTab('assets')} />{assets.filter((item) => item.status === 'FINAL').slice(0, 5).map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />)}{!assets.some((item) => item.status === 'FINAL') && <p className="empty-copy">从 Notebook 中选择已经形成正式价值的文件，创建成果资产关联；不会复制文件。</p>}</section><section className="work-panel"><PanelHeader title="最近失败或失效结果" />{outcomes.filter((item) => ['FAILED', 'INVALIDATED', 'MISSED'].includes(String(item.status))).slice(0, 5).map((record) => <CompactRecord key={record.id} record={record} onOpen={onOpen} />)}{!outcomes.some((item) => ['FAILED', 'INVALIDATED', 'MISSED'].includes(String(item.status))) && <p className="empty-copy">失败成果会被保留，避免未来重复已验证过的错误。</p>}</section></div>}
    {tab === 'results' && (outcomes.length ? <div className="outcome-grid">{outcomes.map((outcome) => <article key={outcome.id} onClick={() => onOpen(outcome)}><header><span>{String(outcome.outcomeType || 'QUALITATIVE')}</span><b>{statusLabel(outcome.status)}</b></header><h3>{titleFor(outcome)}</h3><p>{String(outcome.summary || descriptionFor(outcome) || outcome.actual || outcome.expected || '尚未记录实际结果。')}</p><div><span>预期<strong>{outcome.metricKind === 'MONEY' ? outcome.targetAmountMinor ? formatMoneyMinor(String(outcome.targetAmountMinor), String(outcome.currency || 'CNY')) : '未记录' : String(outcome.targetValue || outcome.expected || '未记录')}</strong></span><span>实际<strong>{outcome.actualAmountMinor || outcome.actualValue || outcome.actual ? outcome.metricKind === 'MONEY' ? formatMoneyMinor(String(outcome.actualAmountMinor || '0'), String(outcome.currency || 'CNY')) : String(outcome.actualValue || outcome.actual) : '未记录'}</strong></span><span>证据<strong>{statusLabel(outcome.evidenceStatus)}</strong></span></div></article>)}</div> : <GuidedEmpty icon="✓" title="还没有结果" text="结果可以不关联文件，也可以关联项目或独立决策。" action="创建第一个结果" onAction={createResult} />)}
    {tab === 'assets' && (assets.length ? <div className="result-asset-grid">{assets.map((asset) => <article key={asset.id} onClick={() => onOpen(asset)}><header><span>{String(asset.assetType || 'OTHER')}</span><b>{statusLabel(asset.status)}</b></header><h3>{titleFor(asset)}</h3><p>{String(asset.summary || '尚未补充说明。')}</p><footer><span>{asset.fileId ? '已关联 Notebook 文件' : '待关联文件'}</span><span>{String(asset.versionNumber || 'v1')}</span></footer></article>)}</div> : <GuidedEmpty icon="▣" title="还没有成果资产" text="从 Notebook 文件中选择正式输出并建立关系；同一文件只保存一次。" action="添加成果" onAction={() => onCreate('deliverables', { status: 'DRAFT', assetType: 'OTHER', versionNumber: 'v1' })} />)}
    {tab === 'packages' && (packages.length ? <div className="result-package-grid">{packages.map((item) => <article key={item.id} onClick={() => onOpen(item)}><header><span>{statusLabel(item.status)}</span><small>{relationName(item.projectId, records) || '独立成果包'}</small></header><h3>{titleFor(item)}</h3><p>{String(item.summary || '聚合结果、正式资产、决策、复盘与工作链运行。')}</p><footer>{Array.isArray(item.resultIds) ? item.resultIds.length : String(item.resultIds || '').split(',').filter(Boolean).length} 个结果 · {Array.isArray(item.deliverableIds) ? item.deliverableIds.length : String(item.deliverableIds || '').split(',').filter(Boolean).length} 个资产</footer></article>)}</div> : <GuidedEmpty icon="▰" title="还没有成果包" text="成果包只是关联聚合对象，不会创建新的文件夹或复制文件。" action="创建成果包" onAction={() => onCreate('resultPackages', { status: 'ACTIVE' })} />)}</div>
}

function FinanceView({ records, onOpen, onCreate }: { records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void }) {
  const [tab, setTab] = useState<'overview' | 'transactions' | 'accounts' | 'categories'>('overview')
  const accounts = records.filter((record) => record.entity === 'financialAccounts')
  const transactions = records.filter((record) => record.entity === 'financialTransactions')
  const categories = records.filter((record) => record.entity === 'financialCategories')
  const economics = projectEconomics(records)
  const createTransaction = () => onCreate('financialTransactions', { status: 'POSTED', transactionType: 'EXPENSE', currency: 'CNY', baseCurrency: 'CNY', occurredAt: nowInput(), evidenceStatus: 'RECORDED' })
  return <div className="finance-page"><section className="finance-hero"><div><span>JASON OS · RESOURCE LAYER</span><h2>Financial Intelligence</h2><p>记录资金事实，并把 Time + Money + Outcome 转化为 CEO 决策证据。现金净流动与经营贡献不等于会计利润。</p></div><button className="button primary" onClick={createTransaction}>＋ 记录流水</button></section><div className="metric-strip four"><Metric label="现金净流动" value={economics.postedTransactions ? formatMoneyMinor(economics.cashNetMinor) : '未记录'} /><Metric label="已记录收入" value={economics.postedTransactions ? formatMoneyMinor(economics.incomeMinor) : '未记录'} /><Metric label="已记录支出" value={economics.postedTransactions ? formatMoneyMinor(economics.expenseMinor) : '未记录'} /><Metric label="数据覆盖" value={`${economics.dataCoverage}%`} hint="缺失数据不会按 0 处理" /></div><nav className="external-tabs finance-tabs">{([['overview','总览'],['transactions','流水'],['accounts','账户'],['categories','分类']] as const).map(([key,label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {tab === 'overview' && <div className="finance-overview"><section className="work-panel"><PanelHeader title="CEO 资源事实" /><div className="decision-evidence-grid"><span><small>经营贡献</small><strong>{economics.postedTransactions ? formatMoneyMinor(economics.managementContributionMinor) : '未记录'}</strong></span><span><small>投入时间</small><strong>{economics.timeMinutes ? formatMinutes(economics.timeMinutes) : '未记录'}</strong></span><span><small>单位时间经营贡献</small><strong>{economics.unitTimeContributionMinor !== undefined ? `${formatMoneyMinor(economics.unitTimeContributionMinor)}/h` : '数据不足'}</strong></span><span><small>已核验 Outcome</small><strong>{economics.verifiedOutcomeCount}/{economics.outcomeCount}</strong></span></div><p className="finance-disclaimer">经营贡献基于已记录并入账的管理口径，不是会计利润；库存、预付及未分配成本需要单独核验。</p></section><section className="work-panel"><PanelHeader title="账户与数据完整度" action="创建账户" onAction={() => onCreate('financialAccounts', { currency: 'CNY', status: 'ACTIVE', evidenceStatus: 'RECORDED' })} />{accounts.length ? accounts.map((account) => <button className="finance-account-row" key={account.id} onClick={() => onOpen(account)}><div><strong>{titleFor(account)}</strong><small>{String(account.currency || 'CNY')} · {statusLabel(account.evidenceStatus)}</small></div><b>{formatMoneyMinor(accountBalanceMinor(records, account.id), String(account.currency || 'CNY'))}</b></button>) : <p className="empty-copy">尚未建立账户，因此现金余额不可判断。不要把未记录误认为 0。</p>}</section></div>}
    {tab === 'transactions' && <section className="work-panel"><PanelHeader title="财务流水" action="记录流水" onAction={createTransaction} />{transactions.length ? <div className="finance-transaction-list">{transactions.map((transaction) => <button key={transaction.id} onClick={() => onOpen(transaction)}><span className={`finance-direction ${String(transaction.transactionType).toLowerCase()}`}>{transaction.transactionType === 'INCOME' ? '＋' : transaction.transactionType === 'EXPENSE' ? '－' : '⇄'}</span><div><strong>{titleFor(transaction)}</strong><small>{formatDate(transaction.occurredAt, true)} · {relationName(transaction.projectId, records) || '未关联项目'} · {statusLabel(transaction.status)}</small></div><b>{formatMoneyMinor(String(transaction.amountMinor || '0'), String(transaction.currency || 'CNY'))}</b></button>)}</div> : <GuidedEmpty icon="¥" title="还没有财务事实" text="先记录一笔真实收入或支出。转账不会被算作收入或支出。" action="记录第一笔流水" onAction={createTransaction} />}</section>}
    {tab === 'accounts' && <section className="work-panel"><PanelHeader title="资金账户" action="创建账户" onAction={() => onCreate('financialAccounts', { currency: 'CNY', status: 'ACTIVE', evidenceStatus: 'RECORDED' })} />{accounts.length ? <div className="account-grid">{accounts.map((account) => <article key={account.id} onClick={() => onOpen(account)}><span>{String(account.accountType || 'OTHER')}</span><h3>{titleFor(account)}</h3><strong>{formatMoneyMinor(accountBalanceMinor(records, account.id), String(account.currency || 'CNY'))}</strong><small>{statusLabel(account.evidenceStatus)} · {account.verifiedAt ? formatDate(account.verifiedAt, true) : '尚未余额核验'}</small></article>)}</div> : <GuidedEmpty icon="◉" title="账户是现金事实的入口" text="创建银行卡、现金、PayPal 或平台钱包；当前余额只由期初余额与已入账流水计算。" action="创建账户" onAction={() => onCreate('financialAccounts', { currency: 'CNY', status: 'ACTIVE', evidenceStatus: 'RECORDED' })} />}</section>}
    {tab === 'categories' && <section className="work-panel"><PanelHeader title="经营分类" action="创建分类" onAction={() => onCreate('financialCategories', { direction: 'EXPENSE', status: 'ACTIVE' })} />{categories.length ? <div className="category-list">{categories.map((category) => <button key={category.id} onClick={() => onOpen(category)}><strong>{titleFor(category)}</strong><span>{String(category.direction || 'BOTH')}</span></button>)}</div> : <GuidedEmpty icon="≡" title="分类只服务经营判断" text="从广告、软件、采购、物流、产品收入等少量分类开始，不建立复杂会计科目。" action="创建分类" onAction={() => onCreate('financialCategories', { direction: 'EXPENSE', status: 'ACTIVE' })} />}</section>}
  </div>
}

function DecisionEvidencePacket({ project, records, onCreate }: { project: RecordData; records: RecordData[]; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void }) {
  const economics = projectEconomics(records, project.id)
  const outcomes = records.filter((record) => record.entity === 'results' && linkedTo(record, project.id))
  return <section className="decision-evidence"><header><div><span>CEO DECISION EVIDENCE</span><h3>投入、结果与数据缺口</h3></div><button onClick={() => onCreate('decisions', { title: `决策：${titleFor(project)}`, projectId: project.id, goalId: project.goalId, decisionLevel: 'MATERIAL', date: today(), status: 'pending', reviewDueDate: project.targetDate, knownUnknowns: economics.dataCoverage < 100 ? '部分财务、时间或 Outcome 尚未完整核验。' : '' })}>基于证据创建决策 →</button></header><div className="decision-evidence-grid"><span><small>资金投入</small><strong>{economics.postedTransactions ? formatMoneyMinor(economics.expenseMinor) : '未记录'}</strong></span><span><small>经营贡献</small><strong>{economics.postedTransactions ? formatMoneyMinor(economics.managementContributionMinor) : '未记录'}</strong></span><span><small>时间投入</small><strong>{economics.timeMinutes ? formatMinutes(economics.timeMinutes) : '未记录'}</strong></span><span><small>Outcome</small><strong>{outcomes.length}</strong></span><span><small>已核验证据</small><strong>{economics.verifiedOutcomeCount}</strong></span><span><small>数据覆盖</small><strong>{economics.dataCoverage}%</strong></span></div><p>{economics.dataCoverage < 100 ? '数据仍不完整。系统不会把未记录金额解释为 0，也不会把当前经营贡献称为会计利润。' : '基础决策证据已具备，仍需 CEO 判断战略价值、可逆性与机会成本。'}</p></section>
}

function DecisionWorkspace({ analysis, question, onOpen, onSaveDecision, decisionModelIds, onAddModel }: { analysis: DecisionAnalysis; question: string; onOpen: (record: RecordData) => void; onSaveDecision: (question: string, analysis: DecisionAnalysis, ceoDecision?: string) => Promise<void>; decisionModelIds: string[]; onAddModel: (id: string) => void }) {
  const { classification, lens, models, frameworks, principles, assumptions, supportingCase, counterCase, biases, tensions, opportunityCost, informationGaps, minimumValidation, options, recommendation, confidence } = analysis
  const [ceoChoice, setCeoChoice] = useState('')
  return <div className="decision-workspace">
    <section className="work-panel decision-classification"><header><div><span>DECISION ENGINE</span><h3>决策分析结果</h3></div><button className="button primary" onClick={() => void onSaveDecision(question, analysis)}>保存为决策草案</button></header>
      <div className="decision-meta"><span>{classification.decisionTypeLabel}</span><span>影响 {impactLabel(classification.impact)}</span><span>紧急 {urgencyLabel(classification.urgency)}</span><span>{reversibilityLabel(classification.reversibility)}</span><span>信心 {confidence}%</span></div>
      <div className="decision-reason-list">{classification.reasons.map((reason) => <small key={reason}>· {reason}</small>)}</div>
    </section>
    <section className="work-panel decision-lens-row"><div><span>DECISION LENS</span><h4>{lens ? titleFor(lens) : '未匹配视角'}</h4><p>{lens ? String(lens.description || lens.focus || '') : ''}</p></div><div><span>FRAMEWORKS</span><div className="pill-row">{frameworks.map((item) => <button key={item.id} onClick={() => onOpen(item)}>{titleFor(item)}</button>)}</div></div></section>
    <section className="work-panel decision-models-panel"><header><div><span>PRIMARY MODELS</span><h4>本次调用的模型</h4></div><small>系统已从模型库筛选 3～5 个，不需要浏览全部模型</small></header><div className="recommendation-grid">{models.map(({ model, reasons }: ModelRecommendation) => <article key={model.id} onClick={() => onOpen(model)}><header><strong>{titleFor(model)}</strong></header><small>{modelCategoryLabel(model)} · {modelSourcePerson(model)}</small><p>{reasons[0]}</p><button onClick={(event) => { event.stopPropagation(); onAddModel(model.id) }}>{decisionModelIds.includes(model.id) ? '已加入模型池' : '加入模型池'}</button></article>)}</div></section>
    <section className="work-panel decision-two-col"><div><h4>关键假设（Assumptions）</h4>{assumptions.map((item) => <p key={item}>· {item}</p>)}</div><div><h4>支持路径（Supporting Case）</h4>{supportingCase.map((item) => <p key={item}>{item}</p>)}</div><div><h4>反向挑战（Counter Case）</h4>{counterCase.map((item) => <p key={item}>{item}</p>)}</div></section>
    <section className="work-panel decision-bias-row"><header><h4>认知偏差检查</h4></header>{biases.map((bias) => <div className="decision-bias" key={bias.bias}><strong>{bias.bias}<i className={`sev-${bias.severity}`}>{bias.severity}</i></strong><p>{bias.recommendation}</p></div>)}</section>
    <section className="work-panel decision-tension-row"><header><h4>决策张力（Model Tension）</h4></header>{tensions.map((tension) => <div className="decision-tension" key={tension.left}><span>{tension.left} ↔ {tension.right}</span><p>{tension.note}</p></div>)}</section>
    <section className="work-panel decision-gaps"><div><h4>机会成本</h4><p>{opportunityCost}</p></div><div><h4>信息缺口</h4>{informationGaps.map((gap) => <p key={gap}>· {gap}</p>)}</div><div><h4>最小验证</h4><p>{minimumValidation}</p></div></section>
    <section className="work-panel decision-options"><header><h4>备选方案</h4></header>{options.map((option) => <div className="decision-option" key={option}>{option}</div>)}</section>
    <section className="work-panel decision-recommendation"><header><h4>Recommendation（建议，不等于决定）</h4><b>{confidence}% 信心</b></header><p>{recommendation}</p><small>先选择 CEO 的最终动作，再保存；不选择也可以先保存为待决定草案。</small></section>
    <section className="work-panel ceo-decision-gate"><header><h4>CEO 最终决定</h4><small>AI 不替 CEO 决定</small></header><div className="ceo-choice-row">{['执行 Option A', '先做 Option B 验证', '暂缓 Option C', '不做 Do Nothing'].map((choice) => <button key={choice} className={ceoChoice === choice ? 'active' : ''} onClick={() => setCeoChoice(choice)}>{choice}</button>)}</div><button className="button primary" disabled={!ceoChoice} onClick={() => void onSaveDecision(question, { ...analysis, recommendation: `${recommendation} CEO 最终选择：${ceoChoice}` }, ceoChoice)}>{ceoChoice ? '保存 CEO 决定并进入执行' : '先选择一个最终动作'}</button></section>
    <section className="work-panel decision-principles"><header><h4>CEO 决策原则</h4><small>{principles.length} 条</small></header><div className="pill-row">{principles.map((item) => <button key={item.id} onClick={() => onOpen(item)}>{titleFor(item)}</button>)}</div></section>
  </div>
}

function MentalModelsView({ records, onOpen, onCreate, onSaveDecision, decisionModelIds, onAddModel, onRemoveModel }: { records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void; onSaveDecision: (question: string, analysis: DecisionAnalysis) => Promise<void>; decisionModelIds: string[]; onAddModel: (id: string) => void; onRemoveModel: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sourcePerson, setSourcePerson] = useState('all')
  const [decisionQuestion, setDecisionQuestion] = useState('')
  const [analysis, setAnalysis] = useState<DecisionAnalysis | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const models = records.filter((record) => record.entity === 'mentalModels' && record.status !== 'archived')
  const people = [...new Set(models.map(modelSourcePerson).filter((value) => value !== '未记录'))].sort()
  const filtered = models.filter((model) => {
    const haystack = [model.name, model.definition, model.coreIdea, model.corePrinciple, model.applicationScenarios, model.useCases, model.triggerConditions, model.trigger, model.tags, modelSourcePerson(model)].filter(Boolean).join(' ').toLowerCase()
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (category === 'all' || String(model.categoryId || '') === category) && (sourcePerson === 'all' || modelSourcePerson(model) === sourcePerson)
  })
  const decisionModels = decisionModelIds.map((id) => models.find((model) => model.id === id)).filter(Boolean) as RecordData[]
  const analyze = () => { const question = decisionQuestion.trim(); if (!question) return; setAnalysis(runDecisionEngine(question, records)) }
  return <div className="mental-model-engine">
    <section className="section-intro mental-model-hero"><span>◇</span><div><h2>CEO 决策工作台</h2><p>先输入一个真实决策问题，系统只调用最相关的认知资产；模型库只作为后台资产，不再干扰决策。</p></div><button className="button" onClick={() => onCreate('mentalModels')}>＋ 新建模型</button></section>
    <section className="work-panel decision-question-box decision-entry-box"><label><span>第一步：输入当前 CEO 决策问题</span><textarea value={decisionQuestion} onChange={(event) => { setDecisionQuestion(event.target.value); setAnalysis(null) }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') analyze() }} placeholder="例如：我要不要投入100万元做一个新的跨境电商项目？" /><small>只分析重要问题；普通日常问题不要进入完整决策流程。⌘/Ctrl + Enter 开始分析</small></label><button className="button primary decision-start-button" onClick={analyze}>开始决策分析 →</button></section>
    {analysis && <DecisionWorkspace analysis={analysis} question={decisionQuestion.trim()} onOpen={onOpen} onSaveDecision={onSaveDecision} decisionModelIds={decisionModelIds} onAddModel={onAddModel} />}
    <section className="work-panel decision-model-stack"><header><div><span>SELECTED MODEL STACK</span><h3>手动加入的模型池</h3></div><div className="decision-stack-actions"><small>{decisionModels.length} 个模型</small>{decisionModels.length > 0 && <button onClick={() => onCreate('decisions', { date: today(), status: 'pending', mentalModelIds: decisionModelIds })}>创建空白决策</button>}</div></header>{decisionModels.length ? <div className="model-stack-list">{decisionModels.map((model) => <span key={model.id}>{titleFor(model)}<button onClick={() => onRemoveModel(model.id)}>×</button></span>)}</div> : <p>分析结果会自动选择模型；只有需要手动干预时，才从下面的认知资产库加入模型。</p>}</section>
    <section className="work-panel mental-model-library-toggle"><div><span>COGNITIVE ASSET LIBRARY</span><h3>认知资产库</h3><small>{models.length} 条资产默认收起；决策时由系统按问题调用，不要求 CEO 浏览全部。</small></div><button className="button" onClick={() => setLibraryOpen((value) => !value)}>{libraryOpen ? '收起模型库' : `展开模型库（${models.length}）`}</button></section>
    {libraryOpen && <><section className="work-panel mental-model-toolbar model-library-toolbar"><header><div><span>COGNITIVE ASSET LIBRARY</span><h3>搜索与筛选</h3></div><small>{filtered.length} / {models.length} 个思维模型</small></header><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按名称、定义、场景、标签或来源搜索…" /><div className="mental-model-filters"><div className="segmented">{mentalModelCategories.map((item) => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div><select value={sourcePerson} onChange={(event) => setSourcePerson(event.target.value)}><option value="all">全部来源人物</option>{people.map((person) => <option key={person} value={person}>{person}</option>)}</select></div></section><section className="model-list-section"><header><h3>思维模型资产 <small>按需调用</small></h3></header>{filtered.length ? <div className="mental-model-grid">{filtered.map((model) => <article key={model.id} onClick={() => onOpen(model)}><header><span>{modelCategoryLabel(model)}</span><b>{modelSourcePerson(model)}</b></header><h3>{titleFor(model)}</h3><p>{modelDefinition(model)}</p><footer><span>触发：{modelTrigger(model)}</span><button onClick={(event) => { event.stopPropagation(); onAddModel(model.id) }}>{decisionModelIds.includes(model.id) ? '✓ 已加入' : '＋ 加入模型池'}</button></footer></article>)}</div> : <GuidedEmpty icon="◇" title="还没有匹配的思维模型" text="可以调整搜索、分类或来源人物筛选。" action="创建思维模型" onAction={() => onCreate('mentalModels')} />}</section></>}
  </div>
}

const noteTypeLabel = (value: unknown) => ({ NOTE: '笔记', IDEA: '想法', JOURNAL: '日记', OBSERVATION: '观察', LEARNING: '学习', DRAFT: '草稿' }[String(value || 'NOTE')] || '笔记')
const fileIcon = (record: RecordData) => {
  const extension = String(record.extension || '').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'heic'].includes(extension)) return '▧'
  if (['pdf'].includes(extension)) return '▣'
  if (['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(extension)) return '▶'
  if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(extension)) return '♪'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return '▤'
  return '⊞'
}

function NotebookView({ records, externalItems, captureConfig, onOpen, onRefresh, onNotice, onAi }: { records: RecordData[]; externalItems: ExternalItem[]; captureConfig: CaptureProviderConfig | null; onOpen: (record: RecordData) => void; onRefresh: () => Promise<void>; onNotice: (text: string, tone?: Notice['tone']) => void; onAi: (question: string, context: Partial<AgentContext>) => void }) {
  const [workspaceMode, setWorkspaceMode] = useState<'capture' | 'research'>('capture')
  const notebookPanes = useThreePaneResize('jason-os-notebook-pane-sizes', { left: 250, right: 500 })
  const [scope, setScope] = useState<'inbox' | 'all' | 'favorites' | 'archive' | string>('inbox')
  const [folderId, setFolderId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [archived, setArchived] = useState<RecordData[]>([])
  const [uploading, setUploading] = useState(false)
  const [relationTarget, setRelationTarget] = useState('')
  const [related, setRelated] = useState<RecordData[]>([])
  const [preview, setPreview] = useState<NotebookFilePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [pdfPage, setPdfPage] = useState(0)
  const [movePickerOpen, setMovePickerOpen] = useState(false)
  const [moveCategoryId, setMoveCategoryId] = useState('')
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [categoryDraft, setCategoryDraft] = useState('')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [captureDraft, setCaptureDraft] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [sortMode, setSortMode] = useState<'recent' | 'oldest' | 'title'>('recent')
  const [tagFilter, setTagFilter] = useState('')
  const [editorFullscreen, setEditorFullscreen] = useState(false)
  const [linkComposerOpen, setLinkComposerOpen] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [linkSaving, setLinkSaving] = useState(false)
  const [deleteIds, setDeleteIds] = useState<string[]>([])
  const [deletingItems, setDeletingItems] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { api.archived().then((items) => setArchived(items.filter((record) => ['notes', 'notebookFiles', 'notebookFolders', 'inbox'].includes(record.entity)))) }, [records])
  const categories = records.filter((record) => record.entity === 'notebookCategories')
  const folders = records.filter((record) => record.entity === 'notebookFolders')
  const activeItems = records.filter((record) => ['notes', 'notebookFiles', 'notebookFolders', 'inbox'].includes(record.entity))
  const createdWithinDays = (record: RecordData, days: number) => Date.now() - new Date(String(record.createdAt || record.updatedAt || 0)).getTime() <= days * 86400000
  const matchesScope = (record: RecordData) => {
    if (scope === 'notes') return record.entity === 'notes'
    if (scope === 'links') return record.entity === 'inbox' || Boolean(record.url || record.sourceUrl)
    if (scope === 'files') return record.entity === 'notebookFiles'
    if (scope === 'today') return String(record.createdAt || record.updatedAt || '').slice(0, 10) === today()
    if (scope === 'week') return createdWithinDays(record, 7)
    if (scope === 'attachments') return record.entity === 'notebookFiles' || Boolean(record.attachments)
    if (scope === 'later') return ['LATER', 'SNOOZED'].includes(String(record.status || '').toUpperCase()) || Boolean(record.snoozedUntil)
    if (scope === 'inbox') return record.entity === 'inbox' || (!record.notebookCategoryId && !record.notebookFolderId && (record.entity !== 'notes' || record.status === 'INBOX'))
    return true
  }
  const selectableItems = scope === 'archive' ? archived : activeItems.filter(matchesScope)
  const selected = selectedId === '__closed__' ? undefined : selectableItems.find((record) => record.id === selectedId) || selectableItems[0]
  const selectedRelationId = selected?.id || ''
  useEffect(() => { if (selectedRelationId) api.relations(selectedRelationId).then(setRelated); else setRelated([]) }, [selectedRelationId])
  const selectedFileId = selected?.entity === 'notebookFiles' ? selected.id : ''
  useEffect(() => {
    if (!selectedFileId) { setPreview(null); return }
    let cancelled = false; setPdfPage(0); setPreviewLoading(true); setPreview(null)
    api.previewNotebookFile(selectedFileId).then((value) => { if (!cancelled) setPreview(value) }).catch((error) => { if (!cancelled) setPreview({ kind: 'unsupported', reason: String(error) }) }).finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [selectedFileId])
  const currentCategoryId = categories.some((category) => category.id === scope) ? scope : ''
  const visibleFolders = folders.filter((folder) => (currentCategoryId ? folder.notebookCategoryId === currentCategoryId : scope === 'all' || scope === 'inbox' ? !folder.notebookCategoryId : false) && String(folder.parentNotebookFolderId || '') === folderId)
  const source = scope === 'archive' ? archived : selectableItems.filter((record) => {
    if (record.entity === 'notebookFolders') return visibleFolders.some((folder) => folder.id === record.id)
    if (['notes', 'links', 'files', 'today', 'week', 'attachments', 'later'].includes(scope)) return true
    if (scope === 'favorites' && String(record.favorite) !== 'true') return false
    if (scope === 'inbox' && record.entity === 'notes') return record.status === 'INBOX' && !record.notebookCategoryId && !record.notebookFolderId
    if (scope === 'inbox') return !record.notebookCategoryId && !record.notebookFolderId
    if (currentCategoryId && record.notebookCategoryId !== currentCategoryId) return false
    if (folderId && record.notebookFolderId !== folderId) return false
    if (!folderId && record.notebookFolderId) return false
    return true
  })
  const noteTags = [...new Set(activeItems.filter((record) => record.entity === 'notes').flatMap(tagsFor))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const filtered = [...source.filter((record) => !tagFilter || tagsFor(record).includes(tagFilter))].sort((a, b) => sortMode === 'title' ? titleFor(a).localeCompare(titleFor(b), 'zh-CN') : sortMode === 'oldest' ? String(a.createdAt || a.updatedAt || '').localeCompare(String(b.createdAt || b.updatedAt || '')) : String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
  const relationEntities: Entity[] = ['goals', 'projects', 'tasks', 'knowledge', 'insights', 'mentalModels', 'decisions', 'reviews', 'timeLogs', 'financialTransactions']
  const relationTargets = records.filter((record) => relationEntities.includes(record.entity))
  const relationSources = selectedIds.length ? selectedIds : selected ? [selected.id] : []
  const categoryMoveSources = (selectedIds.length ? selectedIds.map((id) => records.find((record) => record.id === id)) : selected ? [selected] : []).filter((record): record is RecordData => record !== undefined && ['notes', 'notebookFiles', 'inbox'].includes(record.entity))
  const captureIntoInbox = async () => {
    const content = captureDraft.trim(); if (!content) return
    try { const url = content.match(/https?:\/\/[^\s]+/)?.[0]; if (url) await api.captureLink(url); else await api.save('notes', { title: content.slice(0, 42), content, status: 'INBOX', type: 'NOTE' }); setCaptureDraft(''); await onRefresh(); onNotice('已收纳到未整理；不会自动关联项目、目标或任务。') }
    catch (error) { onNotice(`收纳失败：${String(error)}`, 'danger') }
  }
  const createManualNote = async () => {
    try {
      const created = await api.save('notes', { title: '未命名笔记', content: '', status: 'INBOX', type: 'NOTE' })
      setScope('inbox'); setFolderId(''); setSelectedId(created.id); await onRefresh(); onNotice('已新建空白笔记，可以直接记录。')
    } catch (error) { onNotice(`新建笔记失败：${String(error)}`, 'danger') }
  }
  const addManualLink = async () => {
    const input = linkDraft.trim()
    if (!input) return
    const url = /^https?:\/\//i.test(input) ? input : `https://${input}`
    try {
      new URL(url)
      setLinkSaving(true)
      const created = await api.save('inbox', { title: url, content: url, type: 'link', sourceUrl: url, canonicalUrl: url, captureStatus: 'manual_saved', captureProvider: 'manual' })
      setScope('links'); setFolderId(''); setSelectedId(created.id); setLinkDraft(''); setLinkComposerOpen(false); await onRefresh(); onNotice('链接已添加到收纳箱。')
    } catch (error) { onNotice(`添加链接失败：${String(error)}`, 'danger') }
    finally { setLinkSaving(false) }
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key.toLowerCase() !== 'm' || !event.metaKey || !event.shiftKey || target?.matches('input, textarea, select, [contenteditable="true"]') || !categoryMoveSources.length) return
      event.preventDefault(); setMoveCategoryId(''); setMovePickerOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedIds.length, selected?.id, categoryMoveSources.length])
  const toggleSelected = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const uploadFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setUploading(true)
    try {
      const folderCache = new Map<string, string>()
      const ensurePath = async (parts: string[]) => {
        let parent = folderId
        for (const part of parts.map((value) => value.trim()).filter(Boolean)) {
          const key = `${currentCategoryId}/${parent}/${part}`
          if (folderCache.has(key)) { parent = folderCache.get(key)!; continue }
          const existing = folders.find((item) => item.name === part && String(item.notebookCategoryId || '') === currentCategoryId && String(item.parentNotebookFolderId || '') === parent)
          if (existing) { parent = existing.id; folderCache.set(key, parent); continue }
          const created = await api.save('notebookFolders', { name: part, notebookCategoryId: currentCategoryId, parentNotebookFolderId: parent })
          parent = created.id; folderCache.set(key, parent)
        }
        return parent
      }
      for (const file of files) {
        const relativePath = String((file as File & { webkitRelativePath?: string }).webkitRelativePath || '')
        const pathParts = relativePath ? relativePath.split('/').slice(0, -1) : []
        const targetFolderId = pathParts.length ? await ensurePath(pathParts) : folderId
        await api.uploadNotebookFile({ file, notebookCategoryId: currentCategoryId, notebookFolderId: targetFolderId, relativePath })
      }
      onNotice(`已上传 ${files.length} 个文件；可搜索的内容已自动提取。`)
      await onRefresh()
    } catch (error) { onNotice(`上传失败：${String(error)}`, 'danger') }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }
  const addOptionalRelation = async () => {
    if (!relationTarget || !relationSources.length) return
    try { await Promise.all(relationSources.map((sourceId) => api.addRelation(sourceId, relationTarget, 'notebook:RELATED'))); setRelationTarget(''); if (selected) setRelated(await api.relations(selected.id)); onNotice(`已为 ${relationSources.length} 条 Notebook 内容建立可选关联。`) }
    catch (error) { onNotice(`关联失败：${String(error)}`, 'danger') }
  }
  const moveToCategory = async (categoryId: string) => {
    if (!categoryMoveSources.length) return
    try {
      await Promise.all(categoryMoveSources.map((record) => api.save(record.entity, { ...record, notebookCategoryId: categoryId || undefined, notebookFolderId: undefined })) )
      setMovePickerOpen(false); setSelectedIds([]); setScope(categoryId || 'inbox'); setFolderId(''); await onRefresh(); onNotice(`已将 ${categoryMoveSources.length} 项归类；不会自动关联 Jason OS 记录。`)
    } catch (error) { onNotice(`归类失败：${String(error)}`, 'danger') }
  }
  const assignCategory = async (record: RecordData, categoryId: string) => {
    try {
      await api.save(record.entity, { ...record, notebookCategoryId: categoryId || undefined, notebookFolderId: undefined })
      await onRefresh()
      onNotice(categoryId ? '已放入收纳箱分类；不会自动关联 Jason OS 记录。' : '已移出收纳箱分类。')
    } catch (error) { onNotice(`修改分类失败：${String(error)}`, 'danger') }
  }
  const createCategory = async () => {
    const name = categoryDraft.trim()
    if (!name) return
    try {
      setCreatingCategory(true)
      const created = await api.save('notebookCategories', { name })
      setCategoryDraft(''); setCategoryDialogOpen(false); await onRefresh(); setScope(created.id); setFolderId(''); onNotice('已创建收纳箱分类。')
    } catch (error) { onNotice(`创建分类失败：${String(error)}`, 'danger') }
    finally { setCreatingCategory(false) }
  }
  const archiveSelection = async () => { const ids = selectedIds.length ? selectedIds : selected ? [selected.id] : []; if (!ids.length) return; await Promise.all(ids.map((id) => api.archive(id))); setSelectedIds([]); setSelectedId(''); await onRefresh(); onNotice('已 Archive，原始文件仍可恢复。') }
  const requestDeleteSelection = (ids?: string[]) => {
    const targets = ids?.length ? ids : selectedIds.length ? selectedIds : selected ? [selected.id] : []
    if (targets.length) setDeleteIds(targets)
  }
  const deleteSelection = async () => {
    if (!deleteIds.length) return
    const count = deleteIds.length
    try { setDeletingItems(true); await Promise.all(deleteIds.map((id) => api.remove(id))); setDeleteIds([]); setSelectedIds([]); setSelectedId(''); await onRefresh(); onNotice(`已删除 ${count} 项。`) }
    catch (error) { onNotice(`删除失败：${String(error)}`, 'danger') }
    finally { setDeletingItems(false) }
  }
  const restoreSelection = async () => {
    const ids = selectedIds.length ? selectedIds : selected ? [selected.id] : []
    if (!ids.length) return
    try {
      await Promise.all(ids.map((id) => api.restore(id)))
      setSelectedIds([]); await onRefresh(); onNotice('已还原到原位置。')
    } catch (error) { onNotice(`还原失败：${String(error)}`, 'danger') }
  }
  const refreshExtractedContent = async () => { if (!selected || selected.entity !== 'notebookFiles') return; try { await api.extractNotebookFile(selected.id); await onRefresh(); onNotice('文件内容已重新提取并进入搜索索引。') } catch (error) { onNotice(`提取失败：${String(error)}`, 'danger') } }
  const copySelected = async () => { if (!selected || selected.entity !== 'notebookFiles') return; try { const copied = await api.copyNotebookFile(selected.id, currentCategoryId, folderId); await onRefresh(); setSelectedId(copied.id); onNotice('已创建文件副本。') } catch (error) { onNotice(`复制失败：${String(error)}`, 'danger') } }
  const openSelectedFile = async () => { if (!selected || selected.entity !== 'notebookFiles') return; try { await api.openNotebookFile(selected.id) } catch (error) { onNotice(String(error), 'danger') } }
  const revealSelectedFile = async () => { if (!selected || selected.entity !== 'notebookFiles') return; try { await api.revealNotebookFile(selected.id) } catch (error) { onNotice(String(error), 'danger') } }
  const askAiAboutFile = (mode: 'summary' | 'relations') => { if (!selected || selected.entity !== 'notebookFiles') return; onAi(mode === 'summary' ? `请只基于这份 Notebook 文件的已提取内容，给出结构化摘要、关键事实、待验证点与可沉淀的知识。不要修改任何内容。` : `请只基于这份 Notebook 文件的已提取内容和 Jason OS 现有记录，列出最多 5 个潜在关联及理由。不要创建关系；由用户决定是否关联。`, { currentRoute: 'notebook', currentEntityType: 'notebookFiles', currentEntityId: selected.id, selectedItems: [selected.id] }) }
  const changePdfPage = async (page: number) => {
    if (!selected || selected.entity !== 'notebookFiles') return
    try { setPreviewLoading(true); setPreview(await api.previewNotebookPdfPage(selected.id, page)); setPdfPage(page) }
    catch (error) { onNotice(`PDF 预览失败：${String(error)}`, 'danger') }
    finally { setPreviewLoading(false) }
  }
  const previewNode = !selected ? null : selected.entity === 'notes' ? <pre className="notebook-text-preview">{String(selected.content || '暂无正文。')}</pre> : selected.entity !== 'notebookFiles' ? <p>文件夹可包含 Note、File 与子文件夹。</p> : previewLoading ? <p>正在按需加载预览…</p> : preview?.kind === 'image' ? <img className="notebook-media-preview" src={preview.dataUrl} alt={titleFor(selected)} /> : preview?.kind === 'pdf' ? <><div className="notebook-pdf-toolbar"><span>PDF 阅读 · 第 {(preview.page ?? pdfPage) + 1} / {preview.pageCount || 1} 页</span><div><button disabled={(preview.page ?? pdfPage) <= 0} onClick={() => void changePdfPage((preview.page ?? pdfPage) - 1)}>上一页</button><button disabled={(preview.page ?? pdfPage) >= (preview.pageCount || 1) - 1} onClick={() => void changePdfPage((preview.page ?? pdfPage) + 1)}>下一页</button></div></div>{preview.dataUrl ? <img className="notebook-pdf-preview" src={preview.dataUrl} alt={`${titleFor(selected)} 第 ${(preview.page ?? pdfPage) + 1} 页`} /> : <p>此 PDF 页面暂时无法渲染，可阅读下方已提取文本。</p>}<pre className="notebook-text-preview">{preview.text}</pre></> : preview?.kind === 'audio' ? <audio controls src={preview.dataUrl} /> : preview?.kind === 'video' ? <video className="notebook-media-preview" controls src={preview.dataUrl} /> : preview?.kind === 'text' ? <pre className="notebook-text-preview">{preview.text || String(selected.extractionError || '没有可预览的文本。')}</pre> : <p>{preview?.reason || String(selected.extractionError || '此文件没有可用的内嵌预览。')}</p>
  if (workspaceMode === 'research') return <ResearchInboxView records={records} externalItems={externalItems} categories={categories} captureConfig={captureConfig} onBackToCapture={() => setWorkspaceMode('capture')} onRefresh={onRefresh} onNotice={onNotice} />
  return <div className="notebook-page notebook-space">
    <header className="notebook-page-title">
      <div><h2>收纳箱</h2><p>收集、整理并沉淀你的内容</p></div>
      <div className="research-mode-switch"><button className="active">收纳内容</button><button onClick={() => setWorkspaceMode('research')}>提出调研需求</button></div>
    </header>

    <section
      className="notebook-capture"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); void uploadFiles(event.dataTransfer.files) }}
    >
      <span className="notebook-capture-icon">⌁</span>
      <textarea
        value={captureDraft}
        onChange={(event) => setCaptureDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void captureIntoInbox() } }}
        placeholder="记录想法、粘贴链接，或拖入文件…"
        aria-label="快速记录"
      />
      <button className="notebook-attach-button" title="添加附件" disabled={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? '…' : '📎'}</button>
      <button className="button primary" disabled={!captureDraft.trim()} onClick={() => void captureIntoInbox()}>收纳</button>
      <input ref={fileInputRef} className="hidden-file-input" type="file" multiple onChange={(event) => void uploadFiles(event.currentTarget.files)} />
    </section>

    <div ref={notebookPanes.layoutRef} className="notebook-layout notebook-resizable-layout" style={notebookPanes.style}>
      <aside className="notebook-sidebar">
        <div className="notebook-filter-group">
          {[
            { id: 'inbox', icon: '▱', label: '未整理', count: activeItems.filter((item) => item.entity === 'inbox' || (!item.notebookCategoryId && !item.notebookFolderId && (item.entity !== 'notes' || item.status === 'INBOX'))).length },
            { id: 'notes', icon: '▤', label: '笔记', count: activeItems.filter((item) => item.entity === 'notes').length },
            { id: 'links', icon: '⌁', label: '链接', count: activeItems.filter((item) => item.entity === 'inbox' || Boolean(item.url || item.sourceUrl)).length },
            { id: 'files', icon: '□', label: '文件', count: activeItems.filter((item) => item.entity === 'notebookFiles').length },
          ].map((item) => <button key={item.id} className={scope === item.id ? 'active' : ''} onClick={() => { setScope(item.id); setFolderId(''); setSelectedId(''); setSelectedIds([]) }}><i>{item.icon}</i><strong>{item.label}</strong><span>{item.count}</span></button>)}
        </div>
        <div className="notebook-filter-group archive">
          <button className={scope === 'archive' ? 'active' : ''} onClick={() => { setScope('archive'); setFolderId(''); setSelectedId(''); setSelectedIds([]) }}><i>▱</i><strong>已归档</strong><span>{archived.length}</span></button>
        </div>
        <div className="notebook-category-filters"><button className={`notebook-category-trigger${currentCategoryId ? ' active' : ''}`} onClick={() => setCategoryMenuOpen(true)}><i>▦</i><strong>分类</strong><span>{categories.length}</span><b>⌄</b></button></div>
        <div className="notebook-smart-views">
          <header><span>✦</span><strong>智能视图</strong><b>⌄</b></header>
          {[
            { id: 'today', icon: '◉', label: '今天收集', count: activeItems.filter((item) => String(item.createdAt || item.updatedAt || '').slice(0, 10) === today()).length },
            { id: 'week', icon: '◷', label: '本周收集', count: activeItems.filter((item) => createdWithinDays(item, 7)).length },
            { id: 'attachments', icon: '⌕', label: '有附件', count: activeItems.filter((item) => item.entity === 'notebookFiles' || Boolean(item.attachments)).length },
            { id: 'later', icon: '◴', label: '稍后处理', count: activeItems.filter((item) => ['LATER', 'SNOOZED'].includes(String(item.status || '').toUpperCase()) || Boolean(item.snoozedUntil)).length },
          ].map((item) => <button key={item.id} className={scope === item.id ? 'active' : ''} onClick={() => { setScope(item.id); setFolderId(''); setSelectedId(''); setSelectedIds([]) }}><i>{item.icon}</i><strong>{item.label}</strong><span>{item.count}</span></button>)}
        </div>
        {noteTags.length > 0 && <div className="notebook-tag-filters"><header><span>◇</span><strong>标签</strong>{tagFilter && <button title="清除标签筛选" onClick={() => setTagFilter('')}>×</button>}</header><button className={!tagFilter ? 'active' : ''} onClick={() => { setTagFilter(''); setScope('notes'); setSelectedId('') }}>全部标签</button>{noteTags.map((tag) => <button key={tag} className={tagFilter === tag ? 'active' : ''} onClick={() => { setTagFilter(tag); setScope('notes'); setFolderId(''); setSelectedId(''); setSelectedIds([]) }}>#{tag}</button>)}</div>}
      </aside>
      <div className="notebook-pane-resizer" role="separator" title="拖动调整左侧栏宽度" aria-label="调整左侧栏宽度" aria-orientation="vertical" onPointerDown={notebookPanes.startResize('left')}><span aria-hidden="true">⋮</span></div>

      <section className="notebook-main">
        <div className="notebook-toolbar">
          <label className="notebook-select-all">
            <input
              type="checkbox"
              checked={filtered.length > 0 && filtered.every((record) => selectedIds.includes(record.id))}
              onChange={(event) => setSelectedIds(event.currentTarget.checked ? filtered.map((record) => record.id) : [])}
              aria-label="全选"
            />
          </label>
          <select
            aria-label="批量操作"
            value=""
            onChange={(event) => {
              const action = event.currentTarget.value
              if (action === 'archive') void archiveSelection()
              if (action === 'delete') requestDeleteSelection()
              if (action === 'restore') void restoreSelection()
              if (action === 'move') { setMoveCategoryId(''); setMovePickerOpen(true) }
            }}
          >
            <option value="">批量操作</option>
            {scope === 'archive' ? <option value="restore">恢复所选</option> : <option value="archive">归档所选</option>}
            {scope !== 'archive' && <option value="delete">删除所选</option>}
            {scope !== 'archive' && categoryMoveSources.length > 0 && <option value="move">归类所选</option>}
          </select>
          <span className="notebook-toolbar-divider" />
          <select aria-label="快速排序" value={sortMode} onChange={(event) => setSortMode(event.target.value as 'recent' | 'oldest' | 'title')}>
            <option value="recent">快速排序</option>
            <option value="oldest">最早创建</option>
            <option value="title">按标题</option>
          </select>
          <span className="notebook-toolbar-divider" />
          <div className="notebook-view-switch">
            <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title="列表视图">▤</button>
            <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title="网格视图">▦</button>
          </div>
        </div>

        {selectedIds.length > 0 && <div className="notebook-batch-bar"><span>已选择 {selectedIds.length} 项</span>{scope !== 'archive' && <button className="notebook-batch-delete" onClick={() => requestDeleteSelection()}>删除所选</button>}<button onClick={() => setSelectedIds([])}>取消选择</button></div>}
        {movePickerOpen && <section className="notebook-move-picker"><header><div><strong>归类到收纳箱分类</strong><small>分类只用于收纳箱整理，不会自动关联 Jason OS。</small></div><button onClick={() => setMovePickerOpen(false)}>×</button></header>{categories.length ? <div className="notebook-move-select-row"><label>目标分类<select value={moveCategoryId} onChange={(event) => setMoveCategoryId(event.target.value)}><option value="">选择分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{titleFor(category)}</option>)}</select></label><button className="button primary" disabled={!moveCategoryId} onClick={() => void moveToCategory(moveCategoryId)}>确认归类</button></div> : <p>请先通过左侧“分类”旁的 ＋ 新建一个分类。</p>}</section>}

        {filtered.length ? <div className={`notebook-content-list ${viewMode}`}>
          {filtered.map((record) => {
            const kind = record.entity === 'notes' ? '笔记' : record.entity === 'notebookFiles' ? String(record.extension || '文件').toUpperCase() : record.entity === 'notebookFolders' ? '文件夹' : '网页链接'
            const summary = record.entity === 'notes' ? String(record.content || '暂无正文。') : record.entity === 'notebookFiles' ? String(record.extractedContent || record.originalName || record.relativePath || '') : String(record.description || record.summary || record.url || record.sourceUrl || '打开查看内容')
            return <article key={record.id} className={selected?.id === record.id ? 'active' : ''} onClick={() => setSelectedId(record.id)} onDoubleClick={() => record.entity === 'notebookFolders' ? setFolderId(record.id) : onOpen(record)}>
              <input type="checkbox" checked={selectedIds.includes(record.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelected(record.id)} aria-label={'选择 ' + titleFor(record)} />
              <span className={`notebook-item-icon ${record.entity}`}>{record.entity === 'notebookFolders' ? '□' : record.entity === 'notebookFiles' ? fileIcon(record) : record.entity === 'inbox' ? '⌁' : '▤'}</span>
              <div className="notebook-item-copy">
                <header><strong>{titleFor(record)}</strong><time>{formatDate(record.updatedAt || record.createdAt)}</time></header>
                <small>{kind}{record.entity === 'inbox' && record.sourceUrl ? ' · ' + String(record.sourceUrl).replace(/^https?:\/\//, '').split('/')[0] : ''}</small>
                <p>{summary}</p>
              </div>
            </article>
          })}
        </div> : <GuidedEmpty icon="▤" title="这里还没有内容" text="记录想法、粘贴链接或添加文件，内容会先进入未整理。" action="新建笔记" onAction={() => void createManualNote()} />}
      </section>
      <div className="notebook-pane-resizer" role="separator" title="拖动调整右侧栏宽度" aria-label="调整右侧栏宽度" aria-orientation="vertical" onPointerDown={notebookPanes.startResize('right')}><span aria-hidden="true">⋮</span></div>

      <aside className={`notebook-preview ${selected?.entity === 'notes' ? 'note-preview' : 'detail-preview'}${editorFullscreen && selected?.entity === 'notes' ? ' fullscreen' : ''}`}>
        {selected?.entity === 'notes' ? <RichNotebookEditor note={selected} records={records} related={related} categories={categories} fullscreen={editorFullscreen} onOpen={onOpen} onCreateNote={() => void createManualNote()} onRefresh={onRefresh} onNotice={onNotice} onAi={onAi} onAssignCategory={assignCategory} onCreateCategory={() => { setCategoryDraft(''); setCategoryDialogOpen(true) }} onToggleFullscreen={() => setEditorFullscreen((current) => !current)} onClose={() => { setEditorFullscreen(false); setSelectedId('__closed__') }} onRelationsChanged={() => void api.relations(selected.id).then(setRelated)} /> : <>
          <header><strong>{scope === 'files' || selected?.entity === 'notebookFiles' ? '文件' : scope === 'links' || selected?.entity === 'inbox' ? '链接' : '详情'}</strong><div>{scope === 'links' && <button className="notebook-preview-add" onClick={() => { setLinkDraft(''); setLinkComposerOpen(true) }}>＋ 添加链接</button>}{scope === 'files' && <button className="notebook-preview-add" onClick={() => fileInputRef.current?.click()}>＋ 添加文件</button>}{selected && scope !== 'archive' && <button className="notebook-preview-delete" onClick={() => requestDeleteSelection([selected.id])}>删除</button>}{selected && <button title="关闭" onClick={() => setSelectedId('__closed__')}>×</button>}</div></header>
          {selected ? <>
            <div className="notebook-preview-card"><span>{selected.entity === 'notebookFiles' ? fileIcon(selected) : selected.entity === 'notebookFolders' ? '□' : '⌁'}</span><h3>{titleFor(selected)}</h3><p>{descriptionFor(selected) || String(selected.originalName || selected.relativePath || selected.url || selected.sourceUrl || '独立收纳内容')}</p><small>{selected.entity === 'notebookFiles' ? '文件' : selected.entity === 'notebookFolders' ? '文件夹' : '链接'} · {formatDate(selected.updatedAt || selected.createdAt)}</small></div>
            <section className="notebook-inline-preview">{previewNode}</section>
            {['notebookFiles', 'inbox'].includes(selected.entity) && <NotebookCategoryControl record={selected} categories={categories} onChange={assignCategory} onCreate={() => { setCategoryDraft(''); setCategoryDialogOpen(true) }} />}
            {selected.entity === 'notebookFiles' && <div className="notebook-file-actions"><button className="button" onClick={openSelectedFile}>在本机打开</button><button className="button" onClick={revealSelectedFile}>在 Finder 显示</button><button className="button" onClick={() => void copySelected()}>复制</button><button className="button" onClick={() => void refreshExtractedContent()}>重新提取</button><button className="button" onClick={() => askAiAboutFile('summary')}>AI 理解</button></div>}
            <section className="notebook-relation-box"><h4>关联 Jason OS <span>可选</span></h4><p>只有你确认后才会建立关联。</p><select value={relationTarget} onChange={(event) => setRelationTarget(event.target.value)}><option value="">选择要关联的对象</option>{relationTargets.map((target) => <option key={target.id} value={target.id}>{configFor(target.entity).label} · {titleFor(target)}</option>)}</select><button className="button primary" disabled={!relationTarget} onClick={() => void addOptionalRelation()}>确认关联</button></section>
            <footer>{scope === 'archive' ? <button className="button primary" onClick={() => void restoreSelection()}>恢复</button> : <button className="button" onClick={() => void archiveSelection()}>归档</button>}<button className="button" onClick={() => onOpen(selected)}>查看详情</button></footer>
          </> : <div className="notebook-empty-detail"><span>▤</span><strong>选择一条内容</strong><p>右侧会显示完整内容和可用操作。</p></div>}
        </>}
      </aside>
    </div>
    {linkComposerOpen && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setLinkComposerOpen(false)}><form className="notebook-action-dialog" onSubmit={(event) => { event.preventDefault(); void addManualLink() }}><header><div><p>手动添加</p><h3>添加链接</h3></div><button type="button" onClick={() => setLinkComposerOpen(false)}>×</button></header><label><span>链接地址</span><input autoFocus value={linkDraft} onChange={(event) => setLinkDraft(event.target.value)} placeholder="https://example.com" /></label><small>链接只会进入收纳箱，不会自动关联项目、目标或任务。</small><footer><button type="button" className="button ghost" onClick={() => setLinkComposerOpen(false)}>取消</button><button className="button primary" type="submit" disabled={!linkDraft.trim() || linkSaving}>{linkSaving ? '正在添加…' : '确认添加'}</button></footer></form></div>}
    {categoryMenuOpen && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCategoryMenuOpen(false)}><section className="notebook-action-dialog notebook-category-menu"><header><div><p>收纳箱整理</p><h3>分类选项</h3></div><button onClick={() => setCategoryMenuOpen(false)}>×</button></header>{categories.length ? <div className="notebook-category-option-list">{categories.map((category) => <button key={category.id} className={scope === category.id ? 'active' : ''} onClick={() => { setScope(category.id); setFolderId(''); setSelectedId(''); setSelectedIds([]); setCategoryMenuOpen(false) }}><span>{titleFor(category)}</span><b>{activeItems.filter((item) => ['notes', 'notebookFiles', 'inbox'].includes(item.entity) && item.notebookCategoryId === category.id).length}</b></button>)}</div> : <p className="notebook-category-empty">还没有分类，请先新建一个分类。</p>}<footer><button className="button" onClick={() => { setCategoryMenuOpen(false); setCategoryDraft(''); setCategoryDialogOpen(true) }}>＋ 新建分类</button></footer></section></div>}
    {categoryDialogOpen && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !creatingCategory && setCategoryDialogOpen(false)}><form className="notebook-action-dialog" onSubmit={(event) => { event.preventDefault(); void createCategory() }}><header><div><p>收纳箱整理</p><h3>新建分类</h3></div><button type="button" disabled={creatingCategory} onClick={() => setCategoryDialogOpen(false)}>×</button></header><label><span>分类名称</span><input autoFocus value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="例如：产品灵感、工作资料" /></label><small>分类只用于笔记、链接和文件的查找整理，不会关联 Jason OS 的项目、目标或任务。</small><footer><button type="button" className="button ghost" disabled={creatingCategory} onClick={() => setCategoryDialogOpen(false)}>取消</button><button className="button primary" type="submit" disabled={!categoryDraft.trim() || creatingCategory}>{creatingCategory ? '正在创建…' : '创建分类'}</button></footer></form></div>}
    {deleteIds.length > 0 && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !deletingItems && setDeleteIds([])}><section className="notebook-action-dialog danger"><header><div><p>删除内容</p><h3>确定删除选中的 {deleteIds.length} 项？</h3></div><button disabled={deletingItems} onClick={() => setDeleteIds([])}>×</button></header><small>笔记、文件和链接删除后不会进入已归档。只有你确认后才会执行。</small><footer><button className="button ghost" disabled={deletingItems} onClick={() => setDeleteIds([])}>取消</button><button className="button danger" disabled={deletingItems} onClick={() => void deleteSelection()}>{deletingItems ? '正在删除…' : '确认删除'}</button></footer></section></div>}
  </div>
}

function ResearchInboxView({ records, externalItems, categories, captureConfig, onBackToCapture, onRefresh, onNotice }: { records: RecordData[]; externalItems: ExternalItem[]; categories: RecordData[]; captureConfig: CaptureProviderConfig | null; onBackToCapture: () => void; onRefresh: () => Promise<void>; onNotice: (text: string, tone?: Notice['tone']) => void }) {
  const [requestDraft, setRequestDraft] = useState('')
  const researchPanes = useThreePaneResize('jason-os-research-pane-sizes', { left: 210, right: 510 })
  const [filter, setFilter] = useState<'requests' | 'pending' | 'results' | 'completed'>('requests')
  const [selectedRequestId, setSelectedRequestId] = useState('')
  const [selectedResultId, setSelectedResultId] = useState('')
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<string[] | null>(null)
  const [sourceUrlDraft, setSourceUrlDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [knowledgeDialogOpen, setKnowledgeDialogOpen] = useState(false)
  const [knowledgeCategory, setKnowledgeCategory] = useState('')
  const [knowledgeRelationId, setKnowledgeRelationId] = useState('')
  const [relationDialogOpen, setRelationDialogOpen] = useState(false)
  const [relationTargetId, setRelationTargetId] = useState('')
  const requests = records.filter((record) => record.entity === 'researchRequests').sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
  const results = records.filter((record) => record.entity === 'researchResults').sort((a, b) => String(b.completedAt || b.updatedAt || '').localeCompare(String(a.completedAt || a.updatedAt || '')))
  const selectedRequest = requests.find((record) => record.id === selectedRequestId) || requests[0]
  const selectedResult = results.find((record) => record.id === selectedResultId) || results.find((record) => record.researchRequestId === selectedRequest?.id) || results[0]
  const plan = selectedRequest ? {
    title: titleFor(selectedRequest), scope: String(selectedRequest.scope || '待确认范围'),
    dimensions: String(selectedRequest.dimensions || '').split('、').filter(Boolean),
    deliverables: String(selectedRequest.deliverables || '').split('、').filter(Boolean),
    sources: resolveResearchSources(parseResearchSources(selectedRequest.sourcePlan), String(selectedRequest.request || ''), captureConfig), tags: tagsFor(selectedRequest),
  } satisfies ResearchPlan : null
  const relationTargets = records.filter((record) => ['goals', 'projects', 'tasks', 'knowledge', 'insights', 'mentalModels', 'decisions', 'reviews', 'timeLogs', 'financialTransactions'].includes(record.entity))
  const selectedRequestSources = plan?.sources || []
  const currentSelectedSources = selectedSourceKeys ?? selectedRequestSources.filter((source) => source.status === 'ready').map((source) => source.key)
  const createPlan = async () => {
    const request = requestDraft.trim()
    if (!request) return
    const generated = createResearchPlan(request, records, captureConfig)
    try {
      setBusy(true)
      const created = await api.save('researchRequests', {
        title: generated.title, request, status: 'DRAFT', scope: generated.scope, dimensions: generated.dimensions.join('、'), deliverables: generated.deliverables.join('、'),
        sourcePlan: JSON.stringify(generated.sources), selectedSourceKeys: generated.sources.filter((source) => source.status === 'ready').map((source) => source.key).join(','), tags: generated.tags.join(','),
      })
      setRequestDraft(''); setSelectedRequestId(created.id); setSelectedResultId(''); setSelectedSourceKeys(generated.sources.filter((source) => source.status === 'ready').map((source) => source.key)); await onRefresh()
      onNotice('已生成调研方案；确认前不会抓取数据或关联 Jason OS。')
    } catch (error) { onNotice(`生成方案失败：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const toggleSource = (key: string) => setSelectedSourceKeys((current) => { const base = current ?? selectedRequestSources.filter((source) => source.status === 'ready').map((source) => source.key); return base.includes(key) ? base.filter((item) => item !== key) : [...base, key] })
  const addSourceUrl = async (sourceKey: string) => {
    if (!selectedRequest || !plan) return
    const url = sourceUrlDraft.trim()
    if (!/^https?:\/\//i.test(url)) { onNotice('请粘贴以 http:// 或 https:// 开头的公开链接。', 'danger'); return }
    const sources = plan.sources.map((source) => source.key === sourceKey ? { ...source, url, status: 'ready' as const, detail: `${source.label} · 已补充公开链接，可在确认后执行` } : source)
    const selected = [...new Set([...currentSelectedSources, sourceKey])]
    try {
      setBusy(true)
      await api.save('researchRequests', { ...selectedRequest, sourcePlan: JSON.stringify(sources), selectedSourceKeys: selected.join(',') })
      setSelectedSourceKeys(selected); setSourceUrlDraft(''); await onRefresh(); onNotice('已添加公开链接；确认开始调研后才会读取。')
    } catch (error) { onNotice(`添加公开链接失败：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const runResearch = async () => {
    if (!selectedRequest || !plan) return
    const selectedSources = plan.sources.filter((source) => currentSelectedSources.includes(source.key))
    const runnable = selectedSources.filter((source) => source.status === 'ready' && (source.mode === 'keyword_search' || source.url))
    if (!runnable.length) { onNotice('请先选择一个可执行的情报源；未配置或未补充入口的来源不会被伪造执行。', 'danger'); return }
    const readSource = async (source: ResearchSourcePlan) => {
      if (source.mode === 'keyword_search') return api.searchTikTok(source.query || String(selectedRequest.request || ''), source.periodDays || 30)
      await api.captureLink(source.url!, source.provider || 'auto')
      return { items: 1, urls: [source.url!] }
    }
    try {
      setBusy(true)
      await api.save('researchRequests', { ...selectedRequest, status: 'RUNNING', startedAt: nowInput(), selectedSourceKeys: selectedSources.map((source) => source.key).join(',') })
      const settled = await Promise.allSettled(runnable.map(readSource))
      const fulfilled = settled.filter((result): result is PromiseFulfilledResult<{ items: number; urls: string[] }> => result.status === 'fulfilled').map((result) => result.value)
      const successful = runnable.filter((_, index) => settled[index].status === 'fulfilled')
      const failed = runnable.filter((_, index) => settled[index].status === 'rejected')
      const evidenceUrls = fulfilled.flatMap((result) => result.urls).join('\n')
      const itemCount = fulfilled.reduce((total, result) => total + result.items, 0)
      const result = await api.save('researchResults', {
        title: `${titleFor(selectedRequest)} · 调研结果`, researchRequestId: selectedRequest.id, status: failed.length ? 'PARTIAL' : 'COMPLETED', completedAt: nowInput(), tags: plan.tags.join(','),
        summary: `本次已读取 ${successful.length} 个已确认的公开来源${itemCount ? `，获得 ${itemCount} 条可追溯内容` : ''}。\n\n调研范围：${plan.scope}\n研究维度：${plan.dimensions.join('、')}\n交付内容：${plan.deliverables.join('、')}\n\n未自动关联任何 Jason OS 项目、目标或任务。${failed.length ? `\n${failed.length} 个来源未完成，请检查来源或采集服务。` : ''}`,
        evidenceUrls,
      })
      await api.save('researchRequests', { ...selectedRequest, status: failed.length ? 'FAILED' : 'COMPLETED', completedAt: nowInput(), selectedSourceKeys: selectedSources.map((source) => source.key).join(','), resultId: result.id })
      setSelectedResultId(result.id); await onRefresh(); onNotice(failed.length ? '调研已部分完成；结果与未完成来源已保存。' : '调研完成；结果已保存到收纳箱的外部情报中。')
    } catch (error) { await api.save('researchRequests', { ...selectedRequest, status: 'FAILED' }).catch(() => undefined); onNotice(`调研未完成：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const updateResultCategory = async (categoryId: string) => {
    if (!selectedResult) return
    try { await api.save('researchResults', { ...selectedResult, notebookCategoryId: categoryId || undefined }); await onRefresh(); onNotice(categoryId ? '已为调研结果选择分类。' : '已移出收纳箱分类。') } catch (error) { onNotice(`分类失败：${String(error)}`, 'danger') }
  }
  const saveToKnowledge = async () => {
    if (!selectedResult) return
    try {
      setBusy(true)
      const knowledge = await api.save('knowledge', { title: titleFor(selectedResult), content: `${String(selectedResult.summary || '')}\n\n证据链接：\n${String(selectedResult.evidenceUrls || '无')}`, category: knowledgeCategory || '外部情报', status: 'ACTIVE' })
      await api.addRelation(selectedResult.id, knowledge.id, 'research:STORED_AS_KNOWLEDGE')
      if (knowledgeRelationId) await api.addRelation(knowledge.id, knowledgeRelationId, 'knowledge:RELATED')
      setKnowledgeDialogOpen(false); setKnowledgeCategory(''); setKnowledgeRelationId(''); await onRefresh(); onNotice('已按你的确认存入知识。')
    } catch (error) { onNotice(`存入知识失败：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const addRelation = async () => {
    if (!selectedResult || !relationTargetId) return
    try { setBusy(true); await api.addRelation(selectedResult.id, relationTargetId, 'research:RELATED'); setRelationDialogOpen(false); setRelationTargetId(''); onNotice('已按你的确认建立关联。') } catch (error) { onNotice(`关联失败：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const filteredRequests = requests.filter((record) => filter === 'pending' ? record.status === 'DRAFT' : filter === 'completed' ? record.status === 'COMPLETED' || record.status === 'FAILED' : true)
  const resultCount = results.length
  const intelligenceSignals = records.filter((record) => record.entity === 'signals')
  const intelligenceSources = records.filter((record) => record.entity === 'externalSources')
  const intelligenceOpportunities = records.filter((record) => record.entity === 'opportunities')
  return <div className="notebook-page notebook-space research-inbox-page">
    <header className="notebook-page-title"><div><h2>收纳箱</h2><p>收集、整理并沉淀你的内容</p></div><div className="research-mode-switch"><button onClick={onBackToCapture}>收纳内容</button><button className="active">提出调研需求</button></div></header>
    <section className="research-request-composer">
      <label>我想调研什么？<textarea value={requestDraft} onChange={(event) => setRequestDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void createPlan() } }} placeholder="例如：调研美国 TikTok 大码女装近30天的爆款、竞品和价格带" /></label>
      <div><small>系统会先规划情报源；确认前不会抓取数据或关联 Jason OS。</small><button className="button primary" disabled={!requestDraft.trim() || busy} onClick={() => void createPlan()}>{busy ? '正在规划…' : '生成调研方案'}</button></div>
    </section>
    <div ref={researchPanes.layoutRef} className="research-workspace research-resizable-workspace" style={researchPanes.style}>
      <aside className="research-sidebar"><header><strong>调研结果</strong></header><nav><button className={filter === 'requests' ? 'active' : ''} onClick={() => setFilter('requests')}>⌕ 调研需求 <span>{requests.length}</span></button><button className={filter === 'results' ? 'active' : ''} onClick={() => setFilter('results')}>◈ 调研结果 <span>{resultCount}</span></button><button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>◷ 待确认 <span>{requests.filter((record) => record.status === 'DRAFT').length}</span></button><button className={filter === 'completed' ? 'active' : ''} onClick={() => setFilter('completed')}>✓ 已完成 <span>{requests.filter((record) => ['COMPLETED', 'FAILED'].includes(String(record.status))).length}</span></button></nav><section><header><strong>分类</strong></header>{categories.length ? categories.map((category) => <button key={category.id} onClick={() => { setFilter('results'); setSelectedResultId(results.find((result) => result.notebookCategoryId === category.id)?.id || '') }}>▱ {titleFor(category)} <span>{results.filter((result) => result.notebookCategoryId === category.id).length}</span></button>) : <p>调研完成后可创建分类整理结果。</p>}</section></aside>
      <div className="research-pane-resizer" role="separator" title="拖动调整左侧栏宽度" aria-label="调整调研左侧栏宽度" aria-orientation="vertical" onPointerDown={researchPanes.startResize('left')}><span aria-hidden="true">⋮</span></div>
      <section className="research-thread">
        {(filter === 'results' ? results : filteredRequests).length ? <div className="research-record-list">{(filter === 'results' ? results : filteredRequests).map((record) => <button key={record.id} className={(record.id === selectedRequest?.id || record.id === selectedResult?.id) ? 'active' : ''} onClick={() => { if (record.entity === 'researchResults') setSelectedResultId(record.id); else { setSelectedRequestId(record.id); setSelectedSourceKeys(String(record.selectedSourceKeys || '').split(',').filter(Boolean)) } }}><div><strong>{titleFor(record)}</strong><small>{record.entity === 'researchResults' ? '调研结果' : String(record.status === 'DRAFT' ? '方案待确认' : record.status === 'RUNNING' ? '调研中' : record.status === 'COMPLETED' ? '已完成' : '未完成')}</small></div><time>{formatDate(record.updatedAt || record.completedAt || record.createdAt, true)}</time></button>)}</div> : <div className="research-empty-list"><strong>还没有调研内容</strong><p>在上方写下需求，系统会先生成可确认的方案。</p></div>}
      </section>
      <div className="research-pane-resizer" role="separator" title="拖动调整右侧栏宽度" aria-label="调整调研右侧栏宽度" aria-orientation="vertical" onPointerDown={researchPanes.startResize('right')}><span aria-hidden="true">⋮</span></div>
      <aside className="research-detail">
        {filter === 'results' && selectedResult ? <><header><strong>调研结果</strong><span>{String(selectedResult.status) === 'PARTIAL' ? '部分完成' : '已完成'}</span></header><article className="research-result-card"><h3>{titleFor(selectedResult)}</h3><pre>{String(selectedResult.summary || '暂无摘要。')}</pre>{Boolean(selectedResult.evidenceUrls) && <section><strong>证据链接</strong>{String(selectedResult.evidenceUrls).split('\n').filter(Boolean).map((url) => <button key={url} onClick={() => void api.openExternal(url)}>{url.replace(/^https?:\/\//, '')}</button>)}</section>}</article><section className="research-intelligence-overview"><header><div><strong>已收纳情报</strong><small>所有调研内容均在收纳箱内查看与整理</small></div><span>{externalItems.length} 条内容</span></header><div className="research-intelligence-metrics"><span><b>{intelligenceSignals.length}</b>信号</span><span><b>{intelligenceSources.length}</b>来源</span><span><b>{intelligenceOpportunities.length}</b>机会</span></div>{[...intelligenceSignals, ...intelligenceOpportunities].slice(0, 3).map((item) => <article key={item.id}><strong>{titleFor(item)}</strong><p>{String(item.summary || item.description || item.content || '暂无摘要。')}</p></article>)}{!intelligenceSignals.length && !intelligenceOpportunities.length && <p className="research-intelligence-empty">调研产生的可追溯内容会保留在这里，不会自动进入项目、目标或任务。</p>}</section><NotebookCategoryControl record={selectedResult} categories={categories} onChange={async (_, categoryId) => updateResultCategory(categoryId)} onCreate={() => onNotice('请先切换到“收纳内容”，在左侧分类处新建分类。')} /><div className="research-result-actions"><button className="button" onClick={() => { setKnowledgeCategory(''); setKnowledgeRelationId(''); setKnowledgeDialogOpen(true) }}>▱ 存入知识</button><button className="button" onClick={() => { setRelationTargetId(''); setRelationDialogOpen(true) }}>□ 关联 Jason OS</button></div></> : selectedRequest && plan ? <><header><strong>调研方案</strong><span className="research-status">{selectedRequest.status === 'DRAFT' ? '尚未执行' : selectedRequest.status === 'RUNNING' ? '调研中' : selectedRequest.status === 'COMPLETED' ? '已完成' : '未完成'}</span></header><article className="research-plan-card"><div className="research-user-message">{String(selectedRequest.request || '')}</div><h3>已为你生成调研方案</h3><dl><div><dt>范围</dt><dd>{plan.scope}</dd></div><div><dt>维度</dt><dd>{plan.dimensions.join('、')}</dd></div><div><dt>情报源</dt><dd>{plan.sources.map((source) => <div className="research-source-choice" key={source.key}><label className={source.status}><input type="checkbox" checked={currentSelectedSources.includes(source.key)} disabled={source.status !== 'ready' || selectedRequest.status !== 'DRAFT'} onChange={() => toggleSource(source.key)} /><span><b>{source.label}</b><small>{source.detail}</small></span><em>{source.status === 'ready' ? '可执行' : source.status === 'needs_input' ? '需入口' : '需配置'}</em></label>{source.status === 'needs_input' && selectedRequest.status === 'DRAFT' && <div className="research-source-input"><input value={sourceUrlDraft} onChange={(event) => setSourceUrlDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addSourceUrl(source.key) } }} placeholder="粘贴公开链接后执行" /><button className="button" disabled={busy || !sourceUrlDraft.trim()} onClick={() => void addSourceUrl(source.key)}>添加入口</button></div>}</div>)}</dd></div><div><dt>交付内容</dt><dd>{plan.deliverables.join('、')}</dd></div></dl>{selectedRequest.status === 'DRAFT' ? <footer><button className="button" onClick={() => { setRequestDraft(String(selectedRequest.request || '')); onNotice('已将需求放回输入框，可补充后重新生成方案。') }}>修改方案</button><button className="button primary" disabled={busy} onClick={() => void runResearch()}>{busy ? '正在执行…' : '确认并开始调研'}</button></footer> : <p className="research-plan-note">{selectedRequest.status === 'RUNNING' ? '正在读取你确认的公开来源。' : '调研记录已保留；结果可在“调研结果”中查看。'}</p>}</article><p className="research-safety-note">⌑ 确认前不会抓取数据，也不会关联 Jason OS。</p></> : <div className="research-result-empty"><span>⌕</span><strong>选择一条调研需求</strong><p>右侧会显示方案、来源与结果操作。</p></div>}
      <section className="research-followup"><span>📎</span><input value={requestDraft} onChange={(event) => setRequestDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createPlan() }} placeholder="继续补充调研要求…" /><button aria-label="发送调研需求" disabled={!requestDraft.trim() || busy} onClick={() => void createPlan()}>➤</button></section>
      </aside>
    </div>
    {knowledgeDialogOpen && selectedResult && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setKnowledgeDialogOpen(false)}><section className="notebook-action-dialog notebook-knowledge-dialog"><header><div><p>知识沉淀</p><h3>确认存入知识</h3></div><button disabled={busy} onClick={() => setKnowledgeDialogOpen(false)}>×</button></header><label><span>知识分类</span><input autoFocus value={knowledgeCategory} onChange={(event) => setKnowledgeCategory(event.target.value)} placeholder="例如：行业研究、竞品资料" /></label><label><span>可选关联</span><select value={knowledgeRelationId} onChange={(event) => setKnowledgeRelationId(event.target.value)}><option value="">不关联其他记录</option>{relationTargets.map((target) => <option key={target.id} value={target.id}>{configFor(target.entity).label} · {titleFor(target)}</option>)}</select></label><small>确认后才会创建知识记录。项目、目标、任务等只会按你在这里的选择关联。</small><footer><button className="button ghost" disabled={busy} onClick={() => setKnowledgeDialogOpen(false)}>取消</button><button className="button primary" disabled={busy} onClick={() => void saveToKnowledge()}>{busy ? '正在存入…' : '确认存入知识'}</button></footer></section></div>}
    {relationDialogOpen && selectedResult && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setRelationDialogOpen(false)}><section className="notebook-action-dialog"><header><div><p>可选关联</p><h3>关联 Jason OS</h3></div><button disabled={busy} onClick={() => setRelationDialogOpen(false)}>×</button></header><label><span>选择要关联的对象</span><select autoFocus value={relationTargetId} onChange={(event) => setRelationTargetId(event.target.value)}><option value="">暂不选择</option>{relationTargets.map((target) => <option key={target.id} value={target.id}>{configFor(target.entity).label} · {titleFor(target)}</option>)}</select></label><small>仅在你确认后建立关联；不选择则不会写入任何 Jason OS 关系。</small><footer><button className="button ghost" disabled={busy} onClick={() => setRelationDialogOpen(false)}>取消</button><button className="button primary" disabled={!relationTargetId || busy} onClick={() => void addRelation()}>确认关联</button></footer></section></div>}
  </div>
}

function NotebookCategoryControl({ record, categories, compact = false, onChange, onCreate }: { record: RecordData; categories: RecordData[]; compact?: boolean; onChange: (record: RecordData, categoryId: string) => Promise<void>; onCreate: () => void }) {
  return <section className={`notebook-category-control${compact ? ' compact' : ''}`}><label>收纳箱分类<select value={String(record.notebookCategoryId || '')} onChange={(event) => void onChange(record, event.target.value)}><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{titleFor(category)}</option>)}</select></label><button className="button" onClick={onCreate}>＋ 新建分类</button></section>
}

function RichNotebookEditor({ note, records, related, categories, fullscreen, onOpen, onCreateNote, onRefresh, onNotice, onAi, onAssignCategory, onCreateCategory, onToggleFullscreen, onClose, onRelationsChanged }: { note: RecordData; records: RecordData[]; related: RecordData[]; categories: RecordData[]; fullscreen: boolean; onOpen: (record: RecordData) => void; onCreateNote: () => void; onRefresh: () => Promise<void>; onNotice: (text: string, tone?: Notice['tone']) => void; onAi: (question: string, context: Partial<AgentContext>) => void; onAssignCategory: (record: RecordData, categoryId: string) => Promise<void>; onCreateCategory: () => void; onToggleFullscreen: () => void; onClose: () => void; onRelationsChanged: () => void }) {
  const editorRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const relationPickerRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState(String(note.title || ''))
  const [tags, setTags] = useState<string[]>(tagsFor(note))
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [relationPickerOpen, setRelationPickerOpen] = useState(false)
  const [relationTarget, setRelationTarget] = useState('')
  const [knowledgeDialogOpen, setKnowledgeDialogOpen] = useState(false)
  const [knowledgeCategory, setKnowledgeCategory] = useState('')
  const [knowledgeRelationTarget, setKnowledgeRelationTarget] = useState('')
  const [archivingToKnowledge, setArchivingToKnowledge] = useState(false)
  const [imagePickerOpen, setImagePickerOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => { setTitle(String(note.title || '')); setTags(Array.isArray(note.tags) ? note.tags.map(String).map((tag) => tag.trim()).filter(Boolean) : String(note.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean)); setRelationPickerOpen(false); setKnowledgeDialogOpen(false); if (editorRef.current) { const html = String(note.contentHtml || ''); if (html) editorRef.current.innerHTML = html; else editorRef.current.textContent = String(note.content || '') } }, [note.id, note.updatedAt, note.content, note.contentHtml, note.tags, note.title])
  useEffect(() => {
    if (!fullscreen) return
    const exitFullscreen = (event: KeyboardEvent) => { if (event.key === 'Escape') onToggleFullscreen() }
    window.addEventListener('keydown', exitFullscreen)
    return () => window.removeEventListener('keydown', exitFullscreen)
  }, [fullscreen, onToggleFullscreen])
  useEffect(() => {
    if (!relationPickerOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!relationPickerRef.current?.contains(event.target as Node)) { setRelationPickerOpen(false); setRelationTarget('') }
    }
    window.addEventListener('pointerdown', closeOutside)
    return () => window.removeEventListener('pointerdown', closeOutside)
  }, [relationPickerOpen])
  const html = () => editorRef.current?.innerHTML || ''
  const text = () => editorRef.current?.innerText.trim() || ''
  const command = (name: string, value?: string) => { editorRef.current?.focus(); document.execCommand(name, false, value) }
  const save = async () => { try { await api.save('notes', { ...note, title: title.trim() || '未命名笔记', content: text(), contentHtml: html(), tags }); await onRefresh(); onNotice('笔记已保存。') } catch (error) { onNotice(`保存失败：${String(error)}`, 'danger') } }
  const existingTags = [...new Set(records.filter((record) => record.entity === 'notes').flatMap(tagsFor))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const relationEntities: Entity[] = ['goals', 'projects', 'tasks', 'results', 'knowledge', 'insights', 'mentalModels', 'decisions', 'reviews', 'events', 'people']
  const relationTargets = records.filter((record) => record.id !== note.id && relationEntities.includes(record.entity))
  const addTag = () => {
    const tag = tagDraft.trim()
    if (!tag) return
    if (!tags.includes(tag)) setTags((current) => [...current, tag])
    setTagDraft(''); setTagDialogOpen(false)
  }
  const addLink = () => { const url = window.prompt('输入链接地址'); if (url) command('createLink', url) }
  const inboxImages = records.filter((record) => record.entity === 'notebookFiles' && (String(record.mimeType || '').startsWith('image/') || /\.(jpe?g|png|webp|gif|svg|heic)$/i.test(String(record.originalName || record.name || record.relativePath || record.extension || ''))))
  const addLocalImage = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { command('insertImage', String(reader.result || '')); setImagePickerOpen(false); if (imageInputRef.current) imageInputRef.current.value = '' }
    reader.onerror = () => onNotice('图片读取失败。', 'danger')
    reader.readAsDataURL(file)
  }
  const addInboxImage = async (record: RecordData) => {
    try {
      const image = await api.previewNotebookFile(record.id)
      if (image.kind !== 'image' || !image.dataUrl) throw new Error('这张图片暂时无法预览')
      command('insertImage', image.dataUrl); setImagePickerOpen(false)
    } catch (error) { onNotice(`图片插入失败：${String(error)}`, 'danger') }
  }
  const archiveToKnowledge = async () => {
    try {
      setArchivingToKnowledge(true)
      const created = await api.save('knowledge', { title: title.trim() || titleFor(note), content: text(), sourceNoteId: note.id, category: knowledgeCategory.trim(), tags })
      if (knowledgeRelationTarget) await api.addRelation(created.id, knowledgeRelationTarget, 'knowledge:RELATED')
      await api.save('notes', { ...note, title: title.trim() || titleFor(note), content: text(), contentHtml: html(), tags, status: 'ARCHIVED' })
      setKnowledgeDialogOpen(false); setKnowledgeCategory(''); setKnowledgeRelationTarget(''); await onRefresh(); onNotice('已按你的确认存入知识并归档原笔记。')
    } catch (error) { onNotice(`存入知识失败：${String(error)}`, 'danger') }
    finally { setArchivingToKnowledge(false) }
  }
  const associate = async () => {
    const target = relationTargets.find((record) => record.id === relationTarget)
    if (!target) return
    try { await api.addRelation(note.id, target.id, 'notebook:RELATED'); setRelationTarget(''); setRelationPickerOpen(false); onRelationsChanged(); onNotice(`已关联到${configFor(target.entity).label}“${titleFor(target)}”。`) } catch (error) { onNotice(`关联失败：${String(error)}`, 'danger') }
  }
  const askAi = () => onAi('请仅基于这条收纳箱笔记给出摘要、要点、Notebook 分类建议、建议标签和潜在关联建议。不要创建、修改、关联、归档或写入标签；所有建议必须由用户确认后才可应用。', { currentRoute: 'notebook', currentEntityType: 'notes', currentEntityId: note.id, selectedItems: [note.id] })
  const deleteNote = async () => {
    try { setDeleting(true); await api.remove(note.id); setDeleteConfirmOpen(false); await onRefresh(); onClose(); onNotice('笔记已按你的确认删除。') }
    catch (error) { onNotice(`删除笔记失败：${String(error)}`, 'danger') }
    finally { setDeleting(false) }
  }
  return <>
    <header className="notebook-editor-header">
      <div><span>▤</span><strong>笔记</strong></div>
      <div className="notebook-editor-header-actions">
        <button className="notebook-new-note" title="手动新建笔记" onClick={onCreateNote}>＋ 新建</button>
        <button title="置顶 / 收藏" onClick={() => void api.save('notes', { ...note, favorite: String(note.favorite) === 'true' ? 'false' : 'true' }).then(onRefresh)}>⚑</button>
        <button className="notebook-ai-note" title="AI 整理建议" onClick={askAi}>AI</button>
        <button className="notebook-fullscreen-note" title={fullscreen ? '缩小笔记栏' : '放大笔记栏'} aria-label={fullscreen ? '缩小笔记栏' : '放大笔记栏'} onClick={onToggleFullscreen}>{fullscreen ? '↙ 缩小' : '⛶ 放大'}</button>
        <button className="notebook-save-note" title="保存笔记" onClick={() => void save()}>保存</button>
        <button className="notebook-delete-note" title="删除笔记" onClick={() => setDeleteConfirmOpen(true)}>删除</button>
        <button title="关闭编辑器" onClick={onClose}>×</button>
      </div>
    </header>
    <div className="notebook-editor">
      <input className="notebook-editor-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="未命名笔记" />
      <div className="notebook-editor-toolbar" role="toolbar" aria-label="笔记格式">
        <button title="粗体" onClick={() => command('bold')}><b>B</b></button>
        <button title="斜体" onClick={() => command('italic')}><i>I</i></button>
        <button title="删除线" onClick={() => command('strikeThrough')}><s>S</s></button>
        <i />
        <button title="项目符号列表" onClick={() => command('insertUnorderedList')}>☷</button>
        <button title="编号列表" onClick={() => command('insertOrderedList')}>☰</button>
        <button title="待办事项" onClick={() => command('insertHTML', '<div>☐&nbsp;</div>')}>☑</button>
        <button title="引用" onClick={() => command('formatBlock', 'blockquote')}>❝</button>
        <button title="代码块" onClick={() => command('formatBlock', 'pre')}>‹›</button>
        <button title="插入链接" onClick={addLink}>⌁</button>
        <button className="notebook-image-button" title="添加图片（电脑 / 收纳箱）" onClick={() => setImagePickerOpen((open) => !open)}><span>▧</span>图片</button>
        <span />
        <button title="撤销" onClick={() => command('undo')}>↶</button>
        <button title="重做" onClick={() => command('redo')}>↷</button>
      </div>
      {imagePickerOpen && <div className="notebook-image-picker"><header><strong>添加图片</strong><button onClick={() => setImagePickerOpen(false)}>×</button></header><button className="notebook-image-local" onClick={() => imageInputRef.current?.click()}><span>＋</span><div><strong>从电脑添加</strong><small>选择本地 JPG、PNG、WebP 等图片</small></div></button><input ref={imageInputRef} className="hidden-file-input" type="file" accept="image/*" onChange={(event) => addLocalImage(event.currentTarget.files)} /><div className="notebook-image-library"><strong>从收纳箱选择</strong>{inboxImages.length ? inboxImages.map((record) => <button key={record.id} onClick={() => void addInboxImage(record)}><span>▧</span><div><strong>{titleFor(record)}</strong><small>{String(record.extension || '图片').toUpperCase()}</small></div></button>) : <p>收纳箱里还没有图片。</p>}</div></div>}
      <div ref={editorRef} className="notebook-rich-editor" contentEditable suppressContentEditableWarning data-placeholder="开始记录…" />
      <div className="notebook-editor-rule">— — —</div>
    </div>
    <div className="notebook-editor-tags">
      <span>◇</span><strong>标签</strong>
      {tags.map((tag) => <em key={tag}>{tag}<button onClick={() => setTags((current) => current.filter((item) => item !== tag))}>×</button></em>)}
      <button title="添加标签" onClick={() => { setTagDraft(''); setTagDialogOpen(true) }}>＋</button>
      <button className="notebook-tag-ai" title="让 AI 建议标签" onClick={askAi}>AI 建议</button>
      <NotebookCategoryControl compact record={note} categories={categories} onChange={onAssignCategory} onCreate={onCreateCategory} />
    </div>
    <footer className="notebook-editor-actions">
      <button className="button primary" onClick={() => void save()}>◉ 保存</button>
      <button className="button" onClick={() => { setKnowledgeCategory(''); setKnowledgeRelationTarget(''); setKnowledgeDialogOpen(true) }}>▱ 存入知识</button>
      <button className="button" onClick={() => { setRelationTarget(''); setRelationPickerOpen(true) }}>□ 关联记录</button>
    </footer>
    <div className="notebook-editor-meta">
      <span>来源 · 收纳箱</span>
      <span>创建 · {formatDate(note.createdAt, true)}</span>
      <span>更新 · {formatDate(note.updatedAt, true)}</span>
    </div>
    {related.length > 0 && <div className="notebook-editor-relations">已关联：{related.map((record) => <button key={record.id} onClick={() => onOpen(record)}>{configFor(record.entity).icon} {titleFor(record)}</button>)}</div>}
    {relationPickerOpen && <section ref={relationPickerRef} className="notebook-relation-popover"><header><div><strong>关联 Jason OS 记录</strong><small>可选择项目、目标、任务等；点击其他任意位置即可取消。</small></div><button onClick={() => { setRelationPickerOpen(false); setRelationTarget('') }}>×</button></header><label>选择对象<select autoFocus value={relationTarget} onChange={(event) => setRelationTarget(event.target.value)}><option value="">暂不选择</option>{relationTargets.map((target) => <option key={target.id} value={target.id}>{configFor(target.entity).label} · {titleFor(target)}</option>)}</select></label><footer><button className="button ghost" onClick={() => { setRelationPickerOpen(false); setRelationTarget('') }}>取消</button><button className="button primary" disabled={!relationTarget} onClick={() => void associate()}>确认关联</button></footer></section>}
    {tagDialogOpen && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setTagDialogOpen(false)}><form className="notebook-action-dialog" onSubmit={(event) => { event.preventDefault(); addTag() }}><header><div><p>笔记标签</p><h3>创建标签</h3></div><button type="button" onClick={() => setTagDialogOpen(false)}>×</button></header><label><span>标签名称</span><input autoFocus value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="例如：产品灵感" list="notebook-existing-tags" /><datalist id="notebook-existing-tags">{existingTags.map((tag) => <option key={tag} value={tag} />)}</datalist></label><small>标签会保存到当前笔记，并可在收纳箱左侧按标签筛选。需要 AI 协助时，可先点击“AI 建议”，再由你确认添加。</small><footer><button className="button ghost" type="button" onClick={() => setTagDialogOpen(false)}>取消</button><button className="button primary" type="submit" disabled={!tagDraft.trim()}>添加标签</button></footer></form></div>}
    {knowledgeDialogOpen && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !archivingToKnowledge && setKnowledgeDialogOpen(false)}><section className="notebook-action-dialog notebook-knowledge-dialog"><header><div><p>知识沉淀</p><h3>确认存入知识</h3></div><button disabled={archivingToKnowledge} onClick={() => setKnowledgeDialogOpen(false)}>×</button></header><label><span>知识分类</span><input autoFocus value={knowledgeCategory} onChange={(event) => setKnowledgeCategory(event.target.value)} placeholder="例如：产品、方法、行业研究" list="notebook-knowledge-categories" /><datalist id="notebook-knowledge-categories">{[...new Set(records.filter((record) => record.entity === 'knowledge').map((record) => String(record.category || '').trim()).filter(Boolean))].map((category) => <option key={category} value={category} />)}</datalist></label><label><span>可选关联</span><select value={knowledgeRelationTarget} onChange={(event) => setKnowledgeRelationTarget(event.target.value)}><option value="">不关联其他记录</option>{relationTargets.map((target) => <option key={target.id} value={target.id}>{configFor(target.entity).label} · {titleFor(target)}</option>)}</select></label><small>确认后会创建一条知识记录并归档当前笔记；项目、目标、任务等只会按你在这里的选择关联。</small><footer><button className="button ghost" disabled={archivingToKnowledge} onClick={() => setKnowledgeDialogOpen(false)}>取消</button><button className="button primary" disabled={archivingToKnowledge} onClick={() => void archiveToKnowledge()}>{archivingToKnowledge ? '正在存入…' : '确认存入知识'}</button></footer></section></div>}
    {deleteConfirmOpen && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDeleteConfirmOpen(false)}><section className="notebook-action-dialog danger"><header><div><p>删除笔记</p><h3>确定删除“{title.trim() || titleFor(note)}”？</h3></div><button onClick={() => setDeleteConfirmOpen(false)}>×</button></header><small>删除后不会进入已归档，也不会影响其他笔记。</small><footer><button className="button ghost" onClick={() => setDeleteConfirmOpen(false)}>取消</button><button className="button danger" disabled={deleting} onClick={() => void deleteNote()}>{deleting ? '正在删除…' : '确认删除'}</button></footer></section></div>}
  </>
}

function MemoryView({ entity, records, onOpen, onCreate }: { entity: Entity; records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void }) {
  const config = configFor(entity); const items = records.filter((record) => record.entity === entity)
  return <div className="memory-page"><section className="section-intro"><span>{config.icon}</span><div><h2>{config.label}</h2><p>{config.description} 这些内容应该与项目、复盘、决策和其他认知资产互相关联。</p></div></section>{items.length ? <div className="knowledge-list">{items.map((record) => <article key={record.id} onClick={() => onOpen(record)}><div><span className="entity-pill">{config.label}</span><h3>{titleFor(record)}</h3><p>{descriptionFor(record) || '打开查看完整内容与相关记录。'}</p></div><footer><span>{formatDate(record.updatedAt)}</span>{entity === 'mentalModels' && <ModelEffectiveness model={record} records={records} />}</footer></article>)}</div> : <GuidedEmpty icon={config.icon} title={`${config.label}不是普通文档收藏夹`} text={`${config.description} 从一次真实的结果或复盘开始创建。`} action={`创建${config.singular}`} onAction={() => onCreate(entity)} />}</div>
}

function DecisionsView({ records, onOpen, onCreate }: { records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: () => void }) {
  const decisions = records.filter((record) => record.entity === 'decisions')
  return <div className="decisions-page"><section className="decision-flow"><span>问题</span><b>→</b><span>证据快照</span><b>→</b><span>选择</span><b>→</b><span>实际结果</span><b>→</b><span>校准</span></section>{decisions.length ? <div className="decision-list">{decisions.map((decision) => { const economics = projectEconomics(records, String(decision.projectId || '')); const material = ['MATERIAL', 'STRATEGIC'].includes(String(decision.decisionLevel)); return <article key={decision.id} onClick={() => onOpen(decision)}><header><span className={`status-dot ${decision.status || 'pending'}`} />{statusLabel(decision.status)}<time>{formatDate(decision.date || decision.createdAt)}</time></header><h2>{titleFor(decision)}</h2><p>{String(decision.problem || '打开查看问题、选项、证据与预测。')}</p><div className="decision-prediction"><small>{material ? '决策时证据' : '预测'}</small><span>{material ? `覆盖 ${Number(decision.dataCoverage || 0)}% · 快照 ${decision.evidenceSnapshotAt ? formatDate(decision.evidenceSnapshotAt, true) : '尚未冻结'}` : String(decision.prediction || '尚未记录预测')}</span></div>{Boolean(decision.projectId) && <div className="decision-current-context"><span>当前经营贡献 <b>{economics.postedTransactions ? formatMoneyMinor(economics.managementContributionMinor) : '未记录'}</b></span><span>当前时间 <b>{economics.timeMinutes ? formatMinutes(economics.timeMinutes) : '未记录'}</b></span><span>当前 Outcome <b>{economics.outcomeCount}</b></span></div>}<footer><span>置信度 {Number(decision.confidence || 0)}%</span><span>{relationName(decision.projectId, records) || '独立决策'}</span></footer></article> })}</div> : <GuidedEmpty icon="◆" title="决策日志用于校准判断，而不是记录待办" text="重要决策会冻结当时的时间、资金、Outcome 与数据缺口，之后再和现实比较。" action="记录重要决策" onAction={onCreate} />}</div>
}

function ContextView({ entity, records, onOpen, onCreate }: { entity: 'events' | 'people'; records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: (entity: Entity) => void }) {
  const config = configFor(entity); const items = records.filter((record) => record.entity === entity)
  return <div className="context-page"><section className="section-intro"><span>{config.icon}</span><div><h2>{config.label}</h2><p>{config.description}</p></div></section>{items.length ? <div className={entity === 'people' ? 'people-grid' : 'event-list'}>{items.map((record) => <article key={record.id} onClick={() => onOpen(record)}><span className="avatar">{entity === 'people' ? titleFor(record).slice(0, 1) : config.icon}</span><div><h3>{titleFor(record)}</h3><p>{entity === 'people' ? `${record.organization || '未填写组织'} · ${record.role || '未填写角色'}` : `${formatDate(record.startAt, true)} · ${record.location || '地点未定'}`}</p><small>{descriptionFor(record)}</small></div></article>)}</div> : <GuidedEmpty icon={config.icon} title={entity === 'people' ? '人物提供关系上下文，不是 CRM' : '事件连接现实世界与工作'} text={config.description} action={`创建${config.singular}`} onAction={() => onCreate(entity)} />}</div>
}

const timelineRangeLabels: Record<TimelineRange, string> = { today: '今天', week: '本周', month: '本月', '90d': '90 天', all: '全部' }
const timelineMeaningLabels = { planned: '计划', actual: '现实', recorded: '记录' } as const
const timelineEvidenceLabels = { REALITY: '现实证据', USER_CONFIRMED: '用户记录', AI_CONFIRMED: 'AI 已确认', AI_SUGGESTION: 'AI 建议' } as const

const timelineAiContext = (items: TimelineProjectionItem[], edges: TimelineCausalEdge[], mode: TimelineFilter['mode'], range: TimelineRange, projectId?: string, readOnly = true): Partial<AgentContext> => {
  const selectedItems = [...new Set([projectId, ...items.slice(0, 29).map((item) => item.record.id)].filter((id): id is string => Boolean(id)))]
  return {
    currentRoute: 'timeline', currentProjectId: projectId, selectedItems, analysisMode: readOnly ? 'timeline_readonly' : undefined,
    timelineSummary: {
      mode, range, recordCount: items.length, actualCount: items.filter((item) => item.timeMeaning === 'actual').length,
      plannedCount: items.filter((item) => item.timeMeaning === 'planned').length, causalCount: edges.length, sampledRecordCount: selectedItems.length,
    },
  }
}

function TimelineView({ records, onOpen, onAiAnalyze }: { records: RecordData[]; onOpen: (record: RecordData) => void; onAiAnalyze: (question: string, context: Partial<AgentContext>) => void }) {
  const [filter, setFilter] = useState<TimelineFilter>({ mode: 'key', range: 'month', entity: 'all', projectId: 'all', goalId: 'all' })
  const projects = records.filter((record) => record.entity === 'projects'); const goals = records.filter((record) => record.entity === 'goals')
  const allItems = timelineProjection(records); const items = filterTimelineItems(allItems, filter); const causalEdges = visibleTimelineCausalEdges(timelineCausalEdges(records), items)
  const actual = items.filter((item) => item.timeMeaning === 'actual').length; const planned = items.filter((item) => item.timeMeaning === 'planned').length
  const update = <K extends keyof TimelineFilter>(key: K, value: TimelineFilter[K]) => setFilter((current) => ({ ...current, [key]: value }))
  const projectId = filter.projectId !== 'all' && filter.projectId !== 'unlinked' ? filter.projectId : undefined
  const analyze = (question: string) => onAiAnalyze(question, timelineAiContext(items, causalEdges, filter.mode, filter.range, projectId))
  const prepare = (question: string) => onAiAnalyze(question, timelineAiContext(items, causalEdges, filter.mode, filter.range, projectId, false))
  return <div className="timeline-page phase-one"><section className="timeline-summary"><div><span>TIMELINE · EVIDENCE LAYER</span><h2>{filter.mode === 'key' ? '关键时间线' : '完整时间线'}</h2><p>按真实发生时间连接目标、项目、行动、结果和学习。</p></div><div><span><b>{items.length}</b> 条记录</span><span><b>{actual}</b> 条现实</span><span><b>{planned}</b> 条计划</span><span><b>{causalEdges.length}</b> 条因果</span></div></section><div className="timeline-toolbar"><div className="timeline-toolbar-row"><div className="segmented timeline-mode-switch"><button className={filter.mode === 'key' ? 'active' : ''} onClick={() => update('mode', 'key')}>关键</button><button className={filter.mode === 'all' ? 'active' : ''} onClick={() => update('mode', 'all')}>完整</button></div><div className="segmented timeline-range-switch">{(Object.keys(timelineRangeLabels) as TimelineRange[]).map((range) => <button key={range} className={filter.range === range ? 'active' : ''} onClick={() => update('range', range)}>{timelineRangeLabels[range]}</button>)}</div></div><div className="timeline-filter-row"><label>类型<select value={filter.entity} onChange={(event) => update('entity', event.target.value as Entity | 'all')}><option value="all">全部类型</option>{timelineEntityTypes.map((entity) => <option value={entity} key={entity}>{entity === 'timelineEvents' ? '状态变化' : configFor(entity).label}</option>)}</select></label><label>项目<select value={filter.projectId} onChange={(event) => update('projectId', event.target.value)}><option value="all">全部项目</option><option value="unlinked">未关联项目</option>{projects.map((project) => <option value={project.id} key={project.id}>{titleFor(project)}</option>)}</select></label><label>目标<select value={filter.goalId} onChange={(event) => update('goalId', event.target.value)}><option value="all">全部目标</option><option value="unlinked">未关联目标</option>{goals.map((goal) => <option value={goal.id} key={goal.id}>{titleFor(goal)}</option>)}</select></label><button onClick={() => setFilter({ mode: 'key', range: 'month', entity: 'all', projectId: 'all', goalId: 'all' })}>重置筛选</button></div></div>{items.length ? <><TimelineCausalPanel edges={causalEdges} onOpen={onOpen} /><TimelineAiPanel scope={`${filter.mode === 'key' ? '关键' : '完整'} · ${timelineRangeLabels[filter.range]}`} onAnalyze={analyze} onPrepare={prepare} /><TimelineList items={items} records={records} causalEdges={causalEdges} onOpen={onOpen} /></> : <TimelineEmpty keyMode={filter.mode === 'key'} onShowAll={() => update('mode', 'all')} />}</div>
}

function ProjectTimelineView({ project, records, related, onOpen, onAiAnalyze }: { project: RecordData; records: RecordData[]; related: RecordData[]; onOpen: (record: RecordData) => void; onAiAnalyze: (question: string, context: Partial<AgentContext>) => void }) {
  const [mode, setMode] = useState<TimelineFilter['mode']>('key'); const [range, setRange] = useState<TimelineRange>('all'); const [entity, setEntity] = useState<Entity | 'all'>('all')
  const source = [project, ...related]; const items = filterTimelineItems(timelineProjection(source), { mode, range, entity, projectId: 'all', goalId: 'all' }); const causalEdges = visibleTimelineCausalEdges(timelineCausalEdges(records), items)
  const analyze = (question: string) => onAiAnalyze(question, timelineAiContext(items, causalEdges, mode, range, project.id))
  const prepare = (question: string) => onAiAnalyze(question, timelineAiContext(items, causalEdges, mode, range, project.id, false))
  return <section className="project-timeline"><div className="timeline-toolbar project"><div className="timeline-toolbar-row"><div className="segmented"><button className={mode === 'key' ? 'active' : ''} onClick={() => setMode('key')}>关键</button><button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>完整</button></div><div className="segmented timeline-range-switch">{(Object.keys(timelineRangeLabels) as TimelineRange[]).map((item) => <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{timelineRangeLabels[item]}</button>)}</div></div><div className="timeline-filter-row"><label>记录类型<select value={entity} onChange={(event) => setEntity(event.target.value as Entity | 'all')}><option value="all">全部类型</option>{timelineEntityTypes.map((item) => <option value={item} key={item}>{item === 'timelineEvents' ? '状态变化' : configFor(item).label}</option>)}</select></label><span>{titleFor(project)} · {items.length} 条记录 · {causalEdges.length} 条因果</span></div></div>{items.length ? <><TimelineCausalPanel edges={causalEdges} onOpen={onOpen} /><TimelineAiPanel scope={`${titleFor(project)} · ${timelineRangeLabels[range]}`} onAnalyze={analyze} onPrepare={prepare} /><TimelineList items={items} records={records} causalEdges={causalEdges} onOpen={onOpen} /></> : <TimelineEmpty keyMode={mode === 'key'} onShowAll={() => setMode('all')} />}</section>
}

function TimelineEmpty({ keyMode, onShowAll }: { keyMode: boolean; onShowAll: () => void }) {
  return <div className="timeline-empty"><span>⌁</span><h3>{keyMode ? '当前范围没有关键记录' : '当前筛选没有时间线记录'}</h3><p>{keyMode ? '关键时间线只显示重要决策、结果、复盘、洞见和关键状态变化。' : '创建任务、记录时间、结果、复盘或决策后会自动出现在这里。'}</p>{keyMode && <button onClick={onShowAll}>查看完整时间线</button>}</div>
}

function AiNewsRadarView() {
  const [reload, setReload] = useState(0)
  const [mode, setMode] = useState<'curated' | 'all'>('curated')
  const [category, setCategory] = useState<RadarCategory>('all')
  const [data, setData] = useState<RadarData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); setError('')
    Promise.all([
      fetch(`https://news.learnprompt.pro/data/latest-24h.json?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal }).then((response) => { if (!response.ok) throw new Error(`最新新闻加载失败（${response.status}）`); return response.json() }),
      fetch(`https://news.learnprompt.pro/data/daily-brief.json?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal }).then((response) => { if (!response.ok) throw new Error(`精选日报加载失败（${response.status}）`); return response.json() }),
    ]).then(([latest, brief]) => setData(buildRadarData(latest, brief))).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)) })
    return () => controller.abort()
  }, [reload])
  const stories = (mode === 'curated' ? data?.curated : data?.all) || []
  const filtered = category === 'all' ? stories : stories.filter((story) => story.category === category)
  const topStories = filtered.slice(0, 3); const timelineStories = filtered.slice(3)
  const generatedAt = data?.generatedAt ? new Date(data.generatedAt).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '正在同步'
  return <div className="ai-news-page"><section className="ai-news-toolbar"><div><span>INDEPENDENT ONLINE TOOL</span><h2>AI News Radar</h2><p>在线读取 LearnPrompt 新闻数据，仅保存在当前页面内存中，不进入 Jason OS 数据库、知识库、AI 上下文或导出。</p></div><div><a href="https://github.com/LearnPrompt/ai-news-radar" target="_blank" rel="noreferrer">GitHub</a><button onClick={() => setReload((value) => value + 1)}>↻ 刷新</button></div></section><section className="radar-panel"><header className="radar-summary"><div><span className="provider-light connected" /><strong>今日 AI 情报</strong><small>更新于 {generatedAt}</small></div><div><span><b>{data?.totalItems || '—'}</b> 条新闻</span><span><b>{data?.sourceCount || '—'}</b> 个来源</span><span><b>{data?.curated.length || '—'}</b> 条精选</span></div></header><div className="radar-controls"><nav>{radarCategories.map((item) => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</nav><div className="radar-mode"><button className={mode === 'curated' ? 'active' : ''} onClick={() => setMode('curated')}>精选</button><button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>全部</button></div></div><div className="radar-scroll">{error ? <div className="radar-state"><span>!</span><h3>新闻数据暂时无法连接</h3><p>{error}</p><button onClick={() => setReload((value) => value + 1)}>重新加载</button></div> : !data ? <div className="radar-state"><span className="radar-loader" /><h3>正在读取今日 AI 新闻</h3><p>只进行在线读取，不会把新闻内容保存到电脑。</p></div> : !filtered.length ? <div className="radar-state"><span>○</span><h3>当前分类暂无新闻</h3><p>切换分类或“全部”模式查看更多内容。</p></div> : <><section className="radar-top"><header><div><span>TOP STORIES</span><h3>今日重点</h3></div><small>{mode === 'curated' ? '编辑精选' : '最新情报'} · {filtered.length} 条</small></header><div>{topStories.map((story, index) => <RadarStoryCard story={story} rank={index + 1} featured key={story.id} />)}</div></section><section className="radar-feed"><header><div><span>CHRONOLOGICAL FEED</span><h3>时间线</h3></div><small>点击任一条目打开原始新闻详情</small></header><div>{timelineStories.map((story, index) => <RadarStoryCard story={story} rank={index + 4} key={story.id} />)}</div></section></>}</div></section></div>
}

function RadarStoryCard({ story, rank, featured = false }: { story: RadarStory; rank: number; featured?: boolean }) {
  const publishedAt = story.publishedAt ? new Date(story.publishedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未知'
  const categoryLabel = radarCategories.find((item) => item.id === story.category)?.label || '来源'
  return <a className={`radar-story ${featured ? 'featured' : ''}`} href={story.url} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); void api.openExternal(story.url) }}><div className="radar-story-meta"><span>#{rank}</span><span className={`radar-kind kind-${story.category}`}>{categoryLabel}</span>{story.score && <span>AI {story.score}分</span>}<time>{publishedAt}</time></div><h4>{story.title}</h4>{story.titleEn && !story.title.includes(story.titleEn) && <p className="radar-title-en">{story.titleEn}</p>}<p className="radar-why"><b>为什么值得关注</b>{story.reason}</p><footer><div>{story.sourceNames.slice(0, 3).map((source) => <span key={source}>{source}</span>)}</div><strong>{story.sourceCount} 个来源 ↗</strong></footer></a>
}


function CloudSyncPanel({ onNotice, onSynced }: { onNotice: (text: string, tone?: Notice['tone']) => void; onSynced: () => Promise<void> }) {
  const [status, setStatus] = useState(() => api.cloudStatus())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const refreshStatus = () => setStatus(api.cloudStatus())
  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true)
    try { await action(); refreshStatus(); onNotice(success) } catch (error) { onNotice(String(error), 'danger') } finally { setBusy(false) }
  }
  return <section className="settings-section cloud-sync-panel"><header><div><h2>网页端与跨设备同步</h2><p>同步只在你登录后执行；AI 不会自动关联项目、目标、任务或存入知识。</p></div><span className={`connection-badge ${status.signedIn ? 'connected' : ''}`}>{status.signedIn ? `已登录${status.email ? ` · ${status.email}` : ''}` : status.configured ? '等待登录' : '等待云端配置'}</span></header>{!status.configured ? <p className="muted">尚未检测到 Supabase 环境变量。部署前请按 docs/WEB_AND_SYNC_SETUP.md 配置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY。</p> : status.signedIn ? <div className="settings-actions"><button className="primary" disabled={busy} onClick={() => run(async () => { await api.syncNow(); await onSynced() }, '本机与云端已同步。')}>{busy ? '同步中…' : '立即同步'}</button><button disabled={busy} onClick={() => run(async () => { await api.signOutFromCloud() }, '已退出同步账户；本机数据未删除。')}>退出同步账户</button>{status.lastSyncedAt && <span className="muted">上次同步：{formatDate(status.lastSyncedAt, true)}</span>}</div> : <div className="settings-fields cloud-sync-fields"><label>同步邮箱<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><label>同步密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位" /></label><button className="button primary" disabled={busy || !email || !password} onClick={() => run(async () => { await api.signInToCloud(email, password); await onSynced() }, '登录成功，已完成首次同步。')}>{busy ? '登录中…' : '登录并同步'}</button><button className="button ghost" disabled={busy || !email || !password} onClick={() => run(async () => { await api.signUpForCloud(email, password) }, '注册请求已提交；如启用了邮箱确认，请先完成邮箱验证。')}>注册</button></div>}</section>
}

function SettingsView({ themePreference, activeTheme, onThemeChange, config, captureConfig, onSaveAiProvider, onSaveCaptureProvider, onExport, onBackup, backups, onRestoreBackup, onRestoreRecord }: { themePreference: ThemePreference; activeTheme: 'dark' | 'light'; onThemeChange: (theme: ThemePreference) => void; config: HackStartConfig | null; captureConfig: CaptureProviderConfig | null; onSaveAiProvider: (provider: AiProviderId, key: string, model: string) => void; onSaveCaptureProvider: (provider: CaptureProviderId, key: string) => void; onExport: (format: 'json' | 'markdown' | 'csv') => void; onBackup: () => void; backups: BackupInfo[]; onRestoreBackup: (path: string) => void; onRestoreRecord: (id: string) => Promise<void> }) {
  const [provider, setProvider] = useState<AiProviderId>(config?.provider || 'hackstart')
  const selectedProvider = config?.providers.find((item) => item.id === provider)
  const [key, setKey] = useState(''); const [redfoxKey, setRedfoxKey] = useState(''); const [apifyKey, setApifyKey] = useState(''); const [tikhubKey, setTikhubKey] = useState(''); const [scrapeCreatorsKey, setScrapeCreatorsKey] = useState(''); const [model, setModel] = useState(selectedProvider?.model || 'gpt-5.5'); const [archived, setArchived] = useState<RecordData[]>([])
  useEffect(() => { if (config?.provider) setProvider(config.provider) }, [config?.provider])
  useEffect(() => { const selected = config?.providers.find((item) => item.id === provider); setKey(''); if (selected) setModel(selected.model || selected.models[0]?.id || '') }, [provider, config])
  useEffect(() => { api.archived().then(setArchived) }, [])
  return <div className="settings-page"><section className="settings-section appearance-section"><header><div><h2>界面外观</h2><p>选择深色、白色，或按本机时间自动切换。</p></div><span className="connection-badge connected">当前：{activeTheme === 'light' ? '白色' : '深色'}</span></header><div className="theme-options">{([{ value: 'light', label: '白色' }, { value: 'dark', label: '深色' }, { value: 'auto', label: '自动' }] as { value: ThemePreference; label: string }[]).map((option) => <button key={option.value} className={themePreference === option.value ? 'active' : ''} onClick={() => onThemeChange(option.value)}><strong>{option.label}</strong><small>{option.value === 'auto' ? '07:00–19:00 白色' : option.value === 'light' ? '清爽白色界面' : '保留深色界面'}</small>{themePreference === option.value && <b>✓</b>}</button>)}</div></section><section className="settings-section"><header><div><h2>AI 服务商与模型</h2><p>每个服务商使用独立 API Key，并分别保存在 应用私有凭据文件（权限 0600）。</p></div><span className={`connection-badge ${selectedProvider?.configured ? 'connected' : ''}`}>{selectedProvider?.configured ? '已配置' : '未配置'}</span></header><div className="provider-tabs">{config?.providers.map((item) => <button key={item.id} className={provider === item.id ? 'active' : ''} onClick={() => setProvider(item.id)}><span className={`provider-light ${item.configured ? 'connected' : ''}`} /><strong>{item.label}</strong><small>{item.model}</small></button>)}</div><div className="model-catalog">{selectedProvider?.models.map((item) => <button key={item.id} className={model === item.id ? 'active' : ''} onClick={() => setModel(item.id)}><span>{model === item.id ? '●' : '○'}</span><div><strong>{item.label}</strong><small>{item.description}</small></div></button>)}</div><div className="settings-fields provider-settings"><label>{selectedProvider?.label || 'AI'} API Key<input type="password" autoComplete="off" placeholder={selectedProvider?.configured ? '已配置；留空保留当前 Key' : `粘贴 ${selectedProvider?.label || ''} API Key`} value={key} onChange={(event) => setKey(event.target.value)} /></label><label>当前模型<select value={model} onChange={(event) => setModel(event.target.value)}>{selectedProvider?.models.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><button className="button primary" onClick={() => onSaveAiProvider(provider, key, model)}>保存、测试并启用</button></div><p className="provider-endpoint">API Endpoint：{selectedProvider?.baseUrl}{provider === 'minimax' ? ' · 中国大陆 Token Plan（Anthropic Messages）' : ''}</p></section><section className="settings-section capture-provider-section"><header><div><h2>采集服务与 External Intelligence Provider</h2><p>Provider 只负责读取外部数据，原始响应进入本机 External Intelligence 缓存；API 凭据保存在应用私有凭据文件（权限 0600），不会进入 SQLite、导出或 AI Prompt。</p></div><span className={`connection-badge ${captureConfig?.providers.some((item) => item.configured) ? 'connected' : ''}`}>{captureConfig?.providers.some((item) => item.configured) ? '已有 Provider' : '未配置'}</span></header>{captureConfig?.providers.map((item) => { if (item.id === 'redfox') return <div className="capture-provider-card" key={item.id}><div><strong>RedFoxHub</strong><small>微信公众号 · 抖音 · 小红书</small></div><label>RedFox API Key<input type="password" autoComplete="off" value={redfoxKey} onChange={(event) => setRedfoxKey(event.target.value)} placeholder={item.configured ? '已配置；留空保留当前 Key' : '粘贴 RedFox API Key'} /></label><button className="button primary" onClick={() => { onSaveCaptureProvider('redfox', redfoxKey); setRedfoxKey('') }}>保存并测试</button></div>; if (item.id === 'apify') return <div className="capture-provider-card" key={item.id}><div><strong>Apify</strong><small>网页 · 公众号 · 抖音 · 小红书 · X · Instagram · Facebook · Reddit · TikTok · YouTube</small></div><label>Apify API Token<input type="password" autoComplete="off" value={apifyKey} onChange={(event) => setApifyKey(event.target.value)} placeholder={item.configured ? '已配置；留空保留当前 Token' : '粘贴 Apify API Token'} /></label><button className="button primary" onClick={() => { onSaveCaptureProvider('apify', apifyKey); setApifyKey('') }}>保存并测试</button></div>; if (item.id === 'tikhub') return <div className="capture-provider-card" key={item.id}><div><strong>TikHub</strong><small>抖音 · TikTok · 小红书 · X · Instagram · Reddit · YouTube · 微信公众号</small></div><label>TikHub API Key<input type="password" autoComplete="off" value={tikhubKey} onChange={(event) => setTikhubKey(event.target.value)} placeholder={item.configured ? '已配置；留空保留当前 Key' : '粘贴 TikHub API Key'} /></label><button className="button primary" onClick={() => { onSaveCaptureProvider('tikhub', tikhubKey); setTikhubKey('') }}>保存并测试</button></div>; return <div className="capture-provider-card" key={item.id}><div><strong>Scrape Creators</strong><small>TikTok · Instagram · YouTube · Facebook · X · Reddit</small></div><label>Scrape Creators API Key<input type="password" autoComplete="off" value={scrapeCreatorsKey} onChange={(event) => setScrapeCreatorsKey(event.target.value)} placeholder={item.configured ? '已配置；留空保留当前 Key' : '粘贴 Scrape Creators API Key'} /></label><button className="button primary" onClick={() => { onSaveCaptureProvider('scrapecreators', scrapeCreatorsKey); setScrapeCreatorsKey('') }}>保存并测试</button></div>})}</section><section className="settings-section"><header><div><h2>数据所有权</h2><p>核心数据保存在本机 SQLite，可完整导出、备份和恢复。</p></div></header><div className="settings-actions"><button onClick={() => onExport('json')}>导出 JSON</button><button onClick={() => onExport('markdown')}>导出 Markdown</button><button onClick={() => onExport('csv')}>导出 CSV</button><button className="primary" onClick={onBackup}>创建 SQLite 快照</button></div></section><section className="settings-section"><header><div><h2>本地备份</h2><p>恢复前会自动保存当前数据库，避免覆盖错误。</p></div></header>{backups.length ? <div className="backup-list">{backups.slice(0, 8).map((backup) => <div key={backup.path}><div><strong>{backup.name}</strong><small>{formatDate(backup.modified, true)} · {(backup.size / 1024).toFixed(1)} KB</small></div><button onClick={() => onRestoreBackup(backup.path)}>恢复</button></div>)}</div> : <GuidedEmpty icon="↺" title="还没有本地备份" text="创建 SQLite 快照后，可以随时恢复到这个状态。" action="创建第一个备份" onAction={onBackup} />}</section><section className="settings-section"><header><div><h2>归档</h2><p>重要记录不会直接永久删除。归档后可随时恢复。</p></div><span>{archived.length} 条</span></header>{archived.length ? <div className="archive-list">{archived.map((record) => <div key={record.id}><div><span>{configFor(record.entity).icon}</span><strong>{titleFor(record)}</strong><small>{configFor(record.entity).label}</small></div><button onClick={async () => { await onRestoreRecord(record.id); setArchived(await api.archived()) }}>恢复</button></div>)}</div> : <p className="muted">归档箱为空。</p>}</section></div>
}

function SearchOverlay({ query, results, selectedEntities, onToggleEntity, onOpen, onClose }: { query: string; results: RecordData[]; selectedEntities: Entity[]; onToggleEntity: (entity: Entity) => void; onOpen: (record: RecordData) => void; onClose: () => void }) {
  const filters = entities.filter((config) => ['goals', 'projects', 'tasks', 'timeLogs', 'events', 'people', 'knowledge', 'notes', 'hypotheses', 'experiments', 'results', 'deliverables', 'resultPackages', 'workflows', 'workflowVersions', 'workflowRuns', 'workflowImprovementProposals', 'reviews', 'insights', 'principles', 'mentalModels', 'decisions'].includes(config.entity))
  return <div className="overlay-backdrop search-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="search-overlay"><header><div><p>全局搜索</p><h2>{query ? `“${query}”` : '最近更新'}</h2></div><button onClick={onClose}>×</button></header><div className="search-filters">{filters.map((config) => <button key={config.entity} className={selectedEntities.includes(config.entity) ? 'active' : ''} onClick={() => onToggleEntity(config.entity)}>{config.icon} {config.label}</button>)}</div><div className="search-results">{results.length ? results.map((record) => <button key={record.id} onClick={() => onOpen(record)}><span className="search-icon">{configFor(record.entity).icon}</span><div><div><strong>{titleFor(record)}</strong><span>{configFor(record.entity).label}</span></div><p>{descriptionFor(record) || '打开查看完整内容与关联。'}</p><small>{formatDate(record.updatedAt)} · {relationSummary(record)}</small></div></button>) : <GuidedEmpty icon="⌕" title={query ? '没有找到匹配记录' : '开始输入关键词'} text="可搜索标题、正文、标签、实体和关联字段。" action="关闭" onAction={onClose} />}</div></section></div>
}

function CommandPalette({ actions, onClose }: { actions: { label: string; hint: string; icon: string; run: () => void }[]; onClose: () => void }) {
  const [query, setQuery] = useState(''); const filtered = actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase()))
  return <div className="overlay-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="command-palette"><div className="palette-input"><span>⌘</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入命令..." /><kbd>Esc</kbd></div><div>{filtered.map((action) => <button key={action.label} onClick={action.run}><span>{action.icon}</span><strong>{action.label}</strong><small>{action.hint}</small></button>)}</div></section></div>
}

function AiDrawer({ config, chat, draft, busy, context, onDraft, onSend, onConfirmAction, onCancelAction, onViewAction, onSelectModel, onClose, onSettings }: { config: HackStartConfig | null; chat: ChatMessage[]; draft: string; busy: boolean; context: RecordData[]; onDraft: (value: string) => void; onSend: (preset?: string) => void; onConfirmAction: (actionId: string) => void; onCancelAction: (actionId: string) => void; onViewAction: (action: AgentAction) => void; onSelectModel: (provider: AiProviderId, model: string) => void; onClose: () => void; onSettings: () => void }) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const [attachments, setAttachments] = useState<{ name: string; size: number; type: string; url?: string }[]>([])
  const chatRef = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const node = chatRef.current
    if (!node) return
    const frame = window.requestAnimationFrame(() => node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' }))
    return () => window.cancelAnimationFrame(frame)
  }, [chat, busy])
  useEffect(() => {
    if (!modelMenuOpen) return
    const handler = (event: MouseEvent) => { if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) setModelMenuOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [modelMenuOpen])
  const currentProvider = config?.providers.find((provider) => provider.id === config.provider)
  const currentModel = currentProvider?.models.find((model) => model.id === config?.model)
  const availableModels = config?.providers.flatMap((provider) => provider.configured ? provider.models.map((model) => ({ provider, model })) : []) || []
  const selectModel = (provider: AiProviderId, model: string) => { setModelMenuOpen(false); onSelectModel(provider, model) }
  const sendWithAttachments = () => {
    const attInfo = attachments.length ? '\n\n[附件: ' + attachments.map((a) => a.name).join(', ') + ']' : ''
    onSend(draft + attInfo); setAttachments([])
  }
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    setAttachments((prev) => [...prev, ...files.map((f) => ({ name: f.name, size: f.size, type: f.type, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined }))])
    event.target.value = ''
  }
  return <aside className="ai-drawer"><header><div><span>AI</span><div className="ai-drawer-title"><strong>Jason OS 首席助理</strong><small>{config?.configured ? `当前：${currentProvider?.label || config.providerLabel} · ${currentModel?.label || config.model} · 拖动左侧边界调整宽度` : '尚未配置 API'}</small></div></div><button onClick={onClose}>×</button></header>{context.length > 0 && <div className="ai-context"><p>当前上下文</p>{context.map((record) => <span key={record.id}>{configFor(record.entity).icon} {titleFor(record)}</span>)}</div>}<div className="ai-chat" ref={chatRef}>{chat.length ? chat.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}><span>{message.role === 'assistant' ? 'AI' : '你'}</span><div className="ai-message-body"><p>{message.content}</p>{message.action && <AiActionCard action={message.action} busy={busy} onConfirm={onConfirmAction} onCancel={onCancelAction} onView={onViewAction} />}</div></article>) : <div className="ai-empty"><h2>基于你的记录，也能替你执行。</h2><p>AI 会理解当前页面、调用本地工具，并在确认后把内容真正写入 Jason OS。</p><button onClick={() => onSend('这个页面最值得关注的问题是什么？')}>这个页面最大的问题是什么？</button><button onClick={() => onSend('根据过去类似记录，我现在有什么风险？')}>我现在有什么风险？</button><button onClick={() => onSend('最近一个月时间主要花在哪里？')}>我的时间花在哪里？</button></div>}{busy && <article className="assistant loading"><span>AI</span><div className="ai-message-body"><p>正在理解意图、检索上下文并校验可执行操作…</p></div></article>}</div>{config?.configured ? <><input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileSelect} /><div className="ai-composer">{attachments.length > 0 && <div className="ai-attachments">{attachments.map((att, i) => <span key={i} className="ai-attachment-chip">{att.url && <img src={att.url} alt={att.name} />}<span className="ai-attachment-name">{att.name}</span><button onClick={() => setAttachments(attachments.filter((_, j) => j !== i))}>×</button></span>)}</div>}<div className="ai-composer-input"><textarea value={draft} onChange={(event) => onDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendWithAttachments() } }} placeholder="询问或让 Jason OS 执行操作..." /><div className="ai-composer-bar"><button className="ai-attach" onClick={() => fileInputRef.current?.click()} title="添加文件、图片"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button><div className="ai-composer-model" ref={modelMenuRef}><button ref={modelTriggerRef} className="ai-composer-model-trigger" aria-expanded={modelMenuOpen} onClick={() => { if (modelTriggerRef.current) { const rect = modelTriggerRef.current.getBoundingClientRect(); setMenuStyle({ position: "fixed", bottom: window.innerHeight - rect.top + 6, right: window.innerWidth - rect.right, width: 270 }); } setModelMenuOpen(!modelMenuOpen); }}><span>{currentModel?.label || config.model}</span><i>{modelMenuOpen ? '⌃' : '⌄'}</i></button>{modelMenuOpen && <div className="ai-composer-model-menu" style={menuStyle}><header><strong>选择模型</strong><small>{availableModels.length} 个可用</small></header>{availableModels.map(({ provider, model }) => { const current = provider.id === config.provider && model.id === config.model; return <button key={`${provider.id}:${model.id}`} className={current ? 'active' : ''} onClick={() => selectModel(provider.id, model.id)}><span>{current ? '✓' : '○'}</span><div><strong>{model.label}</strong><small>{provider.label}</small></div></button> })}</div>}</div><button className="ai-send" onClick={() => sendWithAttachments()} disabled={busy || !draft.trim()}><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 11V3M3 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button></div></div></div></> : <div className="ai-config-needed"><p>配置任一 AI 服务商的 API Key 后即可使用上下文感知分析和 Action。</p><button className="button primary" onClick={onSettings}>前往设置</button></div>}</aside>
}

function AiActionCard({ action, busy, onConfirm, onCancel, onView }: { action: AgentAction; busy: boolean; onConfirm: (actionId: string) => void; onCancel: (actionId: string) => void; onView: (action: AgentAction) => void }) {
  const status = { PENDING: '等待处理', CONFIRM_REQUIRED: '等待确认', EXECUTING: '正在执行', SUCCESS: '执行成功', FAILED: '执行失败', CANCELLED: '已取消' }[action.status]
  return <section className={`ai-action-card status-${action.status.toLowerCase()}`}><header><div><span>{action.status === 'SUCCESS' ? '✓' : action.status === 'FAILED' ? '!' : '→'}</span><div><strong>{action.previewTitle}</strong><small>{status} · {action.riskLevel === 'LOW_WRITE' ? '普通写入' : action.riskLevel === 'MEDIUM_WRITE' ? '重要写入' : action.riskLevel}</small></div></div></header>{action.previewFields?.length > 0 && <dl>{action.previewFields.map((field) => <div key={`${field.label}:${field.value}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}{action.error && <p className="ai-action-error">{action.error}</p>}<footer>{action.status === 'CONFIRM_REQUIRED' && <><button onClick={() => onCancel(action.actionId)} disabled={busy}>取消</button><button className="confirm" onClick={() => onConfirm(action.actionId)} disabled={busy}>确认执行</button></>}{action.status === 'SUCCESS' && action.result && <button className="confirm" onClick={() => onView(action)}>查看{configFor(action.entityType).singular}</button>}</footer></section>
}

function TimerStartModal({ initial, records, onClose, onStart }: { initial: Partial<RecordData>; records: RecordData[]; onClose: () => void; onStart: (context: Partial<RecordData>) => Promise<void> }) {
  const initialTaskId = initial.entity === 'tasks' ? String(initial.id || '') : String(initial.taskId || '')
  const initialProjectId = initial.entity === 'projects' ? String(initial.id || '') : String(initial.projectId || '')
  const initialGoalId = initial.entity === 'goals' ? String(initial.id || '') : String(initial.goalId || '')
  const [taskId, setTaskId] = useState(initialTaskId)
  const [projectId, setProjectId] = useState(initialProjectId)
  const [goalId, setGoalId] = useState(initialGoalId)
  const task = records.find((record) => record.id === taskId && record.entity === 'tasks')
  const project = records.find((record) => record.id === (task?.projectId || projectId) && record.entity === 'projects')
  const goal = records.find((record) => record.id === (task?.goalId || project?.goalId || goalId) && record.entity === 'goals')
  const chooseTask = (id: string) => { setTaskId(id); if (!id) return; const selected = records.find((record) => record.id === id); setProjectId(String(selected?.projectId || '')); setGoalId(String(selected?.goalId || '')) }
  const chooseProject = (id: string) => { setTaskId(''); setProjectId(id); const selected = records.find((record) => record.id === id); setGoalId(String(selected?.goalId || '')) }
  const chooseGoal = (id: string) => { setTaskId(''); setProjectId(''); setGoalId(id) }
  const title = task ? titleFor(task) : project ? titleFor(project) : goal ? titleFor(goal) : '专注工作'
  return <div className="overlay-backdrop timer-backdrop"><section className="timer-start-modal"><header><div><p>开始计时</p><h2>正在做什么？</h2><span>选择最具体的对象，系统自动继承上级上下文。</span></div><button onClick={onClose}>×</button></header><div className="timer-context-fields"><label>任务<select value={taskId} onChange={(event) => chooseTask(event.target.value)}><option value="">不选择任务</option>{records.filter((record) => record.entity === 'tasks').map((record) => <option key={record.id} value={record.id}>{titleFor(record)}</option>)}</select></label><label>项目<select value={String(project?.id || projectId)} disabled={Boolean(taskId)} onChange={(event) => chooseProject(event.target.value)}><option value="">不选择项目</option>{records.filter((record) => record.entity === 'projects').map((record) => <option key={record.id} value={record.id}>{titleFor(record)}</option>)}</select></label><label>目标<select value={String(goal?.id || goalId)} disabled={Boolean(taskId || projectId)} onChange={(event) => chooseGoal(event.target.value)}><option value="">不关联</option>{records.filter((record) => record.entity === 'goals').map((record) => <option key={record.id} value={record.id}>{titleFor(record)}</option>)}</select></label></div><div className="timer-inheritance"><strong>{title}</strong><span>任务：{task ? titleFor(task) : '—'}</span><span>项目：{project ? titleFor(project) : '—'}</span><span>目标：{goal ? titleFor(goal) : '—'}</span></div><footer><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" onClick={() => onStart({ title, taskId: task?.id, projectId: project?.id, goalId: goal?.id })}>▶ 开始计时</button></footer></section></div>
}

const formDataFor = (config: EntityConfig, value: Partial<RecordData>) => {
  const data = { ...value } as Record<string, unknown>
  config.fields.filter((field) => field.type === 'money').forEach((field) => { if (data[field.key] !== undefined && data[field.key] !== '') data[field.key] = minorToDecimal(data[field.key], String(data[field.currencyKey || 'currency'] || 'CNY')) })
  return data
}
const recordDataFor = (config: EntityConfig, value: Record<string, unknown>) => {
  const data = { ...value }
  config.fields.filter((field) => field.type === 'money').forEach((field) => { if (data[field.key] !== undefined && data[field.key] !== '') data[field.key] = decimalToMinor(data[field.key], String(data[field.currencyKey || 'currency'] || 'CNY')) })
  return data
}

function fieldVisible(entity: Entity, key: string, data: Record<string, unknown>) {
  if (entity === 'results') {
    const kind = String(data.metricKind || 'QUALITATIVE')
    if (['currency', 'targetAmountMinor', 'actualAmountMinor', 'varianceAmountMinor'].includes(key)) return kind === 'MONEY'
    if (['targetValue', 'actualValue', 'varianceValue', 'unit'].includes(key)) return ['NUMBER', 'TIME', 'PERCENTAGE'].includes(kind)
    if (key === 'achievementBps') return ['MONEY', 'NUMBER', 'TIME', 'PERCENTAGE'].includes(kind)
  }
  if (entity === 'financialTransactions') {
    const type = String(data.transactionType || '')
    if (key === 'destinationAccountId') return type === 'TRANSFER'
    if (['refundKind', 'refundOfTransactionId'].includes(key)) return type === 'REFUND'
    if (key === 'adjustmentDirection') return type === 'ADJUSTMENT'
    if (['baseAmountMinor', 'exchangeRate'].includes(key)) return Boolean(data.currency && data.baseCurrency && data.currency !== data.baseCurrency)
    if (key === 'voidReason') return data.status === 'VOIDED'
  }
  if (entity === 'financialAccounts' && key === 'verifiedAt') return data.evidenceStatus === 'VERIFIED'
  return true
}

function RecordModal({ config, record, initial, records, onClose, onSave }: { config: EntityConfig; record?: RecordData; initial?: Partial<RecordData>; records: RecordData[]; onClose: () => void; onSave: (entity: Entity, data: Partial<RecordData>) => Promise<void> }) {
  const [data, setData] = useState<Record<string, unknown>>(() => formDataFor(config, { status: defaultStatus(config.entity), ...(initial || {}), ...(record || {}) }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); try { await onSave(config.entity, recordDataFor(config, data) as Partial<RecordData>) } catch (reason) { setError(String(reason)) } finally { setSaving(false) } }
  const visibleFields = config.fields.filter((field) => fieldVisible(config.entity, field.key, data))
  const update = (key: string, value: unknown) => {
    const next = { ...data, [key]: value }
    if (key === 'taskId') { const task = records.find((item) => item.id === value && item.entity === 'tasks'); next.projectId = task?.projectId || ''; next.goalId = task?.goalId || '' }
    if (key === 'projectId' && !next.taskId) { const project = records.find((item) => item.id === value && item.entity === 'projects'); next.goalId = project?.goalId || '' }
    setData(next)
  }
  return <div className="overlay-backdrop form-backdrop"><form className="record-modal" onSubmit={submit}><header><div><p>{record ? '编辑记录' : '创建记录'} · {config.label}</p><h2>{record ? titleFor(record) : config.singular}</h2><span>{config.description}</span></div><button type="button" onClick={onClose}>×</button></header><div className="form-grid">{config.entity === 'inbox' && <div className="capture-hint full"><strong>链接智能采集</strong><p>粘贴公开链接后，Jason OS 会识别平台，读取标题、正文摘要、作者、封面和媒体元数据；无法解析时仍会保存原始链接和失败原因。</p></div>}{visibleFields.length ? visibleFields.map((field) => { const section = formSection(config.entity, field.key); const inherited = (field.key === 'goalId' && Boolean(data.projectId || data.taskId)) || (field.key === 'projectId' && Boolean(data.taskId)); return <Fragment key={field.key}>{section && <div className="form-section-label full">{section}</div>}<label className={field.multiline ? 'full' : ''}><span>{field.label}{inherited && <small>由上级自动关联</small>}</span>{field.relation ? <RelationInput field={field} value={data[field.key]} records={records} disabled={inherited} onChange={(value) => update(field.key, value)} /> : field.type === 'select' ? <select value={String(data[field.key] || '')} onChange={(event) => update(field.key, event.target.value)}><option value="">请选择…</option>{field.options?.map((item) => { const option = optionParts(item); return <option value={option.value} key={option.value}>{option.label}</option> })}</select> : field.multiline ? <textarea value={String(data[field.key] || '')} placeholder={field.placeholder} onChange={(event) => update(field.key, event.target.value)} /> : <input type={field.type === 'money' ? 'text' : field.type || 'text'} inputMode={field.type === 'money' ? 'decimal' : undefined} disabled={field.readOnly} value={String(data[field.key] || '')} placeholder={field.placeholder} onChange={(event) => update(field.key, field.type === 'number' ? Number(event.target.value) : event.target.value)} />}</label></Fragment> }) : <p className="muted">这是系统自动生成的审计记录。</p>}</div>{error && <p className="form-error">{error}</p>}<footer><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary" type="submit" disabled={saving}>{saving ? (config.entity === 'inbox' ? '正在读取链接…' : '正在保存…') : (config.entity === 'inbox' ? '读取并保存' : '保存到本机')}</button></footer></form></div>
}

function formSection(entity: Entity, key: string) {
  const starts: Partial<Record<Entity, Record<string, string>>> = {
    projects: { title: '基本信息', goalId: '所属关系', status: '执行属性', startDate: '时间与阻塞' },
    tasks: { title: '基本信息', projectId: '所属关系', status: '执行属性', tags: '辅助信息' },
    timeLogs: { title: '基本信息', taskId: '工作上下文', category: '辅助信息' },
    notes: { title: '基本信息', content: '正文', type: '分类', status: '状态', goalIds: '关联（可选）' },
    results: { title: '基本信息', outcomeType: '结果定义', targetAmountMinor: '预期与实际', expected: '定性描述与证据', taskId: '来源关系' }, financialAccounts: { name: '账户信息', evidenceStatus: '核验状态' }, financialCategories: { name: '分类信息' }, financialTransactions: { title: '交易事实', amountMinor: '金额与币种', occurredAt: '账户与业务关系', refundKind: '退款 / 调整', evidenceStatus: '证据与说明' }, reviews: { title: '基本信息', taskId: '复盘上下文' }, decisions: { title: '基本信息', decisionLevel: '预期与决策证据', evidenceSnapshotAt: '冻结的决策时上下文', date: '校准与实际', taskId: '关联上下文', principleIds: '调用模型' },
  }
  return starts[entity]?.[key]
}

function RelationMultiInput({ relation, value, records, disabled = false, onChange }: { relation: Entity; value: unknown; records: RecordData[]; disabled?: boolean; onChange: (value: unknown) => void }) {
  const [open, setOpen] = useState(false)
  const relationConfig = configFor(relation)
  const options = records.filter((record) => record.entity === relation)
  const current = Array.isArray(value) ? value.map(String) : String(value || '').split(',').filter(Boolean)
  const selected = current.map((id) => options.find((record) => record.id === id)).filter(Boolean) as RecordData[]
  const toggle = (id: string) => {
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    onChange(next)
  }
  return <div className="relation-multi"><button type="button" className="relation-multi-trigger" disabled={disabled} onClick={() => setOpen((state) => !state)}><span>{selected.length ? `已选择 ${selected.length} 项` : `选择${relationConfig.singular}（可选）`}</span><i>{open ? '⌃' : '⌄'}</i></button>{open && <div className="relation-multi-menu">{options.length ? options.map((record) => <label key={record.id}><input type="checkbox" checked={current.includes(record.id)} onChange={() => toggle(record.id)} /><span>{titleFor(record)}</span></label>) : <p className="muted">暂无{relationConfig.singular}（可不关联）</p>}</div>}{selected.length > 0 && <div className="relation-multi-chips">{selected.map((record) => <span key={record.id}>{titleFor(record)}<button type="button" onClick={() => toggle(record.id)}>×</button></span>)}</div>}</div>
}

function RelationInput({ field, value, records, disabled = false, onChange }: { field: EntityConfig['fields'][number]; value: unknown; records: RecordData[]; disabled?: boolean; onChange: (value: unknown) => void }) {
  const [added, setAdded] = useState<RecordData[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const relation = field.relation!
  const relationConfig = configFor(relation)
  const options = [...records.filter((record) => record.entity === relation), ...added.filter((record) => !records.some((item) => item.id === record.id))]
  const quickCreate = async () => {
    const title = name.trim(); if (!title) return
    const created = await api.save(relation, { [relationConfig.titleKey]: title, status: defaultStatus(relation) })
    setAdded((items) => [...items, created]); setName(''); setCreating(false); onChange(created.id)
  }
  if (field.multiple) return <RelationMultiInput relation={relation} value={value} records={records} disabled={disabled} onChange={onChange} />
  return <div className="relation-input"><select disabled={disabled} value={String(value || '')} onChange={(event) => onChange(event.target.value)}><option value="">{options.length ? '不关联' : `暂无${relationConfig.singular}（可不关联）`}</option>{options.map((record) => <option key={record.id} value={record.id}>{titleFor(record)}</option>)}</select>{!disabled && <button type="button" className="quick-relation-button" onClick={() => setCreating(!creating)}>＋ 新建{relationConfig.singular}</button>}{creating && <div className="quick-relation-create"><input autoFocus value={name} placeholder={`${relationConfig.singular}名称`} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); quickCreate() } }} /><button type="button" onClick={quickCreate}>创建并选中</button></div>}</div>
}

function RecordDrawer({ record, records, onClose, onEdit, onArchive, onCreate, onOpen, onStartTimer, onAddModel }: { record?: RecordData; records: RecordData[]; onClose: () => void; onEdit: (record: RecordData) => void; onArchive: (id: string) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void; onOpen: (record: RecordData) => void; onStartTimer: (record: RecordData) => void; onAddModel: (id: string) => void }) {
  const [related, setRelated] = useState<RecordData[]>([])
  useEffect(() => { if (record) api.relations(record.id).then(setRelated) }, [record])
  if (!record) return null
  const config = configFor(record.entity); const fields = config.fields.filter((field) => record[field.key] !== undefined && record[field.key] !== '' && !field.relation)
  const conversions = record.entity === 'notes' ? ['knowledge', 'insights', 'mentalModels', 'decisions', 'tasks', 'projects'] as Entity[] : record.entity === 'reviews' ? ['insights', 'knowledge', 'principles', 'mentalModels', 'decisions', 'tasks', 'workflowImprovementProposals'] as Entity[] : record.entity === 'results' ? ['reviews', 'deliverables', 'resultPackages'] as Entity[] : record.entity === 'inbox' ? ['tasks', 'knowledge', 'insights', 'hypotheses', 'decisions', 'events', 'projects'] as Entity[] : []
  const core = ['goals', 'projects', 'tasks'].includes(record.entity)
  return <aside className="record-drawer"><header><div><span>{config.icon}</span><p>{config.label}</p></div><button onClick={onClose}>×</button></header><div className="record-drawer-body"><ContextBreadcrumb record={record} records={records} onOpen={onOpen} /><div className="record-title"><span className="entity-pill">{record.entity === 'notes' ? noteTypeLabel(record.type) : statusLabel(record.status)}</span><h2>{titleFor(record)}</h2><p>{descriptionFor(record)}</p>{core && <div className="detail-primary-actions"><button onClick={() => onStartTimer(record)}>▶ 开始计时</button>{record.entity === 'goals' && <button onClick={() => onCreate('projects', { goalId: record.id })}>＋ 创建项目</button>}{record.entity === 'projects' && <button onClick={() => onCreate('tasks', { projectId: record.id, goalId: record.goalId })}>＋ 创建任务</button>}{record.entity === 'tasks' && <button onClick={() => onCreate('results', { taskId: record.id, projectId: record.projectId, goalId: record.goalId, date: today() })}>＋ 记录结果</button>}</div>}{record.entity === 'mentalModels' && <div className="detail-primary-actions"><button onClick={() => onAddModel(record.id)}>＋ 加入本次决策分析</button></div>}</div>{record.entity === 'goals' && <GoalSnapshot goal={record} records={records} onOpen={onOpen} />}{core && <RelationshipOverview record={record} records={records} onOpen={onOpen} />}{fields.length > 0 && <section className="detail-fields">{fields.map((field) => <div key={field.key}><small>{field.label}</small><p>{field.type?.includes('date') ? formatDate(record[field.key], field.type === 'datetime-local') : field.type === 'money' ? formatMoneyMinor(String(record[field.key]), String(record[field.currencyKey || 'currency'] || 'CNY')) : field.key === 'achievementBps' ? `${(Number(record[field.key]) / 100).toFixed(2)}%` : String(record[field.key])}</p></div>)}</section>}{conversions.length > 0 && <section className="convert-actions"><h3>{record.entity === 'notes' ? '沉淀为' : record.entity === 'reviews' ? '从复盘提炼' : record.entity === 'inbox' ? '转换为' : '进入下一步'}</h3><div>{conversions.map((entity) => <button key={entity} onClick={() => onCreate(entity, conversionInitial(record, entity))}>＋ {configFor(entity).singular}</button>)}</div></section>}<section className="related-section"><h3>全部关联 <span>{related.length}</span></h3>{related.length ? related.map((item) => <button key={item.id} onClick={() => onOpen(item)}><span>{configFor(item.entity).icon}</span><div><strong>{titleFor(item)}</strong><small>{configFor(item.entity).label} · {String(item.relationType || '').replace('field:', '')}</small></div></button>) : <p>还没有关联记录。选择任务或项目后，上级上下文会自动建立。</p>}</section></div><footer>{(record.entity !== 'financialTransactions' || record.status === 'DRAFT') && <button className="button ghost" onClick={() => onArchive(record.id)}>归档</button>}<button className="button primary" onClick={() => onEdit(record)}>编辑</button></footer></aside>
}

function ContextBreadcrumb({ record, records, onOpen }: { record: RecordData; records: RecordData[]; onOpen: (record: RecordData) => void }) {
  const goal = record.entity === 'goals' ? record : records.find((item) => item.id === record.goalId)
  const project = record.entity === 'projects' ? record : records.find((item) => item.id === record.projectId)
  const chain = [goal, project, record.entity === 'tasks' ? record : undefined].filter((item, index, items): item is RecordData => Boolean(item) && items.findIndex((candidate) => candidate?.id === item?.id) === index)
  if (!chain.length) return null
  return <nav className="record-breadcrumb">{chain.map((item, index) => <Fragment key={item.id}>{index > 0 && <span>/</span>}<button onClick={() => onOpen(item)}>{configFor(item.entity).singular} · {titleFor(item)}</button></Fragment>)}</nav>
}

function RelationshipOverview({ record, records, onOpen }: { record: RecordData; records: RecordData[]; onOpen: (record: RecordData) => void }) {
  const key = record.entity === 'goals' ? 'goalId' : record.entity === 'projects' ? 'projectId' : 'taskId'
  const related = records.filter((item) => item.id !== record.id && item[key] === record.id)
  const order: Entity[] = record.entity === 'goals' ? ['projects', 'tasks', 'timeLogs', 'results', 'deliverables', 'resultPackages', 'workflowRuns', 'reviews', 'decisions', 'insights'] : record.entity === 'projects' ? ['tasks', 'workflowRuns', 'timeLogs', 'financialTransactions', 'results', 'deliverables', 'resultPackages', 'reviews', 'decisions', 'knowledge', 'people', 'events'] : ['timeLogs', 'results', 'deliverables', 'reviews', 'knowledge', 'decisions']
  const minutes = related.filter((item) => item.entity === 'timeLogs').reduce((sum, item) => sum + durationMinutes(item), 0)
  return <section className="relationship-overview"><header><h3>上下文与反向关联</h3><span>总投入 {formatMinutes(minutes)}</span></header>{order.map((entity) => { const items = related.filter((item) => item.entity === entity); if (!items.length) return null; return <div key={entity}><strong>{configFor(entity).label} · {items.length}</strong>{items.slice(0, 5).map((item) => <button key={item.id} onClick={() => onOpen(item)}>{titleFor(item)}<span>›</span></button>)}</div> })}</section>
}

function GoalSnapshot({ goal, records, onOpen }: { goal: RecordData; records: RecordData[]; onOpen: (record: RecordData) => void }) {
  const related = records.filter((record) => linkedTo(record, goal.id)); const keyResults = related.filter((record) => record.entity === 'keyResults'); const projects = related.filter((record) => record.entity === 'projects')
  return <section className="goal-snapshot"><ProgressBar value={percent(goal.progress)} /><div className="goal-numbers"><span><strong>{keyResults.length}</strong> 关键结果</span><span><strong>{projects.length}</strong> 项目</span><span><strong>{related.filter((record) => record.entity === 'results').length}</strong> 最近结果</span></div>{projects.slice(0, 3).map((project) => <CompactRecord key={project.id} record={project} onOpen={onOpen} />)}</section>
}


function DashboardPanel({ title, action, onAction, className = '', children }: { title: string; action?: string; onAction?: () => void; className?: string; children: ReactNode }) { return <section className={`dashboard-panel ${className}`}><PanelHeader title={title} action={action} onAction={onAction} />{children}</section> }
function PanelHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) { return <header className="panel-header"><h3>{title}</h3>{action && <button onClick={onAction}>{action} →</button>}</header> }
function Metric({ label, value, hint, onClick }: { label: string; value: string; hint?: string; onClick?: () => void }) { return <button className="metric" onClick={onClick} disabled={!onClick}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</button> }
function GuidedEmpty({ icon, title, text, action, onAction }: { icon: string; title: string; text: string; action?: string; onAction?: () => void }) { return <div className="guided-empty"><span>{icon}</span><div><h3>{title}</h3><p>{text}</p>{action && <button onClick={onAction}>{action} →</button>}</div></div> }
function ProgressBar({ value }: { value: number }) { return <div className="progress"><span style={{ width: `${value}%` }} /><small>{Math.round(value)}%</small></div> }
function ProgressRing({ value }: { value: number }) { return <div className="progress-ring" style={{ '--progress': `${value * 3.6}deg` } as React.CSSProperties}><span>{Math.round(value)}%</span></div> }
function CompactRecord({ record, onOpen }: { record: RecordData; onOpen: (record: RecordData) => void }) { return <button className="compact-record" onClick={() => onOpen(record)}><span>{configFor(record.entity).icon}</span><div><strong>{titleFor(record)}</strong><small>{configFor(record.entity).label} · {formatDate(recordDate(record))}</small></div><b>›</b></button> }
function TaskRow({ task, records, number, onOpen, onTimer }: { task: RecordData; records: RecordData[]; number: number; onOpen: (record: RecordData) => void; onTimer: (record: RecordData) => void }) { return <div className="task-row"><span className="task-number">0{number}</span><button onClick={() => onOpen(task)}><strong>{titleFor(task)}</strong><small>{relationName(task.projectId, records) || '未分配项目'} · {task.dueDate ? formatDate(task.dueDate) : '无截止日期'}</small></button><button className="timer-icon" onClick={() => onTimer(task)}>▶</button></div> }
function ActionTask({ task, records, index, onOpen, onEdit, onComplete, onTimer }: { task: RecordData; records: RecordData[]; index?: number; onOpen: (record: RecordData) => void; onEdit: (record: RecordData) => void; onComplete: (record: RecordData) => void; onTimer: (record: RecordData) => void }) { return <div className={`action-task ${isOverdue(task) ? 'overdue' : ''}`}>{index && <span className="task-index">{index}</span>}<button className="check" onClick={() => onComplete(task)}>✓</button><button className="task-main" onClick={() => onOpen(task)}><strong>{titleFor(task)}</strong><small>{relationName(task.projectId, records) || '未分配项目'} · {task.dueDate ? formatDate(task.dueDate) : '未安排日期'} · 预计 {Number(task.estimateMinutes || 0)} 分钟</small></button><span className={`priority ${task.priority || 'medium'}`}>{priorityLabel(task.priority)}</span><button onClick={() => onTimer(task)}>▶</button><button onClick={() => onEdit(task)}>•••</button></div> }
function ProjectCompact({ project, records, onOpen }: { project: RecordData; records: RecordData[]; onOpen: (record: RecordData) => void }) { const tasks = records.filter((record) => record.entity === 'tasks' && linkedTo(record, project.id)); const done = tasks.filter((task) => task.status === 'completed').length; return <button className="project-compact" onClick={() => onOpen(project)}><div><span className={`health ${project.health || 'healthy'}`} /><strong>{titleFor(project)}</strong></div><ProgressBar value={tasks.length ? done / tasks.length * 100 : percent(project.progress)} /><small>{done}/{tasks.length} 任务 · {statusLabel(project.status)}</small></button> }
function TimeRow({ log, records, onEdit }: { log: RecordData; records: RecordData[]; onEdit: (record: RecordData) => void }) { return <button className="time-row" onClick={() => onEdit(log)}><time>{formatDate(log.startAt, true).split(' ')[1] || formatDate(log.startAt, true)}<span>—</span>{log.endAt ? formatDate(log.endAt, true).split(' ')[1] : '进行中'}</time><div><strong>{titleFor(log)}</strong><small>{relationName(log.projectId, records) || String(log.category || '未分配')} · {relationName(log.taskId, records)}</small></div><b>{formatMinutes(durationMinutes(log))}</b></button> }
function CompareBar({ label, value, max }: { label: string; value: number; max: number }) { return <div className="compare-bar"><span>{label}</span><div><i style={{ width: `${Math.min(100, value / max * 100)}%` }} /></div><strong>{formatMinutes(value)}</strong></div> }
function AllocationList({ items, empty }: { items: { label: string; minutes: number; percentage: number }[]; empty: string }) { return items.length ? <div className="allocation-list">{items.map((item) => <div key={item.label}><header><span>{item.label}</span><strong>{formatMinutes(item.minutes)}</strong></header><div><i style={{ width: `${item.percentage}%` }} /></div></div>)}</div> : <p className="empty-copy">{empty}</p> }
function AttentionList({ blockers, overdue, decisions, gaps, records, onOpen }: { blockers: RecordData[]; overdue: RecordData[]; decisions: RecordData[]; gaps: ReturnType<typeof detectContextGaps>; records: RecordData[]; onOpen: (record: RecordData) => void }) { const items = [...blockers.slice(0, 2), ...overdue.slice(0, 2), ...decisions.slice(0, 2)]; return items.length || gaps.length ? <div className="attention-list">{items.map((record) => <button key={record.id} onClick={() => onOpen(record)}><span className={record.entity === 'projects' ? 'warning' : record.entity === 'tasks' ? 'danger' : 'neutral'}>{configFor(record.entity).icon}</span><div><strong>{titleFor(record)}</strong><small>{record.entity === 'projects' ? String(record.blockers || '项目受阻') : record.entity === 'tasks' ? '任务已逾期' : statusLabel(record.status)}</small></div></button>)}{gaps.slice(0, Math.max(0, 5 - items.length)).map((gap) => { const record = records.find((item) => item.id === gap.entityId); return <button key={gap.id} onClick={() => record && onOpen(record)}><span className="warning">!</span><div><strong>{gap.title}</strong><small>{gap.detail}</small></div></button> })}</div> : <p className="empty-copy">当前没有明显阻塞、逾期任务、待决策事项或高价值闭环缺口。</p> }
function TimelineAiPanel({ scope, onAnalyze, onPrepare }: { scope: string; onAnalyze: (question: string) => void; onPrepare: (question: string) => void }) {
  const prompts = [
    ['总结当前范围', `请只做只读分析，基于当前筛选的时间线（${scope}）总结发生了什么。区分事实、计划和缺失证据，不要创建或修改任何记录。`],
    ['找出风险与阻塞', `请只做只读分析，检查当前筛选的时间线（${scope}）中的风险、阻塞、长期无结果事项和关系断点。引用具体记录，不要创建或修改任何记录。`],
    ['对比计划与实际', `请只做只读分析，对比当前筛选的时间线（${scope}）中的计划与实际投入，指出明显偏差和证据不足之处，不要创建或修改任何记录。`],
    ['识别重复模式', `请只做只读分析，检查当前筛选的时间线（${scope}）是否存在重复行为或重复问题。证据不足时明确说明，不要创建或修改任何记录。`],
  ]
  const actions = [
    ['生成复盘草稿', `基于当前筛选的时间线（${scope}），选择证据最完整的一条结果或任务，准备一条 createReview Action 预览。必须引用真实记录 ID；只生成预览，等待我确认后再写入。`],
    ['提取洞见草稿', `基于当前筛选的时间线（${scope}），从已有复盘或结果中提取一条有明确证据的洞见，准备一条 createInsight Action 预览。证据不足时不要创建；只生成预览，等待我确认。`],
    ['沉淀原则草稿', `基于当前筛选的时间线（${scope}），从已有洞见中提炼一条可复用原则，准备一条 createPrinciple Action 预览并保留来源洞见关系。只生成预览，等待我确认。`],
    ['形成思维模型草稿', `基于当前筛选的时间线（${scope}），仅在证据足够时把已有洞见整理成结构化思维模型，准备一条 createMentalModel Action 预览并保留来源关系。只生成预览，等待我确认。`],
  ]
  return <section className="timeline-ai-panel"><header><div><span>AI TIMELINE · EVIDENCE FIRST</span><h3>AI 时间线</h3></div><b>受控 Action</b></header><p>分析按钮不会修改业务记录；草稿按钮只生成 Action 预览，仍需你在右下角会话框确认后才会写入。</p><div className="timeline-ai-analysis">{prompts.map(([label, prompt]) => <button key={label} onClick={() => onAnalyze(prompt)}>{label}<span>→</span></button>)}</div><footer><strong>转化为可复用资产 · 确认后写入</strong><div>{actions.map(([label, prompt]) => <button key={label} onClick={() => onPrepare(prompt)}>{label}<span>＋</span></button>)}</div></footer></section>
}

function TimelineCausalPanel({ edges, onOpen }: { edges: TimelineCausalEdge[]; onOpen: (record: RecordData) => void }) {
  return <section className={`timeline-causal-panel ${edges.length ? '' : 'empty'}`}><header><div><span>CAUSE · EXPLICIT ONLY</span><h3>显式因果链</h3></div><b>{edges.length} 条关系</b></header>{edges.length ? <div className="timeline-causal-rows">{edges.map((edge) => <div className="timeline-causal-row" key={edge.id}><button onClick={() => onOpen(edge.source)}><span>{configFor(edge.source.entity).icon} {configFor(edge.source.entity).label}</span><strong>{titleFor(edge.source)}</strong></button><div><span>{edge.label}</span><i>→</i></div><button onClick={() => onOpen(edge.target)}><span>{configFor(edge.target.entity).icon} {configFor(edge.target.entity).label}</span><strong>{titleFor(edge.target)}</strong></button></div>)}</div> : <p>当前筛选范围内尚无显式因果关系。为任务选择来源决策、为结果选择任务、为复盘选择结果后，关系会自动出现在这里；系统不会根据时间接近自动猜测。</p>}</section>
}

function TimelineList({ items, records, causalEdges, onOpen }: { items: TimelineProjectionItem[]; records: RecordData[]; causalEdges: TimelineCausalEdge[]; onOpen: (record: RecordData) => void }) {
  const groups = groupTimelineItems(items)
  const openOriginal = (item: TimelineProjectionItem) => { const sourceId = item.record.entity === 'timelineEvents' ? item.record.sourceEntityId : item.record.id; onOpen(records.find((record) => record.id === sourceId) || item.record) }
  return <div className="timeline-groups">{groups.map((group) => <section className="timeline-day" key={group.key}><header><div><h3>{group.label}</h3><time>{group.key === 'unknown' ? '' : group.key}</time></div><span>{group.items.length} 条</span></header><div className="timeline-list">{group.items.map((item) => { const projectId = timelineProjectId(item); const goalId = timelineGoalId(item); const projectName = relationName(projectId, records); const goalName = relationName(goalId, records); const entityLabel = item.record.entity === 'timelineEvents' ? '状态变化' : configFor(item.record.entity).label; const description = item.record.entity === 'timelineEvents' ? `${String(item.record.beforeValue ?? '—')} → ${String(item.record.afterValue ?? '—')}` : descriptionFor(item.record); const incoming = causalEdges.filter((edge) => edge.targetId === item.record.id); const outgoing = causalEdges.filter((edge) => edge.sourceId === item.record.id); return <article className={`timeline-item kind-${item.record.entity} importance-${item.importance} meaning-${item.timeMeaning}`} key={item.id}><time>{timelineClock(item)}</time><span className="timeline-dot" /><button onClick={() => openOriginal(item)}><div className="timeline-card-meta"><span className="timeline-entity">{entityLabel}</span><span className={`timeline-meaning ${item.timeMeaning}`}>{timelineMeaningLabels[item.timeMeaning]}</span><span className="timeline-evidence">{timelineEvidenceLabels[item.evidenceLevel]}</span>{item.importance === 'key' && <span className="timeline-key">关键</span>}</div><strong>{titleFor(item.record)}</strong>{description && <p>{description}</p>}{(incoming.length > 0 || outgoing.length > 0) && <div className="timeline-card-causality">{incoming.slice(0, 2).map((edge) => <span key={edge.id}>← {edge.label} · {titleFor(edge.source)}</span>)}{outgoing.slice(0, 2).map((edge) => <span key={edge.id}>→ {edge.label} · {titleFor(edge.target)}</span>)}</div>}<footer>{projectName && <span>◈ {projectName}</span>}{goalName && <span>◎ {goalName}</span>}{!projectName && item.record.entity !== 'projects' && <span className="unlinked">未关联项目</span>}<b>打开原始记录 →</b></footer></button></article> })}</div></section>)}</div>
}

function timelineClock(item: TimelineProjectionItem) { if (item.record.timePrecision === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(item.occurredAt)) return item.timeMeaning === 'planned' ? '计划' : '全天'; const timestamp = timelineTimestamp(item.occurredAt); return timestamp ? new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—' }
function ModelEffectiveness({ model, records }: { model: RecordData; records: RecordData[] }) { const usages = records.filter((record) => record.entity === 'mentalModelUsages' && linkedTo(record, model.id)); const effective = usages.filter((record) => record.effective === 'yes').length; return <span>{usages.length} 次使用 · {usages.length ? Math.round(effective / usages.length * 100) : 0}% 有效</span> }

function allocation(logs: RecordData[], records: RecordData[]) { const grouped: Record<string, number> = {}; logs.forEach((log) => { const label = relationName(log.projectId, records) || String(log.category || '未分配'); grouped[label] = (grouped[label] || 0) + durationMinutes(log) }); const total = Object.values(grouped).reduce((sum, value) => sum + value, 0); return Object.entries(grouped).sort(([, a], [, b]) => b - a).map(([label, minutes]) => ({ label, minutes, percentage: total ? minutes / total * 100 : 0 })) }
function relationName(id: unknown, records: RecordData[]) { if (!id) return ''; return titleFor(records.find((record) => record.id === id) || {}) }
function relationSummary(record: RecordData) { const count = Object.entries(record).filter(([key, value]) => (key.endsWith('Id') || key.endsWith('Ids')) && (Array.isArray(value) ? value.length > 0 : Boolean(value && String(value).trim()))).length; return count ? `${count} 个关联字段` : '暂无关联' }
function priorityRank(value: unknown) { return ({ high: 0, medium: 1, low: 2 }[String(value)] ?? 3) }
function greeting() { const hour = new Date().getHours(); return hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好' }
function groupBy<T>(items: T[], key: (item: T) => string) { return items.reduce<Record<string, T[]>>((groups, item) => { const value = key(item); (groups[value] ||= []).push(item); return groups }, {}) }
function conversionInitial(source: RecordData, target: Entity): Partial<RecordData> { const common = { projectId: source.projectId, goalId: source.goalId }; if (target === 'reviews') return { ...common, resultId: source.id, title: `复盘：${titleFor(source)}`, whatHappened: source.actual || source.actualResult }; if (source.entity === 'reviews') { const content = source.lesson || source.doDifferently || source.whatHappened; if (target === 'insights') return { ...common, reviewId: source.id, statement: content, explanation: source.whyItHappened }; if (target === 'principles') return { statement: content, evidence: source.whatHappened, reviewIds: [source.id] }; if (target === 'knowledge') return { ...common, title: titleFor(source), content, reviewIds: [source.id] }; if (target === 'tasks') return { ...common, title: source.nextAction, status: 'todo' }; if (target === 'decisions') return { ...common, title: source.nextAction || titleFor(source), context: source.lesson, status: 'pending' } } if (source.entity === 'notes') { const noteContent = String(source.content || source.title || ''); if (target === 'knowledge') return { title: titleFor(source), content: noteContent, sourceNoteId: source.id }; if (target === 'insights') return { statement: noteContent, explanation: String(source.title || ''), sourceNoteId: source.id }; if (target === 'mentalModels') return { name: titleFor(source), definition: noteContent, coreIdea: noteContent, sourceNoteId: source.id }; if (target === 'decisions') return { title: titleFor(source), context: noteContent, sourceNoteId: source.id, status: 'pending' }; if (target === 'tasks') return { title: titleFor(source), description: noteContent, status: 'todo' }; if (target === 'projects') return { title: titleFor(source), description: noteContent, status: 'active' } } if (source.entity === 'inbox') return { ...common, title: source.content, content: source.content, statement: source.content, description: source.content }; return common }
function paletteActions({ setSearchOpen, setPaletteOpen, openCreate, startTimer, setAiOpen, setView }: { setSearchOpen: (value: boolean) => void; setPaletteOpen: (value: boolean) => void; openCreate: (entity: Entity, initial?: Partial<RecordData>) => void; startTimer: () => void; setAiOpen: (value: boolean) => void; setView: (view: View) => void }) { const run = (action: () => void) => () => { setPaletteOpen(false); action() }; return [{ label: '全局搜索', hint: '搜索所有本地记录', icon: '⌕', run: run(() => setSearchOpen(true)) }, { label: '打开收纳箱', hint: '收集、整理与笔记', icon: '▱', run: run(() => setView('notebook')) }, { label: '创建任务', hint: '添加下一步行动', icon: '□', run: run(() => openCreate('tasks')) }, { label: '创建项目', hint: '建立工作空间', icon: '◈', run: run(() => openCreate('projects')) }, { label: '开始计时', hint: '记录现实投入', icon: '▶', run: run(startTimer) }, { label: '创建决策', hint: '记录预测和理由', icon: '◆', run: run(() => openCreate('decisions', { date: today() })) }, { label: '创建复盘', hint: '从现实提炼学习', icon: '◑', run: run(() => openCreate('reviews')) }, { label: '创建知识', hint: '沉淀长期资产', icon: '⌘', run: run(() => openCreate('knowledge')) }, { label: '打开 AI 助理', hint: '基于当前上下文分析', icon: 'AI', run: run(() => setAiOpen(true)) }, { label: '打开今天', hint: '进入 Focus 工作视图', icon: '◉', run: run(() => setView('today')) }] }

export default App
