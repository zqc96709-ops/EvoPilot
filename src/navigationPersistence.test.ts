import { describe, expect, it } from 'vitest'
import { readPersistedValue } from './navigationPersistence'

describe('navigation persistence', () => {
  const views = ['command', 'settings', 'voice'] as const

  it('restores a valid persisted view', () => {
    expect(readPersistedValue('settings', views, 'command')).toBe('settings')
  })

  it('falls back when persisted navigation is invalid', () => {
    expect(readPersistedValue('removed-view', views, 'command')).toBe('command')
    expect(readPersistedValue(null, views, 'command')).toBe('command')
  })
})
