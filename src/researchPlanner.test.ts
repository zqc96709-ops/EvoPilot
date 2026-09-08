import { describe, expect, it } from 'vitest'
import { createResearchPlan, parseResearchSources, resolveResearchSources } from './researchPlanner'
import type { RecordData } from './model'
import type { CaptureProviderConfig } from './api'

const source = { id: 'source-1', entity: 'externalSources', name: 'TikTok 大码女装', url: 'https://example.com/tiktok', platform: 'TikTok', status: 'active', createdAt: '1', updatedAt: '1' } as RecordData

describe('research request planning', () => {
  it('plans a TikTok request from saved public sources without creating EvoPilot relations', () => {
    const plan = createResearchPlan('调研美国 TikTok 大码女装近30天爆款、竞品和价格带', [source], null)
    expect(plan.scope).toContain('TikTok')
    expect(plan.dimensions).toEqual(expect.arrayContaining(['内容趋势', '竞品动态', '价格带']))
    expect(plan.sources.find((item) => item.key === source.id)?.status).toBe('ready')
    expect(JSON.stringify(plan)).not.toContain('projectId')
    expect(JSON.stringify(plan)).not.toContain('goalId')
    expect(JSON.stringify(plan)).not.toContain('taskId')
  })

  it('routes a configured TikHub capability without requiring a public link', () => {
    const config: CaptureProviderConfig = { providers: [{ id: 'tikhub', label: 'TikHub', configured: true, status: 'AVAILABLE', supportedPlatforms: ['TikTok'], capabilities: [{ platform: 'TikTok', capability: 'VIDEO_SEARCH', status: 'AVAILABLE', endpointKey: 'tiktok/fetch_general_search_result' }], automaticSync: false, mediaDownload: false }] }
    const plan = createResearchPlan('调研 TikTok 大码女装近30天爆款', [], config)
    expect(plan.sources).toContainEqual(expect.objectContaining({ key: 'planned:tiktok-video-search', provider: 'tikhub', mode: 'keyword_search', status: 'ready', sourceRoute: expect.objectContaining({ primaryProviderId: 'tikhub' }) }))
  })

  it('upgrades a legacy TikTok plan when TikHub is configured', () => {
    const config: CaptureProviderConfig = { providers: [{ id: 'tikhub', label: 'TikHub', configured: true, status: 'AVAILABLE', supportedPlatforms: ['TikTok'], capabilities: [{ platform: 'TikTok', capability: 'VIDEO_SEARCH', status: 'AVAILABLE', endpointKey: 'tiktok/fetch_general_search_result' }], automaticSync: false, mediaDownload: false }] }
    const sources = resolveResearchSources([{ key: 'planned:tiktok', label: 'TikTok 公开内容', detail: '旧方案', status: 'needs_configuration', sourceRoute: { fallbackProviderIds: [], validationProviderIds: [], status: 'needs_configuration' } }], '调研 TikTok 大码女装近30天爆款', config)
    expect(sources).toContainEqual(expect.objectContaining({ key: 'planned:tiktok-video-search', mode: 'keyword_search', status: 'ready' }))
  })

  it('preserves a saved source plan for explicit user confirmation', () => {
    const sources = [{ key: 'source-1', label: '公开链接', detail: '可执行', status: 'ready' as const, sourceRoute: { fallbackProviderIds: [], validationProviderIds: [], status: 'ready' as const }, url: 'https://example.com' }]
    expect(parseResearchSources(JSON.stringify(sources))).toEqual(sources)
  })

  it('does not treat a configured web-capture provider as TikTok keyword search', () => {
    const config: CaptureProviderConfig = { providers: [{ id: 'apify', label: 'Apify', configured: true, status: 'AVAILABLE', supportedPlatforms: ['TikTok'], capabilities: [{ platform: '网页', capability: 'WEB_CAPTURE', status: 'AVAILABLE', endpointKey: 'apify~website-content-crawler' }], automaticSync: false, mediaDownload: false }] }
    const plan = createResearchPlan('调研 TikTok 大码女装近30天爆款', [], config)
    expect(plan.sources).toContainEqual(expect.objectContaining({ key: 'planned:tiktok-video-search', status: 'capability_mismatch' }))
  })

  it('keeps a TikTok sales request executable while exposing the official-sales capability gap', () => {
    const config: CaptureProviderConfig = { providers: [{ id: 'tikhub', label: 'TikHub', configured: true, status: 'AVAILABLE', supportedPlatforms: ['TikTok'], capabilities: [{ platform: 'TikTok', capability: 'VIDEO_SEARCH', status: 'AVAILABLE', endpointKey: 'tiktok/fetch_general_search_result' }], automaticSync: false, mediaDownload: false }] }
    const plan = createResearchPlan('调研 TikTok 美国大码女装近30天销量最高的三个产品', [], config)
    expect(plan.sources).toContainEqual(expect.objectContaining({ key: 'planned:product-sales', status: 'capability_mismatch', capability: 'PRODUCT_SALES_DATA' }))
    expect(plan.sources).toContainEqual(expect.objectContaining({ key: 'planned:tiktok-video-search', status: 'ready', provider: 'tikhub' }))
    expect(plan.sources).not.toContainEqual(expect.objectContaining({ key: 'planned:web' }))
  })

  it('limits manual routing to the provider selection', () => {
    const config: CaptureProviderConfig = { providers: [
      { id: 'tikhub', label: 'TikHub', configured: true, status: 'AVAILABLE', supportedPlatforms: ['TikTok'], capabilities: [{ platform: 'TikTok', capability: 'VIDEO_SEARCH', status: 'AVAILABLE', endpointKey: 'tiktok/fetch_general_search_result' }], automaticSync: false, mediaDownload: false },
      { id: 'scrapecreators', label: 'Scrape Creators', configured: true, status: 'AVAILABLE', supportedPlatforms: ['TikTok'], capabilities: [{ platform: 'TikTok', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'tiktok/video' }], automaticSync: false, mediaDownload: false },
    ] }
    const plan = createResearchPlan('调研 TikTok 大码女装近30天爆款', [], config, { allowedProviderIds: ['tikhub'] })
    expect(plan.sources.find((source) => source.key === 'planned:tiktok-video-search')?.sourceRoute).toMatchObject({ primaryProviderId: 'tikhub', fallbackProviderIds: [] })
  })

  it('keeps dimension capability and source route through persisted plan JSON', () => {
    const config: CaptureProviderConfig = { providers: [{ id: 'tikhub', label: 'TikHub', configured: true, status: 'AVAILABLE', supportedPlatforms: ['TikTok'], capabilities: [{ platform: 'TikTok', capability: 'VIDEO_SEARCH', status: 'AVAILABLE', endpointKey: 'tiktok/fetch_general_search_result' }], automaticSync: false, mediaDownload: false }] }
    const plan = createResearchPlan('调研 TikTok 美国大码女装近30天爆款视频', [], config)
    const source = parseResearchSources(JSON.stringify(plan.sources)).find((item) => item.key === 'planned:tiktok-video-search')
    expect(source).toMatchObject({ dimension: '内容趋势', requiredCapabilities: ['VIDEO_SEARCH'], sourceRoute: { status: 'ready', primaryProviderId: 'tikhub', fallbackProviderIds: [], validationProviderIds: [] } })
  })

  it('routes an active saved TikTok keyword source through TikHub', () => {
    const config: CaptureProviderConfig = { providers: [{ id: 'tikhub', label: 'TikHub', configured: true, status: 'AVAILABLE', supportedPlatforms: ['TikTok'], capabilities: [{ platform: 'TikTok', capability: 'VIDEO_SEARCH', status: 'AVAILABLE', endpointKey: 'tiktok/fetch_general_search_result' }], automaticSync: false, mediaDownload: false }] }
    const savedKeyword = { id: 'source-tiktok-keyword', entity: 'externalSources', name: 'TikTok 大码女装内容趋势', type: 'KEYWORD', platform: 'TikTok', query: 'plus size fashion', status: 'active', createdAt: '1', updatedAt: '1' } as RecordData
    const plan = createResearchPlan('调研 TikTok 美国大码女装近30天爆款', [savedKeyword], config)

    expect(plan.sources).toContainEqual(expect.objectContaining({ key: savedKeyword.id, provider: 'tikhub', mode: 'keyword_search', query: 'plus size fashion', status: 'ready' }))
    expect(plan.sources).not.toContainEqual(expect.objectContaining({ key: 'planned:tiktok-video-search' }))
  })

  it('routes a saved Douyin link through RedFox instead of treating it as TikTok', () => {
    const config: CaptureProviderConfig = { providers: [{ id: 'redfox', label: 'RedFoxHub', configured: true, status: 'AVAILABLE', supportedPlatforms: ['抖音'], capabilities: [{ platform: '抖音', capability: 'POST_DETAIL', status: 'AVAILABLE', endpointKey: 'dyData/queryWork' }], automaticSync: false, mediaDownload: false }] }
    const savedDouyin = { id: 'source-douyin-link', entity: 'externalSources', name: '抖音公开视频解析入口', type: 'LINK', platform: '抖音', url: 'https://www.douyin.com/video/7646607909431233969', status: 'active', createdAt: '1', updatedAt: '1' } as RecordData
    const plan = createResearchPlan('调研抖音大码女装内容趋势', [savedDouyin], config)

    expect(plan.scope).toContain('抖音')
    expect(plan.sources).toContainEqual(expect.objectContaining({ key: savedDouyin.id, provider: 'redfox', mode: 'link', status: 'ready' }))
    expect(plan.sources).not.toContainEqual(expect.objectContaining({ key: 'planned:tiktok-video-search' }))
  })
})
