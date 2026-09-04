import { invoke } from '@tauri-apps/api/core'
import { schemaRegistry } from './agent/schemaRegistry'
import { toolRegistry } from './agent/toolRegistry'
import type { AgentActionResult, AgentContext, AgentResponse, ChatMessage } from './agent/types'
import type { Entity, RecordData } from './model'
import type { ExternalItem } from './externalIntelligence'
import { projectEconomics } from './finance'
import { cloudSync, type CloudSyncStatus } from './cloudSync'
import { httpSyncTransport, synchronize } from './sync/client'
import { TauriSqliteReplica } from './sync/tauriReplica'
import { IndexedDbReplica } from './sync/indexedDbReplica'
import { changedFields, SYNC_PROTOCOL_VERSION, type SyncMutation } from './sync/protocol'
export type { ChatMessage } from './agent/types'

export type AiModelOption = { id: string; label: string; description: string }
export type AiProviderId = 'hackstart' | 'deepseek' | 'minimax' | 'volc-agent-plan'
export type AiProviderOption = { id: AiProviderId; label: string; configured: boolean; baseUrl: string; model: string; models: AiModelOption[] }
export type HackStartConfig = { provider: AiProviderId; providerLabel: string; configured: boolean; model: string; baseUrl: string; providers: AiProviderOption[] }
export type BackupInfo = { name: string; path: string; size: number; modified: string }
export type FinanceSummary = { baseCurrency: string; incomeMinor: string; expenseMinor: string; cashNetMinor: string; managementContributionMinor: string; timeMinutes: number; unitTimeContributionMinor?: string; postedTransactions: number; outcomeCount: number; verifiedOutcomeCount: number; dataCoverage: number; warnings: string[] }
export type CaptureProviderId = 'redfox' | 'apify' | 'tikhub' | 'scrapecreators'
export type ProviderHealthStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'AVAILABLE' | 'UNKNOWN' | 'AUTH_ERROR' | 'UNAVAILABLE' | 'DEGRADED' | 'RATE_LIMITED' | 'QUOTA_EXHAUSTED' | 'CAPABILITY_MISMATCH' | 'DISABLED'
export type CaptureProviderCapability = { platform: string; capability: 'POST_DETAIL' | 'VIDEO_SEARCH' | 'WEB_CAPTURE'; status: 'AVAILABLE' | 'NOT_IMPLEMENTED'; endpointKey: string; costClass?: string; latencyClass?: string }
export type CaptureProviderConfig = { providers: { id: CaptureProviderId; code?: string; label: string; configured: boolean; enabled?: boolean; status?: ProviderHealthStatus; health?: { status?: ProviderHealthStatus; lastCheckedAt?: string; latencyMs?: number; lastError?: string }; supportedPlatforms: string[]; capabilities?: CaptureProviderCapability[]; automaticSync: boolean; mediaDownload: boolean }[] }
export type NotebookUploadInput = { file: File; notebookCategoryId?: string; notebookFolderId?: string; relativePath?: string }
export type NotebookFilePreview = { kind: 'text' | 'pdf' | 'image' | 'audio' | 'video' | 'unsupported'; text?: string; dataUrl?: string; page?: number; pageCount?: number; reason?: string; extractStatus?: string }
export type NotebookStorageConfig = { maxFileSize: number; chunkSize: number }
export type BuildProvenance = { appPath: string; appVersion: string; gitCommit: string; buildTime: string; schemaVersion: number; syncProtocolVersion: number; deviceId?: string; workspaceId: string }
export type SyncV1Config = { url: string; configured: boolean; token?: string }

