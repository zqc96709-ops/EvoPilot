import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import './productShell.css'
import { PRODUCT_EYEBROW, PRODUCT_NAME, PRODUCT_SEARCH_PLACEHOLDER, PRODUCT_TAGLINE, resolveUserIdentity } from './product'
import { profileSavePayload } from './profile'
import { buildAgentContext, buildContextRelationIndex, buildGlobalContext, detectGlobalIntent, shouldRetrieveGlobalContext } from './agent/contextEngine'
import type { AgentAction, AgentContext } from './agent/types'
import { buildRadarData, radarCategories, type RadarCategory, type RadarData, type RadarStory } from './aiNews'
import { mentalModelCategories, modelCategoryLabel, modelDefinition, modelSourcePerson, modelTrigger, type ModelRecommendation } from './mentalModels'
import { runDecisionEngine, impactLabel, urgencyLabel, reversibilityLabel, type DecisionAnalysis } from './decisionIntelligence'
import { accountBalanceMinor, decimalToMinor, financeDashboard, financialFacts, formatMoneyMinor, minorToDecimal, projectEconomics } from './finance'
import CommandCenterView from './CommandCenterView'
import FinanceIntelligenceView from './FinanceIntelligenceView'
import TodayCockpitView from './TodayCockpitView'
import TimeIntelligenceView from './TimeIntelligenceView'
import CognitiveCenterView from './CognitiveCenterView'
import TaskExecutionDashboardView from './TaskExecutionDashboardView'
import type { TaskDashboardPeriod } from './taskExecutionDashboard'
import ProjectIntelligenceView from './ProjectIntelligenceView'
import ResultsIntelligenceView from './ResultsIntelligenceView'
import DecisionIntelligenceView, { type DecisionCenterTab } from './DecisionIntelligenceView'
import SettingsWorkspace from './SettingsWorkspace'
import type { CognitivePeriod, CognitiveTab } from './cognitiveIntelligence'
import { type ExternalItem } from './externalIntelligence'
import { createResearchPlan, getConfiguredProviders, parseResearchSources, resolveResearchSources, type ResearchPlan, type ResearchSourcePlan } from './researchPlanner'
import { calendarDateKey, taskCalendarItems, type CalendarScope } from './calendar'
import { taskMatrixQuadrants, taskQuadrant } from './taskMatrix'
import { compareWorkChainRuns, workChainScorecard } from './workchain'
import { filterTimelineItems, groupTimelineItems, timelineCausalEdges, timelineGoalId, timelineProjectId, timelineProjection, timelineTimestamp, timelineEntityTypes, visibleTimelineCausalEdges, type TimelineCausalEdge, type TimelineFilter, type TimelineProjectionItem, type TimelineRange } from './timeline'
import { api, type AiProviderId, type BackupInfo, type CaptureProviderConfig, type CaptureProviderId, type ChatMessage, type HackStartConfig, type NotebookFilePreview } from './api'
import { durableNotebookHtml, imageFiles, notebookFileIds } from './notebookImages'
import { NoteAutosaveController, readNoteRecovery, writeNoteRecovery, type NoteDraftSnapshot, type NoteSaveState } from './noteAutosave'
import { belongsToNotebookCategory, isUnorganizedNotebookItem } from './notebookClassification'
import VoiceOperatingPanel from './voice/VoiceOperatingPanel'
import { routeVoiceIntent } from './voice/intentRouter'
import type { VoiceExecutionResult } from './voice/types'
import './voice/voiceSidebar.css'
import {
  configFor, descriptionFor, durationMinutes, entities, isActive, isOverdue, isToday, linkedTo, localDateKey,
  percent, priorityLabel, recordDate, statusLabel, timeline, titleFor,
  type Entity, type EntityConfig, type FieldOption, type RecordData,
} from './model'

