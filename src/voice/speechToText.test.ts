import { afterEach, describe, expect, it, vi } from 'vitest'
import { SystemSpeechToTextProvider } from './speechToText'
import { VoiceSessionController } from './VoiceSessionController'
import type { SpeechToTextProvider } from './types'

class Recognition {
  static instances: Recognition[] = []
  continuous = false; interimResults = false; lang = ''
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn(); stop = vi.fn(); abort = vi.fn()
  constructor() { Recognition.instances.push(this) }
}
const input = () => ({ onPartial: vi.fn(), onFinal: vi.fn(), onError: vi.fn() })
const microphone = () => {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
  vi.stubGlobal('AudioContext', class { createMediaStreamSource() { return { connect: vi.fn() } }; createAnalyser() { return { fftSize: 256, getByteTimeDomainData: vi.fn() } }; close = vi.fn().mockResolvedValue(undefined) })
  vi.stubGlobal('MediaRecorder', class { state = 'inactive'; start() { this.state = 'recording' }; stop() { this.state = 'inactive' } })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  return { stream, stop }
}
const provider = (): SpeechToTextProvider => ({ capabilities: () => ({ streaming: true, microphone: true, provider: 'test' }), health: vi.fn().mockResolvedValue({ ok: true, message: '' }), startTranscription: vi.fn(), finish: vi.fn(), cancel: vi.fn(), transcribeAudio: vi.fn() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); Recognition.instances = [] })

