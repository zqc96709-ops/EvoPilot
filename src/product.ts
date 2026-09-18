import type { RecordData } from './model'

/**
 * Product-facing identity only.  Storage, bundle and sync identifiers deliberately
 * remain on their existing `com.jasonos.desktop` namespace so an installed update
 * never creates a second local workspace.
 */
export const PRODUCT_NAME = 'EvoPilot'
export const PRODUCT_TAGLINE = '个人操作系统'
export const PRODUCT_EYEBROW = `${PRODUCT_NAME} · PERSONAL OPERATING SYSTEM`
export const PRODUCT_SEARCH_PLACEHOLDER = '搜索任何内容 / 询问 AI...'

const text = (value: unknown) => String(value || '').trim()

export const greetingForHour = (hour: number) => {
  if (hour >= 5 && hour < 11) return '早上好'
  if (hour >= 11 && hour < 13) return '中午好'
  if (hour >= 13 && hour < 18) return '下午好'
  return '晚上好'
}

export type UserIdentity = {
  displayName: string
  accountLabel: string
  initial: string
  avatarUrl: string
  greeting: string
}

export const resolveUserIdentity = (profile?: Partial<RecordData>): UserIdentity => {
  const displayName = [profile?.nickname, profile?.displayName, profile?.display_name, profile?.name]
    .map(text)
    .find(Boolean) || text(profile?.email).split('@')[0] || ''
  return {
    displayName,
    accountLabel: displayName || '账户',
    initial: (displayName || 'E').slice(0, 1).toUpperCase(),
    avatarUrl: text(profile?.avatar),
    greeting: displayName ? `${greetingForHour(new Date().getHours())}，${displayName}` : greetingForHour(new Date().getHours()),
  }
}
