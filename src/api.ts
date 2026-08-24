import { invoke } from '@tauri-apps/api/core'
import { schemaRegistry } from './agent/schemaRegistry'
import { toolRegistry } from './agent/toolRegistry'
import type { AgentActionResult, AgentContext, AgentResponse, ChatMessage } from './agent/types'
import type { Entity, RecordData } from './model'
import type { ExternalItem } from './externalIntelligence'
import { projectEconomics } from './finance'
import { cloudSync, type CloudSyncStatus } from './cloudSync'
export type { ChatMessage } from './agent/types'

export type AiModelOption = { id: string; label: string; description: string }
export type AiProviderId = 'hackstart' | 'deepseek' | 'minimax' | 'volc-agent-plan'
export type AiProviderOption = { id: AiProviderId; label: string; configured: boolean; baseUrl: string; model: string; models: AiModelOption[] }
export type HackStartConfig = { provider: AiProviderId; providerLabel: string; configured: boolean; model: string; baseUrl: string; providers: AiProviderOption[] }
export type BackupInfo = { name: string; path: string; size: number; modified: string }
export type FinanceSummary = { baseCurrency: string; incomeMinor: string; expenseMinor: string; cashNetMinor: string; managementContributionMinor: string; timeMinutes: number; unitTimeContributionMinor?: string; postedTransactions: number; outcomeCount: number; verifiedOutcomeCount: number; dataCoverage: number; warnings: string[] }
export type CaptureProviderId = 'redfox' | 'apify' | 'tikhub' | 'scrapecreators'
export type CaptureProviderConfig = { providers: { id: CaptureProviderId; label: string; configured: boolean; supportedPlatforms: string[]; automaticSync: boolean; mediaDownload: boolean }[] }
export type NotebookUploadInput = { file: File; notebookCategoryId?: string; notebookFolderId?: string; relativePath?: string }
export type NotebookFilePreview = { kind: 'text' | 'pdf' | 'image' | 'audio' | 'video' | 'unsupported'; text?: string; dataUrl?: string; page?: number; pageCount?: number; reason?: string; extractStatus?: string }
export type NotebookStorageConfig = { maxFileSize: number; chunkSize: number }

const key = 'jason-os-browser-records'
const browser = () => !('__TAURI_INTERNALS__' in window)
const read = (): RecordData[] => JSON.parse(localStorage.getItem(key) || '[]')
const write = (records: RecordData[]) => localStorage.setItem(key, JSON.stringify(records))
const stamp = () => new Date().toISOString()
const active = (record: RecordData) => !record.archivedAt && !record.deletedAt
const syncRecords = async () => {
  if (!cloudSync.status().signedIn) return
  const local = browser() ? read() : await invoke<RecordData[]>('list_sync_records')
  const merged = await cloudSync.sync(local)
  if (browser()) write(merged)
  else await invoke('merge_remote_records', { records: merged })
}

