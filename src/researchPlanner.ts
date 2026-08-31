import type { CaptureProviderConfig, CaptureProviderId } from './api'
import type { RecordData } from './model'

type SourceStatus = 'ready' | 'needs_input' | 'needs_configuration' | 'capability_mismatch' | 'unavailable'
type ResearchCapability = 'POST_DETAIL' | 'VIDEO_SEARCH' | 'WEB_CAPTURE' | 'CREATOR_SEARCH' | 'COMMENT_SEARCH' | 'PRICE_DATA' | 'PRODUCT_SALES_DATA'
type SourceRoute = { primaryProviderId?: CaptureProviderId; fallbackProviderIds: CaptureProviderId[]; validationProviderIds: CaptureProviderId[]; status: SourceStatus }
type ProviderRoute = { status: Exclude<SourceStatus, 'ready' | 'needs_input'> } | { primaryProviderId: CaptureProviderId; fallbackProviderIds: CaptureProviderId[] }
export type ResearchPlanningOptions = { allowedProviderIds?: CaptureProviderId[] }

export type ResearchSourcePlan = {
  key: string; label: string; detail: string; status: SourceStatus; dimension?: string; requiredCapabilities?: ResearchCapability[]; sourceRoute: SourceRoute
  url?: string; provider?: CaptureProviderId | 'auto'; primaryProvider?: CaptureProviderId; fallbackProviders?: CaptureProviderId[]
  capability?: ResearchCapability; mode?: 'link' | 'keyword_search'; query?: string; periodDays?: number
}
export type ResearchPlan = { title: string; scope: string; dimensions: string[]; deliverables: string[]; sources: ResearchSourcePlan[]; tags: string[] }