describe('Speech recognition lifecycle', () => {
  it('aborts a failed recognizer and detaches stale callbacks before retry', () => {
    vi.stubGlobal('window', { webkitSpeechRecognition: Recognition })
    const stt = new SystemSpeechToTextProvider(); const first = input()
    stt.startTranscription(first)
    const old = Recognition.instances[0]
    const error = old.onerror!
    error({ error: 'service-not-allowed' })
    expect(old.abort).toHaveBeenCalledOnce()
    expect(old.onerror).toBeNull()
    const next = input(); stt.startTranscription(next)
    error({ error: 'service-not-allowed' })
    expect(first.onError).toHaveBeenCalledOnce()
    expect(next.onError).not.toHaveBeenCalled()
    stt.cancel()
  })

  it('does not duplicate cumulative final results and reports an empty ended session', () => {
    vi.stubGlobal('window', { webkitSpeechRecognition: Recognition })
    const stt = new SystemSpeechToTextProvider(); const callbacks = input()
    stt.startTranscription(callbacks)
    const recognition = Recognition.instances[0]
    recognition.onresult!({ results: [{ 0: { transcript: '你好' }, isFinal: true }] })
    recognition.onresult!({ results: [{ 0: { transcript: '你好' }, isFinal: true }, { 0: { transcript: '世界' }, isFinal: true }] })
    expect(callbacks.onFinal).toHaveBeenLastCalledWith('你好世界')
    recognition.onend!()
    expect(callbacks.onError).not.toHaveBeenCalled()
    stt.startTranscription(callbacks)
    Recognition.instances[1].onend!()
    expect(callbacks.onError).toHaveBeenCalledOnce()
  })

  it('releases recognition and microphone on error so a second start works', async () => {
    const mic = microphone(); const stt = provider()
    const controller = new VoiceSessionController(stt)
    await controller.start()
    const initialCancels = vi.mocked(stt.cancel).mock.calls.length
    vi.mocked(stt.startTranscription).mock.calls[0][0].onError(new Error('service-not-allowed'))
    expect(controller.current.state).toBe('ERROR')
    expect(stt.cancel).toHaveBeenCalledTimes(initialCancels + 1)
    expect(mic.stop).toHaveBeenCalledOnce()
    await controller.start()
    expect(controller.current.state).toBe('LISTENING')
    expect(controller.current.error).toBeUndefined()
    controller.dispose()
  })

  it('stops a microphone returned after cancellation instead of reviving the session', async () => {
    const mic = microphone(); const stt = provider()
    let resolve!: (stream: MediaStream) => void
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise((done) => { resolve = done }))
    const controller = new VoiceSessionController(stt)
    const starting = controller.start()
    await Promise.resolve()
    controller.cancel()
    resolve(mic.stream); await starting
    expect(mic.stop).toHaveBeenCalledOnce()
    expect(stt.startTranscription).not.toHaveBeenCalled()
    expect(controller.current.state).toBe('CANCELLED')
    controller.dispose()
  })
  it('cleans up synchronous start failures and a retry creates a new recognizer', () => {
    vi.stubGlobal('window', { webkitSpeechRecognition: Recognition })
    const stt = new SystemSpeechToTextProvider()
    const callbacks = input()
    // Constructed mock instances carry their own start function.
    class FailingRecognition extends Recognition {
      start = vi.fn(() => { throw new Error('recognizer already started') })
    }
    vi.stubGlobal('window', { webkitSpeechRecognition: FailingRecognition })
    stt.startTranscription(callbacks)
    expect(callbacks.onError).toHaveBeenCalledOnce()
    expect(Recognition.instances[0].abort).toHaveBeenCalledOnce()
    vi.stubGlobal('window', { webkitSpeechRecognition: Recognition })
    stt.startTranscription(input())
    expect(Recognition.instances[1].start).toHaveBeenCalledOnce()
    stt.cancel()
  })

  it('ignores partial results from an earlier failed session after retry', async () => {
    microphone(); const stt = provider()
    const controller = new VoiceSessionController(stt)
    await controller.start()
    const first = vi.mocked(stt.startTranscription).mock.calls[0][0]
    first.onError(new Error('service unavailable'))
    await controller.start()
    first.onPartial('过期内容'); first.onFinal('过期内容')
    expect(controller.current.partialTranscript).toBe('')
    expect(controller.current.transcript).toBe('')
    controller.dispose()
  })

  it('returns to a retryable state if finishing recognition throws', async () => {
    microphone(); const stt = provider()
    vi.mocked(stt.finish!).mockImplementation(() => { throw new Error('already stopped') })
    const controller = new VoiceSessionController(stt)
    await controller.start()
    expect(await controller.stop()).toBe('')
    expect(controller.current.state).toBe('ERROR')
    await controller.start()
    expect(controller.current.state).toBe('LISTENING')
    controller.dispose()
  })

  it('does not overwrite cancellation while waiting for a final transcript', async () => {
    vi.useFakeTimers(); microphone(); const stt = provider()
    const controller = new VoiceSessionController(stt)
    await controller.start()
    const stopping = controller.stop()
    controller.cancel()
    await vi.advanceTimersByTimeAsync(100)
    expect(await stopping).toBe('')
    expect(controller.current.state).toBe('CANCELLED')
    controller.dispose()
  })

  it('returns recognized text after stop without repeating or retaining the audio', async () => {
    microphone(); const stt = provider()
    const controller = new VoiceSessionController(stt)
    await controller.start()
    vi.mocked(stt.startTranscription).mock.calls[0][0].onFinal('打开今天')
    expect(await controller.stop()).toBe('打开今天')
    expect(controller.current.state).toBe('UNDERSTANDING')
    controller.dispose()
  })

  it('keeps displayed interim text when the system ends without a final result', async () => {
    const mic = microphone(); vi.stubGlobal('window', { webkitSpeechRecognition: Recognition })
    const controller = new VoiceSessionController()
    await controller.start()
    const recognition = Recognition.instances[0]
    recognition.onresult!({ results: [{ 0: { transcript: '打开开始界面' }, isFinal: false }] })
    expect(controller.current.partialTranscript).toBe('打开开始界面')
    recognition.onend!()
    expect(controller.current.error).toBeUndefined()
    expect(await controller.stop()).toBe('打开开始界面')
    expect(mic.stop).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('keeps the latest full text including an interim suffix on end', () => {
    vi.stubGlobal('window', { webkitSpeechRecognition: Recognition })
    const stt = new SystemSpeechToTextProvider(); const callbacks = input()
    stt.startTranscription(callbacks)
    const recognition = Recognition.instances[0]
    recognition.onresult!({ results: [{ 0: { transcript: '打开' }, isFinal: true }, { 0: { transcript: '开始界面' }, isFinal: false }] })
    recognition.onend!()
    expect(callbacks.onFinal).toHaveBeenLastCalledWith('打开开始界面')
    expect(callbacks.onError).not.toHaveBeenCalled()
    stt.cancel()
  })

  it('never accepts an interim transcript after cancellation', () => {
    vi.stubGlobal('window', { webkitSpeechRecognition: Recognition })
    const stt = new SystemSpeechToTextProvider(); const callbacks = input()
    stt.startTranscription(callbacks)
    const recognition = Recognition.instances[0]; const end = recognition.onend!
    recognition.onresult!({ results: [{ 0: { transcript: '打开开始界面' }, isFinal: false }] })
    stt.cancel(); end()
    expect(callbacks.onFinal).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

})
