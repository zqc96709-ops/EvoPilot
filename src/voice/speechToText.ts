import type { SpeechToTextProvider } from './types'

type RecognitionEvent = Event & { results: ArrayLike<{ 0?: { transcript?: string }; isFinal?: boolean }> }
type RecognitionErrorEvent = Event & { error?: string }
type WebSpeechRecognition = EventTarget & { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; abort(): void; onresult: ((event: RecognitionEvent) => void) | null; onerror: ((event: RecognitionErrorEvent) => void) | null; onend: (() => void) | null }
type RecognitionConstructor = new () => WebSpeechRecognition

const recognitionConstructor = () => (window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition

export class SystemSpeechToTextProvider implements SpeechToTextProvider {
  private recognition?: WebSpeechRecognition
  private finalTranscript = ''
  private latestTranscript = ''

  capabilities() { return { streaming: Boolean(recognitionConstructor()), microphone: Boolean(navigator.mediaDevices?.getUserMedia), provider: 'system-speech' } }
  async health() { return recognitionConstructor() ? { ok: true, message: '系统语音接口可用；实际权限和识别服务将在开始时检查。' } : { ok: false, message: '当前 Mac WebView 未提供语音识别接口，不能开始识别；需要接入原生或独立语音转文字服务。' } }
  startTranscription({ onPartial, onFinal, onError }: Parameters<SpeechToTextProvider['startTranscription']>[0]) {
    this.cancel()
    const Recognition = recognitionConstructor()
    if (!Recognition) { onError(new Error('当前 Mac WebView 不支持系统语音识别。')); return }
    const recognition = new Recognition(); this.recognition = recognition; this.finalTranscript = ''
    recognition.lang = 'zh-CN'; recognition.continuous = false; recognition.interimResults = true
    recognition.onresult = (event) => {
      if (this.recognition !== recognition) return
      let interim = ''; let final = ''
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]; const value = String(result?.[0]?.transcript || '').trim()
        if (!value) continue
        if (result.isFinal) final += value
        else interim += value
      }
      this.finalTranscript = final
      this.latestTranscript = `${final}${interim}`.trim()
      onPartial(this.latestTranscript)
      if (this.finalTranscript.trim()) onFinal(this.finalTranscript.trim())
    }
    recognition.onerror = (event) => {
      if (this.recognition !== recognition) return
      this.cancel()
      onError(new Error(
        ['service-not-allowed', 'not-allowed'].includes(event.error || '')
          ? `系统拒绝语音识别。请在 macOS“系统设置 → 隐私与安全性”中检查 EvoPilot 的麦克风及语音识别权限，再重启应用（${event.error}）。`
          : `系统语音识别失败：${event.error || 'unknown'}`,
      ))
    }
    recognition.onend = () => {
      if (this.recognition !== recognition) return
      this.recognition = undefined
      recognition.onresult = null; recognition.onerror = null; recognition.onend = null
      // WebKit may end with only interim results; retain the displayed text for the user's stop/execute click.
      this.finalTranscript = this.latestTranscript || this.finalTranscript
      if (this.finalTranscript.trim()) onFinal(this.finalTranscript.trim())
      else onError(new Error('没有识别到语音。请重新开始说话，并检查输入麦克风。'))
    }
    try { recognition.start() } catch (error) {
      this.cancel(); onError(error instanceof Error ? error : new Error(String(error)))
    }
  }
  finish() { this.recognition?.stop() }
  async transcribeAudio(): Promise<string> { if (!this.finalTranscript.trim()) throw new Error('系统语音识别没有返回文字。'); return this.finalTranscript.trim() }
  cancel() {
    const recognition = this.recognition; this.recognition = undefined; this.finalTranscript = ''; this.latestTranscript = ''
    if (recognition) {
      recognition.onresult = null; recognition.onerror = null; recognition.onend = null
      try { recognition.abort() } catch { /* The previous session may already have ended. */ }
    }
  }
}

export const systemSpeechToText = () => new SystemSpeechToTextProvider()
