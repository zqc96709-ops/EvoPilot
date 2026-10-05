import { describe, expect, it, vi } from 'vitest'
import { NoteSaveController, type NoteDraftSnapshot } from './noteAutosave'

const draft = (content: string) => ({ noteId: 'note-1', title: 'T', content, contentHtml: content, fileIds: [], tags: [] })

describe('NoteSaveController', () => {
  it('retains recovery but never saves merely because typing stops', async () => {
    vi.useFakeTimers()
    const saved: string[] = []
    let recovery: NoteDraftSnapshot | null = null
    const controller = new NoteSaveController({ persist: async (value) => { saved.push(value.content) }, recover: (value) => { recovery = value } })
    controller.update(draft('latest'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(saved).toEqual([])
    expect(recovery).toMatchObject({ content: 'latest' })
    await controller.flush()
    expect(saved).toEqual(['latest'])
    expect(recovery).toBeNull()
    vi.useRealTimers()
  })

  it('does not periodically save during continuous editing', async () => {
    vi.useFakeTimers()
    const saved: string[] = []
    const controller = new NoteSaveController({ persist: async (value) => { saved.push(value.content) }, recover: () => {} })
    for (let index = 0; index < 20; index += 1) {
      controller.update(draft(String(index)))
      await vi.advanceTimersByTimeAsync(250)
    }
    expect(saved).toEqual([])
    await controller.flush()
    expect(saved).toEqual(['19'])
    vi.useRealTimers()
  })

  it('serializes saves and never lets an older completion become final', async () => {
    const resolvers: Array<() => void> = []
    const saved: NoteDraftSnapshot[] = []
    const controller = new NoteSaveController({
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
    const controller = new NoteSaveController({ persist: async () => {}, recover: (value) => { recovery = value } })
    controller.update(draft('safe'))
    expect(recovery).toMatchObject({ content: 'safe' })
    await controller.flush()
    expect(recovery).toBeNull()
  })

  it('coalesces repeated flush requests for the same edit', async () => {
    let calls = 0
    let release = () => {}
    const controller = new NoteSaveController({ persist: () => new Promise<void>((resolve) => { calls += 1; release = resolve }), recover: () => {} })
    controller.update(draft('once'))
    const first = controller.flush()
    const duplicate = controller.flush()
    await Promise.resolve()
    expect(calls).toBe(1)
    release()
    await Promise.all([first, duplicate])
    expect(calls).toBe(1)
  })

  it('does not report a failed in-flight save as a successful navigation flush', async () => {
    let rejectSave: (error: Error) => void = () => {}
    const controller = new NoteSaveController({ persist: () => new Promise<void>((_, reject) => { rejectSave = reject }), recover: () => {} })
    controller.update(draft('must not disappear'))
    const autosave = controller.flush()
    const navigation = controller.flush()
    await Promise.resolve()
    rejectSave(new Error('disk full'))
    await expect(autosave).rejects.toThrow('disk full')
    await expect(navigation).rejects.toThrow('disk full')
  })

  it('still saves to SQLite when local recovery storage is full', async () => {
    const saved: string[] = []
    const controller = new NoteSaveController({ persist: async (value) => { saved.push(value.content) }, recover: () => { throw new Error('quota exceeded') } })
    controller.update(draft('keep this note'))
    await controller.flush()
    expect(saved).toEqual(['keep this note'])
  })
})
