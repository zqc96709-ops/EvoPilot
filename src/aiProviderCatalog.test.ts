import { afterEach, expect, it, vi } from 'vitest'
import { api } from './api'

afterEach(() => vi.unstubAllGlobals())

it('omits Volc from the browser catalog without removing native provider models', async () => {
  vi.stubGlobal('window', {})
  const config = await api.getHackStartConfig()
  expect(config.providers.map((provider) => provider.id)).toEqual(['hackstart', 'deepseek', 'minimax'])
  expect(config.providers.find((provider) => provider.id === 'deepseek')?.models.map((model) => model.id)).toEqual(['deepseek-v4-pro', 'deepseek-flash'])
  expect(config.providers.find((provider) => provider.id === 'minimax')?.models.map((model) => model.id)).toEqual(['MiniMax-M3'])
})