const key = 'jason-os-browser-records'
const browser = () => !('__TAURI_INTERNALS__' in window)
let syncV1Url = String(import.meta.env.VITE_JASON_SYNC_URL || '')
let syncV1Token = String(import.meta.env.VITE_JASON_SYNC_TOKEN || '')
const loadSyncV1Config = async () => {
  if (browser()) { syncV1Url ||= localStorage.getItem('jason-sync-v1-url') || ''; syncV1Token ||= localStorage.getItem('jason-sync-v1-token') || ''; return { url: syncV1Url, configured: Boolean(syncV1Url && syncV1Token) } }
  const config = await invoke<SyncV1Config>('get_sync_v1_config'); syncV1Url = config.url; syncV1Token = config.token || ''
  return { url: config.url, configured: config.configured }
}
let browserReplicaPromise: Promise<IndexedDbReplica> | null = null
const webDb = () => browserReplicaPromise ||= IndexedDbReplica.open()
const webDeviceId = () => {
  const storageKey = 'jason-os-sync-device-id'; const existing = localStorage.getItem(storageKey)
  if (existing) return existing
  const id = crypto.randomUUID(); localStorage.setItem(storageKey, id); return id
}
const stamp = () => new Date().toISOString()
const active = (record: RecordData) => !record.archivedAt && !record.deletedAt
const webMutation = (record: RecordData, old: RecordData | null, operation?: SyncMutation['operation']): SyncMutation => ({
  mutationId: crypto.randomUUID(), workspaceId: record.workspaceId || 'local', deviceId: webDeviceId(), entityType: record.entity,
  entityId: record.id, operation: operation || (old ? 'UPDATE' : 'CREATE'), baseRevision: Number(old?.revision || 0),
  changedFields: old ? changedFields(old, record) : Object.keys(record).filter((field) => !['id', 'entity', 'createdAt', 'updatedAt', 'revision'].includes(field)),
  payload: record, protocolVersion: SYNC_PROTOCOL_VERSION, createdAt: stamp(),
})
const syncRecords = async () => {
  if (syncV1Url && syncV1Token) { await synchronize(browser() ? await webDb() : new TauriSqliteReplica(), httpSyncTransport(syncV1Url, syncV1Token)); return }
  if (!cloudSync.status().signedIn) return
  const local = browser() ? await (await webDb()).records() : await invoke<RecordData[]>('list_sync_records')
  const merged = await cloudSync.sync(local)
  if (browser()) await (await webDb()).apply(merged.map((record, index) => ({ mutationId: `legacy-${record.id}`, workspaceId: 'local', deviceId: 'legacy', entityType: record.entity, entityId: record.id, operation: record.deletedAt ? 'DELETE' : 'UPDATE', baseRevision: 0, changedFields: [], payload: record, protocolVersion: 1, createdAt: record.updatedAt, serverRevision: Number(record.revision || 1), serverSequence: index + 1 })), merged.length)
  else await invoke('merge_remote_records', { records: merged })
}
let syncQueued = false
let syncRunning = false
// Local SQLite is the interaction source of truth. Cloud sync stays durable, but it
// must not make a click wait on the network before the UI can render its result.
const queueSyncRecords = () => {
  if (!cloudSync.status().signedIn && !(syncV1Url && syncV1Token)) return
  syncQueued = true
  if (syncRunning) return
  syncRunning = true
  void Promise.resolve().then(async () => {
    while (syncQueued) {
      syncQueued = false
      try { await syncRecords() } catch { /* The explicit sync control still reports retry errors. */ }
    }
  }).finally(() => {
    syncRunning = false
    if (syncQueued) queueSyncRecords()
  })
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => queueSyncRecords())
  window.setInterval(queueSyncRecords, 2_000)
}

