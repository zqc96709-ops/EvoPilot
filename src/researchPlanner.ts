import type { CaptureProviderConfig } from './api'
import type { RecordData } from './model'

export type ResearchSourcePlan = {
  key: string
  label: string
  detail: string
  status: 'ready' | 'needs_input' | 'needs_configuration'
  url?: string
  provider?: 'auto' | 'redfox' | 'apify' | 'tikhub' | 'scrapecreators'
  mode?: 'link' | 'keyword_search'
  query?: string
  periodDays?: number
}

export type ResearchPlan = {
  title: string
  scope: string
  dimensions: string[]
  deliverables: string[]
  sources: ResearchSourcePlan[]
  tags: string[]
}

const firstSentence = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 42) || '未命名调研'
const includes = (text: string, words: string[]) => words.some((word) => text.toLowerCase().includes(word.toLowerCase()))
const researchPeriodDays = (text: string) => {
  const match = text.match(/近\s*(\d+)\s*(天|周|月)/)
  if (!match) return 30
  const value = Number(match[1])
  return match[2] === '周' ? value * 7 : match[2] === '月' ? value * 30 : value
}
const tikTokQuery = (text: string) => text
  .replace(/调研|研究|分析|TikTok|近\s*\d+\s*(天|周|月)|爆款|竞品|价格带|内容趋势|的|、|，|,/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim() || 'TikTok'

export function createResearchPlan(request: string, records: RecordData[], captureConfig: CaptureProviderConfig | null): ResearchPlan {
  const value = request.trim()
  const tikTok = includes(value, ['tiktok', '抖音'])
  const xiaohongshu = includes(value, ['小红书'])
  const platform = tikTok ? 'TikTok' : xiaohongshu ? '小红书' : includes(value, ['youtube']) ? 'YouTube' : '公开网页'
  const period = value.match(/近\s*(\d+)\s*(天|周|月)/)?.[0]?.replace(/\s/g, '') || '近30天'
  const periodDays = researchPeriodDays(value)
  const dimensions = [
    ...(includes(value, ['爆款', '内容', '视频', '趋势']) ? ['内容趋势'] : []),
    ...(includes(value, ['竞品', '对手', '品牌']) ? ['竞品动态'] : []),
    ...(includes(value, ['价格', '价格带', '定价']) ? ['价格带'] : []),
    ...(includes(value, ['需求', '用户', '评论', '反馈']) ? ['用户反馈'] : []),
  ]
  const finalDimensions = dimensions.length ? dimensions : ['市场概览', '关键案例', '待验证点']
  const saved = records.filter((record) => record.entity === 'externalSources' && record.status !== 'paused' && String(record.url || '').startsWith('http'))
  const matchingSaved = saved.filter((record) => !platform || String(record.platform || '').toLowerCase().includes(platform.toLowerCase()) || String(record.name || '').toLowerCase().includes(platform.toLowerCase())).slice(0, 3)
  const inboxLinks = records.filter((record) => record.entity === 'inbox' && String(record.sourceUrl || record.url || '').startsWith('http')).slice(0, 2)
  const readySources: ResearchSourcePlan[] = [...matchingSaved, ...(!matchingSaved.length ? inboxLinks : [])].map((record) => ({
    key: record.id,
    label: String(record.name || record.title || record.sourceUrl || '已保存公开链接'),
    detail: matchingSaved.includes(record) ? '已保存情报源 · 可立即读取公开链接' : '收纳箱链接 · 可立即读取公开内容',
    status: 'ready',
    url: String(record.url || record.sourceUrl || ''),
    provider: (['redfox', 'apify', 'tikhub', 'scrapecreators'].includes(String(record.providerPreference)) ? record.providerPreference : 'auto') as ResearchSourcePlan['provider'],
    mode: 'link',
  }))
  const supportedProviders = (captureConfig?.providers || []).filter((provider) => provider.configured && provider.supportedPlatforms.includes(platform))
  const tikHub = supportedProviders.find((provider) => provider.id === 'tikhub')
  const preferredProvider = ['scrapecreators', 'apify', 'redfox'].map((id) => supportedProviders.find((provider) => provider.id === id)).find(Boolean)
  const planned: ResearchSourcePlan[] = tikTok
    ? tikHub
      ? [{
        key: 'planned:tiktok-search', label: 'TikHub · TikTok 关键词搜索',
        detail: `已选择 TikHub；将搜索“${tikTokQuery(value)}”近${periodDays}天的热门内容`,
        status: 'ready', provider: 'tikhub', mode: 'keyword_search', query: tikTokQuery(value), periodDays,
      }]
      : [{
        key: 'planned:tiktok', label: 'TikTok 公开内容',
        detail: preferredProvider ? `已选择 ${preferredProvider.label}；请补充 TikTok 视频公开链接后执行` : '请先在“设置与数据”配置支持 TikTok 的采集服务，再补充公开视频链接',
        status: preferredProvider ? 'needs_input' : 'needs_configuration',
        provider: preferredProvider?.id as ResearchSourcePlan['provider'], mode: 'link',
      }]
    : [{
      key: 'planned:web', label: '公开网页与已保存链接',
      detail: '请补充一个公开链接后执行；系统不会根据调研描述伪造抓取结果',
      status: 'needs_input', provider: 'apify', mode: 'link',
    }]
  return {
    title: firstSentence(value),
    scope: `${platform} · ${period}`,
    dimensions: finalDimensions,
    deliverables: ['趋势摘要', '案例与证据链接', ...(finalDimensions.includes('价格带') ? ['价格带对比'] : []), '数据缺口说明'],
    sources: [...readySources, ...planned],
    tags: [platform, ...finalDimensions.slice(0, 2)],
  }
}

export function parseResearchSources(value: unknown): ResearchSourcePlan[] {
  if (Array.isArray(value)) return value as ResearchSourcePlan[]
  if (typeof value !== 'string') return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as ResearchSourcePlan[] : [] } catch { return [] }
}


export function resolveResearchSources(sources: ResearchSourcePlan[], request: string, captureConfig: CaptureProviderConfig | null): ResearchSourcePlan[] {
  const hasTikHub = Boolean(captureConfig?.providers.some((provider) => provider.id === 'tikhub' && provider.configured && provider.supportedPlatforms.includes('TikTok')))
  if (!hasTikHub || !includes(request, ['tiktok', '抖音'])) return sources
  const legacy = sources.find((source) => source.key === 'planned:tiktok' && source.status === 'needs_configuration')
  if (!legacy) return sources
  const days = researchPeriodDays(request)
  return sources.map((source) => source === legacy ? {
    key: 'planned:tiktok-search', label: 'TikHub · TikTok 关键词搜索',
    detail: `已选择 TikHub；将搜索“${tikTokQuery(request)}”近${days}天的热门内容`,
    status: 'ready', provider: 'tikhub', mode: 'keyword_search', query: tikTokQuery(request), periodDays: days,
  } : source)
}
