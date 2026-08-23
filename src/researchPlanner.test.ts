import { describe, expect, it } from 'vitest'
import { createResearchPlan, parseResearchSources, resolveResearchSources } from './researchPlanner'
import type { RecordData } from './model'
import type { CaptureProviderConfig } from './api'

const source = { id: 'source-1', entity: 'externalSources', name: 'TikTok 大码女装', url: 'https://example.com/tiktok', platform: 'TikTok', status: 'active', createdAt: '1', updatedAt: '1' } as RecordData

describe('research request planning', () => {
  it('plans a TikTok request from saved public sources without creating Jason OS relations', () => {
    const plan = createResearchPlan('调研美国 TikTok 大码女装近30天爆款、竞品和价格带', [source], null)
    expect(plan.scope).toContain('TikTok')
    expect(plan.dimensions).toEqual(expect.arrayContaining(['内容趋势', '竞品动态', '价格带']))
    expect(plan.sources.find((item) => item.key === source.id)?.status).toBe('ready')
    expect(JSON.stringify(plan)).not.toContain('projectId')
    expect(JSON.stringify(plan)).not.toContain('goalId')
    expect(JSON.stringify(plan)).not.toContain('taskId')
  })

  it('marks a configured provider as needing a public link, not configuration', () => {
    const config: CaptureProviderConfig = { providers: [{ id: 'tikhub', label: 'TikHub', configured: true, supportedPlatforms: ['TikTok'], automaticSync: false, mediaDownload: false }] }
    const plan = createResearchPlan('调研 TikTok 大码女装近30天爆款', [], config)
    expect(plan.sources).toContainEqual(expect.objectContaining({ key: 'planned:tiktok-search', provider: 'tikhub', mode: 'keyword_search', status: 'ready' }))
  })

  it('upgrades a legacy TikTok plan when TikHub is configured', () => {
    const config: CaptureProviderConfig = { providers: [{ id: 'tikhub', label: 'TikHub', configured: true, supportedPlatforms: ['TikTok'], automaticSync: false, mediaDownload: false }] }
    const sources = resolveResearchSources([{ key: 'planned:tiktok', label: 'TikTok 公开内容', detail: '旧方案', status: 'needs_configuration' }], '调研 TikTok 大码女装近30天爆款', config)
    expect(sources).toContainEqual(expect.objectContaining({ key: 'planned:tiktok-search', mode: 'keyword_search', status: 'ready' }))
  })

  it('preserves a saved source plan for explicit user confirmation', () => {
    const sources = [{ key: 'source-1', label: '公开链接', detail: '可执行', status: 'ready' as const, url: 'https://example.com' }]
    expect(parseResearchSources(JSON.stringify(sources))).toEqual(sources)
  })
})
