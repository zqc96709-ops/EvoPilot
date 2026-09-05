import { describe, expect, it, vi } from 'vitest'
import { NoteAutosaveController, type NoteDraftSnapshot } from './noteAutosave'

const draft = (content: string) => ({ noteId: 'note-1', title: 'T', content, contentHtml: content, fileIds: [], tags: [] })

describe('NoteAutosaveController', () => {
  it('saves after the idle interval', async () => {
    vi.useFakeTimers()
    const saved: string[] = []
    const controller = new NoteAutosaveController({ persist: async (value) => { saved.push(value.content) }, recover: () => {} })
    controller.update(draft('latest'))
    await vi.advanceTimersByTimeAsync(600)
    expect(saved).toEqual(['latest'])
    vi.useRealTimers()
  })

  it('uses maxWait during continuous typing', async () => {
    vi.useFakeTimers()
    const saved: string[] = []
    const controller = new NoteAutosaveController({ persist: async (value) => { saved.push(value.content) }, recover: () => {} })
    for (let index = 0; index < 10; index += 1) {
      controller.update(draft(String(index)))
      await vi.advanceTimersByTimeAsync(250)
    }
    expect(saved.length).toBeGreaterThanOrEqual(1)
    expect(saved[0]).toBe('7')
    vi.useRealTimers()
  })

  it('serializes saves and never lets an older completion become final', async () => {
    const resolvers: Array<() => void> = []
    const saved: NoteDraftSnapshot[] = []
    const controller = new NoteAutosaveController({
      persist: (value) => new Promise<void>((resolve) => { saved.push(value); resolvers.push(resolve) }),
      recover: () => {},
    })
    controller.update(draft('A'))
    const first = controller.flush()
    controller.update(draft('B'))
    const second = controller.flush()
    await Promise.resolve()
    expect(saved.map((value) => value.content)).toEqual(['A'])
    resolvers.shift()?.()
    await first
    await Promise.resolve()
    expect(saved.map((value) => value.content)).toEqual(['A', 'B'])
    resolvers.shift()?.()
    await second
    expect(saved.at(-1)?.content).toBe('B')
  })

  it('keeps the recovery snapshot until the latest save succeeds', async () => {
    let recovery: NoteDraftSnapshot | null = null
    const controller = new NoteAutosaveController({ persist: async () => {}, recover: (value) => { recovery = value } })
    controller.update(draft('safe'))
    expect(recovery).toMatchObject({ content: 'safe' })
    await controller.flush()
    expect(recovery).toBeNull()
  })

  it('coalesces repeated flush requests for the same edit', async () => {
    let calls = 0
    let release = () => {}
    const controller = new NoteAutosaveController({ persist: () => new Promise<void>((resolve) => { calls += 1; release = resolve }), recover: () => {} })
    controller.update(draft('once'))
    const first = controller.flush()
    const duplicate = controller.flush()
    await Promise.resolve()
    expect(calls).toBe(1)
    release()
    await Promise.all([first, duplicate])
    expect(calls).toBe(1)
  })
})
