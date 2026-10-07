import type { VoiceRoute } from './types'

export const voicePages: Array<{ pattern: RegExp; page: string; label: string }> = [
  { pattern: /^(收纳箱|收集箱|笔记)$/, page: 'notebook', label: '收纳箱' },
  { pattern: /^(任务|待办)$/, page: 'tasks', label: '任务' },
  { pattern: /^项目$/, page: 'projects', label: '项目' },
  { pattern: /^(今天|今日)$/, page: 'today', label: '今天' },
  { pattern: /^(时间|计时记录)$/, page: 'time', label: '时间' },
  { pattern: /^(成果|结果|能力资产)$/, page: 'outcomes', label: '成果' },
  { pattern: /^财务$/, page: 'finance', label: '财务' },
  { pattern: /^(决策|决策中心)$/, page: 'decisionCenter', label: '决策中心' },
  { pattern: /^(认知|认知中心)$/, page: 'cognition', label: '认知中心' },
  { pattern: /^(知识|知识库)$/, page: 'knowledge', label: '知识' },
  { pattern: /^复盘$/, page: 'reviews', label: '复盘' },
  { pattern: /^洞见$/, page: 'insights', label: '洞见' },
  { pattern: /^原则$/, page: 'principles', label: '原则' },
  { pattern: /^(思维模型|思维模型库)$/, page: 'mentalModels', label: '思维模型' },
  { pattern: /^(指挥中心|驾驶舱|开始界面)$/, page: 'command', label: '指挥中心' },
  { pattern: /^(事件|日程)$/, page: 'events', label: '事件' },
  { pattern: /^(人物|联系人)$/, page: 'people', label: '人物' },
  { pattern: /^时间线$/, page: 'timeline', label: '时间线' },
  { pattern: /^(AI\s*News\s*Radar|AI\s*新闻|新闻雷达)$/i, page: 'aiNews', label: 'AI News Radar' },
  { pattern: /^(设置|设置与工作区)$/, page: 'settings', label: '设置' },
  { pattern: /^(我的档案|用户档案|个人资料)$/, page: 'profile', label: '我的档案' },
  { pattern: /^(AI\s*助理|助理|首席助理)$/i, page: 'assistant', label: 'AI 助理' },
]
export const pageTitleForVoice = (page: string) => voicePages.find((entry) => entry.page === page)?.label || '页面'
const route = (intent: VoiceRoute['intent'], confidence: VoiceRoute['confidence'], reason: VoiceRoute['reason'], extra: Partial<VoiceRoute> = {}): VoiceRoute => ({ intent, confidence, reason, ...extra })

export function routeVoiceIntent(transcript: string): VoiceRoute {
  const text = transcript.replace(/[。！!？?，,]/g, '').trim().replace(/^(请帮我|帮我|请)/, '')
  if (!text) return route('FAST_AI', 'LOW', 'fast_ai')
  if (/^(取消|取消操作|算了|不要执行|停止操作)$/.test(text)) return route('CANCEL', 'HIGH', 'deterministic')
  if (/^(确认|确认执行|执行|确认创建|确认保存)$/.test(text)) return route('CONFIRM', 'HIGH', 'deterministic')
  if (/^(开始|启动|继续)(计时|计时器|专注)$/.test(text)) return route('START_TIMER', 'HIGH', 'deterministic')
  if (/^(停止|结束|暂停)(计时|计时器|专注)$/.test(text)) return route('STOP_TIMER', 'HIGH', 'deterministic')
  const navigation = text.match(/^(?:打开|进入|查看)(.+)$/)
  if (navigation) {
    const page = voicePages.find(({ pattern }) => pattern.test(navigation[1].trim()) || pattern.test(navigation[1].trim().replace(/(?:页面|界面)$/, '')))?.page
    if (page) return route('OPEN_PAGE', 'HIGH', 'deterministic', { page })
  }
  const search = text.match(/^(?:搜索|查找|找一下|找|帮我找)(.+)$/)
  if (search?.[1]?.trim()) return route('SEARCH_SIMPLE', 'HIGH', 'deterministic', { query: search[1].trim() })
  if (/(CEO|首席|战略|投入.*成果|成果.*投入|最近.*问题|为什么|分析|判断|决策建议)/i.test(text)) return route('STRONG_AI', 'MEDIUM', 'strong_ai')
  return route('FAST_AI', 'MEDIUM', 'fast_ai')
}
