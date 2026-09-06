import type { SpeechToTextProvider } from './types'

type RecognitionEvent = Event & { results: ArrayLike<{ 0?: { transcript?: string }; isFinal?: boolean }> }
type RecognitionErrorEvent = Event & { error?: string }
type WebSpeechRecognition = EventTarget & { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; abort(): void; onresult: ((event: RecognitionEvent) => void) | null; onerror: ((event: RecognitionErrorEvent) => void) | null; onend: (() => void) | null }
type RecognitionConstructor = new () => WebSpeechRecognition

const recognitionConstructor = () => (window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition

export class SystemSpeechToTextProvider implements SpeechToTextProvider {
  private recognition?: WebSpeechRecognition
  private finalTranscript = ''

  capabilities() { return { streaming: Boolean(recognitionConstructor()), microphone: Boolean(navigator.mediaDevices?.getUserMedia), provider: 'system-speech' } }
  async health() { return recognitionConstructor() ? { ok: true, message: '系统语音识别可用。' } : { ok: false, message: '当前 Mac WebView 未提供系统语音识别。请配置兼容的 STT Provider。' } }
  startTranscription({ onPartial, onFinal, onError }: Parameters<SpeechToTextProvider['startTranscription']>[0]) {
    const Recognition = recognitionConstructor()
    if (!Recognition) { onError(new Error('当前 Mac WebView 不支持系统语音识别。')); return }
    const recognition = new Recognition(); this.recognition = recognition; this.finalTranscript = ''
    recognition.lang = 'zh-CN'; recognition.continuous = false; recognition.interimResults = true
    recognition.onresult = (event) => {
      let interim = ''
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]; const value = String(result?.[0]?.transcript || '').trim()
        if (!value) continue
        if (result.isFinal) this.finalTranscript += value
        else interim += value
      }
      onPartial(`${this.finalTranscript}${interim}`.trim())
      if (this.finalTranscript.trim()) onFinal(this.finalTranscript.trim())
    }
    recognition.onerror = (event) => { if (event.error !== 'aborted') onError(new Error(`系统语音识别失败：${event.error || 'unknown'}`)) }
    recognition.start()
  }
  finish() { this.recognition?.stop() }
  async transcribeAudio(): Promise<string> { if (!this.finalTranscript.trim()) throw new Error('系统语音识别没有返回文字。'); return this.finalTranscript.trim() }
  cancel() { this.recognition?.abort(); this.recognition = undefined; this.finalTranscript = '' }
}

export const systemSpeechToText = () => new SystemSpeechToTextProvider()
