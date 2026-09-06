import { describe, expect, it } from 'vitest'
import { routeVoiceIntent } from './intentRouter'

describe('Voice deterministic intent router', () => {
  it('does not send deterministic navigation or timer commands to an LLM', () => {
    expect(routeVoiceIntent('开始计时')).toMatchObject({ intent: 'START_TIMER', reason: 'deterministic', confidence: 'HIGH' })
    expect(routeVoiceIntent('打开决策中心')).toMatchObject({ intent: 'OPEN_PAGE', page: 'decisionCenter', reason: 'deterministic' })
    expect(routeVoiceIntent('搜索 Jason OS 项目')).toMatchObject({ intent: 'SEARCH_SIMPLE', query: 'Jason OS 项目', reason: 'deterministic' })
  })

  it('keeps confirmation and cancellation deterministic', () => {
    expect(routeVoiceIntent('确认')).toMatchObject({ intent: 'CONFIRM', reason: 'deterministic' })
    expect(routeVoiceIntent('取消操作')).toMatchObject({ intent: 'CANCEL', reason: 'deterministic' })
  })

  it('routes only complex cross-domain reasoning to the strong path', () => {
    expect(routeVoiceIntent('Jason OS 最近是不是投入太多但成果太少？')).toMatchObject({ intent: 'STRONG_AI', reason: 'strong_ai' })
    expect(routeVoiceIntent('创建明天的高优任务')).toMatchObject({ intent: 'FAST_AI', reason: 'fast_ai' })
  })
})
