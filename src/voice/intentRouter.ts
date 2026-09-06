import type { VoiceRoute } from './types'

const pageMatchers: Array<[RegExp, string]> = [
  [/(收纳箱|收集箱|笔记)/, 'notebook'], [/(任务|待办)/, 'tasks'], [/(项目)/, 'projects'], [/(今天|今日)/, 'today'], [/(时间|计时记录)/, 'time'], [/(成果|结果)/, 'outcomes'], [/(财务)/, 'finance'], [/(决策)/, 'decisionCenter'], [/(认知|知识|洞见|复盘)/, 'cognition'], [/(指挥中心|驾驶舱)/, 'command'],
]
const route = (intent: VoiceRoute['intent'], confidence: VoiceRoute['confidence'], reason: VoiceRoute['reason'], extra: Partial<VoiceRoute> = {}): VoiceRoute => ({ intent, confidence, reason, ...extra })

export function routeVoiceIntent(transcript: string): VoiceRoute {
  const text = transcript.replace(/[。！!？?，,]/g, '').trim()
  if (!text) return route('FAST_AI', 'LOW', 'fast_ai')
  if (/^(取消|取消操作|算了|不要执行|停止操作)$/.test(text)) return route('CANCEL', 'HIGH', 'deterministic')
  if (/^(确认|确认执行|执行|确认创建|确认保存)$/.test(text)) return route('CONFIRM', 'HIGH', 'deterministic')
  if (/(开始|启动|继续).{0,6}(计时|计时器|专注)/.test(text)) return route('START_TIMER', 'HIGH', 'deterministic')
  if (/(停止|结束|暂停).{0,6}(计时|计时器|专注)/.test(text)) return route('STOP_TIMER', 'HIGH', 'deterministic')
  if (/^(打开|进入|查看).{0,8}/.test(text)) {
    const page = pageMatchers.find(([pattern]) => pattern.test(text))?.[1]
    if (page) return route('OPEN_PAGE', 'HIGH', 'deterministic', { page })
  }
  const search = text.match(/^(?:搜索|查找|找一下|帮我找)(.+)$/)
  if (search?.[1]?.trim()) return route('SEARCH_SIMPLE', 'HIGH', 'deterministic', { query: search[1].trim() })
  if (/(CEO|首席|战略|投入.*成果|成果.*投入|最近.*问题|为什么|分析|判断|决策建议)/i.test(text)) return route('STRONG_AI', 'MEDIUM', 'strong_ai')
  return route('FAST_AI', 'MEDIUM', 'fast_ai')
}