const firstSentence = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 42) || '未命名调研'
const includes = (text: string, words: string[]) => words.some((word) => text.toLowerCase().includes(word.toLowerCase()))
const researchPeriodDays = (text: string) => { const match = text.match(/近\s*(\d+)\s*(天|周|月)/); if (!match) return 30; const value = Number(match[1]); return match[2] === '周' ? value * 7 : match[2] === '月' ? value * 30 : value }
const tikTokQuery = (text: string) => text.replace(/调研|研究|分析|TikTok|近\s*\d+\s*(天|周|月)|爆款|竞品|价格带|销量|销售|最高|三个产品|的|、|，|,/gi, ' ').replace(/\s+/g, ' ').trim() || 'TikTok'
const platformForUrl = (url: string) => {
  const value = url.toLowerCase()
  if (value.includes('tiktok.com')) return 'TikTok'; if (value.includes('douyin.com')) return '抖音'; if (value.includes('xiaohongshu.com') || value.includes('xhslink.com')) return '小红书'
  if (value.includes('twitter.com') || value.includes('x.com')) return 'X'; if (value.includes('instagram.com')) return 'Instagram'; if (value.includes('youtube.com') || value.includes('youtu.be')) return 'YouTube'
  if (value.includes('facebook.com') || value.includes('fb.watch')) return 'Facebook'; if (value.includes('mp.weixin.qq.com')) return '微信公众号'; return '网页'
}
const unavailableStatuses = new Set(['NOT_CONFIGURED', 'AUTH_ERROR', 'UNAVAILABLE', 'RATE_LIMITED', 'QUOTA_EXHAUSTED', 'DISABLED'])
export const getConfiguredProviders = (config: CaptureProviderConfig | null) => (config?.providers || []).filter((provider) => provider.configured && provider.enabled !== false)
const healthyProviders = (config: CaptureProviderConfig | null, platform: string, capability: ResearchCapability, options?: ResearchPlanningOptions) => getConfiguredProviders(config).filter((provider) => (!options?.allowedProviderIds || options.allowedProviderIds.includes(provider.id)) && !unavailableStatuses.has(provider.status || 'CONFIGURED') && provider.capabilities?.some((item) => item.platform === platform && item.capability === capability && item.status === 'AVAILABLE'))
const route = (config: CaptureProviderConfig | null, platform: string, capability: ResearchCapability, options?: ResearchPlanningOptions): ProviderRoute => {
  const candidates = healthyProviders(config, platform, capability, options)
  if (candidates.length) return { primaryProviderId: candidates[0].id, fallbackProviderIds: candidates.slice(1).map((item) => item.id) }
  const implemented = (config?.providers || []).some((provider) => provider.capabilities?.some((item) => item.platform === platform && item.capability === capability && item.status === 'AVAILABLE'))
  return { status: implemented ? (options?.allowedProviderIds ? 'unavailable' : 'needs_configuration') : 'capability_mismatch' }
}
const capabilityLabel: Record<ResearchCapability, string> = { POST_DETAIL: '公开链接内容读取', VIDEO_SEARCH: '视频关键词搜索', WEB_CAPTURE: '网页内容读取', CREATOR_SEARCH: '创作者检索', COMMENT_SEARCH: '评论检索', PRICE_DATA: '价格数据读取', PRODUCT_SALES_DATA: '官方产品销量数据' }
const sourceRoute = (candidate: ProviderRoute): SourceRoute => 'status' in candidate ? { fallbackProviderIds: [], validationProviderIds: [], status: candidate.status } : { primaryProviderId: candidate.primaryProviderId, fallbackProviderIds: candidate.fallbackProviderIds, validationProviderIds: [], status: 'ready' }
const routedLink = (record: RecordData, config: CaptureProviderConfig | null, options?: ResearchPlanningOptions): ResearchSourcePlan => {
  const url = String(record.url || record.sourceUrl || '')
  if (!config) return { key: record.id, label: String(record.name || record.title || record.sourceUrl || '已保存公开链接'), detail: '已保存公开链接；将使用本地公开网页读取，不会假称为第三方 Provider 数据', status: 'ready', sourceRoute: { fallbackProviderIds: [], validationProviderIds: [], status: 'ready' }, url, provider: 'auto', mode: 'link' }
  const platform = platformForUrl(url); const capability: ResearchCapability = platform === '网页' ? 'WEB_CAPTURE' : 'POST_DETAIL'; const candidate = route(config, platform, capability, options); const selectedRoute = sourceRoute(candidate)
  if ('status' in candidate) return { key: record.id, label: String(record.name || record.title || record.sourceUrl || '已保存公开链接'), detail: candidate.status === 'needs_configuration' ? `${capabilityLabel[capability]}已实现，但尚未配置可用 Provider` : candidate.status === 'unavailable' ? '手动选择的 Provider 不具备该链接所需能力' : `${platform} 尚未实现${capabilityLabel[capability]}；不会伪造执行`, status: candidate.status, sourceRoute: selectedRoute, url, requiredCapabilities: [capability], capability, mode: 'link' }
  return { key: record.id, label: String(record.name || record.title || record.sourceUrl || '已保存公开链接'), detail: `主源：${candidate.primaryProviderId}${candidate.fallbackProviderIds.length ? `；备用：${candidate.fallbackProviderIds.join(' / ')}` : ''}`, status: 'ready', sourceRoute: selectedRoute, url, provider: candidate.primaryProviderId, primaryProvider: candidate.primaryProviderId, fallbackProviders: candidate.fallbackProviderIds, requiredCapabilities: [capability], capability, mode: 'link' }
}
const routedKeyword = (record: RecordData, config: CaptureProviderConfig | null, options?: ResearchPlanningOptions): ResearchSourcePlan => {
  const query = String(record.query || '').trim(); const label = String(record.name || record.title || query || '已保存关键词')
  if (String(record.platform || '') !== 'TikTok' || !query) return { key: record.id, label, detail: '当前仅 TikTok 视频关键词搜索具备已实现的执行能力；不会伪造执行。', status: 'capability_mismatch', sourceRoute: { fallbackProviderIds: [], validationProviderIds: [], status: 'capability_mismatch' }, capability: 'VIDEO_SEARCH', requiredCapabilities: ['VIDEO_SEARCH'], mode: 'keyword_search', query }
  const candidate = route(config, 'TikTok', 'VIDEO_SEARCH', options); const selectedRoute = sourceRoute(candidate)
  if ('status' in candidate) return { key: record.id, label, detail: candidate.status === 'needs_configuration' ? 'TikTok 视频关键词搜索已实现，但 TikHub 尚未配置或当前不可用' : '当前选择的 Provider 不具备 TikTok 视频关键词搜索能力', status: candidate.status, sourceRoute: selectedRoute, capability: 'VIDEO_SEARCH', requiredCapabilities: ['VIDEO_SEARCH'], mode: 'keyword_search', query, periodDays: 30 }
  return { key: record.id, label, detail: `关键词：${query}；主源：${candidate.primaryProviderId}`, status: 'ready', sourceRoute: selectedRoute, provider: candidate.primaryProviderId, primaryProvider: candidate.primaryProviderId, fallbackProviders: candidate.fallbackProviderIds, capability: 'VIDEO_SEARCH', requiredCapabilities: ['VIDEO_SEARCH'], mode: 'keyword_search', query, periodDays: 30 }
}
const capabilityGap = (key: string, dimension: string, capability: ResearchCapability, detail: string): ResearchSourcePlan => ({ key, label: `${dimension} · 暂无直接数据源`, detail, status: 'capability_mismatch', dimension, requiredCapabilities: [capability], capability, sourceRoute: { fallbackProviderIds: [], validationProviderIds: [], status: 'capability_mismatch' } })