export const api = {
  async initialize() { const result = browser() ? { ok: true } : await invoke('initialize_database'); await syncRecords(); return result },
  async list(entity: Entity | 'all'): Promise<RecordData[]> { return browser() ? read().filter((record) => active(record) && (entity === 'all' || record.entity === entity)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : invoke('list_records', { entity }) },
  async get(id: string): Promise<RecordData | null> { return browser() ? read().find((record) => record.id === id && !record.deletedAt) || null : invoke('get_record', { id }) },
  async save(entity: Entity, data: Partial<RecordData>): Promise<RecordData> {
    if (!browser()) { const saved = await invoke<RecordData>('save_record', { entity, data }); await syncRecords(); return saved }
    const records = read(); const id = data.id || `${entity}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; const old = records.find((record) => record.id === id)
    const record = { ...old, ...data, id, entity, createdAt: old?.createdAt || stamp(), updatedAt: stamp() } as RecordData
    write([...records.filter((item) => item.id !== id), record]); await syncRecords(); return record
  },
  async archive(id: string) { if (!browser()) { await invoke('archive_record', { id }); await syncRecords(); return }; write(read().map((record) => record.id === id ? { ...record, archivedAt: stamp(), updatedAt: stamp() } : record)); await syncRecords() },
  async remove(id: string) { if (!browser()) { await invoke('delete_record', { id }); await syncRecords(); return }; write(read().map((record) => record.id === id ? { ...record, archivedAt: undefined, deletedAt: stamp(), updatedAt: stamp() } : record)); await syncRecords() },
  async restore(id: string): Promise<RecordData> { if (!browser()) { const restored = await invoke<RecordData>('restore_record', { id }); await syncRecords(); return restored }; const record = read().find((item) => item.id === id)!; const restored = { ...record, archivedAt: undefined, deletedAt: undefined, updatedAt: stamp() }; write([...read().filter((item) => item.id !== id), restored]); await syncRecords(); return restored },
  cloudStatus(): CloudSyncStatus { return cloudSync.status() },
  async signInToCloud(email: string, password: string): Promise<CloudSyncStatus> { const status = await cloudSync.signIn(email, password); await syncRecords(); return status },
  async signUpForCloud(email: string, password: string): Promise<CloudSyncStatus> { const status = await cloudSync.signUp(email, password); if (status.signedIn) await syncRecords(); return status },
  async signOutFromCloud() { await cloudSync.signOut() },
  async syncNow(): Promise<CloudSyncStatus> { await syncRecords(); return cloudSync.status() },
  async archived(): Promise<RecordData[]> { return browser() ? read().filter((record) => record.archivedAt && !record.deletedAt) : invoke('list_archived') },
  async search(query: string, entities: Entity[] = []): Promise<RecordData[]> { return browser() ? read().filter(active).filter((record) => (!entities.length || entities.includes(record.entity)) && JSON.stringify(record).toLowerCase().includes(query.toLowerCase())) : entities.length ? invoke('search_records_filtered', { query, entities }) : invoke('search_records', { query }) },
  async relations(id: string): Promise<RecordData[]> {
    if (!browser()) return invoke('list_relations', { id })
    return read().filter(active).filter((record) => record.id !== id && Object.entries(record).some(([field, value]) => field.endsWith('Id') && value === id || field.endsWith('Ids') && String(value || '').split(',').map((part) => part.trim()).includes(id)))
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
  async stopTimer(id: string, endAt: string, durationMinutes: number): Promise<RecordData> { if (!browser()) return invoke('stop_timer', { id, endAt, durationMinutes }); const timer = read().find((record) => record.id === id)!; return this.save('timeLogs', { ...timer, endAt, durationMinutes, isRunning: false }) },
  async export(format: 'json' | 'markdown' | 'csv'): Promise<string> { if (!browser()) return invoke('export_data', { format }); const content = format === 'json' ? JSON.stringify(read(), null, 2) : read().map((record) => JSON.stringify(record)).join('\n'); const blob = new Blob([content], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `jason-os.${format}`; anchor.click(); URL.revokeObjectURL(url); return '已在浏览器模式下载' },
  async backup(): Promise<string> { return browser() ? '浏览器模式没有 SQLite 数据库可供备份。' : invoke('create_backup') },
  async backups(): Promise<BackupInfo[]> { return browser() ? [] : invoke('list_backups') },
  async restoreBackup(path: string) { if (browser()) throw new Error('浏览器模式无法恢复 SQLite 备份。'); return invoke('restore_backup', { path }) },
  async getHackStartConfig(): Promise<HackStartConfig> { if (!browser()) return invoke('get_ai_config'); const providers = [{ id: 'hackstart' as const, label: 'HackStart', configured: false, baseUrl: 'https://ip2.hackstart.org/v1/chat/completions', model: 'gpt-5.5', models: [{ id: 'gpt-5.5', label: 'gpt-5.5', description: 'HackStart 模型' }] }, { id: 'deepseek' as const, label: 'DeepSeek', configured: false, baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-pro', models: [{ id: 'deepseek-v4-pro', label: 'deepseek-v4-pro', description: '高质量复杂推理' }, { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', description: '低延迟高性价比' }] }, { id: 'minimax' as const, label: 'MiniMax Token Plan', configured: false, baseUrl: 'https://api.minimaxi.com/anthropic/v1/messages', model: 'MiniMax-M3', models: [{ id: 'MiniMax-M3', label: 'MiniMax-M3', description: '最新旗舰 Agent 与推理模型' }] }, { id: 'volc-agent-plan' as const, label: '火山引擎 Agent Plan', configured: false, baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3/responses', model: 'kimi-k3', models: [{ id: 'kimi-k3', label: 'kimi-k3', description: 'Agent Plan Medium 当前文本模型' }, { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', description: '低延迟高性价比' }, { id: 'glm-5.2', label: 'glm-5.2', description: '智谱 GLM 通用大模型' }, { id: 'minimax-m3', label: 'minimax-m3', description: 'MiniMax 旗舰 Agent 与推理模型' }, { id: 'doubao-seed-evolving', label: 'doubao-seed-evolving', description: '豆包 Seed 自进化模型' }, { id: 'kimi-k2.7-code', label: 'kimi-k2.7-code', description: 'Kimi 代码专用模型（需开启 thinking）' }] }]; return { provider: 'hackstart', providerLabel: 'HackStart', configured: false, model: 'gpt-5.5', baseUrl: providers[0].baseUrl, providers } },
  async configureAiProvider(provider: AiProviderId, apiKey: string, model: string): Promise<HackStartConfig> { if (browser()) throw new Error('浏览器模式不能写入 应用私有凭据文件（权限 0600）。请使用桌面应用。'); return invoke('configure_ai_provider', { provider, apiKey, model }) },
  async testAiProvider(provider: AiProviderId, model: string): Promise<{ ok: boolean; provider: string; model: string; latencyMs: number; content: string }> { if (browser()) throw new Error('浏览器模式不能测试真实 API。请使用桌面应用。'); return invoke('test_ai_provider', { provider, model }) },
  async openExternal(url: string): Promise<void> { if (browser()) { window.open(url, '_blank', 'noopener,noreferrer'); return }; return invoke('open_external', { url }) },
  async getFinanceSummary(projectId?: string): Promise<FinanceSummary> { if (browser()) { const result = projectEconomics(read(), projectId); return { baseCurrency: 'CNY', incomeMinor: result.incomeMinor.toString(), expenseMinor: result.expenseMinor.toString(), cashNetMinor: result.cashNetMinor.toString(), managementContributionMinor: result.managementContributionMinor.toString(), timeMinutes: result.timeMinutes, unitTimeContributionMinor: result.unitTimeContributionMinor?.toString(), postedTransactions: result.postedTransactions, outcomeCount: result.outcomeCount, verifiedOutcomeCount: result.verifiedOutcomeCount, dataCoverage: result.dataCoverage, warnings: [] } } return invoke('get_finance_summary', { projectId }) },
  async getCaptureProviderConfig(): Promise<CaptureProviderConfig> { return browser() ? { providers: [{ id: 'redfox', label: 'RedFoxHub', configured: false, supportedPlatforms: ['微信公众号', '抖音', '小红书'], automaticSync: false, mediaDownload: false }, { id: 'apify', label: 'Apify', configured: false, supportedPlatforms: ['网页', '微信公众号', '抖音', '小红书', 'X', 'Instagram', 'Facebook', 'Reddit', 'TikTok', 'YouTube'], automaticSync: false, mediaDownload: false }, { id: 'tikhub', label: 'TikHub', configured: false, supportedPlatforms: ['抖音', 'TikTok', '小红书', 'X', 'Instagram', 'Reddit', 'YouTube', '微信公众号'], automaticSync: false, mediaDownload: false }, { id: 'scrapecreators', label: 'Scrape Creators', configured: false, supportedPlatforms: ['TikTok', 'Instagram', 'YouTube', 'Facebook', 'X', 'Reddit'], automaticSync: false, mediaDownload: false }] } : invoke('get_capture_provider_config') },
  async configureCaptureProvider(provider: CaptureProviderId, apiKey: string): Promise<CaptureProviderConfig> { if (browser()) throw new Error('浏览器模式不能保存采集凭据。请使用桌面应用。'); return invoke('configure_capture_provider', { provider, apiKey }) },
  async testCaptureProvider(provider: CaptureProviderId, url: string): Promise<{ ok: boolean; provider: string; latencyMs: number; content: Record<string, unknown> }> { if (browser()) throw new Error('浏览器模式不能测试真实采集 API。'); return invoke('test_capture_provider', { provider, url }) },
  async searchTikTok(query: string, periodDays = 30): Promise<{ items: number; urls: string[] }> { if (browser()) throw new Error('浏览器模式不能运行真实调研。请使用桌面应用。'); return invoke('search_tiktok_research', { query, periodDays }) },
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