export const api = {
  async initialize() { await loadSyncV1Config(); if (browser()) { const db = await webDb(); let legacy: RecordData[] = []; try { legacy = JSON.parse(localStorage.getItem(key) || '[]') } catch { legacy = [] }; await db.importLegacy(legacy); await syncRecords().catch(() => {}); return { ok: true } }; const result = await invoke('initialize_database'); await syncRecords().catch(() => {}); return result },
  async list(entity: Entity | 'all'): Promise<RecordData[]> { return browser() ? (await (await webDb()).records()).filter((record) => active(record) && (entity === 'all' || record.entity === entity)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : invoke('list_records', { entity }) },
  async get(id: string): Promise<RecordData | null> { return browser() ? (await (await webDb()).record(id)) : invoke('get_record', { id }) },
  async save(entity: Entity, data: Partial<RecordData>): Promise<RecordData> {
    if (!browser()) { const saved = await invoke<RecordData>('save_record', { entity, data }); queueSyncRecords(); return saved }
    const db = await webDb(); const id = data.id || crypto.randomUUID(); const old = await db.record(id)
    const record = { ...old, ...data, id, entity, createdAt: old?.createdAt || stamp(), updatedAt: stamp(), revision: old?.revision || 0, workspaceId: old?.workspaceId || 'local' } as RecordData
    await db.save(record, webMutation(record, old)); queueSyncRecords(); return record
  },
  async archive(id: string) { if (!browser()) { await invoke('archive_record', { id }); queueSyncRecords(); return }; const db = await webDb(); const old = await db.record(id); if (!old) return; const record = { ...old, archivedAt: stamp(), updatedAt: stamp() }; await db.save(record, webMutation(record, old)); queueSyncRecords() },
  async archiveMany(ids: string[]) { if (!ids.length) return; if (!browser()) { await invoke('archive_records', { ids }); queueSyncRecords(); return }; const db = await webDb(); const items: Array<{ record: RecordData; mutation: SyncMutation }> = []; for (const id of ids) { const old = await db.record(id); if (!old) continue; const record: RecordData = { ...old, archivedAt: stamp(), updatedAt: stamp() }; items.push({ record, mutation: webMutation(record, old) }) }; await db.mutate(items); queueSyncRecords() },
  async remove(id: string) { if (!browser()) { await invoke('delete_record', { id }); queueSyncRecords(); return }; const db = await webDb(); const old = await db.record(id); if (!old) return; const record = { ...old, archivedAt: undefined, deletedAt: stamp(), updatedAt: stamp() }; await db.save(record, webMutation(record, old, 'DELETE')); queueSyncRecords() },
  async removeMany(ids: string[]) { if (!ids.length) return; if (!browser()) { await invoke('delete_records', { ids }); queueSyncRecords(); return }; const db = await webDb(); const items: Array<{ record: RecordData; mutation: SyncMutation }> = []; for (const id of ids) { const old = await db.record(id); if (!old) continue; const record: RecordData = { ...old, archivedAt: undefined, deletedAt: stamp(), updatedAt: stamp() }; items.push({ record, mutation: webMutation(record, old, 'DELETE') }) }; await db.mutate(items); queueSyncRecords() },
  async restore(id: string): Promise<RecordData> { if (!browser()) { const restored = await invoke<RecordData>('restore_record', { id }); queueSyncRecords(); return restored }; const db = await webDb(); const old = await db.record(id); if (!old) throw new Error('记录不存在'); const restored = { ...old, archivedAt: undefined, deletedAt: undefined, updatedAt: stamp() }; await db.save(restored, webMutation(restored, old)); queueSyncRecords(); return restored },
  cloudStatus(): CloudSyncStatus { return cloudSync.status() },
  async signInToCloud(email: string, password: string): Promise<CloudSyncStatus> { const status = await cloudSync.signIn(email, password); await syncRecords(); return status },
  async signUpForCloud(email: string, password: string): Promise<CloudSyncStatus> { const status = await cloudSync.signUp(email, password); if (status.signedIn) await syncRecords(); return status },
  async signOutFromCloud() { await cloudSync.signOut() },
  async syncNow(): Promise<CloudSyncStatus> { await syncRecords(); return cloudSync.status() },
  async syncV1Now() {
    if (!syncV1Url || !syncV1Token) throw new Error('尚未配置 VITE_JASON_SYNC_URL / VITE_JASON_SYNC_TOKEN。')
    if (browser()) return synchronize(await webDb(), httpSyncTransport(syncV1Url, syncV1Token))
    const ios = navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')
    await invoke('register_sync_device', { name: ios ? 'Jason OS iOS' : 'Jason OS Mac', platform: ios ? 'IOS' : 'MAC' })
    return synchronize(new TauriSqliteReplica(), httpSyncTransport(syncV1Url, syncV1Token))
  },
  async getSyncV1Config(): Promise<SyncV1Config> { return loadSyncV1Config() },
  async configureSyncV1(url: string, token: string): Promise<SyncV1Config> { if (browser()) { syncV1Url = url.trim().replace(/\/$/, ''); syncV1Token = token.trim(); localStorage.setItem('jason-sync-v1-url', syncV1Url); localStorage.setItem('jason-sync-v1-token', syncV1Token); return { url: syncV1Url, configured: Boolean(syncV1Url && syncV1Token) } }; const result = await invoke<SyncV1Config>('configure_sync_v1', { url, token }); syncV1Url = result.url; syncV1Token = result.token || token.trim(); return { url: result.url, configured: result.configured } },
  async testSyncV1(): Promise<{ ok: boolean; latencyMs: number }> { if (browser()) { const response = await fetch(`${syncV1Url}/devices`, { headers: { authorization: `Bearer ${syncV1Token}` } }); if (!response.ok) throw new Error(`同步服务验证失败：HTTP ${response.status}`); return { ok: true, latencyMs: 0 } }; return invoke('test_sync_v1') },
  async syncV1Status(): Promise<{ pending: number; conflicts: number; serverCursor: number; lastSyncedAt?: string; protocolVersion: number; schemaVersion: number }> {
    if (browser()) { const db = await webDb(); return { pending: (await db.pending(100000)).length, conflicts: await db.conflictCount(), serverCursor: await db.cursor(), protocolVersion: 1, schemaVersion: 16 } }
    return invoke('get_sync_status')
  },
  async buildProvenance(): Promise<BuildProvenance> { return browser() ? { appPath: window.location.href, appVersion: 'web', gitCommit: String(import.meta.env.VITE_GIT_COMMIT || 'development'), buildTime: String(import.meta.env.VITE_BUILD_TIME || 'development'), schemaVersion: 16, syncProtocolVersion: 1, workspaceId: 'local' } : invoke('get_build_provenance') },
  async archived(): Promise<RecordData[]> { return browser() ? (await (await webDb()).records()).filter((record) => record.archivedAt && !record.deletedAt) : invoke('list_archived') },
  async search(query: string, entities: Entity[] = []): Promise<RecordData[]> { return browser() ? (await (await webDb()).records()).filter(active).filter((record) => (!entities.length || entities.includes(record.entity)) && JSON.stringify(record).toLowerCase().includes(query.toLowerCase())) : entities.length ? invoke('search_records_filtered', { query, entities }) : invoke('search_records', { query }) },
  async relations(id: string): Promise<RecordData[]> {
    if (!browser()) return invoke('list_relations', { id })
    return (await (await webDb()).records()).filter(active).filter((record) => record.id !== id && Object.entries(record).some(([field, value]) => field.endsWith('Id') && value === id || field.endsWith('Ids') && String(value || '').split(',').map((part) => part.trim()).includes(id)))
  },
  async addRelation(fromId: string, toId: string, relationType = 'manual') { if (!browser()) return invoke('add_relation', { fromId, toId, relationType }) },
  async removeRelation(fromId: string, toId: string, relationType = 'manual') { if (!browser()) return invoke('remove_relation', { fromId, toId, relationType }) },
  async getNotebookStorageConfig(): Promise<NotebookStorageConfig> { return browser() ? { maxFileSize: 1024 * 1024 * 1024, chunkSize: 2 * 1024 * 1024 } : invoke('get_notebook_storage_config') },
  async setNotebookStorageConfig(maxFileSize: number): Promise<NotebookStorageConfig> { if (browser()) throw new Error('浏览器模式不能配置桌面 Storage。'); return invoke('set_notebook_storage_config', { maxFileSize }) },
  async uploadNotebookFile(input: NotebookUploadInput): Promise<RecordData> {
    if (browser()) return this.save('notebookFiles', { name: input.file.name, originalName: input.file.name, mimeType: input.file.type, size: input.file.size, notebookCategoryId: input.notebookCategoryId, notebookFolderId: input.notebookFolderId, relativePath: input.relativePath, status: 'ACTIVE' })
    const started = await invoke<{ uploadId: string; chunkSize: number }>('begin_notebook_file_upload', { name: input.file.name, size: input.file.size })
    for (let offset = 0; offset < input.file.size; offset += started.chunkSize) {
      const chunk = new Uint8Array(await input.file.slice(offset, offset + started.chunkSize).arrayBuffer())
      await invoke('append_notebook_file_upload', { uploadId: started.uploadId, bytes: Array.from(chunk) })
    }
    return invoke('finish_notebook_file_upload', { uploadId: started.uploadId, name: input.file.name, mimeType: input.file.type || 'application/octet-stream', notebookCategoryId: input.notebookCategoryId, notebookFolderId: input.notebookFolderId, relativePath: input.relativePath })
  },
  async openNotebookFile(id: string): Promise<void> { if (browser()) throw new Error('浏览器模式没有本地 Storage 文件可打开。'); return invoke('open_notebook_file', { id }) },
  async revealNotebookFile(id: string): Promise<void> { if (browser()) throw new Error('浏览器模式没有本地 Storage 文件可显示。'); return invoke('reveal_notebook_file', { id }) },
  async previewNotebookFile(id: string): Promise<NotebookFilePreview> { if (browser()) return { kind: 'unsupported', reason: '浏览器模式不会保存原始文件。' }; return invoke('get_notebook_file_preview', { id }) },
  async previewNotebookPdfPage(id: string, page: number): Promise<NotebookFilePreview> { if (browser()) return { kind: 'unsupported', reason: '浏览器模式不会保存原始文件。' }; return invoke('get_notebook_pdf_page', { id, page }) },
  async extractNotebookFile(id: string): Promise<RecordData> { if (browser()) throw new Error('浏览器模式不能提取本地文件内容。'); return invoke('extract_notebook_file_content', { id }) },
  async copyNotebookFile(id: string, notebookCategoryId?: string, notebookFolderId?: string): Promise<RecordData> { if (browser()) throw new Error('浏览器模式不能复制本地文件。'); return invoke('copy_notebook_file', { id, notebookCategoryId, notebookFolderId }) },
  async destroyNotebookFile(id: string): Promise<void> { if (browser()) throw new Error('浏览器模式不能永久删除本地文件。'); return invoke('destroy_notebook_file', { id }) },
  async stopTimer(id: string, endAt: string, durationMinutes: number): Promise<RecordData> { if (!browser()) return invoke('stop_timer', { id, endAt, durationMinutes }); const timer = await (await webDb()).record(id); if (!timer) throw new Error('计时记录不存在'); return this.save('timeLogs', { ...timer, endAt, durationMinutes, isRunning: false }) },
  async export(format: 'json' | 'markdown' | 'csv'): Promise<string> { if (!browser()) return invoke('export_data', { format }); const records = await (await webDb()).records(); const content = format === 'json' ? JSON.stringify(records, null, 2) : records.map((record) => JSON.stringify(record)).join('\n'); const blob = new Blob([content], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `jason-os.${format}`; anchor.click(); URL.revokeObjectURL(url); return '已在浏览器模式下载' },
  async backup(): Promise<string> { return browser() ? '浏览器模式没有 SQLite 数据库可供备份。' : invoke('create_backup') },
  async backups(): Promise<BackupInfo[]> { return browser() ? [] : invoke('list_backups') },
  async restoreBackup(path: string) { if (browser()) throw new Error('浏览器模式无法恢复 SQLite 备份。'); return invoke('restore_backup', { path }) },
  async getHackStartConfig(): Promise<HackStartConfig> { if (!browser()) return invoke('get_ai_config'); const providers = [{ id: 'hackstart' as const, label: 'HackStart', configured: false, baseUrl: 'https://ip2.hackstart.org/v1/chat/completions', model: 'gpt-5.5', models: [{ id: 'gpt-5.5', label: 'gpt-5.5', description: 'HackStart 模型' }] }, { id: 'deepseek' as const, label: 'DeepSeek', configured: false, baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-pro', models: [{ id: 'deepseek-v4-pro', label: 'deepseek-v4-pro', description: '高质量复杂推理' }, { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', description: '低延迟高性价比' }] }, { id: 'minimax' as const, label: 'MiniMax Token Plan', configured: false, baseUrl: 'https://api.minimaxi.com/anthropic/v1/messages', model: 'MiniMax-M3', models: [{ id: 'MiniMax-M3', label: 'MiniMax-M3', description: '最新旗舰 Agent 与推理模型' }] }, { id: 'volc-agent-plan' as const, label: '火山引擎 Agent Plan', configured: false, baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3/responses', model: 'kimi-k3', models: [{ id: 'kimi-k3', label: 'kimi-k3', description: 'Agent Plan Medium 当前文本模型' }, { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', description: '低延迟高性价比' }, { id: 'glm-5.2', label: 'glm-5.2', description: '智谱 GLM 通用大模型' }, { id: 'minimax-m3', label: 'minimax-m3', description: 'MiniMax 旗舰 Agent 与推理模型' }, { id: 'doubao-seed-evolving', label: 'doubao-seed-evolving', description: '豆包 Seed 自进化模型' }, { id: 'kimi-k2.7-code', label: 'kimi-k2.7-code', description: 'Kimi 代码专用模型（需开启 thinking）' }] }]; return { provider: 'hackstart', providerLabel: 'HackStart', configured: false, model: 'gpt-5.5', baseUrl: providers[0].baseUrl, providers } },
  async configureAiProvider(provider: AiProviderId, apiKey: string, model: string): Promise<HackStartConfig> { if (browser()) throw new Error('浏览器模式不能写入 应用私有凭据文件（权限 0600）。请使用桌面应用。'); return invoke('configure_ai_provider', { provider, apiKey, model }) },
  async testAiProvider(provider: AiProviderId, model: string): Promise<{ ok: boolean; provider: string; model: string; latencyMs: number; content: string }> { if (browser()) throw new Error('浏览器模式不能测试真实 API。请使用桌面应用。'); return invoke('test_ai_provider', { provider, model }) },
  async openExternal(url: string): Promise<void> { if (browser()) { window.open(url, '_blank', 'noopener,noreferrer'); return }; return invoke('open_external', { url }) },
  async getFinanceSummary(projectId?: string): Promise<FinanceSummary> { if (browser()) { const result = projectEconomics(await (await webDb()).records(), projectId); return { baseCurrency: 'CNY', incomeMinor: result.incomeMinor.toString(), expenseMinor: result.expenseMinor.toString(), cashNetMinor: result.cashNetMinor.toString(), managementContributionMinor: result.managementContributionMinor.toString(), timeMinutes: result.timeMinutes, unitTimeContributionMinor: result.unitTimeContributionMinor?.toString(), postedTransactions: result.postedTransactions, outcomeCount: result.outcomeCount, verifiedOutcomeCount: result.verifiedOutcomeCount, dataCoverage: result.dataCoverage, warnings: [] } } return invoke('get_finance_summary', { projectId }) },
  async getCaptureProviderConfig(): Promise<CaptureProviderConfig> { return browser() ? { providers: [{ id: 'redfox', label: 'RedFoxHub', configured: false, supportedPlatforms: ['微信公众号', '抖音', '小红书'], capabilities: [{ platform: '微信公众号', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'gzhData/queryArticleDetail' }, { platform: '抖音', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'dyData/queryWork' }, { platform: '小红书', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'xhsUser/queryWorkDetail' }], automaticSync: false, mediaDownload: false }, { id: 'apify', label: 'Apify', configured: false, supportedPlatforms: ['网页'], capabilities: [{ platform: '网页', capability: 'WEB_CAPTURE', status: 'AVAILABLE', endpointKey: 'apify~website-content-crawler' }], automaticSync: false, mediaDownload: false }, { id: 'tikhub', label: 'TikHub', configured: false, supportedPlatforms: ['抖音', 'TikTok', '小红书', 'X'], capabilities: [{ platform: 'TikTok', capability: 'VIDEO_SEARCH', status: 'AVAILABLE', endpointKey: 'tiktok/fetch_general_search_result' }, { platform: 'TikTok', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'tiktok/fetch_post_detail' }, { platform: '抖音', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'douyin/fetch_one_video_by_share_url' }, { platform: '小红书', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'xiaohongshu/fetch_note_detail' }, { platform: 'X', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'twitter/fetch_tweet_detail' }], automaticSync: false, mediaDownload: false }, { id: 'scrapecreators', label: 'Scrape Creators', configured: false, supportedPlatforms: ['TikTok', 'Instagram', 'YouTube', 'Facebook', 'X'], capabilities: [{ platform: 'TikTok', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'tiktok/video' }, { platform: 'Instagram', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'instagram/post' }, { platform: 'YouTube', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'youtube/video' }, { platform: 'Facebook', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'facebook/post' }, { platform: 'X', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'twitter/tweet' }], automaticSync: false, mediaDownload: false }] } : invoke('get_capture_provider_config') },
  async configureCaptureProvider(provider: CaptureProviderId, apiKey: string): Promise<CaptureProviderConfig> { if (browser()) throw new Error('浏览器模式不能保存采集凭据。请使用桌面应用。'); return invoke('configure_capture_provider', { provider, apiKey }) },
  async testCaptureProvider(provider: CaptureProviderId, url: string): Promise<{ ok: boolean; provider: string; latencyMs: number; content: Record<string, unknown> }> { if (browser()) throw new Error('浏览器模式不能测试真实采集 API。'); return invoke('test_capture_provider', { provider, url }) },
  async searchTikTok(query: string, periodDays = 30): Promise<{ items: number; itemIds?: string[]; urls: string[]; provider?: string; cacheHit?: boolean; researchRunId?: string; evidenceCount?: number }> { if (browser()) throw new Error('浏览器模式不能运行真实调研。请使用桌面应用。'); return invoke('search_tiktok_research', { query, periodDays }) },
  async executeResearchSource(source: Record<string, unknown>): Promise<{ items: number; itemIds?: string[]; urls: string[]; provider?: string; cacheHit?: boolean; researchRunId?: string; evidenceCount?: number }> { if (browser()) throw new Error('浏览器模式不能运行真实调研。请使用桌面应用。'); return invoke('execute_research_source', { source }) },
  async listExternalItems(limit = 80): Promise<ExternalItem[]> { return browser() ? [] : invoke('list_external_items', { limit }) },
  async cleanupExternalCache(): Promise<{ ok: boolean; removed: number }> { return browser() ? { ok: true, removed: 0 } : invoke('cleanup_external_cache') },
  async captureLink(url: string, provider: CaptureProviderId | 'auto' = 'auto'): Promise<RecordData> { if (browser()) return this.save('inbox', { content: url, type: 'link', sourceUrl: url, captureStatus: 'link_saved', captureProvider: provider }); return invoke('capture_link', { url, provider }) },
  async ask(question: string, context: AgentContext, history: ChatMessage[] = []): Promise<AgentResponse> {
    if (!browser()) return invoke('ask_chief', { question, context, history, schemaRegistry, toolDefinitions: toolRegistry })
    const matches = await this.search(question); return { context: matches, answer: matches.length ? `找到 ${matches.length} 条相关本地记录。请在下一次决策前对比预期、实际时间、结果与复盘。` : '暂未找到匹配的本地记录。请先收集相关事实。' }
  },
  async confirmAiAction(actionId: string): Promise<AgentActionResult> { if (browser()) throw new Error('浏览器模式不能执行本地 AI Action。'); return invoke('execute_ai_action', { actionId }) },
  async cancelAiAction(actionId: string): Promise<AgentActionResult> { if (browser()) throw new Error('浏览器模式不能取消本地 AI Action。'); return invoke('cancel_ai_action', { actionId }) },
}
