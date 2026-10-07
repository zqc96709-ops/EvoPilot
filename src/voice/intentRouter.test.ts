import { describe, expect, it } from 'vitest'
import { routeVoiceIntent } from './intentRouter'

describe('Voice deterministic intent router', () => {
  it('does not send deterministic navigation or timer commands to an LLM', () => {
    expect(routeVoiceIntent('开始计时')).toMatchObject({ intent: 'START_TIMER', reason: 'deterministic', confidence: 'HIGH' })
    expect(routeVoiceIntent('停止计时')).toMatchObject({ intent: 'STOP_TIMER', reason: 'deterministic', confidence: 'HIGH' })
    expect(routeVoiceIntent('打开决策中心')).toMatchObject({ intent: 'OPEN_PAGE', page: 'decisionCenter', reason: 'deterministic' })
    expect(routeVoiceIntent('打开今天')).toMatchObject({ intent: 'OPEN_PAGE', page: 'today', reason: 'deterministic', confidence: 'HIGH' })
    expect(routeVoiceIntent('打开开始界面')).toMatchObject({ intent: 'OPEN_PAGE', page: 'command', reason: 'deterministic', confidence: 'HIGH' })
    expect(routeVoiceIntent('帮我找直播项目')).toMatchObject({ intent: 'SEARCH_SIMPLE', query: '直播项目' })
    expect(routeVoiceIntent('搜索 EvoPilot 项目')).toMatchObject({ intent: 'SEARCH_SIMPLE', query: 'EvoPilot 项目', reason: 'deterministic' })
  })

  it('keeps confirmation and cancellation deterministic', () => {
    expect(routeVoiceIntent('确认')).toMatchObject({ intent: 'CONFIRM', reason: 'deterministic' })
    expect(routeVoiceIntent('取消操作')).toMatchObject({ intent: 'CANCEL', reason: 'deterministic' })
  })

  it('routes only complex cross-domain reasoning to the strong path', () => {
    expect(routeVoiceIntent('EvoPilot 最近是不是投入太多但成果太少？')).toMatchObject({ intent: 'STRONG_AI', reason: 'strong_ai' })
    expect(routeVoiceIntent('创建明天的高优任务')).toMatchObject({ intent: 'FAST_AI', reason: 'fast_ai' })
  })
})

describe('whole-system voice routing', () => {
  it.each([
    ['打开设置', 'settings'], ['打开事件', 'events'], ['打开人物', 'people'], ['打开时间线', 'timeline'],
    ['打开 AI News Radar', 'aiNews'], ['打开知识库', 'knowledge'], ['打开复盘', 'reviews'],
    ['打开洞见', 'insights'], ['打开原则', 'principles'], ['打开思维模型', 'mentalModels'],
    ['打开我的档案', 'profile'], ['打开 AI 助理', 'assistant'],
  ])('routes %s without needing a model', (text, page) => {
    expect(routeVoiceIntent(text)).toMatchObject({ intent: 'OPEN_PAGE', page, reason: 'deterministic' })
  })
  it.each(['查看项目本月收入', '打开任务直播准备的详情', '查看最近一周的复盘并总结', '开始计时并创建一个项目', '删除笔记直播话术'])('does not swallow specific requests as page/timer shortcuts: %s', (text) => {
    expect(['FAST_AI', 'STRONG_AI']).toContain(routeVoiceIntent(text).intent)
  })
})