export function createResearchPlan(request: string, records: RecordData[], captureConfig: CaptureProviderConfig | null, options?: ResearchPlanningOptions): ResearchPlan {
  const value = request.trim(); const tikTok = includes(value, ['tiktok']); const douyin = !tikTok && includes(value, ['抖音']); const xiaohongshu = includes(value, ['小红书']); const platform = tikTok ? 'TikTok' : douyin ? '抖音' : xiaohongshu ? '小红书' : includes(value, ['youtube']) ? 'YouTube' : '网页'
  const period = value.match(/近\s*(\d+)\s*(天|周|月)/)?.[0]?.replace(/\s/g, '') || '近30天'; const periodDays = researchPeriodDays(value); const sales = includes(value, ['销量', '销售', '销量最高', '三个产品', 'top'])
  const dimensions = [...(includes(value, ['爆款', '内容', '视频', '趋势']) ? ['内容趋势'] : []), ...(sales ? ['热门产品'] : []), ...(includes(value, ['竞品', '对手', '品牌']) ? ['竞品动态'] : []), ...(includes(value, ['价格', '价格带', '定价']) ? ['价格带'] : []), ...(includes(value, ['需求', '用户', '评论', '反馈']) ? ['用户反馈'] : [])]
  const finalDimensions = dimensions.length ? dimensions : ['市场概览', '关键案例', '待验证点']
  const saved = records.filter((record) => record.entity === 'externalSources' && record.status !== 'paused'); const matchingSaved = saved.filter((record) => String(record.platform || '').toLowerCase().includes(platform.toLowerCase()) || String(record.name || '').toLowerCase().includes(platform.toLowerCase())).slice(0, 3); const inboxLinks = records.filter((record) => record.entity === 'inbox' && String(record.sourceUrl || record.url || '').startsWith('http')).slice(0, 2)
  const savedSources = [...matchingSaved, ...(!matchingSaved.length ? inboxLinks : [])].map((record) => String(record.type || '').toUpperCase() === 'KEYWORD' ? routedKeyword(record, captureConfig, options) : routedLink(record, captureConfig, options)); const planned: ResearchSourcePlan[] = []
  if (sales) planned.push(capabilityGap('planned:product-sales', '真实销量', 'PRODUCT_SALES_DATA', '当前情报源不能提供官方真实销量数据；将使用公开视频热度、内容表现和商品出现频次作为替代判断。'))
  if (tikTok && !savedSources.some((source) => source.mode === 'keyword_search' && source.capability === 'VIDEO_SEARCH')) {
    const candidate = route(captureConfig, 'TikTok', 'VIDEO_SEARCH', options); const selectedRoute = sourceRoute(candidate)
    if ('status' in candidate) planned.push({ key: 'planned:tiktok-video-search', label: 'TikTok · 内容热度替代判断', detail: candidate.status === 'needs_configuration' ? 'TikTok 视频关键词搜索已实现，但 TikHub 尚未配置或当前不可用' : candidate.status === 'unavailable' ? '手动选择未包含具备 TikTok 视频搜索能力的 Provider' : '当前没有已实现的 TikTok 视频关键词搜索能力', status: candidate.status, dimension: sales ? '热门产品替代判断' : '内容趋势', requiredCapabilities: ['VIDEO_SEARCH'], sourceRoute: selectedRoute, capability: 'VIDEO_SEARCH', mode: 'keyword_search', query: tikTokQuery(value), periodDays })
    else planned.push({ key: 'planned:tiktok-video-search', label: sales ? '热门产品 · 内容热度替代判断' : 'TikTok · 关键词搜索', detail: `${sales ? '不使用官方销量，改用公开热度、内容表现与商品出现频次。' : ''}主源：${candidate.primaryProviderId}${candidate.fallbackProviderIds.length ? `；备用：${candidate.fallbackProviderIds.join(' / ')}` : ''}`, status: 'ready', dimension: sales ? '热门产品替代判断' : '内容趋势', requiredCapabilities: ['VIDEO_SEARCH'], sourceRoute: selectedRoute, provider: candidate.primaryProviderId, primaryProvider: candidate.primaryProviderId, fallbackProviders: candidate.fallbackProviderIds, capability: 'VIDEO_SEARCH', mode: 'keyword_search', query: tikTokQuery(value), periodDays })
  }
  const requestedCapabilities: [string, ResearchCapability][] = [['竞品动态', 'CREATOR_SEARCH'], ['价格带', 'PRICE_DATA'], ['用户反馈', 'COMMENT_SEARCH']]
  requestedCapabilities.forEach(([dimension, capability]) => { if (finalDimensions.includes(dimension)) planned.push(capabilityGap(`planned:${capability.toLowerCase()}`, dimension, capability, `该维度需要${capabilityLabel[capability]}；当前没有已实现的 Provider 能力。`)) })
  if (!tikTok && !douyin && !planned.length && !savedSources.length) planned.push({ key: 'planned:web', label: '公开网页', detail: '这是用户明确选择网页调研时的入口；请补充公开链接后执行。', status: 'needs_input', sourceRoute: { fallbackProviderIds: [], validationProviderIds: [], status: 'needs_input' }, requiredCapabilities: ['WEB_CAPTURE'], capability: 'WEB_CAPTURE', mode: 'link' })
  return { title: firstSentence(value), scope: `${platform} · ${period}`, dimensions: finalDimensions, deliverables: ['趋势摘要', '案例与证据链接', ...(sales ? ['替代判断说明'] : []), ...(finalDimensions.includes('价格带') ? ['价格带对比'] : []), '数据缺口说明'], sources: [...planned, ...savedSources], tags: [platform, ...finalDimensions.slice(0, 2)] }
}

export function parseResearchSources(value: unknown): ResearchSourcePlan[] { if (Array.isArray(value)) return value as ResearchSourcePlan[]; if (typeof value !== 'string') return []; try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as ResearchSourcePlan[] : [] } catch { return [] } }
export function resolveResearchSources(sources: ResearchSourcePlan[], request: string, captureConfig: CaptureProviderConfig | null): ResearchSourcePlan[] {
  if (!includes(request, ['tiktok', '抖音'])) return sources
  const legacy = sources.find((source) => ['planned:tiktok', 'planned:tiktok-search', 'planned:web'].includes(source.key))
  if (!legacy) return sources
  // Existing requests can retain legacy PUBLIC_WEB plans. Rebuild only their derived
  // source routes; request text, history, and any user-supplied records remain intact.
  return createResearchPlan(request, [], captureConfig).sources
}
