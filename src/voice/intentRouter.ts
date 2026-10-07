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
const settingsPages: Array<{ pattern: RegExp; section: VoiceRoute['settingsSection']; label: string }> = [
  { pattern: /^(账户|账号)$/, section: 'account', label: '账户' },
  { pattern: /^通用$/, section: 'general', label: '通用' },
  { pattern: /^(外观|主题)$/, section: 'appearance', label: '外观' },
  { pattern: /^(AI\s*与模型|AI\s*模型|模型)$/i, section: 'ai', label: 'AI 与模型' },
  { pattern: /^AI\s*协作上下文$/i, section: 'aiContext', label: 'AI 协作上下文' },
  { pattern: /^语音$/, section: 'voice', label: '语音' },
  { pattern: /^(同步|同步与设备)$/, section: 'sync', label: '同步与设备' },
  { pattern: /^(数据与备份|备份)$/, section: 'data', label: '数据与备份' },
  { pattern: /^存储$/, section: 'storage', label: '存储' },
  { pattern: /^通知$/, section: 'notifications', label: '通知' },
  { pattern: /^(Provider\s*\/\s*API|API|服务商)$/i, section: 'providers', label: 'Provider / API' },
  { pattern: /^(隐私与安全|隐私|安全)$/, section: 'privacy', label: '隐私与安全' },
  { pattern: /^快捷键$/, section: 'shortcuts', label: '快捷键' },
  { pattern: /^(帮助与反馈|帮助|反馈)$/, section: 'help', label: '帮助与反馈' },
  { pattern: /^关于\s*EvoPilot$/i, section: 'about', label: '关于 EvoPilot' },
  { pattern: /^退出登录$/, section: 'logout', label: '退出登录' },
]
export const pageTitleForVoice = (page: string, settingsSection?: VoiceRoute['settingsSection']) => (settingsSection ? settingsPages.find((entry) => entry.section === settingsSection)?.label : voicePages.find((entry) => entry.page === page)?.label) || '页面'
const route = (intent: VoiceRoute['intent'], confidence: VoiceRoute['confidence'], reason: VoiceRoute['reason'], extra: Partial<VoiceRoute> = {}): VoiceRoute => ({ intent, confidence, reason, ...extra })

export function routeVoiceIntent(transcript: string): VoiceRoute {
  const text = transcript.replace(/[。！!？?，,]/g, '').trim().replace(/^(请帮我|帮我|请)/, '')
  if (!text) return route('FAST_AI', 'LOW', 'fast_ai')
  if (/^(取消|取消操作|算了|不要执行|停止操作)$/.test(text)) return route('CANCEL', 'HIGH', 'deterministic')
  if (/^(确认|确认执行|执行|确认创建|确认保存)$/.test(text)) return route('CONFIRM', 'HIGH', 'deterministic')
  if (/^(开始|启动|继续)(计时|计时器|专注)$/.test(text)) return route('START_TIMER', 'HIGH', 'deterministic')
  if (/^(停止|结束|暂停)(计时|计时器|专注)$/.test(text)) return route('STOP_TIMER', 'HIGH', 'deterministic')
  const theme = text.match(/^(?:打开|开启|启用|切换(?:到|为)?|设置为|改为|换成|恢复)(暗色|深色|浅色|亮色|自动)(?:模式|主题)$/)
  if (theme) return route('SET_THEME', 'HIGH', 'deterministic', { theme: /暗色|深色/.test(theme[1]) ? 'dark' : /浅色|亮色/.test(theme[1]) ? 'light' : 'auto' })
  if (/^关闭(?:暗色|深色)模式$/.test(text)) return route('SET_THEME', 'HIGH', 'deterministic', { theme: 'light' })
  const navigation = text.match(/^(?:打开|进入|查看)(.+)$/)
  if (navigation) {
    const target = navigation[1].trim().replace(/^(?:设置(?:里面|中|里)的?|设置\/)/, '').replace(/(?:设置)?(?:页面|界面)?$/, '')
    const settings = settingsPages.find(({ pattern }) => pattern.test(target))
    if (settings) return route('OPEN_PAGE', 'HIGH', 'deterministic', { page: 'settings', settingsSection: settings.section })
    const page = voicePages.find(({ pattern }) => pattern.test(navigation[1].trim()) || pattern.test(navigation[1].trim().replace(/(?:页面|界面)$/, '')))?.page
    if (page) return route('OPEN_PAGE', 'HIGH', 'deterministic', { page })
  }
  const search = text.match(/^(?:搜索|查找|找一下|找|帮我找)(.+)$/)
  if (search?.[1]?.trim()) return route('SEARCH_SIMPLE', 'HIGH', 'deterministic', { query: search[1].trim() })
  if (/(CEO|首席|战略|投入.*成果|成果.*投入|最近.*问题|为什么|分析|判断|决策建议)/i.test(text)) return route('STRONG_AI', 'MEDIUM', 'strong_ai')
  return route('FAST_AI', 'MEDIUM', 'fast_ai')
}
