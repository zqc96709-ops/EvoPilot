import { describe, expect, it } from 'vitest'
import type { RecordData } from './model'
import { profileSavePayload } from './profile'
import { greetingForHour, resolveUserIdentity } from './product'

const profile = (extra: Record<string, unknown> = {}) => ({
  id: 'profile-1', entity: 'profiles', createdAt: '1', updatedAt: '2',
  longTermDirection: 'Preserve this context', ...extra,
}) as RecordData

describe('profile identity persistence', () => {
  it('writes nickname as the canonical account field without changing the profile id', () => {
    expect(profileSavePayload(profile(), { nickname: 'Felix Native E2E' })).toMatchObject({
      id: 'profile-1', nickname: 'Felix Native E2E', title: 'Felix Native E2E',
    })
  })

  it('preserves profile context when Account Settings saves identity fields', () => {
    expect(profileSavePayload(profile(), { nickname: 'Felix' })).toMatchObject({
      longTermDirection: 'Preserve this context', nickname: 'Felix',
    })
  })

  it('maps nickname, legacy display_name, and an anonymous fallback consistently', () => {
    expect(resolveUserIdentity(profile({ nickname: 'Felix', displayName: 'Display' })).displayName).toBe('Felix')
    expect(resolveUserIdentity(profile({ display_name: 'Remote Display' })).displayName).toBe('Remote Display')
    expect(resolveUserIdentity().accountLabel).toBe('账户')
  })
})

describe('local-time greeting', () => {
  it('uses the local hour for morning, noon, afternoon, and evening greetings', () => {
    expect(greetingForHour(5)).toBe('早上好')
    expect(greetingForHour(11)).toBe('中午好')
    expect(greetingForHour(13)).toBe('下午好')
    expect(greetingForHour(18)).toBe('晚上好')
    expect(greetingForHour(2)).toBe('晚上好')
  })
})
