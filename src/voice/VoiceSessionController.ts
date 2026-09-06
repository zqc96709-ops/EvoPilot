import { systemSpeechToText } from './speechToText'
import type { SpeechToTextProvider, VoiceSessionSnapshot, VoiceState } from './types'

const initial = (): VoiceSessionSnapshot => ({ state: 'IDLE', transcript: '', partialTranscript: '', level: 0 })

export class VoiceSessionController {
  private provider: SpeechToTextProvider
  private stream?: MediaStream
  private recorder?: MediaRecorder
  private audioContext?: AudioContext
  private frame?: number
  private finalTranscript = ''
  private snapshot = initial()
  private listeners = new Set<(snapshot: VoiceSessionSnapshot) => void>()

  constructor(provider: SpeechToTextProvider = systemSpeechToText()) { this.provider = provider }
  subscribe(listener: (snapshot: VoiceSessionSnapshot) => void) { this.listeners.add(listener); listener(this.snapshot); return () => { this.listeners.delete(listener) } }
  get current() { return this.snapshot }
  private update(next: Partial<VoiceSessionSnapshot>) { this.snapshot = { ...this.snapshot, ...next }; this.listeners.forEach((listener) => listener(this.snapshot)) }
  transition(state: VoiceState) { this.update({ state }) }
  private release() { if (this.frame) cancelAnimationFrame(this.frame); this.frame = undefined; try { if (this.recorder?.state !== 'inactive') this.recorder?.stop() } catch { /* Recorder has already stopped. */ } this.recorder = undefined; this.stream?.getTracks().forEach((track) => track.stop()); this.stream = undefined; void this.audioContext?.close(); this.audioContext = undefined }
  private monitor(stream: MediaStream) {
    const context = new AudioContext(); const source = context.createMediaStreamSource(stream); const analyser = context.createAnalyser(); analyser.fftSize = 256; source.connect(analyser); const values = new Uint8Array(analyser.fftSize); this.audioContext = context
    const sample = () => { analyser.getByteTimeDomainData(values); const level = values.reduce((sum, value) => sum + Math.abs(value - 128), 0) / values.length / 128; this.update({ level }); this.frame = requestAnimationFrame(sample) }; sample()
  }
  async start() {
    this.cancel(false); this.finalTranscript = ''; this.update({ ...initial(), state: 'LISTENING' })
    try {
      const health = await this.provider.health()
      if (!health.ok) { this.update({ state: 'ERROR', error: { kind: 'STT', message: health.message } }); return }
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); this.monitor(this.stream)
      try { this.recorder = new MediaRecorder(this.stream); this.recorder.start() } catch { /* Audio is only an ephemeral VAD buffer; system STT can still proceed. */ }
      this.provider.startTranscription({
        onPartial: (text) => this.update({ partialTranscript: text }),
        onFinal: (text) => { this.finalTranscript = text; this.update({ transcript: text, partialTranscript: text }) },
        onError: (error) => { this.release(); this.update({ state: 'ERROR', error: { kind: 'STT', message: error.message } }) },
      })
    } catch (error) { this.release(); this.update({ state: 'ERROR', error: { kind: 'PERMISSION', message: `无法使用麦克风：${String(error)}` } }) }
  }
  async stop() {
    if (this.snapshot.state !== 'LISTENING') return ''
    this.update({ state: 'TRANSCRIBING' }); this.provider.finish?.()
    const started = Date.now()
    while (!this.finalTranscript && this.current.state !== 'ERROR' && Date.now() - started < 3_500) await new Promise((resolve) => setTimeout(resolve, 80))
    this.release()
    if (!this.finalTranscript) { this.update({ state: 'ERROR', error: { kind: 'STT', message: '没有识别到语音。请再试一次，或检查系统语音识别是否可用。' } }); return '' }
    this.update({ state: 'UNDERSTANDING', transcript: this.finalTranscript, partialTranscript: this.finalTranscript, level: 0 }); return this.finalTranscript
  }
  cancel(markCancelled = true) { this.provider.cancel(); this.release(); this.finalTranscript = ''; this.update(markCancelled ? { ...initial(), state: 'CANCELLED' } : initial()) }
  dispose() { this.cancel(false); this.listeners.clear() }
}