type View = 'command' | 'today' | 'tasks' | 'time' | 'projects' | 'outcomes' | 'finance' | 'notebook' | 'cognition' | 'knowledge' | 'reviews' | 'insights' | 'principles' | 'mentalModels' | 'decisionCenter' | 'decisions' | 'events' | 'people' | 'timeline' | 'aiNews' | 'settings' | 'profile'
type EditState = { config: EntityConfig; record?: RecordData; initial?: Partial<RecordData> }
type Notice = { text: string; tone?: 'success' | 'danger' }
type TaskView = 'overview' | 'list' | 'kanban' | 'matrix' | 'calendar'
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
const pageTitleForVoice = (view: string) => ({ notebook: '收纳箱', tasks: '任务', projects: '项目', today: '今天', time: '时间', outcomes: '成果', finance: '财务', decisionCenter: '决策中心', cognition: '认知中心', command: '指挥中心' }[view] || '页面')
const optionParts = (option: FieldOption) => typeof option === 'string' ? { value: option, label: option } : option
const defaultStatus = (entity: Entity) => ({ tasks: 'todo', goals: 'active', projects: 'active', hypotheses: 'untested', experiments: 'planned', decisions: 'pending', inbox: 'unprocessed', notes: 'INBOX', notebookFiles: 'ACTIVE', results: 'PLANNED', deliverables: 'DRAFT', resultPackages: 'ACTIVE', workflows: 'ACTIVE', workflowVersions: 'EXPERIMENTAL', workflowRuns: 'PLANNED', workflowRunSteps: 'PLANNED', workflowImprovementProposals: 'DRAFT', financialAccounts: 'ACTIVE', financialCategories: 'ACTIVE', financialTransactions: 'POSTED' } as Partial<Record<Entity, string>>)[entity] || 'active'
const tagsFor = (record: RecordData) => Array.isArray(record.tags) ? record.tags.map(String).map((tag) => tag.trim()).filter(Boolean) : String(record.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean)

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
  const [view, setView] = useState<View>(() => localStorage.getItem('jason-os-decision-center-open') === 'true' ? 'decisionCenter' : 'command')
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
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voicePendingActionId, setVoicePendingActionId] = useState<string | null>(null)
  const [aiConfig, setAiConfig] = useState<HackStartConfig | null>(null)
  const [captureConfig, setCaptureConfig] = useState<CaptureProviderConfig | null>(null)
  const [externalItems, setExternalItems] = useState<ExternalItem[]>([])
  const [chat, setChat] = useState<ChatMessage[]>(() => { try { return JSON.parse(localStorage.getItem('jason-os-ai-chat') || '[]') } catch { return [] } })
  const [aiDraft, setAiDraft] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  // Voice dialogue is deliberately session-only: transcripts must never enter chat localStorage.
  const voiceConversation = useRef<ChatMessage[]>([])
  const [decisionModelIds, setDecisionModelIds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('jason-os-decision-model-ids') || '[]') } catch { return [] } })
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const profileSection: ProfileSection = 'basic'
  const [cognitivePeriod, setCognitivePeriod] = useState<CognitivePeriod>('30d')
  const [decisionCenterTab, setDecisionCenterTab] = useState<DecisionCenterTab>(() => localStorage.getItem('jason-os-decision-center-tab') === 'log' ? 'log' : 'overview')
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
  useEffect(() => { localStorage.setItem('jason-os-decision-center-tab', decisionCenterTab) }, [decisionCenterTab])
  useEffect(() => { localStorage.setItem('jason-os-decision-center-open', String(view === 'decisionCenter' || view === 'decisions')) }, [view])
  useEffect(() => {
    const openSettingsRoute = () => {
      if (!window.location.hash.startsWith('#settings')) return
      if (window.location.hash === '#settings-data') window.location.hash = 'settings/account'
      setView('settings')
    }
    openSettingsRoute(); window.addEventListener('hashchange', openSettingsRoute)
    return () => window.removeEventListener('hashchange', openSettingsRoute)
  }, [])
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
    await api.save('profiles', profileSavePayload(existing, data))
    await refresh(); showNotice('我的档案已保存到本机。')
  }
  const saveDecisionAnalysis = async (question: string, analysis: DecisionAnalysis, ceoDecision = '') => {
    const { classification, lens, models, frameworks, assumptions, supportingCase, counterCase, biases, tensions, opportunityCost, informationGaps, minimumValidation, options, recommendation, confidence } = analysis
    await api.save('decisions', {
      title: question.slice(0, 80), problem: question, context: `决策类型：${classification.decisionTypeLabel}；决策视角：${lens ? titleFor(lens) : '未匹配'}`,
      decisionType: classification.decisionType, decisionTypeLabel: classification.decisionTypeLabel, impactLevel: classification.impact,
      urgencyLevel: classification.urgency, reversibility: classification.reversibility, suggestedReversibility: classification.reversibility, confidence,
      decisionLevel: classification.impact === 'high' ? 'STRATEGIC' : classification.impact === 'medium' ? 'MATERIAL' : 'OPERATIONAL',
      suggestedImportance: classification.impact, status: ceoDecision ? 'decided' : 'pending', choiceStatus: ceoDecision ? 'DECIDED' : 'PENDING', executionStatus: 'NOT_STARTED', validationStatus: 'PENDING', date: today(), decisionAt: ceoDecision ? new Date().toISOString() : '', lensId: lens?.id, mentalModelIds: models.map(({ model }) => model.id), frameworkIds: frameworks.map((framework) => framework.id),
      assumptions: assumptions.join('\n'), evidence: '', options: options.join('\n'), risks: counterCase.join('\n'),
      supportingCase: supportingCase.join('\n'), counterCase: counterCase.join('\n'), biasAnalysis: JSON.stringify(biases), modelTensions: JSON.stringify(tensions),
      opportunityCost, informationGaps: informationGaps.join('\n'), minimumValidation, recommendation, ceoDecision, executionPlan: ceoDecision ? '待创建执行任务：根据 CEO 最终决定拆分下一步行动。' : '', outcome: '', reviewId: '',
      knownUnknowns: informationGaps.join('\n'), expectedOutcome: recommendation,
    })
    await refresh(); setDecisionCenterTab('log'); setView('decisionCenter'); showNotice('决策草案已保存到“决策中心”的决策日志，等待 CEO 最终决定。')
  }
  const archiveRecord = async (id: string) => { await api.archive(id); await refresh(); setDetailId(null); if (selectedProjectId === id) setSelectedProjectId(null); showNotice('已归档，可在设置中恢复。') }
  const completeTask = async (task: RecordData) => { await api.save('tasks', { ...task, status: 'completed', completedAt: new Date().toISOString() }); await refresh(); showNotice('任务已完成。') }
  const restoreTask = async (task: RecordData) => { await api.save('tasks', { ...task, status: 'todo' }); await refresh(); showNotice('任务已恢复为待办。') }
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
    if (record.entity === 'decisions') setView('decisionCenter')
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
    const targetView = ({ tasks: 'tasks', timeLogs: 'time', projects: 'projects', results: 'outcomes', deliverables: 'outcomes', resultPackages: 'outcomes', workflows: 'projects', workflowVersions: 'projects', workflowSteps: 'projects', workflowGates: 'projects', workflowRuns: 'projects', workflowRunSteps: 'projects', workflowMetricDefinitions: 'projects', workflowImprovementProposals: 'projects', financialAccounts: 'finance', financialCategories: 'finance', financialTransactions: 'finance', signals: 'notebook', opportunities: 'notebook', externalSources: 'notebook', intelligenceBriefs: 'notebook', knowledge: 'knowledge', reviews: 'reviews', insights: 'insights', principles: 'principles', mentalModels: 'mentalModels', decisions: 'decisionCenter', events: 'events', people: 'people' } as Partial<Record<Entity, View>>)[record.entity]
    if (targetView) setView(targetView)
    setAiOpen(false); openRecord(record)
  }
  const sendAi = async (preset?: string, contextOverride: Partial<AgentContext> = {}) => {
    const question = (preset || aiDraft).trim(); if (!question || aiBusy) return
    if (!aiConfig?.configured) { setView('settings'); setAiOpen(false); showNotice('请先配置任一 AI 服务商的 API Key。', 'danger'); return }
    const isVoice = contextOverride.voiceMode === true
    const conversation = isVoice ? voiceConversation.current : chat
    const nextChat = [...conversation, { role: 'user' as const, content: question }]
    if (!isVoice) { setChat(nextChat); setAiDraft('') }
    const pending = [...conversation].reverse().find((message) => message.action?.status === 'CONFIRM_REQUIRED')?.action
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
    try {
      const result = await api.ask(question, requestContext, nextChat)
      const completedConversation = [...nextChat, { role: 'assistant' as const, content: result.answer, action: result.action }]
      if (isVoice) voiceConversation.current = completedConversation.slice(-10)
      else setChat(completedConversation)
      await refresh()
      return result
    }
    catch (error) { showNotice(`AI Agent 处理失败：${String(error)}`, 'danger'); return undefined }
    finally { setAiBusy(false) }
  }
  const executeVoiceAction = async (actionId: string): Promise<VoiceExecutionResult> => {
    try {
      const result = await api.confirmAiAction(actionId); await refresh(); setVoicePendingActionId(null)
      const record = result.record; const label = record ? configFor(record.entity).singular : '操作'
      return { state: 'DONE', message: result.duplicate ? `相同的${label}已执行，无需重复写入。` : `已完成：${record ? titleFor(record) : result.action.previewTitle || label}`, viewLabel: record ? `已保存到${label}` : undefined }
    } catch (error) { return { state: 'ERROR', message: `执行失败：${String(error)}。没有写入成功。` } }
  }
  const cancelVoiceAction = async (actionId: string): Promise<VoiceExecutionResult> => {
    try { await api.cancelAiAction(actionId); await refresh(); setVoicePendingActionId(null); return { state: 'CANCELLED', message: '已取消本次操作，没有写入任何记录。' } }
    catch (error) { return { state: 'ERROR', message: `取消失败：${String(error)}` } }
  }
  const runVoiceTranscript = async (transcript: string): Promise<VoiceExecutionResult> => {
    const intent = routeVoiceIntent(transcript)
    if (intent.intent === 'OPEN_PAGE' && intent.page) { setView(intent.page as View); return { state: 'DONE', message: `已打开${pageTitleForVoice(intent.page)}。` } }
    if (intent.intent === 'SEARCH_SIMPLE' && intent.query) { setSearchQuery(intent.query); setSearchOpen(true); return { state: 'DONE', message: `正在搜索：${intent.query}` } }
    if (intent.intent === 'START_TIMER') {
      if (running) return { state: 'ERROR', message: `已有计时正在运行：${titleFor(running)}。` }
      await startTimerNow({ title: '语音计时', source: 'voice' }); return { state: 'DONE', message: '已开始计时。' }
    }
    if (intent.intent === 'STOP_TIMER') {
      if (!running) return { state: 'ERROR', message: '当前没有正在运行的计时。' }
      await stopTimer(); return { state: 'DONE', message: '已停止计时并记录实际投入。' }
    }
    if (intent.intent === 'CONFIRM') return voicePendingActionId ? executeVoiceAction(voicePendingActionId) : { state: 'ERROR', message: '当前没有等待确认的语音操作。' }
    if (intent.intent === 'CANCEL') return voicePendingActionId ? cancelVoiceAction(voicePendingActionId) : { state: 'CANCELLED', message: '已取消，没有执行任何操作。' }
    if (!aiConfig?.configured) { setView('settings'); return { state: 'ERROR', message: '复杂语音操作需要已配置的 AI 服务商；已打开“设置与数据”。' } }
    const response = await sendAi(transcript, { voiceMode: true, voiceIntent: intent.intent })
    if (!response) return { state: 'ERROR', message: 'AI 未能完成语音请求；没有执行写入。' }
    if (response.action?.status === 'CONFIRM_REQUIRED') { setVoicePendingActionId(response.action.actionId); return { state: 'AWAITING_CONFIRMATION', actionId: response.action.actionId, message: response.action.previewTitle || '已生成操作预览，请确认后执行。' } }
    return { state: 'DONE', message: response.answer, actionId: response.action?.actionId }
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
    { group: '认知', items: [{ view: 'cognition', label: '认知中心', icon: '⌘' }] },
    { group: '决策', items: [{ view: 'decisionCenter', label: '决策中心', icon: '◆' }] },
    { group: '情境', items: [{ view: 'events', label: '事件', icon: '●' }, { view: 'people', label: '人物', icon: '♙' }, { view: 'timeline', label: '时间线', icon: '⌁' }] },
  ]
  const profile = records.find((record) => record.entity === 'profiles')
  const identity = resolveUserIdentity(profile)
  const pageTitle = view === 'profile' ? '我的档案' : view === 'notebook' ? '收纳箱' : view === 'aiNews' ? 'AI News Radar' : nav.flatMap((group) => group.items).find((item) => item.view === view)?.label || (view === 'settings' ? '设置' : PRODUCT_NAME)
  const cognitiveTab: CognitiveTab = ({ insights: 'insights', reviews: 'reviews', knowledge: 'knowledge', principles: 'principles', mentalModels: 'mentalModels' } as Partial<Record<View, CognitiveTab>>)[view] || 'overview'
  const cognitiveEntity = cognitiveTab === 'overview' ? 'insights' : cognitiveTab
  const cognitiveDomainContent = cognitiveTab === 'overview' ? undefined : cognitiveTab === 'mentalModels'
    ? <MentalModelsView records={records} onOpen={openRecord} onCreate={openCreate} onSaveDecision={saveDecisionAnalysis} decisionModelIds={decisionModelIds} onAddModel={addModelToDecision} onRemoveModel={removeModelFromDecision} />
    : <MemoryView entity={cognitiveTab as Entity} records={records} onOpen={openRecord} onCreate={openCreate} />

  const effectiveSidebarOpen = sidebarOpen || sidebarPeek
  const toggleSidebar = () => { setSidebarPeek(false); setSidebarOpen((open) => !open) }
  const handleShellPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarOpen) return
    if (event.clientX <= 14) setSidebarPeek(true)
    else if (sidebarPeek && event.clientX > 236) setSidebarPeek(false)
  }
  return <div className={`app-shell ${view === 'today' ? 'today-route' : ''} ${view === 'finance' ? 'finance-route' : ''} ${view === 'time' ? 'time-route' : ''} ${activeTheme === 'light' ? 'light-theme' : 'dark-theme'} ${effectiveSidebarOpen ? "" : "sidebar-collapsed"} ${sidebarPeek ? "sidebar-peek" : ""} ${aiOpen ? "ai-open" : ""} ${aiResizing ? "ai-resizing" : ""}`} style={{ "--ai-width": `${aiWidth}px` } as React.CSSProperties} onPointerMove={handleShellPointer}>
    <GlobalHeader
      query={searchQuery} onQuery={(value) => { setSearchQuery(value); setSearchOpen(true) }} onSearchFocus={() => setSearchOpen(true)}
      sidebarOpen={effectiveSidebarOpen} onToggleSidebar={toggleSidebar} onSettings={() => setView('settings')} onAiNews={() => setView('aiNews')} aiNewsActive={view === 'aiNews'} onAi={() => setAiOpen(true)} onPalette={() => setPaletteOpen(true)} aiConfigured={Boolean(aiConfig?.configured)}
    />
    <aside className="sidebar">
      <button className="quick-capture" onClick={() => setView('notebook')}><span>▱</span><div><strong>收纳箱</strong><small>收集与笔记 · ⌘ ⇧ Space</small></div></button>
      <nav>{nav.map((group) => <section key={group.group}><p>{group.group}</p>{group.items.map((item) => <Fragment key={item.view}><button className={item.view === 'cognition' ? ['cognition', 'knowledge', 'reviews', 'insights', 'principles', 'mentalModels'].includes(view) ? 'active' : '' : view === item.view ? 'active' : ''} onClick={() => { setView(item.view); if (item.view === 'decisionCenter') setDecisionCenterTab('overview'); if (item.view !== 'projects') setSelectedProjectId(null) }}><span>{item.icon}</span>{item.label}</button>{item.view === 'cognition' && ['cognition', 'knowledge', 'reviews', 'insights', 'principles', 'mentalModels'].includes(view) && <div className="cognition-sidebar-tabs">{([['cognition', '总览'], ['insights', '洞见'], ['reviews', '复盘'], ['knowledge', '知识'], ['principles', '原则'], ['mentalModels', '思维模型']] as Array<[View, string]>).map(([target, label]) => <button key={target} className={(target === 'cognition' ? view === 'cognition' : view === target) ? 'active' : ''} onClick={() => setView(target)}>— <span>{label}</span></button>)}</div>}</Fragment>)}</section>)}</nav>
      <div className="sidebar-bottom-actions"><button className={`running-card ${running ? 'live' : ''}`} onClick={() => running ? stopTimer() : startTimer()}>{running ? <><span className="pulse" /><div><strong>{titleFor(running)}</strong><small>点击停止并记录时间</small></div></> : <><span>▶</span><div><strong>开始计时</strong><small>记录现实投入</small></div></>}</button><button className={`account-footer ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')} title="打开设置"><span className="account-avatar">{identity.avatarUrl ? <img src={identity.avatarUrl} alt="" /> : identity.initial}</span><span><strong>{identity.accountLabel}</strong><small>账户与偏好设置</small></span></button></div>
    </aside>
    <main className="main-content">
      {!['notebook', 'command', 'today', 'time', 'outcomes', 'cognition', 'knowledge', 'reviews', 'insights', 'principles', 'mentalModels', 'decisionCenter', 'decisions'].includes(view) && <div className="page-heading"><div><p className="eyebrow">{PRODUCT_EYEBROW}</p><h1>{pageTitle}</h1>{view === 'tasks' && <small className="page-heading-subtitle">洞察执行健康、识别阻塞与积压、保持行动与目标一致</small>}{view === 'projects' && <small className="page-heading-subtitle">从想法到结果，追踪每个项目的健康度、投入与交付。</small>}</div>{!['command', 'aiNews', 'timeline', 'outcomes', 'finance', 'profile', 'settings'].includes(view) && <button className="button primary" onClick={() => openCreate(viewEntity(view))}>＋ {view === 'tasks' ? '新建任务' : view === 'projects' ? '新建项目' : '新建'}</button>}</div>}
      {view === 'command' && <CommandCenter records={records} onOpen={openRecord} onView={setView} onRefresh={refresh} />}
      {view === 'today' && <TodayView records={records} running={running} onOpen={openRecord} onComplete={completeTask} onRestore={restoreTask} onStartTimer={startTimer} onStopTimer={stopTimer} onCreate={openCreate} />}
      {view === 'tasks' && <TasksView records={records} onOpen={openRecord} onEdit={(record) => setEditing({ config: configFor('tasks'), record })} onComplete={completeTask} onStartTimer={startTimer} onCreate={(initial) => openCreate('tasks', initial)} />}
      {view === 'time' && <TimeView records={records} running={running} onStartTimer={startTimer} onStopTimer={stopTimer} onOpen={openRecord} onEdit={(record) => setEditing({ config: configFor('timeLogs'), record })} onCreate={(initial) => openCreate('timeLogs', { startAt: nowInput(), ...initial })} />}
      {view === 'projects' && <ProjectsView records={records} selectedId={selectedProjectId} onSelect={setSelectedProjectId} onOpen={openRecord} onCreate={openCreate} onEdit={(record) => setEditing({ config: configFor(record.entity), record })} onStartTimer={startTimer} onAiAnalyze={(question, context) => { setAiOpen(true); void sendAi(question, context) }} />}
      {view === 'outcomes' && <OutcomesView records={records} onOpen={openRecord} onCreate={openCreate} />}
      {view === 'finance' && <FinanceView records={records} onOpen={openRecord} onCreate={openCreate} onRefresh={() => void refresh()} onAskAi={() => void sendAi('基于当前财务总览，最近最值得 CEO 关注的财务问题是什么？请只基于已聚合的趋势、项目资本配置与关注事项解释。')} />}
      {view === 'notebook' && <NotebookView records={records} externalItems={externalItems} captureConfig={captureConfig} onOpen={openRecord} onRefresh={refresh} onNotice={showNotice} onAi={(question, context) => { setAiOpen(true); void sendAi(question, context) }} />}
      {(['cognition', 'knowledge', 'reviews', 'insights', 'principles', 'mentalModels'] as View[]).includes(view) && <CognitiveCenterView records={records} tab={cognitiveTab} period={cognitivePeriod} onPeriod={setCognitivePeriod} onTab={(tab) => setView(tab === 'overview' ? 'cognition' : tab)} onOpen={openRecord} onCreate={() => openCreate(cognitiveEntity as Entity)} onAi={() => { setAiOpen(true); if (aiConfig?.configured) void sendAi('基于当前认知中心的真实记录，哪些事项值得我优先复盘、验证或沉淀？不要自动修改任何认知状态。') }} domainContent={cognitiveDomainContent} />}
      {view === 'decisionCenter' && <DecisionIntelligenceView records={records} onOpen={openRecord} onCreate={openCreate} tab={decisionCenterTab} onTabChange={setDecisionCenterTab} />}
      {view === 'decisions' && <DecisionIntelligenceView records={records} onOpen={openRecord} onCreate={openCreate} tab="log" onTabChange={setDecisionCenterTab} />}
      {(view === 'events' || view === 'people') && <ContextView entity={view} records={records} onOpen={openRecord} onCreate={openCreate} />}
      {view === 'timeline' && <TimelineView records={records} onOpen={openRecord} onAiAnalyze={(question, context) => { setAiOpen(true); void sendAi(question, context) }} />}
      {view === 'profile' && <ProfileView profile={profile} initialSection={profileSection} onSave={saveProfile} />}
      {view === 'aiNews' && <AiNewsRadarView />}
      {view === 'settings' && <SettingsWorkspace profile={profile} themePreference={themePreference} activeTheme={activeTheme} onThemeChange={setThemePreference} aiConfig={aiConfig} captureConfig={captureConfig} onSaveAiProvider={saveAiProvider} onSaveCaptureProvider={saveCaptureProvider} onSaveProfile={saveProfile} onExport={async (format) => showNotice(`已导出：${await api.export(format)}`)} onBackup={createBackup} backups={backups} onRestoreBackup={restoreBackup} syncPanel={<CloudSyncPanel onNotice={showNotice} onSynced={refresh} />} onOpenVoice={() => setVoiceOpen(true)} onNotice={showNotice} />}
    </main>
    {notice && <div className={`toast ${notice.tone === 'danger' ? 'danger' : ''}`}>{notice.text}</div>}
    {searchOpen && <SearchOverlay query={searchQuery} results={searchResults} selectedEntities={searchEntities} onToggleEntity={(entity) => setSearchEntities((current) => current.includes(entity) ? current.filter((item) => item !== entity) : [...current, entity])} onOpen={openRecord} onClose={() => setSearchOpen(false)} />}
    {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} actions={paletteActions({ setSearchOpen, setPaletteOpen, openCreate, startTimer, setAiOpen, setView })} />}
    {aiOpen && <><div className="ai-resize-handle" role="separator" aria-label="调整 AI 助理宽度" onPointerDown={(event) => { event.preventDefault(); setAiResizing(true) }} /><AiDrawer config={aiConfig} chat={chat} draft={aiDraft} busy={aiBusy} context={contextRecords} onDraft={setAiDraft} onSend={sendAi} onConfirmAction={confirmAiAction} onCancelAction={cancelAiAction} onViewAction={viewAiActionResult} onSelectModel={(provider, model) => saveAiProvider(provider, '', model)} onClose={() => setAiOpen(false)} onSettings={() => { setAiOpen(false); setView('settings') }} /></>}
    {voiceOpen && <VoiceOperatingPanel onClose={() => { voiceConversation.current = []; setVoicePendingActionId(null); setVoiceOpen(false) }} onTranscript={runVoiceTranscript} onConfirm={executeVoiceAction} onCancel={cancelVoiceAction} />}
    {timerStart && <TimerStartModal initial={timerStart} records={records} onClose={() => setTimerStart(null)} onStart={startTimerNow} />}
    {editing && <RecordModal config={editing.config} record={editing.record} initial={editing.initial} records={records} onClose={() => setEditing(null)} onSave={saveRecord} />}
    {detailId && <RecordDrawer record={records.find((record) => record.id === detailId)} records={records} onClose={() => setDetailId(null)} onEdit={(record) => setEditing({ config: configFor(record.entity), record })} onArchive={archiveRecord} onCreate={openCreate} onOpen={openRecord} onStartTimer={startTimer} onAddModel={addModelToDecision} />}
  </div>
}

const viewEntity = (view: View): Entity => ({ command: 'inbox', today: 'tasks', tasks: 'tasks', time: 'timeLogs', projects: 'projects', outcomes: 'results', finance: 'financialTransactions', notebook: 'notes', cognition: 'insights', knowledge: 'knowledge', reviews: 'reviews', insights: 'insights', principles: 'principles', mentalModels: 'mentalModels', decisionCenter: 'decisions', decisions: 'decisions', events: 'events', people: 'people', timeline: 'events', aiNews: 'inbox', settings: 'inbox', profile: 'profiles' }[view] as Entity)

function GlobalHeader({ query, onQuery, onSearchFocus, sidebarOpen, onToggleSidebar, onSettings: _onSettings, onAiNews, aiNewsActive, onAi, onPalette, aiConfigured }: { query: string; onQuery: (value: string) => void; onSearchFocus: () => void; sidebarOpen: boolean; onToggleSidebar: () => void; onSettings: () => void; onAiNews: () => void; aiNewsActive: boolean; onAi: () => void; onPalette: () => void; aiConfigured: boolean }) {
  return <header className="global-header"><div className="global-brand"><button className={`sidebar-toggle ${sidebarOpen ? 'open' : ''}`} onClick={onToggleSidebar} aria-label={sidebarOpen ? '隐藏边栏' : '展开边栏'} title={sidebarOpen ? '隐藏边栏' : '展开边栏'}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2" /><path d="M7 3v14" /></svg></button><div className="product-brand" aria-label={PRODUCT_NAME}><span className="brand-mark">E</span><span className="brand-copy"><strong>{PRODUCT_NAME}</strong><small>{PRODUCT_TAGLINE}</small></span></div></div><div className="global-search"><span>⌕</span><input value={query} onFocus={onSearchFocus} onChange={(event) => onQuery(event.target.value)} placeholder={PRODUCT_SEARCH_PLACEHOLDER} /><kbd>⌘ K</kbd></div><div className="global-actions"><button className={`news-radar-shortcut ${aiNewsActive ? 'active' : ''}`} onClick={onAiNews}><span>✺</span>AI News Radar</button><button onClick={onAi}><span className={`ai-status ${aiConfigured ? 'connected' : ''}`} />AI 助理</button><button onClick={onPalette}><kbd>⌘ K</kbd></button></div></header>
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
  const profileValues = (record?: RecordData) => Object.fromEntries(['name', 'nickname', 'displayName', 'email', 'avatar', 'occupation', 'role', 'organization', 'workDomains', 'longTermDirection', 'currentFocus', 'workStyle', 'decisionStyle', 'commonTools', 'otherContext', 'aiAssistancePreference', 'aiResponsePreference', 'aiDecisionPreference', 'aiOtherContext'].map((key) => [key, String(record?.[key] || '')])) as Record<string, string>
  const [section, setSection] = useState<ProfileSection>(initialSection)
  const [started, setStarted] = useState(Boolean(profile))
  const [draft, setDraft] = useState<Record<string, string>>(() => profileValues(profile))
  const [saving, setSaving] = useState(false)
  useEffect(() => { setSection(initialSection) }, [initialSection])
  useEffect(() => { setDraft(profileValues(profile)); if (profile) setStarted(true) }, [profile])
  const update = (field: string) => (value: string) => setDraft((current) => ({ ...current, [field]: value }))
  const save = async () => { setSaving(true); try { await onSave(draft) } finally { setSaving(false) } }
  if (!started) return <div className="profile-page"><section className="profile-empty"><span>◌</span><div><p className="eyebrow">MY PROFILE · LOCAL ONLY</p><h2>还没有建立你的个人档案</h2><p>建立少量长期信息后，{PRODUCT_NAME} AI 可以更准确地理解你的背景、工作方式和协作偏好。</p><button className="button primary" onClick={() => { setStarted(true); setSection('basic') }}>开始建立档案</button></div></section></div>
  const avatar = draft.avatar.trim()
  return <div className="profile-page"><section className="profile-hero"><div className="profile-avatar">{avatar ? <img src={avatar} alt="头像" /> : <span>{(draft.nickname || draft.name || 'J').trim().slice(0, 1)}</span>}</div><div><p className="eyebrow">MY PROFILE · LOCAL CONTEXT</p><h2>{draft.nickname || draft.name || '我的档案'}</h2><p>让 Jason OS 更了解你，并为 AI 提供长期上下文。</p></div><small>仅保存在本机；仅在问题相关时向 AI 提供精简上下文。</small></section><div className="profile-tabs" role="tablist"><button className={section === 'basic' ? 'active' : ''} onClick={() => setSection('basic')}>基础资料</button><button className={section === 'personal' ? 'active' : ''} onClick={() => setSection('personal')}>个人上下文</button><button className={section === 'ai' ? 'active' : ''} onClick={() => setSection('ai')}>AI 上下文</button></div><section className="profile-editor">{section === 'basic' && <><header><div><h3>基础资料</h3><p>只记录对工作与协作有价值的基本背景，不收集证件、联系方式等敏感信息。</p></div></header><div className="profile-grid"><ProfileField label="姓名" field="name" value={draft.name} onChange={update('name')} placeholder="例如：Jason" /><ProfileField label="昵称" field="nickname" value={draft.nickname} onChange={update('nickname')} placeholder="可选" /><ProfileField label="头像 URL" field="avatar" value={draft.avatar} onChange={update('avatar')} placeholder="可选" /><ProfileField label="职业 / 身份" field="occupation" value={draft.occupation} onChange={update('occupation')} placeholder="例如：创业者" /><ProfileField label="当前角色" field="role" value={draft.role} onChange={update('role')} placeholder="例如：CEO / 产品负责人" /><ProfileField label="公司 / 组织" field="organization" value={draft.organization} onChange={update('organization')} placeholder="可选" /><ProfileTagField label="主要工作领域" field="workDomains" value={draft.workDomains} onChange={update('workDomains')} placeholder="跨境电商，AI，产品系统" /></div></>}{section === 'personal' && <><header><div><h3>个人上下文</h3><p>记录相对稳定、能帮助 Jason OS 理解你如何工作的长期信息。</p></div></header><div className="profile-stack"><ProfileField label="长期方向" field="longTermDirection" value={draft.longTermDirection} onChange={update('longTermDirection')} multiline placeholder="例如：打造 AI 驱动的跨境电商业务体系" /><ProfileTagField label="当前重点" field="currentFocus" value={draft.currentFocus} onChange={update('currentFocus')} placeholder="Jason OS，跨境电商业务，AI Agent" /><ProfileField label="我的工作方式" field="workStyle" value={draft.workStyle} onChange={update('workStyle')} multiline placeholder="例如：偏好先建立完整架构，再执行。" /><ProfileField label="我的决策方式" field="decisionStyle" value={draft.decisionStyle} onChange={update('decisionStyle')} multiline placeholder="例如：重视反向思维、风险分析、长期价值。" /><ProfileTagField label="常用工具" field="commonTools" value={draft.commonTools} onChange={update('commonTools')} placeholder="Codex，ChatGPT，Shopify" /><ProfileField label="其他长期背景" field="otherContext" value={draft.otherContext} onChange={update('otherContext')} multiline placeholder="记录其他长期有价值的信息。" /></div></>}{section === 'ai' && <><header><div><h3>AI 上下文</h3><p>这些内容会在相关问题中帮助 AI 理解你，但 AI 修改档案仍必须经过你的确认。</p></div></header><div className="profile-stack"><ProfileField label="我希望 AI 如何帮助我" field="aiAssistancePreference" value={draft.aiAssistancePreference} onChange={update('aiAssistancePreference')} multiline placeholder="例如：从 CEO 和产品架构师角度思考，主动指出风险。" /><ProfileField label="我的回答偏好" field="aiResponsePreference" value={draft.aiResponsePreference} onChange={update('aiResponsePreference')} multiline placeholder="例如：复杂问题先给架构，再给执行方案。" /><ProfileField label="我的决策偏好" field="aiDecisionPreference" value={draft.aiDecisionPreference} onChange={update('aiDecisionPreference')} multiline placeholder="例如：关注长期价值、机会成本、风险和系统协同。" /><ProfileField label="AI 其他上下文" field="aiOtherContext" value={draft.aiOtherContext} onChange={update('aiOtherContext')} multiline placeholder="补充 AI 应长期知道的协作背景。" /></div></>}<footer><span>{profile ? '更改将立即保存到本机。' : '首次建议先填写姓名、角色、长期方向和 AI 协作方式。'}</span><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存档案'}</button></footer></section></div>
}

function CommandCenter({ records, onOpen, onView, onRefresh }: { records: RecordData[]; onOpen: (record: RecordData) => void; onView: (view: View) => void; onRefresh: () => Promise<void> }) {
  return <CommandCenterView records={records} onOpen={onOpen} onView={onView} onRefresh={onRefresh} />
}

function TodayView({ records, running, onOpen, onComplete, onRestore, onStartTimer, onStopTimer, onCreate }: { records: RecordData[]; running?: RecordData; onOpen: (record: RecordData) => void; onComplete: (record: RecordData) => void; onRestore: (record: RecordData) => void; onStartTimer: (record?: Partial<RecordData>) => void; onStopTimer: () => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void }) {
  return <TodayCockpitView records={records} running={running} onOpen={onOpen} onComplete={onComplete} onRestore={onRestore} onStartTimer={onStartTimer} onStopTimer={onStopTimer} onCreate={onCreate} />
}

function TasksView({ records, onOpen, onEdit, onComplete, onStartTimer, onCreate }: { records: RecordData[]; onOpen: (record: RecordData) => void; onEdit: (record: RecordData) => void; onComplete: (record: RecordData) => void; onStartTimer: (record: RecordData) => void; onCreate: (initial?: Partial<RecordData>) => void }) {
  const [mode, setMode] = useState<TaskView>('overview'); const [filter, setFilter] = useState<'all' | 'today' | 'upcoming' | 'overdue'>('all'); const [period, setPeriod] = useState<TaskDashboardPeriod>('30d')
  const tasks = records.filter((record) => record.entity === 'tasks' && isActive(record)).filter((task) => filter === 'all' || filter === 'today' && isToday(task.dueDate) || filter === 'upcoming' && Boolean(task.dueDate) && String(task.dueDate) > today() || filter === 'overdue' && isOverdue(task))
  return <div className={`tasks-page ${mode === 'calendar' ? 'calendar-v2-mode' : ''}`}><div className="task-view-tabs">{(['overview', 'list', 'kanban', 'matrix', 'calendar'] as const).map((item) => <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>{{ overview: '总览', list: '列表', kanban: '看板', matrix: '四象限', calendar: '日历' }[item]}</button>)}</div>{mode !== 'overview' && mode !== 'calendar' && <div className="toolbar"><div className="segmented">{(['all', 'today', 'upcoming', 'overdue'] as const).map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{{ all: '全部', today: '今天', upcoming: '即将到期', overdue: '已逾期' }[item]}</button>)}</div></div>}
    {mode === 'overview' && <TaskExecutionDashboardView records={records} period={period} onPeriod={setPeriod} onOpen={onOpen} />}
    {mode === 'list' && <section className="work-panel">{tasks.length ? tasks.map((task) => <ActionTask key={task.id} task={task} records={records} onOpen={onOpen} onEdit={onEdit} onComplete={onComplete} onTimer={onStartTimer} />) : <GuidedEmpty icon="□" title="这个视图里没有任务" text="任务应该代表可执行的下一步，并关联项目或目标。" action="创建任务" onAction={() => onCreate()} />}</section>}
    {mode === 'kanban' && <div className="kanban">{(['inbox', 'todo', 'in_progress', 'waiting', 'blocked'] as const).map((status) => <section key={status}><header><h3>{statusLabel(status)}</h3><span>{tasks.filter((task) => task.status === status).length}</span></header>{tasks.filter((task) => task.status === status).map((task) => <article key={task.id} onClick={() => onOpen(task)}><strong>{titleFor(task)}</strong><small>{relationName(task.projectId, records) || '未分配项目'}</small><footer><span className={`priority ${task.priority || 'medium'}`}>{priorityLabel(task.priority)}</span><span>{formatDate(task.dueDate)}</span></footer></article>)}</section>)}</div>}
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

function TimeView({ records, running, onStartTimer, onStopTimer, onOpen, onEdit, onCreate }: { records: RecordData[]; running?: RecordData; onStartTimer: () => void; onStopTimer: () => void; onOpen: (record: RecordData) => void; onEdit: (record: RecordData) => void; onCreate: (initial?: Partial<RecordData>) => void }) {
  return <TimeIntelligenceView records={records} running={running} onStartTimer={onStartTimer} onStopTimer={onStopTimer} onOpen={onOpen} onEdit={onEdit} onCreate={onCreate} />
}

function ProjectsView({ records, selectedId, onSelect, onOpen, onCreate, onEdit, onStartTimer, onAiAnalyze }: { records: RecordData[]; selectedId: string | null; onSelect: (id: string | null) => void; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void; onEdit: (record: RecordData) => void; onStartTimer: (record: RecordData) => void; onAiAnalyze: (question: string, context: Partial<AgentContext>) => void }) {
  const projects = records.filter((record) => record.entity === 'projects')
  const selected = projects.find((project) => project.id === selectedId)
  if (selected) return <ProjectWorkspace project={selected} records={records} onBack={() => onSelect(null)} onOpen={onOpen} onCreate={onCreate} onEdit={onEdit} onStartTimer={onStartTimer} onAiAnalyze={onAiAnalyze} />
  return <ProjectIntelligenceView records={records} onOpen={onOpen} onSelectProject={onSelect} onCreate={onCreate} />
}

function ProjectWorkspace({ project, records, onBack, onOpen, onCreate, onEdit, onStartTimer, onAiAnalyze }: { project: RecordData; records: RecordData[]; onBack: () => void; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void; onEdit: (record: RecordData) => void; onStartTimer: (record: RecordData) => void; onAiAnalyze: (question: string, context: Partial<AgentContext>) => void }) {
  const [tab, setTab] = useState<'overview' | Entity | 'timeline' | 'workchain' | 'outcomes'>('overview')
  const map: { key: typeof tab; label: string; entity?: Entity }[] = [{ key: 'overview', label: '概览' }, { key: 'tasks', label: '任务', entity: 'tasks' }, { key: 'projectMilestones', label: '里程碑', entity: 'projectMilestones' }, { key: 'workchain', label: '工作链' }, { key: 'timeLogs', label: '时间', entity: 'timeLogs' }, { key: 'financialTransactions', label: '财务', entity: 'financialTransactions' }, { key: 'outcomes', label: '成果' }, { key: 'hypotheses', label: '假设', entity: 'hypotheses' }, { key: 'experiments', label: '实验', entity: 'experiments' }, { key: 'decisions', label: '决策', entity: 'decisions' }, { key: 'reviews', label: '复盘', entity: 'reviews' }, { key: 'timeline', label: '时间线' }]
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

function OutcomesView({ records, onOpen, onCreate }: { records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void }) {
  return <ResultsIntelligenceView records={records} onOpen={onOpen} onCreate={onCreate} />
}

function FinanceView({ records, onOpen, onCreate, onRefresh, onAskAi }: { records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void; onRefresh: () => void; onAskAi: () => void }) {
  const [tab, setTab] = useState<'overview' | 'transactions' | 'accounts' | 'categories' | 'budgets'>('overview')
  const [projectId, setProjectId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [period, setPeriod] = useState<'all' | 'month' | 'lastMonth' | 'quarter' | 'year'>('all')
  const [monthKey, setMonthKey] = useState('')
  const [transactionType, setTransactionType] = useState('')
  const [series, setSeries] = useState({ income: true, expense: true })
  const accounts = records.filter((record) => record.entity === 'financialAccounts')
  const projects = records.filter((record) => record.entity === 'projects')
  const categories = records.filter((record) => record.entity === 'financialCategories')
  const range = (() => {
    const now = new Date()
    const start = (year: number, month: number) => String(year) + '-' + String(month + 1).padStart(2, '0') + '-01'
    const end = (year: number, month: number) => String(year) + '-' + String(month + 1).padStart(2, '0') + '-' + String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')
    if (monthKey) { const values = monthKey.split('-').map(Number); return { from: start(values[0], values[1] - 1), to: end(values[0], values[1] - 1) } }
    if (period === 'all') return {}
    if (period === 'month') return { from: start(now.getFullYear(), now.getMonth()), to: end(now.getFullYear(), now.getMonth()) }
    if (period === 'lastMonth') { const prior = new Date(now.getFullYear(), now.getMonth() - 1, 1); return { from: start(prior.getFullYear(), prior.getMonth()), to: end(prior.getFullYear(), prior.getMonth()) } }
    if (period === 'year') return { from: String(now.getFullYear()) + '-01-01', to: String(now.getFullYear()) + '-12-31' }
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3
    return { from: start(now.getFullYear(), quarterMonth), to: end(now.getFullYear(), quarterMonth + 2) }
  })()
  const dashboard = financeDashboard(records, { projectId: projectId || undefined, accountId: accountId || undefined, categoryId: categoryId || undefined, ...range })
  const economics = dashboard.economics
  const transactions = financialFacts(records, projectId || undefined).map(({ transaction }) => transaction).filter((transaction) => {
    const date = String(transaction.occurredAt || transaction.createdAt || '').slice(0, 10)
    return (!range.from || !date || date >= range.from) && (!range.to || !date || date <= range.to) && (!accountId || transaction.accountId === accountId || transaction.destinationAccountId === accountId) && (!categoryId || transaction.categoryId === categoryId) && (!transactionType || transaction.transactionType === transactionType)
  })
  const maximum = dashboard.trends.reduce((value, point) => [point.incomeMinor, point.expenseMinor].reduce((next, amount) => amount > next ? amount : next, value), 0n)
  const height = (value: bigint) => maximum ? Math.max(8, Number(value * 100n / maximum)) : 0
  const createTransaction = () => onCreate('financialTransactions', { status: 'POSTED', transactionType: 'EXPENSE', currency: 'CNY', baseCurrency: 'CNY', occurredAt: nowInput(), evidenceStatus: 'RECORDED' })
  const createBudget = () => onCreate('financialBudgets', { status: 'ACTIVE', baseCurrency: 'CNY', periodStart: today(), periodEnd: today() })
  const clearFilters = () => { setProjectId(''); setAccountId(''); setCategoryId(''); setTransactionType(''); setPeriod('all'); setMonthKey('') }
  const showTransactions = () => setTab('transactions')
  const drilldown = ({ tab: nextTab, projectId: nextProjectId, accountId: nextAccountId, categoryId: nextCategoryId, transactionType: nextTransactionType, monthKey: nextMonthKey }: { tab: 'overview' | 'transactions' | 'accounts' | 'categories' | 'budgets'; projectId?: string; accountId?: string; categoryId?: string; transactionType?: string; monthKey?: string }) => {
    if (nextProjectId !== undefined) setProjectId(nextProjectId)
    if (nextAccountId !== undefined) setAccountId(nextAccountId)
    if (nextCategoryId !== undefined) setCategoryId(nextCategoryId)
    if (nextTransactionType !== undefined) setTransactionType(nextTransactionType)
    if (nextMonthKey !== undefined) setMonthKey(nextMonthKey)
    setTab(nextTab)
  }
  const showLegacyOverview = tab === 'overview'
  if (tab === 'overview') return <FinanceIntelligenceView records={records} onOpen={onOpen} onCreate={onCreate} onDrilldown={drilldown} onRefresh={onRefresh} onAskAi={onAskAi} />
  return <div className="finance-page">
    <section className="finance-hero"><div><span>JASON OS · RESOURCE LAYER</span><h2>Financial Intelligence</h2><p>记录资金事实，并把 Time + Money + Outcome 转化为 CEO 决策证据。现金净流动与经营贡献不等于会计利润。</p></div><button className="button primary" onClick={createTransaction}>＋ 记录流水</button></section>
    <section className="finance-filter-bar"><label>项目<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">全部项目</option>{projects.map((item) => <option key={item.id} value={item.id}>{titleFor(item)}</option>)}</select></label><label>账户<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">全部账户</option>{accounts.map((item) => <option key={item.id} value={item.id}>{titleFor(item)}</option>)}</select></label><label>分类<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">全部分类</option>{categories.map((item) => <option key={item.id} value={item.id}>{titleFor(item)}</option>)}</select></label><div className="segmented">{([['all','全部'],['year','本年'],['quarter','本季度'],['month','本月'],['lastMonth','上月']] as const).map(([key, label]) => <button key={key} className={period === key && !monthKey ? 'active' : ''} onClick={() => { setPeriod(key); setMonthKey('') }}>{label}</button>)}</div>{(projectId || accountId || categoryId || period !== 'all' || monthKey) && <button className="button" onClick={clearFilters}>清除筛选</button>}<small>筛选只改变分析视图，不会修改流水。</small></section>
    <div className="metric-strip four"><Metric label="现金净流动" value={economics.postedTransactions ? formatMoneyMinor(economics.cashNetMinor) : '未记录'} /><Metric label="已记录收入" value={economics.postedTransactions ? formatMoneyMinor(economics.incomeMinor) : '未记录'} /><Metric label="已记录支出" value={economics.postedTransactions ? formatMoneyMinor(economics.expenseMinor) : '未记录'} /><Metric label="数据覆盖" value={String(economics.dataCoverage) + '%'} hint="缺失数据不会按 0 处理" /></div>
    <nav className="external-tabs finance-tabs">{([['overview','总览'],['transactions','流水'],['accounts','账户'],['categories','分类'],['budgets','预算']] as const).map(([key,label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {showLegacyOverview && <div className="finance-dashboard">
      <section className="work-panel finance-trend-panel"><PanelHeader title="资金趋势" /><div className="finance-trend-chart">{dashboard.trends.length ? dashboard.trends.map((point) => <button className="finance-trend-column" key={point.key} onClick={() => { setMonthKey(point.key); showTransactions() }}><><div className="finance-trend-bars">{series.income && <i className="income" style={{ height: String(height(point.incomeMinor)) + '%' }} />}{series.expense && <i className="expense" style={{ height: String(height(point.expenseMinor)) + '%' }} />}</div><small>{point.key}</small></></button>) : <p className="empty-copy">所选范围还没有已入账流水。</p>}</div><div className="finance-legend"><button className={series.income ? 'active income' : ''} onClick={() => setSeries((value) => ({ ...value, income: !value.income }))}>■ 收入</button><button className={series.expense ? 'active expense' : ''} onClick={() => setSeries((value) => ({ ...value, expense: !value.expense }))}>■ 支出</button></div></section>
      <section className="work-panel"><PanelHeader title="预算 vs 实际" action="管理预算" onAction={() => setTab('budgets')} />{dashboard.budgets.length ? <div className="finance-breakdown">{dashboard.budgets.slice(0, 4).map((item) => <button key={item.budget.id} onClick={() => { setProjectId(String(item.budget.projectId || '')); setCategoryId(String(item.budget.categoryId || '')); showTransactions() }}><small>{titleFor(item.budget)} · 实际 {item.observedTransactions ? formatMoneyMinor(item.actualExpenseMinor) : '未记录'}</small><b>{item.varianceMinor >= 0n ? '余 ' + formatMoneyMinor(item.varianceMinor) : '超 ' + formatMoneyMinor(-item.varianceMinor)}</b></button>)}</div> : <p className="empty-copy">预算是管理约束，不是流水；创建预算后将按真实支出进行对比。</p>}</section>
      <section className="work-panel"><PanelHeader title="CEO 资源事实" /><div className="decision-evidence-grid"><span><small>经营贡献</small><strong>{economics.postedTransactions ? formatMoneyMinor(economics.managementContributionMinor) : '未记录'}</strong></span><span><small>投入时间</small><strong>{economics.timeMinutes ? formatMinutes(economics.timeMinutes) : '未记录'}</strong></span><span><small>单位时间经营贡献</small><strong>{economics.unitTimeContributionMinor === undefined ? '数据不足' : formatMoneyMinor(economics.unitTimeContributionMinor) + '/h'}</strong></span><span><small>已核验 Outcome</small><strong>{String(economics.verifiedOutcomeCount) + '/' + String(economics.outcomeCount)}</strong></span></div><p className="finance-disclaimer">经营贡献基于已记录并入账的管理口径，不是会计利润；库存、预付及未分配成本需要单独核验。</p></section>
      <section className="work-panel"><PanelHeader title="资金去向" />{dashboard.categories.length ? <div className="finance-breakdown">{dashboard.categories.slice(0, 6).map((item) => <button key={item.categoryId} onClick={() => { setCategoryId(item.categoryId === '__uncategorized__' ? '' : item.categoryId); showTransactions() }}><small>{item.categoryId === '__uncategorized__' ? '未分类' : relationName(item.categoryId, records) || '已删除分类'}</small><b>{formatMoneyMinor(item.amountMinor)}</b></button>)}</div> : <p className="empty-copy">需要收入、支出或退款流水后，才能按经营分类查看去向。</p>}</section>
      <section className="work-panel"><PanelHeader title="项目资源组合" />{dashboard.projects.length ? <div className="finance-portfolio">{dashboard.projects.slice(0, 6).map((item) => <button key={item.projectId} onClick={() => { setProjectId(item.projectId); showTransactions() }}><span>{relationName(item.projectId, records)}</span><small>投入 {formatMoneyMinor(item.economics.expenseMinor)} · {formatMinutes(item.economics.timeMinutes)} · 覆盖 {String(item.economics.dataCoverage) + '%'}</small><b>{formatMoneyMinor(item.economics.managementContributionMinor)}</b></button>)}</div> : <p className="empty-copy">项目尚未形成资金、时间或 Outcome 的真实记录。</p>}</section>
      <section className="work-panel finance-quality-panel"><PanelHeader title="数据质量与待核验" /><div className="finance-quality-list"><span><small>未分配项目资金</small><b>{dashboard.unallocatedMinor ? formatMoneyMinor(dashboard.unallocatedMinor) : '无'}</b><em>{String(dashboard.unassignedTransactions) + ' 笔'}</em></span><span><small>未核验流水</small><b>{String(dashboard.unverifiedTransactions) + ' 笔'}</b><em>不等于错误</em></span><span><small>未分类流水</small><b>{String(dashboard.missingCategoryTransactions) + ' 笔'}</b><em>无法分析去向</em></span></div></section>
      <section className="work-panel"><PanelHeader title="账户与数据完整度" action="创建账户" onAction={() => onCreate('financialAccounts', { currency: 'CNY', status: 'ACTIVE', evidenceStatus: 'RECORDED' })} />{accounts.length ? accounts.map((account) => <button className="finance-account-row" key={account.id} onClick={() => { setAccountId(account.id); showTransactions() }}><div><strong>{titleFor(account)}</strong><small>{String(account.currency || 'CNY')} · {statusLabel(account.evidenceStatus)}</small></div><b>{formatMoneyMinor(accountBalanceMinor(records, account.id), String(account.currency || 'CNY'))}</b></button>) : <p className="empty-copy">尚未建立账户，因此现金余额不可判断。不要把未记录误认为 0。</p>}</section>
    </div>}
    {tab === 'transactions' && <section className="work-panel"><header className="finance-list-header"><PanelHeader title={'财务流水 · ' + String(transactions.length) + ' 笔'} action="记录流水" onAction={createTransaction} /><button className="button" onClick={() => onCreate('financialTransactionAllocations', { baseCurrency: 'CNY' })}>＋ 项目分摊</button></header>{transactions.length ? <div className="finance-transaction-list">{transactions.map((transaction) => <button key={transaction.id} onClick={() => onOpen(transaction)}><span className={'finance-direction ' + String(transaction.transactionType).toLowerCase()}>{transaction.transactionType === 'INCOME' ? '＋' : transaction.transactionType === 'EXPENSE' ? '－' : '⇄'}</span><div><strong>{titleFor(transaction)}</strong><small>{formatDate(transaction.occurredAt, true)} · {relationName(transaction.projectId, records) || '未关联项目'} · {statusLabel(transaction.status)}</small></div><b>{formatMoneyMinor(String(transaction.amountMinor || '0'), String(transaction.currency || 'CNY'))}</b></button>)}</div> : <GuidedEmpty icon="¥" title="所选筛选下没有流水" text="筛选不会删除任何数据；可清除筛选或记录一笔真实流水。" action="记录流水" onAction={createTransaction} />}</section>}
    {tab === 'accounts' && <section className="work-panel"><PanelHeader title="资金账户" action="创建账户" onAction={() => onCreate('financialAccounts', { currency: 'CNY', status: 'ACTIVE', evidenceStatus: 'RECORDED' })} />{accounts.length ? <div className="account-grid">{accounts.map((account) => <article key={account.id} onClick={() => onOpen(account)}><span>{String(account.accountType || 'OTHER')}</span><h3>{titleFor(account)}</h3><strong>{formatMoneyMinor(accountBalanceMinor(records, account.id), String(account.currency || 'CNY'))}</strong><small>{statusLabel(account.evidenceStatus)} · {account.verifiedAt ? formatDate(account.verifiedAt, true) : '尚未余额核验'}</small></article>)}</div> : <GuidedEmpty icon="◉" title="账户是现金事实的入口" text="创建银行卡、现金、PayPal 或平台钱包；当前余额只由期初余额与已入账流水计算。" action="创建账户" onAction={() => onCreate('financialAccounts', { currency: 'CNY', status: 'ACTIVE', evidenceStatus: 'RECORDED' })} />}</section>}
    {tab === 'categories' && <section className="work-panel"><PanelHeader title="经营分类" action="创建分类" onAction={() => onCreate('financialCategories', { direction: 'EXPENSE', status: 'ACTIVE' })} />{categories.length ? <div className="category-list">{categories.map((category) => <button key={category.id} onClick={() => onOpen(category)}><strong>{titleFor(category)}</strong><span>{String(category.direction || 'BOTH')}</span></button>)}</div> : <GuidedEmpty icon="≡" title="分类只服务经营判断" text="从广告、软件、采购、物流、产品收入等少量分类开始，不建立复杂会计科目。" action="创建分类" onAction={() => onCreate('financialCategories', { direction: 'EXPENSE', status: 'ACTIVE' })} />}</section>}
    {tab === 'budgets' && <section className="work-panel"><PanelHeader title="预算" action="创建预算" onAction={createBudget} />{dashboard.budgets.length ? <div className="finance-transaction-list">{dashboard.budgets.map((item) => <button key={item.budget.id} onClick={() => onOpen(item.budget)}><span className="finance-direction expense">▣</span><div><strong>{titleFor(item.budget)}</strong><small>{String(item.budget.periodStart)} 至 {String(item.budget.periodEnd)} · 实际 {item.observedTransactions ? formatMoneyMinor(item.actualExpenseMinor) : '未记录'}</small></div><b>{item.varianceMinor >= 0n ? '余 ' + formatMoneyMinor(item.varianceMinor) : '超 ' + formatMoneyMinor(-item.varianceMinor)}</b></button>)}</div> : <GuidedEmpty icon="▣" title="尚未设置预算" text="预算不会改写资金事实；先设定一个项目或分类预算，再用真实已入账支出对比。" action="创建预算" onAction={createBudget} />}</section>}
  </div>
}
function DecisionEvidencePacket({ project, records, onCreate }: { project: RecordData; records: RecordData[]; onCreate: (entity: Entity, initial?: Partial<RecordData>) => void }) {
  const economics = projectEconomics(records, project.id)
  const finance = financeDashboard(records, { projectId: project.id })
  const outcomes = records.filter((record) => record.entity === 'results' && linkedTo(record, project.id))
  return <section className="decision-evidence"><header><div><span>CEO DECISION EVIDENCE</span><h3>投入、结果与数据缺口</h3></div><div className="decision-evidence-actions"><button onClick={() => onCreate('financialTransactionAllocations', { projectId: project.id, baseCurrency: 'CNY' })}>＋ 分摊流水</button><button onClick={() => onCreate('decisions', { title: `决策：${titleFor(project)}`, projectId: project.id, goalId: project.goalId, decisionLevel: 'MATERIAL', date: today(), status: 'pending', reviewDueDate: project.targetDate, knownUnknowns: economics.dataCoverage < 100 ? '部分财务、时间或 Outcome 尚未完整核验。' : '' })}>基于证据创建决策 →</button></div></header><div className="decision-evidence-grid"><span><small>资金投入</small><strong>{economics.postedTransactions ? formatMoneyMinor(economics.expenseMinor) : '未记录'}</strong></span><span><small>经营贡献</small><strong>{economics.postedTransactions ? formatMoneyMinor(economics.managementContributionMinor) : '未记录'}</strong></span><span><small>时间投入</small><strong>{economics.timeMinutes ? formatMinutes(economics.timeMinutes) : '未记录'}</strong></span><span><small>Outcome</small><strong>{outcomes.length}</strong></span><span><small>已核验证据</small><strong>{economics.verifiedOutcomeCount}</strong></span><span><small>数据覆盖</small><strong>{economics.dataCoverage}%</strong></span></div>{finance.categories.length > 0 && <div className="project-finance-breakdown"><small>项目资金去向</small>{finance.categories.slice(0, 3).map((item) => <span key={item.categoryId}>{item.categoryId === '__uncategorized__' ? '未分类' : relationName(item.categoryId, records)} <b>{formatMoneyMinor(item.amountMinor)}</b></span>)}</div>}<p>{economics.dataCoverage < 100 ? '数据仍不完整。系统不会把未记录金额解释为 0，也不会把当前经营贡献称为会计利润。' : '基础决策证据已具备，仍需 CEO 判断战略价值、可逆性与机会成本。'}</p></section>
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
  const [captureFileAccept, setCaptureFileAccept] = useState('*/*')
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
  const captureInputRef = useRef<HTMLTextAreaElement>(null)
  const editorFlushRef = useRef<(() => Promise<void>) | null>(null)
  const flushEditor = () => editorFlushRef.current?.() ?? Promise.resolve()
  useEffect(() => { api.archived().then((items) => setArchived(items.filter((record) => ['notes', 'notebookFiles', 'notebookFolders', 'inbox'].includes(record.entity)))) }, [records])
  const categories = records.filter((record) => record.entity === 'notebookCategories')
  const folders = records.filter((record) => record.entity === 'notebookFolders')
  const activeItems = records.filter((record) => ['notes', 'notebookFiles', 'notebookFolders', 'inbox'].includes(record.entity))
  const createdWithinDays = (record: RecordData, days: number) => {
    const value = record.createdAt || record.updatedAt || 0
    const timestamp = new Date(Number(value) || String(value)).getTime()
    return Number.isFinite(timestamp) && Date.now() - timestamp <= days * 86400000
  }
  const createdToday = (record: RecordData) => {
    const value = record.createdAt || record.updatedAt || ''
    const date = new Date(Number(value) || String(value))
    return !Number.isNaN(date.getTime()) && localDateKey(date) === today()
  }
  const fileMatches = (record: RecordData, type: 'image' | 'video' | 'audio') => record.entity === 'notebookFiles' && (
    String(record.mimeType || record.contentType || '').toLowerCase().startsWith(`${type}/`) ||
    new RegExp(type === 'image' ? '\\.(jpe?g|png|webp|gif|svg|heic|avif)$' : type === 'video' ? '\\.(mp4|mov|m4v|webm|avi|mkv)$' : '\\.(mp3|m4a|wav|aac|ogg|flac)$', 'i').test(String(record.originalName || record.name || record.relativePath || record.extension || ''))
  )
  const matchesScope = (record: RecordData) => {
    if (scope === 'notes') return record.entity === 'notes'
    if (scope === 'links') return record.entity === 'inbox' || Boolean(record.url || record.sourceUrl)
    if (scope === 'images') return fileMatches(record, 'image')
    if (scope === 'videos') return fileMatches(record, 'video')
    if (scope === 'audio') return fileMatches(record, 'audio')
    if (scope === 'files') return record.entity === 'notebookFiles'
    if (scope === 'today') return createdToday(record)
    if (scope === 'week') return createdWithinDays(record, 7)
    if (scope === 'attachments') return record.entity === 'notebookFiles' || Boolean(record.attachments)
    if (scope === 'later') return ['LATER', 'SNOOZED'].includes(String(record.status || '').toUpperCase()) || Boolean(record.snoozedUntil)
    if (scope === 'inbox') return isUnorganizedNotebookItem(record)
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
    if (scope === 'inbox') return isUnorganizedNotebookItem(record)
    if (currentCategoryId && !belongsToNotebookCategory(record, currentCategoryId)) return false
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
    try {
      const url = content.match(/https?:\/\/[^\s]+/)?.[0]
      if (url) await api.captureLink(url)
      else await api.save('notes', { title: content.slice(0, 42), content, status: 'INBOX', type: 'NOTE' })
      setCaptureDraft('')
      await onRefresh()
      onNotice('已收纳到未整理；不会自动关联项目、目标或任务。')
      window.setTimeout(() => captureInputRef.current?.focus(), 0)
    }
    catch (error) { onNotice(`收纳失败：${String(error)}`, 'danger') }
  }
  const selectScope = async (nextScope: string) => { await flushEditor(); setScope(nextScope); setFolderId(''); setSelectedId(''); setSelectedIds([]) }
  const chooseCaptureFile = (accept = '*/*') => {
    setCaptureFileAccept(accept)
    window.setTimeout(() => fileInputRef.current?.click(), 0)
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
    finally { setUploading(false); setCaptureFileAccept('*/*'); if (fileInputRef.current) fileInputRef.current.value = '' }
  }
  const addOptionalRelation = async () => {
    if (!relationTarget || !relationSources.length) return
    try { await Promise.all(relationSources.map((sourceId) => api.addRelation(sourceId, relationTarget, 'notebook:RELATED'))); setRelationTarget(''); if (selected) setRelated(await api.relations(selected.id)); onNotice(`已为 ${relationSources.length} 条 Notebook 内容建立可选关联。`) }
    catch (error) { onNotice(`关联失败：${String(error)}`, 'danger') }
  }
  const moveToCategory = async (categoryId: string) => {
    if (!categoryMoveSources.length) return
    try {
      await flushEditor()
      await Promise.all(categoryMoveSources.map(async (record) => { const latest = await api.get(record.id) || record; return api.save(record.entity, { ...latest, notebookCategoryId: categoryId || undefined, notebookFolderId: undefined }) }))
      setMovePickerOpen(false); setSelectedIds([]); setScope(categoryId || 'inbox'); setFolderId(''); await onRefresh(); onNotice(`已将 ${categoryMoveSources.length} 项归类；不会自动关联 Jason OS 记录。`)
    } catch (error) { onNotice(`归类失败：${String(error)}`, 'danger') }
  }
  const assignCategory = async (record: RecordData, categoryId: string) => {
    try {
      const latest = await api.get(record.id) || record
      await api.save(record.entity, { ...latest, notebookCategoryId: categoryId || undefined, notebookFolderId: undefined })
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
  const archiveSelection = async () => { const ids = selectedIds.length ? selectedIds : selected ? [selected.id] : []; if (!ids.length) return; await flushEditor(); await Promise.all(ids.map((id) => api.archive(id))); setSelectedIds([]); setSelectedId(''); await onRefresh(); onNotice('已 Archive，原始文件仍可恢复。') }
  const requestDeleteSelection = (ids?: string[]) => {
    const targets = ids?.length ? ids : selectedIds.length ? selectedIds : selected ? [selected.id] : []
    if (targets.length) setDeleteIds(targets)
  }
  const deleteSelection = async () => {
    if (!deleteIds.length) return
    const count = deleteIds.length
    try { setDeletingItems(true); await flushEditor(); await Promise.all(deleteIds.map((id) => api.remove(id))); setDeleteIds([]); setSelectedIds([]); setSelectedId(''); await onRefresh(); onNotice(`已删除 ${count} 项。`) }
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
    <div ref={notebookPanes.layoutRef} className="notebook-layout notebook-resizable-layout" style={notebookPanes.style}>
      <aside className="notebook-sidebar">
        <header className="notebook-sidebar-title"><span>▣</span><div><strong>收纳箱</strong><small>快速记录，随手收纳，稍后整理</small></div></header>
        <div className="notebook-filter-group">
          {[
            { id: 'inbox', icon: '▱', label: '未整理', count: activeItems.filter(isUnorganizedNotebookItem).length },
            { id: 'all', icon: '▦', label: '全部内容', count: activeItems.length },
            { id: 'notes', icon: '▤', label: '笔记', count: activeItems.filter((item) => item.entity === 'notes').length },
            { id: 'links', icon: '⌁', label: '链接', count: activeItems.filter((item) => item.entity === 'inbox' || Boolean(item.url || item.sourceUrl)).length },
            { id: 'images', icon: '▧', label: '图片', count: activeItems.filter((item) => fileMatches(item, 'image')).length },
            { id: 'videos', icon: '▻', label: '视频', count: activeItems.filter((item) => fileMatches(item, 'video')).length },
            { id: 'files', icon: '□', label: '文件', count: activeItems.filter((item) => item.entity === 'notebookFiles').length },
            { id: 'audio', icon: '♩', label: '语音', count: activeItems.filter((item) => fileMatches(item, 'audio')).length },
          ].map((item) => <button key={item.id} className={scope === item.id ? 'active' : ''} onClick={() => selectScope(item.id)}><i>{item.icon}</i><strong>{item.label}</strong><span>{item.count}</span></button>)}
        </div>
        <div className="notebook-filter-group archive">
          <button className={scope === 'later' ? 'active' : ''} onClick={() => selectScope('later')}><i>◴</i><strong>稍后处理</strong><span>{activeItems.filter((item) => ['LATER', 'SNOOZED'].includes(String(item.status || '').toUpperCase()) || Boolean(item.snoozedUntil)).length}</span></button>
          <button className={scope === 'archive' ? 'active' : ''} onClick={() => selectScope('archive')}><i>▱</i><strong>已归档</strong><span>{archived.length}</span></button>
        </div>
        <div className="notebook-category-filters">
          <header><span>▦</span><strong>分类</strong><button title="新建分类" onClick={() => { setCategoryDraft(''); setCategoryDialogOpen(true) }}>＋</button></header>
          <div className="notebook-category-list">
            {categories.length ? categories.map((category) => <button key={category.id} className={scope === category.id ? 'active' : ''} onClick={() => selectScope(category.id)}><span>{titleFor(category)}</span><b>{activeItems.filter((item) => belongsToNotebookCategory(item, category.id)).length}</b></button>) : <p>还没有分类</p>}
          </div>
          <button className="notebook-manage-categories" onClick={() => setCategoryMenuOpen(true)}>⚙ 管理分类</button>
        </div>
      </aside>
      <div className="notebook-pane-resizer" role="separator" title="拖动调整左侧栏宽度" aria-label="调整左侧栏宽度" aria-orientation="vertical" onPointerDown={notebookPanes.startResize('left')}><span aria-hidden="true">⋮</span></div>

      <header className="notebook-page-title notebook-workspace-title">
        <div><h2>收纳箱</h2><p>快速记录 · 自由编辑 · 分类整理 · 随时调用</p></div>
        <div className="research-mode-switch"><button className="active">收纳内容</button><button onClick={() => void flushEditor().then(() => setWorkspaceMode('research'))}>提出调研需求</button></div>
      </header>

      <section
        className="notebook-capture"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void uploadFiles(event.dataTransfer.files) }}
      >
        <div className="notebook-capture-copy">
          <span className="notebook-capture-icon">⌁</span>
          <textarea
            ref={captureInputRef}
            value={captureDraft}
            onChange={(event) => setCaptureDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void captureIntoInbox() } }}
            placeholder="记录想法、粘贴链接、拖入文件，或快速语音记录..."
            aria-label="快速记录"
          />
        </div>
        <div className="notebook-capture-types" aria-label="收纳类型">
          <button className="active" type="button" onClick={() => captureInputRef.current?.focus()}>▤ 文字</button>
          <button type="button" onClick={() => captureInputRef.current?.focus()}>⌁ 链接</button>
          <button type="button" onClick={() => chooseCaptureFile('image/*')}>▧ 图片</button>
          <button type="button" onClick={() => chooseCaptureFile('video/*')}>▻ 视频</button>
          <button type="button" onClick={() => chooseCaptureFile('*/*')}>□ 文件</button>
          <button type="button" onClick={() => chooseCaptureFile('audio/*')}>♩ 语音</button>
        </div>
        <div className="notebook-capture-actions">
          <button className="notebook-attach-button" title="添加附件" disabled={uploading} onClick={() => chooseCaptureFile()}>{uploading ? '…' : '📎'}</button>
          <button className="notebook-attach-button" title="选择语音文件" disabled={uploading} onClick={() => chooseCaptureFile('audio/*')}>♩</button>
          <button className="button primary" disabled={!captureDraft.trim()} onClick={() => void captureIntoInbox()}>立即收纳</button>
        </div>
        <input ref={fileInputRef} className="hidden-file-input" type="file" accept={captureFileAccept} multiple onChange={(event) => void uploadFiles(event.currentTarget.files)} />
      </section>

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

        <div className="notebook-smart-filter-row">
          {[
            { id: 'today', icon: '◉', label: '今天收集', count: activeItems.filter(createdToday).length },
            { id: 'week', icon: '◷', label: '本周收集', count: activeItems.filter((item) => createdWithinDays(item, 7)).length },
            { id: 'attachments', icon: '⌕', label: '有附件', count: activeItems.filter((item) => item.entity === 'notebookFiles' || Boolean(item.attachments)).length },
          ].map((item) => <button key={item.id} className={scope === item.id ? 'active' : ''} onClick={() => selectScope(item.id)}><i>{item.icon}</i>{item.label}<span>{item.count}</span></button>)}
          {noteTags.length > 0 && <div className="notebook-tag-filter-inline"><strong>标签</strong><select aria-label="按标签筛选" value={tagFilter} onChange={(event) => { setTagFilter(event.target.value); selectScope('notes') }}><option value="">全部</option>{noteTags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}</select></div>}
        </div>

        {selectedIds.length > 0 && <div className="notebook-batch-bar"><span>已选择 {selectedIds.length} 项</span>{scope !== 'archive' && <button className="notebook-batch-delete" onClick={() => requestDeleteSelection()}>删除所选</button>}<button onClick={() => setSelectedIds([])}>取消选择</button></div>}
        {movePickerOpen && <section className="notebook-move-picker"><header><div><strong>归类到收纳箱分类</strong><small>分类只用于收纳箱整理，不会自动关联 Jason OS。</small></div><button onClick={() => setMovePickerOpen(false)}>×</button></header>{categories.length ? <div className="notebook-move-select-row"><label>目标分类<select value={moveCategoryId} onChange={(event) => setMoveCategoryId(event.target.value)}><option value="">选择分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{titleFor(category)}</option>)}</select></label><button className="button primary" disabled={!moveCategoryId} onClick={() => void moveToCategory(moveCategoryId)}>确认归类</button></div> : <p>请先通过左侧“分类”旁的 ＋ 新建一个分类。</p>}</section>}

        {filtered.length ? <div className={`notebook-content-list ${viewMode}`}>
          {filtered.map((record) => {
            const kind = record.entity === 'notes' ? '笔记' : record.entity === 'notebookFiles' ? String(record.extension || '文件').toUpperCase() : record.entity === 'notebookFolders' ? '文件夹' : '网页链接'
            const summary = record.entity === 'notes' ? String(record.content || '暂无正文。') : record.entity === 'notebookFiles' ? String(record.extractedContent || record.originalName || record.relativePath || '') : String(record.description || record.summary || record.url || record.sourceUrl || '打开查看内容')
            return <article key={record.id} className={selected?.id === record.id ? 'active' : ''} onClick={() => void flushEditor().then(() => setSelectedId(record.id))} onDoubleClick={() => record.entity === 'notebookFolders' ? void flushEditor().then(() => setFolderId(record.id)) : onOpen(record)}>
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
        {selected?.entity === 'notes' ? <RichNotebookEditor note={selected} records={records} related={related} categories={categories} fullscreen={editorFullscreen} onOpen={onOpen} onCreateNote={() => void createManualNote()} onRefresh={onRefresh} onNotice={onNotice} onAi={onAi} onAssignCategory={assignCategory} onCreateCategory={() => { setCategoryDraft(''); setCategoryDialogOpen(true) }} onToggleFullscreen={() => setEditorFullscreen((current) => !current)} onClose={() => { setEditorFullscreen(false); setSelectedId('__closed__') }} onRelationsChanged={() => void api.relations(selected.id).then(setRelated)} onRegisterFlush={(value) => { editorFlushRef.current = value }} /> : <>
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
    {categoryMenuOpen && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCategoryMenuOpen(false)}><section className="notebook-action-dialog notebook-category-menu"><header><div><p>收纳箱整理</p><h3>分类选项</h3></div><button onClick={() => setCategoryMenuOpen(false)}>×</button></header>{categories.length ? <div className="notebook-category-option-list">{categories.map((category) => <button key={category.id} className={scope === category.id ? 'active' : ''} onClick={() => void selectScope(category.id).then(() => setCategoryMenuOpen(false))}><span>{titleFor(category)}</span><b>{activeItems.filter((item) => belongsToNotebookCategory(item, category.id)).length}</b></button>)}</div> : <p className="notebook-category-empty">还没有分类，请先新建一个分类。</p>}<footer><button className="button" onClick={() => { setCategoryMenuOpen(false); setCategoryDraft(''); setCategoryDialogOpen(true) }}>＋ 新建分类</button></footer></section></div>}
    {categoryDialogOpen && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !creatingCategory && setCategoryDialogOpen(false)}><form className="notebook-action-dialog" onSubmit={(event) => { event.preventDefault(); void createCategory() }}><header><div><p>收纳箱整理</p><h3>新建分类</h3></div><button type="button" disabled={creatingCategory} onClick={() => setCategoryDialogOpen(false)}>×</button></header><label><span>分类名称</span><input autoFocus value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="例如：产品灵感、工作资料" /></label><small>分类只用于笔记、链接和文件的查找整理，不会关联 Jason OS 的项目、目标或任务。</small><footer><button type="button" className="button ghost" disabled={creatingCategory} onClick={() => setCategoryDialogOpen(false)}>取消</button><button className="button primary" type="submit" disabled={!categoryDraft.trim() || creatingCategory}>{creatingCategory ? '正在创建…' : '创建分类'}</button></footer></form></div>}
    {deleteIds.length > 0 && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !deletingItems && setDeleteIds([])}><section className="notebook-action-dialog danger"><header><div><p>删除内容</p><h3>确定删除选中的 {deleteIds.length} 项？</h3></div><button disabled={deletingItems} onClick={() => setDeleteIds([])}>×</button></header><small>笔记、文件和链接删除后不会进入已归档。只有你确认后才会执行。</small><footer><button className="button ghost" disabled={deletingItems} onClick={() => setDeleteIds([])}>取消</button><button className="button danger" disabled={deletingItems} onClick={() => void deleteSelection()}>{deletingItems ? '正在删除…' : '确认删除'}</button></footer></section></div>}
  </div>
}

function ResearchInboxView({ records, externalItems: _externalItems, categories, captureConfig, onBackToCapture, onRefresh, onNotice }: { records: RecordData[]; externalItems: ExternalItem[]; categories: RecordData[]; captureConfig: CaptureProviderConfig | null; onBackToCapture: () => void; onRefresh: () => Promise<void>; onNotice: (text: string, tone?: Notice['tone']) => void }) {
  const [requestDraft, setRequestDraft] = useState('')
  const [followUpDraft, setFollowUpDraft] = useState('')
  const researchPanes = useThreePaneResize('jason-os-research-pane-sizes', { left: 210, right: 510 })
  const [filter, setFilter] = useState<'requests' | 'pending' | 'results' | 'completed'>('requests')
  const [selectedRequestId, setSelectedRequestId] = useState('')
  const [selectedResultId, setSelectedResultId] = useState('')
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<string[] | null>(null)
  const [sourceSelectionMode, setSourceSelectionMode] = useState<'AUTO' | 'MANUAL'>('AUTO')
  const [manualProviderIds, setManualProviderIds] = useState<CaptureProviderId[]>([])
  const [researchMode, setResearchMode] = useState<'QUICK' | 'STANDARD' | 'DEEP'>('STANDARD')
  const [sourceUrlDraft, setSourceUrlDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [knowledgeDialogOpen, setKnowledgeDialogOpen] = useState(false)
  const [knowledgeCategory, setKnowledgeCategory] = useState('')
  const [knowledgeRelationId, setKnowledgeRelationId] = useState('')
  const [relationDialogOpen, setRelationDialogOpen] = useState(false)
  const [relationTargetId, setRelationTargetId] = useState('')
  const [decisionEvidenceDialogOpen, setDecisionEvidenceDialogOpen] = useState(false)
  const [decisionTargetId, setDecisionTargetId] = useState('')
  const [evidenceSubject, setEvidenceSubject] = useState<RecordData | null>(null)
  const [reportDialogOpen, setReportDialogOpen] = useState(false)
  const [resultTab, setResultTab] = useState<'result' | 'plan' | 'evidence'>('result')
  const [planEditing, setPlanEditing] = useState(false)
  const [planEditDraft, setPlanEditDraft] = useState({ request: '', scope: '', dimensions: '', deliverables: '' })
  const [runningProgress, setRunningProgress] = useState({ current: '', completed: 0, total: 0 })
  const [selectedListIds, setSelectedListIds] = useState<string[]>([])
  const [batchAction, setBatchAction] = useState<'archive' | 'delete' | null>(null)
  const [optimisticallyHiddenIds, setOptimisticallyHiddenIds] = useState<string[]>([])
  const visibleRecords = records.filter((record) => !optimisticallyHiddenIds.includes(record.id))
  const requests = visibleRecords.filter((record) => record.entity === 'researchRequests').sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
  const results = visibleRecords.filter((record) => record.entity === 'researchResults').sort((a, b) => String(b.completedAt || b.updatedAt || '').localeCompare(String(a.completedAt || a.updatedAt || '')))
  const findings = visibleRecords.filter((record) => record.entity === 'researchFindings')
  const selectedRequest = requests.find((record) => record.id === selectedRequestId) || requests[0]
  const selectedResult = results.find((record) => record.id === selectedResultId) || results.find((record) => record.researchRequestId === selectedRequest?.id) || results[0]
  const plan = selectedRequest ? {
    title: titleFor(selectedRequest), scope: String(selectedRequest.scope || '待确认范围'),
    dimensions: String(selectedRequest.dimensions || '').split('、').filter(Boolean),
    deliverables: String(selectedRequest.deliverables || '').split('、').filter(Boolean),
    sources: resolveResearchSources(parseResearchSources(selectedRequest.sourcePlan), String(selectedRequest.request || ''), captureConfig), tags: tagsFor(selectedRequest),
  } satisfies ResearchPlan : null
  const relationTargets = records.filter((record) => ['goals', 'projects', 'tasks', 'knowledge', 'insights', 'mentalModels', 'decisions', 'reviews', 'timeLogs', 'financialTransactions'].includes(record.entity))
  const projectTargets = records.filter((record) => record.entity === 'projects')
  const decisionTargets = records.filter((record) => record.entity === 'decisions')
  const selectedRequestSources = plan?.sources || []
  const configuredProviders = getConfiguredProviders(captureConfig)
  const persistedSelectedSources = selectedSourceKeys ?? selectedRequestSources.filter((source) => source.status === 'ready').map((source) => source.key)
  const currentSelectedSources = persistedSelectedSources.filter((key) => selectedRequestSources.some((source) => source.key === key))
  const effectiveSelectedSources = currentSelectedSources.length ? currentSelectedSources : selectedRequestSources.filter((source) => source.status === 'ready').map((source) => source.key)
  const createPlan = async (draft = requestDraft, parentThreadId = '') => {
    const request = draft.trim()
    if (!request) return
    if (sourceSelectionMode === 'MANUAL' && !manualProviderIds.length) { onNotice('请至少选择一个已配置的 Provider，或切换回“智能匹配”。', 'danger'); return }
    const generated = createResearchPlan(request, records, captureConfig, sourceSelectionMode === 'MANUAL' ? { allowedProviderIds: manualProviderIds } : undefined)
    try {
      setBusy(true)
      const thread = parentThreadId ? null : await api.save('researchThreads', { title: generated.title, summary: request, status: 'ACTIVE', tags: generated.tags.join(',') })
      const created = await api.save('researchRequests', {
        title: generated.title, request, status: 'DRAFT', scope: generated.scope, dimensions: generated.dimensions.join('、'), deliverables: generated.deliverables.join('、'),
        researchThreadId: parentThreadId || thread?.id, sourcePlan: JSON.stringify(generated.sources), selectedSourceKeys: generated.sources.filter((source) => source.status === 'ready').map((source) => source.key).join(','), sourceSelectionMode, allowedProviderIds: sourceSelectionMode === 'MANUAL' ? manualProviderIds.join(',') : '', researchMode, tags: generated.tags.join(','),
      })
      setRequestDraft(''); setFollowUpDraft(''); setSelectedRequestId(created.id); setSelectedResultId(''); setSelectedSourceKeys(generated.sources.filter((source) => source.status === 'ready').map((source) => source.key)); setFilter('requests'); await onRefresh()
      onNotice(parentThreadId ? '已在同一调研主题下生成后续方案；历史结果不会被覆盖。' : '已生成调研方案；确认前不会抓取数据或关联 Jason OS。')
    } catch (error) { onNotice(`生成方案失败：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const toggleSource = (key: string) => setSelectedSourceKeys((current) => { const base = (current ?? selectedRequestSources.filter((source) => source.status === 'ready').map((source) => source.key)).filter((id) => selectedRequestSources.some((source) => source.key === id)); return base.includes(key) ? base.filter((item) => item !== key) : [...base, key] })
  const addSourceUrl = async (sourceKey: string) => {
    if (!selectedRequest || !plan) return
    const url = sourceUrlDraft.trim()
    if (!/^https?:\/\//i.test(url)) { onNotice('请粘贴以 http:// 或 https:// 开头的公开链接。', 'danger'); return }
    const sources = plan.sources.map((source) => source.key === sourceKey ? { ...source, url, status: 'ready' as const, detail: `${source.label} · 已补充公开链接，可在确认后执行` } : source)
    const selected = [...new Set([...effectiveSelectedSources, sourceKey])]
    try {
      setBusy(true)
      await api.save('researchRequests', { ...selectedRequest, sourcePlan: JSON.stringify(sources), selectedSourceKeys: selected.join(',') })
      setSelectedSourceKeys(selected); setSourceUrlDraft(''); await onRefresh(); onNotice('已添加公开链接；确认开始调研后才会读取。')
    } catch (error) { onNotice(`添加公开链接失败：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const runResearch = async () => {
    if (!selectedRequest || !plan) return
    const selectedSources = plan.sources.filter((source) => effectiveSelectedSources.includes(source.key))
    const runnable = selectedSources.filter((source) => source.status === 'ready' && (source.mode === 'keyword_search' || source.url))
    if (!runnable.length) { onNotice('请先选择一个可执行的情报源；未配置或未补充入口的来源不会被伪造执行。', 'danger'); return }
    const readSource = async (source: ResearchSourcePlan) => {
      return api.executeResearchSource({ ...source, researchRequestId: selectedRequest.id } as unknown as Record<string, unknown>)
    }
    let run: RecordData | null = null
    try {
      setBusy(true)
      const startedAt = nowInput()
      const planSnapshot = JSON.stringify({ scope: plan.scope, dimensions: plan.dimensions, deliverables: plan.deliverables, sources: selectedSources.map(({ key, label, mode, url }) => ({ key, label, mode, url })) })
      run = await api.save('researchRuns', { title: `${titleFor(selectedRequest)} · 本次执行`, researchThreadId: selectedRequest.researchThreadId, researchRequestId: selectedRequest.id, status: 'RUNNING', scopeSnapshot: plan.scope, planSnapshot, startedAt })
      await api.save('researchRequests', { ...selectedRequest, status: 'RUNNING', startedAt, selectedSourceKeys: selectedSources.map((source) => source.key).join(',') })
      setRunningProgress({ current: '', completed: 0, total: runnable.length })
      const settled: PromiseSettledResult<{ items: number; itemIds?: string[]; urls: string[]; provider?: string; cacheHit?: boolean; researchRunId?: string; evidenceCount?: number }>[] = []
      for (const [index, source] of runnable.entries()) {
        setRunningProgress({ current: source.label, completed: index, total: runnable.length })
        try { settled.push({ status: 'fulfilled', value: await readSource(source) }) } catch (reason) { settled.push({ status: 'rejected', reason }) }
        setRunningProgress({ current: source.label, completed: index + 1, total: runnable.length })
      }
      const fulfilled = settled.filter((result): result is PromiseFulfilledResult<{ items: number; itemIds?: string[]; urls: string[]; provider?: string; cacheHit?: boolean; researchRunId?: string; evidenceCount?: number }> => result.status === 'fulfilled').map((result) => result.value)
      const successful = runnable.filter((_, index) => settled[index].status === 'fulfilled')
      const failed = runnable.filter((_, index) => settled[index].status === 'rejected')
      const evidenceUrls = fulfilled.flatMap((result) => result.urls).join('\n')
      const itemCount = fulfilled.reduce((total, result) => total + result.items, 0)
      const evidenceItemIds = [...new Set(fulfilled.flatMap((result) => result.itemIds || []))]
      const researchRunIds = fulfilled.flatMap((result) => result.researchRunId ? [result.researchRunId] : [])
      const provenanceCount = fulfilled.reduce((total, result) => total + (result.evidenceCount || 0), 0)
      const cacheHits = fulfilled.filter((result) => result.cacheHit).length
      const status = failed.length ? 'PARTIAL' : 'COMPLETED'
      await api.save('researchRuns', { ...run, status, completedAt: nowInput(), providerRunIds: researchRunIds.join(',') })
      const missingData = failed.length ? `${failed.map((source) => source.label).join('、')} 未完成；需要补充入口或稍后重试。` : '无明显缺口；结论仍应结合原始证据复核。'
      const sourceCoverage = `已确认 ${selectedSources.length} 个来源，成功执行 ${successful.length} 个，未完成 ${failed.length} 个。`
      const summary = `本次已执行 ${successful.length} 个已确认的情报源${itemCount ? `，获得 ${itemCount} 条标准化内容` : ''}。\n\n调研范围：${plan.scope}\n研究维度：${plan.dimensions.join('、')}\n交付内容：${plan.deliverables.join('、')}\nEvidence：${evidenceItemIds.length} 条\nProvenance：${provenanceCount} 条${cacheHits ? `\n缓存命中：${cacheHits} 个来源` : ''}\n\n未自动关联任何 Jason OS 项目、目标或任务。${failed.length ? `\n${failed.length} 个来源未完成，请检查来源或采集服务。` : ''}`
      const result = await api.save('researchResults', {
        title: `${titleFor(selectedRequest)} · 调研结果`, researchRequestId: selectedRequest.id, status: failed.length ? 'PARTIAL' : 'COMPLETED', completedAt: nowInput(), tags: plan.tags.join(','),
        researchThreadId: selectedRequest.researchThreadId, researchRunId: run.id, summary, executiveSummary: summary, scopeSnapshot: plan.scope, planSnapshot, metricsSummary: `标准化内容 ${itemCount} 条；证据内容 ${evidenceItemIds.length} 条；来源追溯 ${provenanceCount} 条。`, sourceCoverage, missingData, limitations: '结果基于本次确认执行的公开来源，不代表完整市场事实或商业结论。', confidence: failed.length ? '低（存在未完成来源）' : evidenceItemIds.length ? '中（需结合原始证据复核）' : '低（未获得可核验证据）', recommendations: '先查看发现和证据，再决定是否继续补充调研、关联项目或沉淀为知识。', evidenceUrls, evidenceItemIds: evidenceItemIds.join(','), researchRunIds: researchRunIds.join(','), provenanceCount,
      })
      await api.save('researchFindings', { title: '执行与证据概览', finding: `${sourceCoverage} 已收集 ${evidenceItemIds.length} 条标准化证据内容和 ${provenanceCount} 条来源追溯。`, dimension: '执行与证据', importance: 'MEDIUM', confidence: failed.length ? '低' : '中', evidenceItemIds: evidenceItemIds.join(','), evidenceCount: evidenceItemIds.length, orderIndex: 1, researchThreadId: selectedRequest.researchThreadId, researchResultId: result.id, researchRunId: run.id })
      if (failed.length) await api.save('researchFindings', { title: '数据缺口', finding: missingData, dimension: '数据缺口', importance: 'HIGH', confidence: '高', evidenceCount: 0, orderIndex: 2, researchThreadId: selectedRequest.researchThreadId, researchResultId: result.id, researchRunId: run.id })
      await api.save('researchRequests', { ...selectedRequest, status: failed.length && !successful.length ? 'FAILED' : 'COMPLETED', executionStatus: failed.length ? 'PARTIAL_SUCCESS' : 'COMPLETED', completedAt: nowInput(), selectedSourceKeys: selectedSources.map((source) => source.key).join(','), resultId: result.id })
      setSelectedResultId(result.id); setFilter('results'); await onRefresh(); onNotice(failed.length ? '调研已部分完成；结果与未完成来源已保存。' : '调研完成；结果快照已保存。')
    } catch (error) { if (run) await api.save('researchRuns', { ...run, status: 'FAILED', completedAt: nowInput() }).catch(() => undefined); await api.save('researchRequests', { ...selectedRequest, status: 'FAILED' }).catch(() => undefined); onNotice(`调研未完成：${String(error)}`, 'danger') } finally { setRunningProgress({ current: '', completed: 0, total: 0 }); setBusy(false) }
  }
  const updateResultCategory = async (categoryId: string) => {
    if (!selectedResult) return
    try { await api.save('researchResults', { ...selectedResult, notebookCategoryId: categoryId || undefined }); await onRefresh(); onNotice(categoryId ? '已为调研结果选择分类。' : '已移出收纳箱分类。') } catch (error) { onNotice(`分类失败：${String(error)}`, 'danger') }
  }
  const saveToKnowledge = async () => {
    if (!selectedResult) return
    try {
      setBusy(true)
      const knowledge = await api.save('knowledge', { title: titleFor(selectedResult), content: `${String(selectedResult.executiveSummary || selectedResult.summary || '')}\n\n证据链接：\n${String(selectedResult.evidenceUrls || '无')}`, category: knowledgeCategory || '外部情报', status: 'ACTIVE', researchResultId: selectedResult.id })
      await api.addRelation(selectedResult.id, knowledge.id, 'research:STORED_AS_KNOWLEDGE')
      if (knowledgeRelationId) await api.addRelation(knowledge.id, knowledgeRelationId, 'knowledge:RELATED')
      setKnowledgeDialogOpen(false); setKnowledgeCategory(''); setKnowledgeRelationId(''); await onRefresh(); onNotice('已按你的确认存入知识。')
    } catch (error) { onNotice(`存入知识失败：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const addRelation = async () => {
    if (!selectedResult || !relationTargetId) return
    try { setBusy(true); await api.addRelation(selectedResult.id, relationTargetId, 'research:PROJECT_CONTEXT'); setRelationDialogOpen(false); setRelationTargetId(''); onNotice('已按你的确认关联项目。') } catch (error) { onNotice(`关联失败：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const savePlanEdit = async () => {
    if (!selectedRequest) return
    try { setBusy(true); await api.save('researchRequests', { ...selectedRequest, request: planEditDraft.request.trim(), scope: planEditDraft.scope.trim(), dimensions: planEditDraft.dimensions.trim(), deliverables: planEditDraft.deliverables.trim() }); setPlanEditing(false); await onRefresh(); onNotice('已更新调研方案；尚未执行任何情报源。') } catch (error) { onNotice(`修改方案失败：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const createDecisionEvidence = async () => {
    if (!decisionTargetId || !evidenceSubject) return
    try { setBusy(true); await api.addRelation(evidenceSubject.id, decisionTargetId, evidenceSubject.entity === 'researchFindings' ? 'decision:RESEARCH_FINDING_EVIDENCE' : 'decision:RESEARCH_RESULT_EVIDENCE'); setDecisionEvidenceDialogOpen(false); setDecisionTargetId(''); setEvidenceSubject(null); onNotice('已作为决策证据关联；不会改变调研结果快照。') } catch (error) { onNotice(`关联决策证据失败：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const reportPreview = selectedResult ? `# ${titleFor(selectedResult)}\n\n## 执行摘要\n${String(selectedResult.executiveSummary || selectedResult.summary || '暂无摘要。')}\n\n## 发现\n${findings.filter((item) => item.researchResultId === selectedResult.id).map((item) => `- **${titleFor(item)}**：${String(item.finding || '')}`).join('\n') || '暂无独立发现。'}\n\n## 证据与局限\n${String(selectedResult.sourceCoverage || '')}\n${String(selectedResult.missingData || '')}\n${String(selectedResult.limitations || '')}\n` : ''
  const createReportDraft = async () => {
    if (!selectedResult) return
    try { setBusy(true); const report = await api.save('deliverables', { title: `${titleFor(selectedResult)} · 正式报告草稿`, summary: '由调研结果生成的 Markdown 正式报告草稿；需人工确认后再定稿。', status: 'DRAFT', assetType: 'RESEARCH', reportMarkdown: reportPreview, sourceResearchResultId: selectedResult.id, projectId: undefined }); await api.addRelation(report.id, selectedResult.id, 'deliverable:SOURCE_RESEARCH_RESULT'); setReportDialogOpen(false); await onRefresh(); onNotice('已生成 Markdown 正式报告草稿，未改动原调研结果。') } catch (error) { onNotice(`生成报告失败：${String(error)}`, 'danger') } finally { setBusy(false) }
  }
  const executeBatchAction = async () => {
    if (!batchAction || !selectedListIds.length) return
    const ids = selectedListIds
    const action = batchAction === 'archive' ? '归档' : '删除'
    setBatchAction(null)
    setOptimisticallyHiddenIds((current) => [...new Set([...current, ...ids])])
    setSelectedListIds([])
    setSelectedRequestId('')
    setSelectedResultId('')
    try {
      setBusy(true)
      if (batchAction === 'archive') await api.archiveMany(ids)
      else await api.removeMany(ids)
      await onRefresh()
      onNotice(`已${action} ${ids.length} 条调研记录。`)
    } catch (error) {
      setOptimisticallyHiddenIds((current) => current.filter((id) => !ids.includes(id)))
      await onRefresh()
      onNotice(`${action}失败：${String(error)}`, 'danger')
    } finally { setBusy(false) }
  }
  const filteredRequests = requests.filter((record) => filter === 'pending' ? record.status === 'DRAFT' : filter === 'completed' ? record.status === 'COMPLETED' || record.status === 'FAILED' : true)
  const resultCount = results.length
  return <div className="notebook-page notebook-space research-inbox-page">
    <header className="notebook-page-title"><div><h2>收纳箱</h2><p>收集、整理并沉淀你的内容</p></div><div className="research-mode-switch"><button onClick={onBackToCapture}>收纳内容</button><button className="active">提出调研需求</button></div></header>
    <section className="research-request-composer">
      <label>我想调研什么？<textarea value={requestDraft} onChange={(event) => setRequestDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void createPlan() } }} placeholder="例如：调研美国 TikTok 大码女装近30天的爆款、竞品和价格带" /></label>
      <div className="research-planning-options"><label>情报源<select value={sourceSelectionMode} onChange={(event) => { const mode = event.target.value as 'AUTO' | 'MANUAL'; setSourceSelectionMode(mode); if (mode === 'MANUAL' && !manualProviderIds.length) setManualProviderIds(configuredProviders.map((provider) => provider.id)) }}><option value="AUTO">智能匹配（推荐）</option><option value="MANUAL">手动选择 Provider</option></select></label><label>调研深度<select value={researchMode} onChange={(event) => setResearchMode(event.target.value as 'QUICK' | 'STANDARD' | 'DEEP')}><option value="QUICK">快速</option><option value="STANDARD">标准</option><option value="DEEP">深度</option></select></label></div>
      {sourceSelectionMode === 'MANUAL' && <section className="research-provider-multiselect"><strong>可用 Provider</strong>{configuredProviders.length ? configuredProviders.map((provider) => <label key={provider.id}><input type="checkbox" checked={manualProviderIds.includes(provider.id)} onChange={() => setManualProviderIds((current) => current.includes(provider.id) ? current.filter((id) => id !== provider.id) : [...current, provider.id])} /><span><b>{provider.label}</b><small>{provider.status || 'CONFIGURED'} · {provider.supportedPlatforms.join('、')}</small></span></label>) : <p>尚未配置可用 External Intelligence Provider。</p>}</section>}
      <div><small>系统会先规划情报源；确认前不会抓取数据或关联 Jason OS。</small><button className="button primary" disabled={!requestDraft.trim() || busy} onClick={() => void createPlan()}>{busy ? '正在规划…' : '生成调研方案'}</button></div>
    </section>
    <div ref={researchPanes.layoutRef} className="research-workspace research-resizable-workspace" style={researchPanes.style}>
      <aside className="research-sidebar"><header><strong>调研结果</strong></header><nav><button className={filter === 'requests' ? 'active' : ''} onClick={() => setFilter('requests')}>⌕ 调研需求 <span>{requests.length}</span></button><button className={filter === 'results' ? 'active' : ''} onClick={() => setFilter('results')}>◈ 调研结果 <span>{resultCount}</span></button><button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>◷ 待确认 <span>{requests.filter((record) => record.status === 'DRAFT').length}</span></button><button className={filter === 'completed' ? 'active' : ''} onClick={() => setFilter('completed')}>✓ 已完成 <span>{requests.filter((record) => ['COMPLETED', 'FAILED'].includes(String(record.status))).length}</span></button></nav><section><header><strong>分类</strong></header>{categories.length ? categories.map((category) => <button key={category.id} onClick={() => { setFilter('results'); setSelectedResultId(results.find((result) => result.notebookCategoryId === category.id)?.id || '') }}>▱ {titleFor(category)} <span>{results.filter((result) => result.notebookCategoryId === category.id).length}</span></button>) : <p>调研完成后可创建分类整理结果。</p>}</section></aside>
      <div className="research-pane-resizer" role="separator" title="拖动调整左侧栏宽度" aria-label="调整调研左侧栏宽度" aria-orientation="vertical" onPointerDown={researchPanes.startResize('left')}><span aria-hidden="true">⋮</span></div>
      <section className="research-thread">
        {selectedListIds.length > 0 && <div className="research-batch-actions"><span>已选 {selectedListIds.length} 条</span><button className="button" disabled={busy} onClick={() => setBatchAction('archive')}>归档</button><button className="button danger" disabled={busy} onClick={() => setBatchAction('delete')}>删除</button><button className="button ghost" disabled={busy} onClick={() => setSelectedListIds([])}>取消</button></div>}
        {(filter === 'results' ? results : filteredRequests).length ? <div className="research-record-list">{(filter === 'results' ? results : filteredRequests).map((record) => <article key={record.id} className={`research-record-row ${(record.id === selectedRequest?.id || record.id === selectedResult?.id) ? 'active' : ''}`}><input aria-label={`选择 ${titleFor(record)}`} type="checkbox" checked={selectedListIds.includes(record.id)} onChange={() => setSelectedListIds((current) => current.includes(record.id) ? current.filter((id) => id !== record.id) : [...current, record.id])} /><button onClick={() => { if (record.entity === 'researchResults') { setSelectedResultId(record.id); setFilter('results'); setResultTab('result') } else { setSelectedRequestId(record.id); setSelectedSourceKeys(String(record.selectedSourceKeys || '').split(',').filter(Boolean)); setPlanEditing(false) } }}><div><strong>{titleFor(record)}</strong><small>{record.entity === 'researchResults' ? '调研结果' : String(record.status === 'DRAFT' ? '方案待确认' : record.status === 'RUNNING' ? '调研中' : record.status === 'COMPLETED' ? '已完成' : '未完成')}</small></div><time>{formatDate(record.updatedAt || record.completedAt || record.createdAt, true)}</time></button></article>)}</div> : <div className="research-empty-list"><strong>还没有调研内容</strong><p>在上方写下需求，系统会先生成可确认的方案。</p></div>}
      </section>
      <div className="research-pane-resizer" role="separator" title="拖动调整右侧栏宽度" aria-label="调整调研右侧栏宽度" aria-orientation="vertical" onPointerDown={researchPanes.startResize('right')}><span aria-hidden="true">⋮</span></div>
      <aside className="research-detail">
        {filter === 'results' && selectedResult ? <>
          <header><strong>调研结果快照</strong><span>{String(selectedResult.status) === 'PARTIAL' ? '部分完成' : '已完成'}</span></header>
          <nav className="research-result-tabs"><button className={resultTab === 'result' ? 'active' : ''} onClick={() => setResultTab('result')}>结果</button><button className={resultTab === 'plan' ? 'active' : ''} onClick={() => setResultTab('plan')}>方案快照</button><button className={resultTab === 'evidence' ? 'active' : ''} onClick={() => setResultTab('evidence')}>证据</button></nav>
          <article className="research-result-card"><h3>{titleFor(selectedResult)}</h3><pre>{resultTab === 'plan' ? String(selectedResult.planSnapshot || '旧版结果未保存完整方案快照。') : resultTab === 'evidence' ? `${String(selectedResult.sourceCoverage || '')}\n${String(selectedResult.missingData || '')}\n${String(selectedResult.limitations || '')}` : String(selectedResult.executiveSummary || selectedResult.summary || '暂无摘要。')}</pre>{resultTab === 'result' && <section className="research-findings"><strong>调研发现</strong>{findings.filter((item) => item.researchResultId === selectedResult.id).map((finding) => <article key={finding.id}><b>{titleFor(finding)}</b><p>{String(finding.finding || '')}</p><small>{String(finding.confidence || '未标注')} · {Number(finding.evidenceCount || 0)} 条证据</small><button onClick={() => { setEvidenceSubject(finding); setDecisionTargetId(''); setDecisionEvidenceDialogOpen(true) }}>作为决策证据</button></article>)}{!findings.some((item) => item.researchResultId === selectedResult.id) && <p>暂无独立发现；可查看证据与数据缺口。</p>}</section>}{resultTab === 'evidence' && Boolean(selectedResult.evidenceUrls) && <section><strong>证据链接</strong>{String(selectedResult.evidenceUrls).split('\n').filter(Boolean).map((url) => <button key={url} onClick={() => void api.openExternal(url)}>{url.replace(/^https?:\/\//, '')}</button>)}</section>}</article>
          <NotebookCategoryControl record={selectedResult} categories={categories} onChange={async (_, categoryId) => updateResultCategory(categoryId)} onCreate={() => onNotice('请先切换到“收纳内容”，在左侧分类处新建分类。')} />
          <div className="research-result-actions"><button className="button" onClick={() => { setKnowledgeCategory(''); setKnowledgeRelationId(''); setKnowledgeDialogOpen(true) }}>▱ 存入知识</button><button className="button" onClick={() => { setRelationTargetId(''); setRelationDialogOpen(true) }}>□ 关联项目</button><button className="button" onClick={() => { setEvidenceSubject(selectedResult); setDecisionTargetId(''); setDecisionEvidenceDialogOpen(true) }}>◇ 作为决策证据</button><button className="button" onClick={() => setReportDialogOpen(true)}>▣ 生成正式报告</button></div>
        </> : selectedRequest && plan ? <>
          <header><strong>调研方案</strong><span className="research-status">{selectedRequest.status === 'DRAFT' ? '尚未执行' : selectedRequest.status === 'RUNNING' ? '调研中' : selectedRequest.status === 'COMPLETED' ? '已完成' : '未完成'}</span></header>
          <article className="research-plan-card">{planEditing ? <section className="research-plan-editor"><label>调研要求<textarea value={planEditDraft.request} onChange={(event) => setPlanEditDraft((draft) => ({ ...draft, request: event.target.value }))} /></label><label>范围<input value={planEditDraft.scope} onChange={(event) => setPlanEditDraft((draft) => ({ ...draft, scope: event.target.value }))} /></label><label>维度（用、分隔）<input value={planEditDraft.dimensions} onChange={(event) => setPlanEditDraft((draft) => ({ ...draft, dimensions: event.target.value }))} /></label><label>交付内容（用、分隔）<input value={planEditDraft.deliverables} onChange={(event) => setPlanEditDraft((draft) => ({ ...draft, deliverables: event.target.value }))} /></label><footer><button className="button ghost" disabled={busy} onClick={() => setPlanEditing(false)}>取消</button><button className="button primary" disabled={busy || !planEditDraft.request.trim()} onClick={() => void savePlanEdit()}>保存方案</button></footer></section> : <><div className="research-user-message">{String(selectedRequest.request || '')}</div><h3>已为你生成调研方案</h3><dl><div><dt>范围</dt><dd>{plan.scope}</dd></div><div><dt>维度</dt><dd>{plan.dimensions.join('、')}</dd></div><div><dt>情报源</dt><dd>{plan.sources.map((source) => <div className="research-source-choice" key={source.key}><label className={source.status}><input type="checkbox" checked={effectiveSelectedSources.includes(source.key)} disabled={source.status !== 'ready' || selectedRequest.status !== 'DRAFT'} onChange={() => toggleSource(source.key)} /><span><b>{source.label}</b><small>{source.detail}</small></span><em>{source.status === 'ready' ? '可执行' : source.status === 'needs_input' ? '需入口' : source.status === 'needs_configuration' ? '需配置' : '不可用'}</em></label>{source.status === 'needs_input' && selectedRequest.status === 'DRAFT' && <div className="research-source-input"><input value={sourceUrlDraft} onChange={(event) => setSourceUrlDraft(event.target.value)} placeholder="粘贴公开链接后执行" /><button className="button" disabled={busy || !sourceUrlDraft.trim()} onClick={() => void addSourceUrl(source.key)}>添加入口</button></div>}</div>)}</dd></div><div><dt>交付内容</dt><dd>{plan.deliverables.join('、')}</dd></div></dl>{selectedRequest.status === 'DRAFT' ? <footer><button className="button" onClick={() => { setPlanEditDraft({ request: String(selectedRequest.request || ''), scope: plan.scope, dimensions: plan.dimensions.join('、'), deliverables: plan.deliverables.join('、') }); setPlanEditing(true) }}>修改方案</button><button className="button primary" disabled={busy} onClick={() => void runResearch()}>{busy ? '正在执行…' : '确认并开始调研'}</button></footer> : <p className="research-plan-note">{selectedRequest.status === 'RUNNING' ? `正在读取 ${runningProgress.current || '已确认的情报源'}（${runningProgress.completed}/${runningProgress.total}）。` : '调研记录已保留；结果可在“调研结果”中查看。'}</p>}</>}</article><p className="research-safety-note">⌑ 确认前不会抓取数据，也不会关联 Jason OS。</p>
        </> : <div className="research-result-empty"><span>⌕</span><strong>选择一条调研需求</strong><p>右侧会显示方案、来源与结果操作。</p></div>}
      {filter === 'results' && selectedResult && <section className="research-followup"><span>📎</span><input value={followUpDraft} onChange={(event) => setFollowUpDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createPlan(followUpDraft, String(selectedResult.researchThreadId || '')) }} placeholder="继续补充调研要求…" /><button aria-label="发送后续调研需求" disabled={!followUpDraft.trim() || busy} onClick={() => void createPlan(followUpDraft, String(selectedResult.researchThreadId || ''))}>➤</button></section>}
      </aside>
    </div>
    {knowledgeDialogOpen && selectedResult && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setKnowledgeDialogOpen(false)}><section className="notebook-action-dialog notebook-knowledge-dialog"><header><div><p>知识沉淀</p><h3>确认存入知识</h3></div><button disabled={busy} onClick={() => setKnowledgeDialogOpen(false)}>×</button></header><label><span>知识分类</span><input autoFocus value={knowledgeCategory} onChange={(event) => setKnowledgeCategory(event.target.value)} placeholder="例如：行业研究、竞品资料" /></label><label><span>可选关联</span><select value={knowledgeRelationId} onChange={(event) => setKnowledgeRelationId(event.target.value)}><option value="">不关联其他记录</option>{relationTargets.map((target) => <option key={target.id} value={target.id}>{configFor(target.entity).label} · {titleFor(target)}</option>)}</select></label><small>确认后才会创建知识记录。项目、目标、任务等只会按你在这里的选择关联。</small><footer><button className="button ghost" disabled={busy} onClick={() => setKnowledgeDialogOpen(false)}>取消</button><button className="button primary" disabled={busy} onClick={() => void saveToKnowledge()}>{busy ? '正在存入…' : '确认存入知识'}</button></footer></section></div>}
    {relationDialogOpen && selectedResult && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setRelationDialogOpen(false)}><section className="notebook-action-dialog"><header><div><p>可选关联</p><h3>关联项目</h3></div><button disabled={busy} onClick={() => setRelationDialogOpen(false)}>×</button></header><label><span>选择项目</span><select autoFocus value={relationTargetId} onChange={(event) => setRelationTargetId(event.target.value)}><option value="">暂不选择</option>{projectTargets.map((target) => <option key={target.id} value={target.id}>{titleFor(target)}</option>)}</select></label><small>仅在你确认后建立项目上下文；调研结果快照和历史关系不会被改写。</small><footer><button className="button ghost" disabled={busy} onClick={() => setRelationDialogOpen(false)}>取消</button><button className="button primary" disabled={!relationTargetId || busy} onClick={() => void addRelation()}>确认关联</button></footer></section></div>}
    {decisionEvidenceDialogOpen && evidenceSubject && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setDecisionEvidenceDialogOpen(false)}><section className="notebook-action-dialog"><header><div><p>证据引用</p><h3>作为决策证据</h3></div><button disabled={busy} onClick={() => setDecisionEvidenceDialogOpen(false)}>×</button></header><label><span>选择决策</span><select autoFocus value={decisionTargetId} onChange={(event) => setDecisionTargetId(event.target.value)}><option value="">暂不选择</option>{decisionTargets.map((target) => <option key={target.id} value={target.id}>{titleFor(target)}</option>)}</select></label><small>关联的是调研结果或发现，不会把它自动变成决策结论。</small><footer><button className="button ghost" disabled={busy} onClick={() => setDecisionEvidenceDialogOpen(false)}>取消</button><button className="button primary" disabled={!decisionTargetId || busy} onClick={() => void createDecisionEvidence()}>确认引用</button></footer></section></div>}
    {reportDialogOpen && selectedResult && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setReportDialogOpen(false)}><section className="notebook-action-dialog notebook-report-dialog"><header><div><p>正式输出</p><h3>生成 Markdown 报告草稿</h3></div><button disabled={busy} onClick={() => setReportDialogOpen(false)}>×</button></header><pre>{reportPreview}</pre><small>确认后会在成果中心创建一份 Markdown 草稿，不会覆盖调研结果或原始证据。</small><footer><button className="button ghost" disabled={busy} onClick={() => setReportDialogOpen(false)}>取消</button><button className="button primary" disabled={busy} onClick={() => void createReportDraft()}>确认生成草稿</button></footer></section></div>}
    {batchAction && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setBatchAction(null)}><section className="notebook-action-dialog danger"><header><div><p>批量{batchAction === 'archive' ? '归档' : '删除'}</p><h3>确认{batchAction === 'archive' ? '归档' : '删除'}选中的 {selectedListIds.length} 条调研记录？</h3></div><button disabled={busy} onClick={() => setBatchAction(null)}>×</button></header><small>{batchAction === 'archive' ? '归档后可在归档箱恢复。' : '删除后可在已删除记录中恢复；相关调研快照不会被静默改写。'}</small><footer><button className="button ghost" disabled={busy} onClick={() => setBatchAction(null)}>取消</button><button className={`button ${batchAction === 'delete' ? 'danger' : 'primary'}`} disabled={busy} onClick={() => void executeBatchAction()}>{busy ? '正在处理…' : `确认${batchAction === 'archive' ? '归档' : '删除'}`}</button></footer></section></div>}
  </div>
}

function NotebookCategoryControl({ record, categories, compact = false, onChange, onCreate }: { record: RecordData; categories: RecordData[]; compact?: boolean; onChange: (record: RecordData, categoryId: string) => Promise<void>; onCreate: () => void }) {
  return <section className={`notebook-category-control${compact ? ' compact' : ''}`}><label>收纳箱分类<select value={String(record.notebookCategoryId || '')} onChange={(event) => void onChange(record, event.target.value)}><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{titleFor(category)}</option>)}</select></label><button className="button" onClick={onCreate}>＋ 新建分类</button></section>
}

function RichNotebookEditor({ note, records, related, categories, fullscreen, onOpen, onCreateNote, onRefresh, onNotice, onAi, onAssignCategory, onCreateCategory, onToggleFullscreen, onClose, onRelationsChanged, onRegisterFlush }: { note: RecordData; records: RecordData[]; related: RecordData[]; categories: RecordData[]; fullscreen: boolean; onOpen: (record: RecordData) => void; onCreateNote: () => void; onRefresh: () => Promise<void>; onNotice: (text: string, tone?: Notice['tone']) => void; onAi: (question: string, context: Partial<AgentContext>) => void; onAssignCategory: (record: RecordData, categoryId: string) => Promise<void>; onCreateCategory: () => void; onToggleFullscreen: () => void; onClose: () => void; onRelationsChanged: () => void; onRegisterFlush: (flush: (() => Promise<void>) | null) => void }) {
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
  const [saveState, setSaveState] = useState<NoteSaveState>('CLEAN')
  const titleRef = useRef(title)
  const tagsRef = useRef(tags)
  const controllerRef = useRef<NoteAutosaveController | null>(null)
  const html = () => editorRef.current ? durableNotebookHtml(editorRef.current) : ''
  const text = () => editorRef.current?.innerText.trim() || ''
  const snapshot = () => ({ noteId: note.id, title: titleRef.current.trim() || '未命名笔记', content: text(), contentHtml: html(), fileIds: editorRef.current ? notebookFileIds(editorRef.current) : [], tags: tagsRef.current })
  const markDirty = () => controllerRef.current?.update(snapshot())
  const flush = () => controllerRef.current?.flush() ?? Promise.resolve()
  useEffect(() => {
    const nextTitle = String(note.title || '')
    const nextTags = tagsFor(note)
    setTitle(nextTitle); titleRef.current = nextTitle
    setTags(nextTags); tagsRef.current = nextTags
    setRelationPickerOpen(false); setKnowledgeDialogOpen(false)
    const editor = editorRef.current
    if (!editor) return
    const recovery = readNoteRecovery(note.id)
    const persistedAt = new Date(Number(note.updatedAt) || String(note.updatedAt || 0)).getTime() || 0
    const recovered = recovery && recovery.capturedAt > persistedAt ? recovery : null
    const savedHtml = String(recovered?.contentHtml || note.contentHtml || '')
    if (savedHtml) editor.innerHTML = savedHtml
    else editor.textContent = String(recovered?.content ?? note.content ?? '')
    if (recovered) {
      setTitle(recovered.title); titleRef.current = recovered.title
      setTags(recovered.tags); tagsRef.current = recovered.tags
      onNotice('检测到未完成编辑，已自动恢复。')
    }
    for (const image of Array.from(editor.querySelectorAll<HTMLImageElement>('img[data-jason-missing-asset]'))) {
      image.removeAttribute('src')
      image.alt = image.alt || '图片资源已失效，原始内容未被删除'
      image.title = '图片资源已失效；如找到原图，可重新插入恢复'
    }
    for (const image of Array.from(editor.querySelectorAll<HTMLImageElement>('img[data-jason-file-id]'))) {
      const fileId = image.dataset.jasonFileId
      if (!fileId) continue
      void api.previewNotebookFile(fileId).then((preview) => {
        if (preview.kind === 'image' && preview.dataUrl && image.isConnected) image.src = preview.dataUrl
      }).catch(() => { image.alt = image.alt || '图片暂时不可用' })
    }
    const controller = new NoteAutosaveController({
      persist: async (draft: NoteDraftSnapshot) => {
        const current = await api.get(draft.noteId)
        if (!current || current.entity !== 'notes') throw new Error('笔记已不存在，无法自动保存')
        await api.save('notes', { ...current, title: draft.title, content: draft.content, contentHtml: draft.contentHtml, fileIds: draft.fileIds, tags: draft.tags, lastAutosavedAt: Date.now(), editSequence: draft.editSequence })
      },
      recover: (draft) => writeNoteRecovery(note.id, draft),
      onState: setSaveState,
    })
    controllerRef.current = controller
    const registeredFlush = () => controller.flush()
    onRegisterFlush(registeredFlush)
    const flushBeforeExit = () => { void controller.flush().catch(() => {}) }
    window.addEventListener('pagehide', flushBeforeExit)
    if (recovered) {
      controller.update({ noteId: note.id, title: recovered.title, content: recovered.content, contentHtml: recovered.contentHtml, fileIds: recovered.fileIds, tags: recovered.tags })
      void controller.flush()
    } else setSaveState('CLEAN')
    return () => {
      window.removeEventListener('pagehide', flushBeforeExit)
      onRegisterFlush(null)
      void controller.flush().catch(() => {})
      controller.dispose()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  // The editor must only be rehydrated when switching notes; metadata refreshes must never overwrite unsaved DOM content.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id])
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
  const command = (name: string, value?: string) => { editorRef.current?.focus(); document.execCommand(name, false, value); markDirty() }
  const save = async () => { try { markDirty(); await flush(); await onRefresh(); onNotice('笔记已保存。') } catch (error) { onNotice(`保存失败：${String(error)}`, 'danger') } }
  const existingTags = [...new Set(records.filter((record) => record.entity === 'notes').flatMap(tagsFor))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const relationEntities: Entity[] = ['goals', 'projects', 'tasks', 'results', 'knowledge', 'insights', 'mentalModels', 'decisions', 'reviews', 'events', 'people']
  const relationTargets = records.filter((record) => record.id !== note.id && relationEntities.includes(record.entity))
  const addTag = () => {
    const tag = tagDraft.trim()
    if (!tag) return
    if (!tagsRef.current.includes(tag)) {
      const next = [...tagsRef.current, tag]
      tagsRef.current = next; setTags(next); window.setTimeout(markDirty, 0)
    }
    setTagDraft(''); setTagDialogOpen(false)
  }
  const addLink = () => { const url = window.prompt('输入链接地址'); if (url) command('createLink', url) }
  const inboxImages = records.filter((record) => record.entity === 'notebookFiles' && (String(record.mimeType || '').startsWith('image/') || /\.(jpe?g|png|webp|gif|svg|heic)$/i.test(String(record.originalName || record.name || record.relativePath || record.extension || ''))))
  const insertManagedImage = (fileId: string, dataUrl: string, alt: string) => {
    const image = document.createElement('img')
    image.src = dataUrl; image.alt = alt; image.dataset.jasonFileId = fileId
    command('insertHTML', image.outerHTML)
  }
  const addLocalImages = async (files: FileList | File[] | null) => {
    const images = files ? imageFiles(files) : []
    if (!images.length) return
    try {
      for (const file of images) {
        const stored = await api.uploadNotebookFile({ file })
        const preview = await api.previewNotebookFile(stored.id)
        if (preview.kind !== 'image' || !preview.dataUrl) throw new Error('图片保存后无法预览')
        insertManagedImage(stored.id, preview.dataUrl, file.name)
      }
      setImagePickerOpen(false)
    } catch (error) { onNotice(`图片保存失败：${String(error)}`, 'danger') }
    finally { if (imageInputRef.current) imageInputRef.current.value = '' }
  }
  const pasteImages = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const images = imageFiles(Array.from(event.clipboardData.files))
    if (!images.length) return
    event.preventDefault()
    void addLocalImages(images)
  }
  const dropImages = (event: React.DragEvent<HTMLDivElement>) => {
    const images = imageFiles(Array.from(event.dataTransfer.files))
    if (!images.length) return
    event.preventDefault()
    void addLocalImages(images)
  }
  const addInboxImage = async (record: RecordData) => {
    try {
      const image = await api.previewNotebookFile(record.id)
      if (image.kind !== 'image' || !image.dataUrl) throw new Error('这张图片暂时无法预览')
      insertManagedImage(record.id, image.dataUrl, titleFor(record)); setImagePickerOpen(false)
    } catch (error) { onNotice(`图片插入失败：${String(error)}`, 'danger') }
  }
  const archiveToKnowledge = async () => {
    try {
      setArchivingToKnowledge(true)
      markDirty(); await flush()
      const latest = await api.get(note.id) || note
      const created = await api.save('knowledge', { title: titleRef.current.trim() || titleFor(latest), content: text(), sourceNoteId: note.id, category: knowledgeCategory.trim(), tags: tagsRef.current })
      if (knowledgeRelationTarget) await api.addRelation(created.id, knowledgeRelationTarget, 'knowledge:RELATED')
      await api.save('notes', { ...latest, title: titleRef.current.trim() || titleFor(latest), content: text(), contentHtml: html(), tags: tagsRef.current, status: 'ARCHIVED' })
      setKnowledgeDialogOpen(false); setKnowledgeCategory(''); setKnowledgeRelationTarget(''); await onRefresh(); onNotice('已按你的确认存入知识并归档原笔记。')
    } catch (error) { onNotice(`存入知识失败：${String(error)}`, 'danger') }
    finally { setArchivingToKnowledge(false) }
  }
  const associate = async () => {
    const target = relationTargets.find((record) => record.id === relationTarget)
    if (!target) return
    try { markDirty(); await flush(); await api.addRelation(note.id, target.id, 'notebook:RELATED'); setRelationTarget(''); setRelationPickerOpen(false); onRelationsChanged(); onNotice(`已关联到${configFor(target.entity).label}“${titleFor(target)}”。`) } catch (error) { onNotice(`关联失败：${String(error)}`, 'danger') }
  }
  const askAi = () => onAi('请仅基于这条收纳箱笔记给出摘要、要点、Notebook 分类建议、建议标签和潜在关联建议。不要创建、修改、关联、归档或写入标签；所有建议必须由用户确认后才可应用。', { currentRoute: 'notebook', currentEntityType: 'notes', currentEntityId: note.id, selectedItems: [note.id] })
  const deleteNote = async () => {
    try { setDeleting(true); await flush(); await api.remove(note.id); setDeleteConfirmOpen(false); await onRefresh(); onClose(); onNotice('笔记已按你的确认删除。') }
    catch (error) { onNotice(`删除笔记失败：${String(error)}`, 'danger') }
    finally { setDeleting(false) }
  }
  return <>
    <header className="notebook-editor-header">
      <div><span>▤</span><strong>笔记</strong></div>
      <div className="notebook-editor-header-actions">
        <button className="notebook-new-note" title="手动新建笔记" onClick={() => void flush().then(onCreateNote)}>＋ 新建</button>
        <button title="置顶 / 收藏" onClick={() => void flush().then(async () => { const latest = await api.get(note.id) || note; await api.save('notes', { ...latest, favorite: String(latest.favorite) === 'true' ? 'false' : 'true' }); await onRefresh() })}>⚑</button>
        <button className="notebook-ai-note" title="AI 整理建议" onClick={askAi}>AI</button>
        <button className="notebook-fullscreen-note" title={fullscreen ? '缩小笔记栏' : '放大笔记栏'} aria-label={fullscreen ? '缩小笔记栏' : '放大笔记栏'} onClick={onToggleFullscreen}>{fullscreen ? '↙ 缩小' : '⛶ 放大'}</button>
        <button className="notebook-save-note" title="保存笔记" onClick={() => void save()}>保存</button>
        <button className="notebook-delete-note" title="删除笔记" onClick={() => setDeleteConfirmOpen(true)}>删除</button>
        <span className={`notebook-save-state ${saveState.toLowerCase()}`}>{saveState === 'DIRTY' ? '未保存' : saveState === 'SAVING' ? '保存中…' : saveState === 'ERROR' ? '保存失败' : saveState === 'SAVED' ? '已自动保存' : ''}</span>
        <button title="关闭编辑器" onClick={() => void flush().then(onClose)}>×</button>
      </div>
    </header>
    <div className="notebook-editor">
      <input className="notebook-editor-title" value={title} onChange={(event) => { titleRef.current = event.target.value; setTitle(event.target.value); window.setTimeout(markDirty, 0) }} placeholder="未命名笔记" />
      <div className="notebook-editor-toolbar" role="toolbar" aria-label="笔记格式">
        <button title="粗体" onClick={() => command('bold')}><b>B</b></button>
        <button title="斜体" onClick={() => command('italic')}><i>I</i></button>
        <button title="删除线" onClick={() => command('strikeThrough')}><s>S</s></button>
        <i />
        <button title="项目符号列表" onClick={() => command('insertUnorderedList')}>☷</button>
        <button title="编号列表" onClick={() => command('insertOrderedList')}>☰</button>
        <button title="待办事项" onClick={() => command('insertHTML', '<div>☐&nbsp;</div>')}>☑</button>
        <button title="引用" onClick={() => command('formatBlock', 'blockquote')}>❝</button>
        <div className="notebook-toolbar-secondary">
          <button title="代码块" onClick={() => command('formatBlock', 'pre')}>‹›</button>
          <button title="插入链接" onClick={addLink}>⌁</button>
          <button className="notebook-image-button" title="添加图片（电脑 / 收纳箱）" onClick={() => setImagePickerOpen((open) => !open)}><span>▧</span>图片</button>
          <label className="notebook-color-control" title="文字颜色">A<input aria-label="文字颜色" type="color" defaultValue="#e5edf2" onChange={(event) => command('foreColor', event.currentTarget.value)} /></label>
          <label className="notebook-color-control highlight" title="高亮颜色">▰<input aria-label="高亮颜色" type="color" defaultValue="#a8d943" onChange={(event) => command('hiliteColor', event.currentTarget.value)} /></label>
        </div>
        <details className="notebook-toolbar-more">
          <summary title="更多格式">•••</summary>
          <div>
            <button title="代码块" onClick={() => command('formatBlock', 'pre')}>‹› 代码块</button>
            <button title="插入链接" onClick={addLink}>⌁ 链接</button>
            <button title="添加图片（电脑 / 收纳箱）" onClick={() => setImagePickerOpen((open) => !open)}>▧ 图片</button>
            <label className="notebook-color-control" title="文字颜色">A 文字颜色<input aria-label="更多文字颜色" type="color" defaultValue="#e5edf2" onChange={(event) => command('foreColor', event.currentTarget.value)} /></label>
            <label className="notebook-color-control highlight" title="高亮颜色">▰ 高亮颜色<input aria-label="更多高亮颜色" type="color" defaultValue="#a8d943" onChange={(event) => command('hiliteColor', event.currentTarget.value)} /></label>
          </div>
        </details>
        <span />
        <button title="撤销" onClick={() => command('undo')}>↶</button>
        <button title="重做" onClick={() => command('redo')}>↷</button>
      </div>
      {imagePickerOpen && <div className="notebook-image-picker"><header><strong>添加图片</strong><button onClick={() => setImagePickerOpen(false)}>×</button></header><button className="notebook-image-local" onClick={() => imageInputRef.current?.click()}><span>＋</span><div><strong>从电脑添加</strong><small>选择本地 JPG、PNG、WebP 等图片</small></div></button><input ref={imageInputRef} className="hidden-file-input" type="file" accept="image/*" onChange={(event) => void addLocalImages(event.currentTarget.files)} /><div className="notebook-image-library"><strong>从收纳箱选择</strong>{inboxImages.length ? inboxImages.map((record) => <button key={record.id} onClick={() => void addInboxImage(record)}><span>▧</span><div><strong>{titleFor(record)}</strong><small>{String(record.extension || '图片').toUpperCase()}</small></div></button>) : <p>收纳箱里还没有图片。</p>}</div></div>}
      <div ref={editorRef} className="notebook-rich-editor" contentEditable suppressContentEditableWarning data-placeholder="开始记录…" onInput={markDirty} onPaste={pasteImages} onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.kind === 'file' && item.type.startsWith('image/'))) event.preventDefault() }} onDrop={dropImages} />
      <div className="notebook-editor-rule">— — —</div>
    </div>
    <div className="notebook-editor-tags">
      <span>◇</span><strong>标签</strong>
      {tags.map((tag) => <em key={tag}>{tag}<button onClick={() => { const next = tagsRef.current.filter((item) => item !== tag); tagsRef.current = next; setTags(next); window.setTimeout(markDirty, 0) }}>×</button></em>)}
      <button title="添加标签" onClick={() => { setTagDraft(''); setTagDialogOpen(true) }}>＋</button>
      <button className="notebook-tag-ai" title="让 AI 建议标签" onClick={askAi}>AI 建议</button>
      <NotebookCategoryControl compact record={note} categories={categories} onChange={async (_, categoryId) => { markDirty(); await flush(); const latest = await api.get(note.id) || note; await onAssignCategory(latest, categoryId) }} onCreate={onCreateCategory} />
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

export function DecisionsView({ records, onOpen, onCreate }: { records: RecordData[]; onOpen: (record: RecordData) => void; onCreate: () => void }) {
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
  const [protocol, setProtocol] = useState<{ pending: number; conflicts: number; serverCursor: number; lastSyncedAt?: string } | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [serverUrl, setServerUrl] = useState(''); const [serverToken, setServerToken] = useState(''); const [serverConfigured, setServerConfigured] = useState(false)
  const refreshStatus = () => setStatus(api.cloudStatus())
  useEffect(() => { api.syncV1Status().then(setProtocol).catch(() => setProtocol(null)); api.getSyncV1Config().then((value) => { setServerUrl(value.url); setServerConfigured(value.configured) }) }, [])
  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true)
    try { await action(); refreshStatus(); onNotice(success) } catch (error) { onNotice(String(error), 'danger') } finally { setBusy(false) }
  }
  return <section className="settings-section cloud-sync-panel"><header><div><h2>同步与设备</h2><p>本地先写、增量同步；密钥、仪表盘、搜索索引和缓存不会上传。</p></div><span className={`connection-badge ${serverConfigured || status.signedIn ? 'connected' : ''}`}>{serverConfigured ? '协议 V1 已配置' : status.signedIn ? '兼容云同步已登录' : '等待云端配置'}</span></header><div className="settings-fields cloud-sync-fields"><label>EVOPOLIT Sync Server<input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://sync.example.com" /></label><label>同步 Token<input type="password" autoComplete="off" value={serverToken} onChange={(event) => setServerToken(event.target.value)} placeholder={serverConfigured ? '已安全保存；留空则不修改' : '输入同步 Token'} /></label><button className="button primary" disabled={busy || !serverUrl || (!serverConfigured && !serverToken)} onClick={() => run(async () => { if (serverToken) { const saved = await api.configureSyncV1(serverUrl, serverToken); setServerConfigured(saved.configured); setServerToken('') }; const tested = await api.testSyncV1(); setProtocol(await api.syncV1Status()); onNotice(`同步服务连接正常（${tested.latencyMs}ms）`) }, '同步服务已保存并通过连接测试。')}>保存并测试</button></div>{protocol && <div className="settings-actions"><span>待上传 {protocol.pending}</span><span>冲突 {protocol.conflicts}</span><span>游标 {protocol.serverCursor}</span>{protocol.lastSyncedAt && <span className="muted">上次同步：{formatDate(protocol.lastSyncedAt, true)}</span>}<button disabled={busy || !serverConfigured} onClick={() => run(async () => { await api.syncV1Now(); setProtocol(await api.syncV1Status()); await onSynced() }, 'EVOPOLIT Sync Protocol 1.0 已完成增量同步。')}>立即同步</button></div>}{!status.configured ? <p className="muted">网页端正式账户同步尚未配置；桌面端可直接使用上方 EVOPOLIT Sync Server。部署说明见 docs/WEB_AND_SYNC_SETUP.md。</p> : status.signedIn ? <div className="settings-actions"><button className="primary" disabled={busy} onClick={() => run(async () => { await api.syncNow(); await onSynced() }, '本机与云端已同步。')}>{busy ? '同步中…' : '兼容同步'}</button><button disabled={busy} onClick={() => run(async () => { await api.signOutFromCloud() }, '已退出同步账户；本机数据未删除。')}>退出同步账户</button></div> : <div className="settings-fields cloud-sync-fields"><label>同步邮箱<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><label>同步密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位" /></label><button className="button primary" disabled={busy || !email || !password} onClick={() => run(async () => { await api.signInToCloud(email, password); await onSynced() }, '登录成功，已完成首次同步。')}>{busy ? '登录中…' : '登录并同步'}</button><button className="button ghost" disabled={busy || !email || !password} onClick={() => run(async () => { await api.signUpForCloud(email, password) }, '注册请求已提交；如启用了邮箱确认，请先完成邮箱验证。')}>注册</button></div>}</section>
}

export function SettingsView({ themePreference, activeTheme, onThemeChange, config, captureConfig, onSaveAiProvider, onSaveCaptureProvider, onExport, onBackup, backups, onRestoreBackup, onRestoreRecord }: { themePreference: ThemePreference; activeTheme: 'dark' | 'light'; onThemeChange: (theme: ThemePreference) => void; config: HackStartConfig | null; captureConfig: CaptureProviderConfig | null; onSaveAiProvider: (provider: AiProviderId, key: string, model: string) => void; onSaveCaptureProvider: (provider: CaptureProviderId, key: string) => void; onExport: (format: 'json' | 'markdown' | 'csv') => void; onBackup: () => void; backups: BackupInfo[]; onRestoreBackup: (path: string) => void; onRestoreRecord: (id: string) => Promise<void> }) {
  const [provider, setProvider] = useState<AiProviderId>(config?.provider || 'hackstart')
  const selectedProvider = config?.providers.find((item) => item.id === provider)
  const [key, setKey] = useState(''); const [redfoxKey, setRedfoxKey] = useState(''); const [apifyKey, setApifyKey] = useState(''); const [tikhubKey, setTikhubKey] = useState(''); const [scrapeCreatorsKey, setScrapeCreatorsKey] = useState(''); const [model, setModel] = useState(selectedProvider?.model || 'gpt-5.5'); const [archived, setArchived] = useState<RecordData[]>([]); const [provenance, setProvenance] = useState<Awaited<ReturnType<typeof api.buildProvenance>> | null>(null)
  useEffect(() => { if (config?.provider) setProvider(config.provider) }, [config?.provider])
  useEffect(() => { const selected = config?.providers.find((item) => item.id === provider); setKey(''); if (selected) setModel(selected.model || selected.models[0]?.id || '') }, [provider, config])
  useEffect(() => { api.archived().then(setArchived) }, [])
  useEffect(() => { api.buildProvenance().then(setProvenance) }, [])
  return <div className="settings-page"><section className="settings-section build-provenance"><header><div><h2>版本与运行诊断</h2><p>用于确认当前看到的是否为最新正式安装版。</p></div><span className="connection-badge connected">Sync Protocol {provenance?.syncProtocolVersion || "—"}</span></header>{provenance && <div className="provenance-grid"><span><small>应用路径</small><b>{provenance.appPath}</b></span><span><small>版本</small><b>{provenance.appVersion}</b></span><span><small>Git Commit</small><b>{provenance.gitCommit}</b></span><span><small>构建时间</small><b>{provenance.buildTime}</b></span><span><small>数据库 Schema</small><b>{provenance.schemaVersion}</b></span><span><small>设备</small><b>{provenance.deviceId || "尚未注册"}</b></span></div>}</section><section className="settings-section appearance-section"><header><div><h2>界面外观</h2><p>选择深色、白色，或按本机时间自动切换。</p></div><span className="connection-badge connected">当前：{activeTheme === 'light' ? '白色' : '深色'}</span></header><div className="theme-options">{([{ value: 'light', label: '白色' }, { value: 'dark', label: '深色' }, { value: 'auto', label: '自动' }] as { value: ThemePreference; label: string }[]).map((option) => <button key={option.value} className={themePreference === option.value ? 'active' : ''} onClick={() => onThemeChange(option.value)}><strong>{option.label}</strong><small>{option.value === 'auto' ? '07:00–19:00 白色' : option.value === 'light' ? '清爽白色界面' : '保留深色界面'}</small>{themePreference === option.value && <b>✓</b>}</button>)}</div></section><section className="settings-section"><header><div><h2>AI 服务商与模型</h2><p>每个服务商使用独立 API Key，并分别保存在 应用私有凭据文件（权限 0600）。</p></div><span className={`connection-badge ${selectedProvider?.configured ? 'connected' : ''}`}>{selectedProvider?.configured ? '已配置' : '未配置'}</span></header><div className="provider-tabs">{config?.providers.map((item) => <button key={item.id} className={provider === item.id ? 'active' : ''} onClick={() => setProvider(item.id)}><span className={`provider-light ${item.configured ? 'connected' : ''}`} /><strong>{item.label}</strong><small>{item.model}</small></button>)}</div><div className="model-catalog">{selectedProvider?.models.map((item) => <button key={item.id} className={model === item.id ? 'active' : ''} onClick={() => setModel(item.id)}><span>{model === item.id ? '●' : '○'}</span><div><strong>{item.label}</strong><small>{item.description}</small></div></button>)}</div><div className="settings-fields provider-settings"><label>{selectedProvider?.label || 'AI'} API Key<input type="password" autoComplete="off" placeholder={selectedProvider?.configured ? '已配置；留空保留当前 Key' : `粘贴 ${selectedProvider?.label || ''} API Key`} value={key} onChange={(event) => setKey(event.target.value)} /></label><label>当前模型<select value={model} onChange={(event) => setModel(event.target.value)}>{selectedProvider?.models.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><button className="button primary" onClick={() => onSaveAiProvider(provider, key, model)}>保存、测试并启用</button></div><p className="provider-endpoint">API Endpoint：{selectedProvider?.baseUrl}{provider === 'minimax' ? ' · 中国大陆 Token Plan（Anthropic Messages）' : ''}</p></section><section className="settings-section capture-provider-section"><header><div><h2>采集服务与 External Intelligence Provider</h2><p>Provider 只负责读取外部数据，原始响应进入本机 External Intelligence 缓存；API 凭据保存在应用私有凭据文件（权限 0600），不会进入 SQLite、导出或 AI Prompt。</p></div><span className={`connection-badge ${captureConfig?.providers.some((item) => item.configured) ? 'connected' : ''}`}>{captureConfig?.providers.some((item) => item.configured) ? '已有 Provider' : '未配置'}</span></header>{captureConfig?.providers.map((item) => { if (item.id === 'redfox') return <div className="capture-provider-card" key={item.id}><div><strong>RedFoxHub</strong><small>微信公众号 · 抖音 · 小红书</small></div><label>RedFox API Key<input type="password" autoComplete="off" value={redfoxKey} onChange={(event) => setRedfoxKey(event.target.value)} placeholder={item.configured ? '已配置；留空保留当前 Key' : '粘贴 RedFox API Key'} /></label><button className="button primary" onClick={() => { onSaveCaptureProvider('redfox', redfoxKey); setRedfoxKey('') }}>保存并测试</button></div>; if (item.id === 'apify') return <div className="capture-provider-card" key={item.id}><div><strong>Apify</strong><small>网页 · 公众号 · 抖音 · 小红书 · X · Instagram · Facebook · Reddit · TikTok · YouTube</small></div><label>Apify API Token<input type="password" autoComplete="off" value={apifyKey} onChange={(event) => setApifyKey(event.target.value)} placeholder={item.configured ? '已配置；留空保留当前 Token' : '粘贴 Apify API Token'} /></label><button className="button primary" onClick={() => { onSaveCaptureProvider('apify', apifyKey); setApifyKey('') }}>保存并测试</button></div>; if (item.id === 'tikhub') return <div className="capture-provider-card" key={item.id}><div><strong>TikHub</strong><small>抖音 · TikTok · 小红书 · X · Instagram · Reddit · YouTube · 微信公众号</small></div><label>TikHub API Key<input type="password" autoComplete="off" value={tikhubKey} onChange={(event) => setTikhubKey(event.target.value)} placeholder={item.configured ? '已配置；留空保留当前 Key' : '粘贴 TikHub API Key'} /></label><button className="button primary" onClick={() => { onSaveCaptureProvider('tikhub', tikhubKey); setTikhubKey('') }}>保存并测试</button></div>; return <div className="capture-provider-card" key={item.id}><div><strong>Scrape Creators</strong><small>TikTok · Instagram · YouTube · Facebook · X · Reddit</small></div><label>Scrape Creators API Key<input type="password" autoComplete="off" value={scrapeCreatorsKey} onChange={(event) => setScrapeCreatorsKey(event.target.value)} placeholder={item.configured ? '已配置；留空保留当前 Key' : '粘贴 Scrape Creators API Key'} /></label><button className="button primary" onClick={() => { onSaveCaptureProvider('scrapecreators', scrapeCreatorsKey); setScrapeCreatorsKey('') }}>保存并测试</button></div>})}</section><section className="settings-section"><header><div><h2>数据所有权</h2><p>核心数据保存在本机 SQLite，可完整导出、备份和恢复。</p></div></header><div className="settings-actions"><button onClick={() => onExport('json')}>导出 JSON</button><button onClick={() => onExport('markdown')}>导出 Markdown</button><button onClick={() => onExport('csv')}>导出 CSV</button><button className="primary" onClick={onBackup}>创建 SQLite 快照</button></div></section><section className="settings-section"><header><div><h2>本地备份</h2><p>恢复前会自动保存当前数据库，避免覆盖错误。</p></div></header>{backups.length ? <div className="backup-list">{backups.slice(0, 8).map((backup) => <div key={backup.path}><div><strong>{backup.name}</strong><small>{formatDate(backup.modified, true)} · {(backup.size / 1024).toFixed(1)} KB</small></div><button onClick={() => onRestoreBackup(backup.path)}>恢复</button></div>)}</div> : <GuidedEmpty icon="↺" title="还没有本地备份" text="创建 SQLite 快照后，可以随时恢复到这个状态。" action="创建第一个备份" onAction={onBackup} />}</section><section className="settings-section"><header><div><h2>归档</h2><p>重要记录不会直接永久删除。归档后可随时恢复。</p></div><span>{archived.length} 条</span></header>{archived.length ? <div className="archive-list">{archived.map((record) => <div key={record.id}><div><span>{configFor(record.entity).icon}</span><strong>{titleFor(record)}</strong><small>{configFor(record.entity).label}</small></div><button onClick={async () => { await onRestoreRecord(record.id); setArchived(await api.archived()) }}>恢复</button></div>)}</div> : <p className="muted">归档箱为空。</p>}</section></div>
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
  const conversions = record.entity === 'notes' ? ['knowledge', 'insights', 'mentalModels', 'decisions', 'tasks', 'projects'] as Entity[] : record.entity === 'reviews' ? ['insights', 'knowledge', 'principles', 'mentalModels', 'decisions', 'tasks', 'workflowImprovementProposals'] as Entity[] : record.entity === 'results' ? ['reviews', 'deliverables', 'resultPackages'] as Entity[] : record.entity === 'decisions' ? ['tasks', 'results', 'reviews'] as Entity[] : record.entity === 'inbox' ? ['tasks', 'knowledge', 'insights', 'hypotheses', 'decisions', 'events', 'projects'] as Entity[] : []
  const core = ['goals', 'projects', 'tasks'].includes(record.entity)
  return <aside className="record-drawer"><header><div><span>{config.icon}</span><p>{config.label}</p></div><button onClick={onClose}>×</button></header><div className="record-drawer-body"><ContextBreadcrumb record={record} records={records} onOpen={onOpen} /><div className="record-title"><span className="entity-pill">{record.entity === 'notes' ? noteTypeLabel(record.type) : statusLabel(record.status)}</span><h2>{titleFor(record)}</h2><p>{descriptionFor(record)}</p>{core && <div className="detail-primary-actions"><button onClick={() => onStartTimer(record)}>▶ 开始计时</button>{record.entity === 'goals' && <button onClick={() => onCreate('projects', { goalId: record.id })}>＋ 创建项目</button>}{record.entity === 'projects' && <button onClick={() => onCreate('tasks', { projectId: record.id, goalId: record.goalId })}>＋ 创建任务</button>}{record.entity === 'tasks' && <button onClick={() => onCreate('results', { taskId: record.id, projectId: record.projectId, goalId: record.goalId, date: today() })}>＋ 记录结果</button>}</div>}{record.entity === 'mentalModels' && <div className="detail-primary-actions"><button onClick={() => onAddModel(record.id)}>＋ 加入本次决策分析</button></div>}</div>{record.entity === 'goals' && <GoalSnapshot goal={record} records={records} onOpen={onOpen} />}{core && <RelationshipOverview record={record} records={records} onOpen={onOpen} />}{fields.length > 0 && <section className="detail-fields">{fields.map((field) => <div key={field.key}><small>{field.label}</small><p>{field.type?.includes('date') ? formatDate(record[field.key], field.type === 'datetime-local') : field.type === 'money' ? formatMoneyMinor(String(record[field.key]), String(record[field.currencyKey || 'currency'] || 'CNY')) : field.key === 'achievementBps' ? `${(Number(record[field.key]) / 100).toFixed(2)}%` : String(record[field.key])}</p></div>)}</section>}{conversions.length > 0 && <section className="convert-actions"><h3>{record.entity === 'notes' ? '沉淀为' : record.entity === 'reviews' ? '从复盘提炼' : record.entity === 'inbox' ? '转换为' : '进入下一步'}</h3><div>{conversions.map((entity) => <button key={entity} onClick={() => onCreate(entity, conversionInitial(record, entity))}>＋ {configFor(entity).singular}</button>)}</div></section>}<section className="related-section"><h3>全部关联 <span>{related.length}</span></h3>{related.length ? related.map((item) => <button key={item.id} onClick={() => onOpen(item)}><span>{configFor(item.entity).icon}</span><div><strong>{titleFor(item)}</strong><small>{configFor(item.entity).label} · {String(item.relationType || '').replace('field:', '')}</small></div></button>) : <p>还没有关联记录。选择任务或项目后，上级上下文会自动建立。</p>}</section></div><footer>{(record.entity !== 'financialTransactions' || record.status === 'DRAFT') && <button className="button ghost" onClick={() => onArchive(record.id)}>归档</button>}<button className="button primary" onClick={() => onEdit(record)}>编辑</button></footer></aside>
}

function ContextBreadcrumb({ record, records, onOpen }: { record: RecordData; records: RecordData[]; onOpen: (record: RecordData) => void }) {
  const goal = record.entity === 'goals' ? record : records.find((item) => item.id === record.goalId)
  const project = record.entity === 'projects' ? record : records.find((item) => item.id === record.projectId)
  const chain = [goal, project, record.entity === 'tasks' ? record : undefined].filter((item, index, items): item is RecordData => Boolean(item) && items.findIndex((candidate) => candidate?.id === item?.id) === index)
  const validation = String(record.validationStatus || ({ validated: 'SUPPORTED', partially_correct: 'PARTIALLY_SUPPORTED', wrong: 'CONTRADICTED', unknown: 'INCONCLUSIVE' } as Record<string, string>)[String(record.status || '')] || 'PENDING')
  const lifecycle = record.entity === 'decisions' ? [
    ['问题', Boolean(String(record.problem || '').trim())], ['证据', Boolean(String(record.evidence || record.evidenceSnapshot || record.assumptions || '').trim())], ['选择', Boolean(String(record.selectedOption || record.ceoDecision || '').trim() || record.choiceStatus === 'DECIDED')], ['执行', ['IN_PROGRESS', 'EXECUTED'].includes(String(record.executionStatus || ''))], ['结果', Boolean(String(record.actualOutcome || record.outcome || '').trim() || records.some((item) => item.entity === 'results' && item.decisionId === record.id))], ['校准', validation !== 'PENDING'],
  ] : []
  if (!chain.length && !lifecycle.length) return null
  return <>{chain.length > 0 && <nav className="record-breadcrumb">{chain.map((item, index) => <Fragment key={item.id}>{index > 0 && <span>/</span>}<button onClick={() => onOpen(item)}>{configFor(item.entity).singular} · {titleFor(item)}</button></Fragment>)}</nav>}{lifecycle.length > 0 && <section className="decision-detail-lifecycle" aria-label="决策生命周期">{lifecycle.map(([label, complete], index) => <Fragment key={String(label)}><span className={complete ? 'complete' : index === lifecycle.findIndex((item) => !item[1]) ? 'current' : ''}><b>{index + 1}</b>{label}</span>{index < lifecycle.length - 1 && <i>›</i>}</Fragment>)}</section>}</>
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


function PanelHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) { return <header className="panel-header"><h3>{title}</h3>{action && <button onClick={onAction}>{action} →</button>}</header> }
function Metric({ label, value, hint, onClick }: { label: string; value: string; hint?: string; onClick?: () => void }) { return <button className="metric" onClick={onClick} disabled={!onClick}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</button> }
function GuidedEmpty({ icon, title, text, action, onAction }: { icon: string; title: string; text: string; action?: string; onAction?: () => void }) { return <div className="guided-empty"><span>{icon}</span><div><h3>{title}</h3><p>{text}</p>{action && <button onClick={onAction}>{action} →</button>}</div></div> }
function ProgressBar({ value }: { value: number }) { return <div className="progress"><span style={{ width: `${value}%` }} /><small>{Math.round(value)}%</small></div> }
function CompactRecord({ record, onOpen }: { record: RecordData; onOpen: (record: RecordData) => void }) { return <button className="compact-record" onClick={() => onOpen(record)}><span>{configFor(record.entity).icon}</span><div><strong>{titleFor(record)}</strong><small>{configFor(record.entity).label} · {formatDate(recordDate(record))}</small></div><b>›</b></button> }
function ActionTask({ task, records, index, onOpen, onEdit, onComplete, onTimer }: { task: RecordData; records: RecordData[]; index?: number; onOpen: (record: RecordData) => void; onEdit: (record: RecordData) => void; onComplete: (record: RecordData) => void; onTimer: (record: RecordData) => void }) { return <div className={`action-task ${isOverdue(task) ? 'overdue' : ''}`}>{index && <span className="task-index">{index}</span>}<button className="check" onClick={() => onComplete(task)}>✓</button><button className="task-main" onClick={() => onOpen(task)}><strong>{titleFor(task)}</strong><small>{relationName(task.projectId, records) || '未分配项目'} · {task.dueDate ? formatDate(task.dueDate) : '未安排日期'} · 预计 {Number(task.estimateMinutes || 0)} 分钟</small></button><span className={`priority ${task.priority || 'medium'}`}>{priorityLabel(task.priority)}</span><button onClick={() => onTimer(task)}>▶</button><button onClick={() => onEdit(task)}>•••</button></div> }
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

function relationName(id: unknown, records: RecordData[]) { if (!id) return ''; return titleFor(records.find((record) => record.id === id) || {}) }
function relationSummary(record: RecordData) { const count = Object.entries(record).filter(([key, value]) => (key.endsWith('Id') || key.endsWith('Ids')) && (Array.isArray(value) ? value.length > 0 : Boolean(value && String(value).trim()))).length; return count ? `${count} 个关联字段` : '暂无关联' }
function groupBy<T>(items: T[], key: (item: T) => string) { return items.reduce<Record<string, T[]>>((groups, item) => { const value = key(item); (groups[value] ||= []).push(item); return groups }, {}) }
function conversionInitial(source: RecordData, target: Entity): Partial<RecordData> { const common = { projectId: source.projectId, goalId: source.goalId }; if (source.entity === 'decisions') { if (target === 'tasks') return { ...common, decisionId: source.id, title: `执行：${titleFor(source)}`, description: source.executionPlan || source.selectedOption || source.ceoDecision, status: 'todo' }; if (target === 'results') return { ...common, decisionId: source.id, title: `结果：${titleFor(source)}`, expectedOutcome: source.expectedOutcome, status: 'PLANNED', date: today() }; if (target === 'reviews') return { ...common, decisionId: source.id, title: `复盘：${titleFor(source)}`, whatHappened: source.actualOutcome || source.outcome } } if (target === 'reviews') return { ...common, resultId: source.id, title: `复盘：${titleFor(source)}`, whatHappened: source.actual || source.actualResult }; if (source.entity === 'reviews') { const content = source.lesson || source.doDifferently || source.whatHappened; if (target === 'insights') return { ...common, reviewId: source.id, statement: content, explanation: source.whyItHappened }; if (target === 'principles') return { statement: content, evidence: source.whatHappened, reviewIds: [source.id] }; if (target === 'knowledge') return { ...common, title: titleFor(source), content, reviewIds: [source.id] }; if (target === 'tasks') return { ...common, title: source.nextAction, status: 'todo' }; if (target === 'decisions') return { ...common, title: source.nextAction || titleFor(source), context: source.lesson, status: 'pending' } } if (source.entity === 'notes') { const noteContent = String(source.content || source.title || ''); if (target === 'knowledge') return { title: titleFor(source), content: noteContent, sourceNoteId: source.id }; if (target === 'insights') return { statement: noteContent, explanation: String(source.title || ''), sourceNoteId: source.id }; if (target === 'mentalModels') return { name: titleFor(source), definition: noteContent, coreIdea: noteContent, sourceNoteId: source.id }; if (target === 'decisions') return { title: titleFor(source), context: noteContent, sourceNoteId: source.id, status: 'pending' }; if (target === 'tasks') return { title: titleFor(source), description: noteContent, status: 'todo' }; if (target === 'projects') return { title: titleFor(source), description: noteContent, status: 'active' } } if (source.entity === 'inbox') return { ...common, title: source.content, content: source.content, statement: source.content, description: source.content }; return common }
function paletteActions({ setSearchOpen, setPaletteOpen, openCreate, startTimer, setAiOpen, setView }: { setSearchOpen: (value: boolean) => void; setPaletteOpen: (value: boolean) => void; openCreate: (entity: Entity, initial?: Partial<RecordData>) => void; startTimer: () => void; setAiOpen: (value: boolean) => void; setView: (view: View) => void }) { const run = (action: () => void) => () => { setPaletteOpen(false); action() }; return [{ label: '全局搜索', hint: '搜索所有本地记录', icon: '⌕', run: run(() => setSearchOpen(true)) }, { label: '打开收纳箱', hint: '收集、整理与笔记', icon: '▱', run: run(() => setView('notebook')) }, { label: '打开设置', hint: '账户、AI、同步与本地数据', icon: '⚙', run: run(() => { window.location.hash = 'settings/account'; setView('settings') }) }, { label: '创建任务', hint: '添加下一步行动', icon: '□', run: run(() => openCreate('tasks')) }, { label: '创建项目', hint: '建立工作空间', icon: '◈', run: run(() => openCreate('projects')) }, { label: '开始计时', hint: '记录现实投入', icon: '▶', run: run(startTimer) }, { label: '创建决策', hint: '记录预测和理由', icon: '◆', run: run(() => openCreate('decisions', { date: today() })) }, { label: '创建复盘', hint: '从现实提炼学习', icon: '◑', run: run(() => openCreate('reviews')) }, { label: '创建知识', hint: '沉淀长期资产', icon: '⌘', run: run(() => openCreate('knowledge')) }, { label: '打开 AI 助理', hint: '基于当前上下文分析', icon: 'AI', run: run(() => setAiOpen(true)) }, { label: '打开今天', hint: '进入 Focus 工作视图', icon: '◉', run: run(() => setView('today')) }] }

export default App
