import { useEffect, useRef, useState } from 'react'
import { VoiceSessionController } from './VoiceSessionController'
import type { VoiceSessionSnapshot } from './types'
import './aiVoiceInput.css'

export default function AiVoiceInput({ disabled, onTranscript, onActive }: { disabled: boolean; onTranscript: (text: string) => void; onActive: (active: boolean) => void }) {
  const controller = useRef<VoiceSessionController | null>(null)
  const [snapshot, setSnapshot] = useState<VoiceSessionSnapshot>({ state: 'IDLE', transcript: '', partialTranscript: '', level: 0 })
  if (!controller.current) controller.current = new VoiceSessionController()
  const active = snapshot.state === 'LISTENING' || snapshot.state === 'TRANSCRIBING'
  useEffect(() => { const session = controller.current!; return session.subscribe(setSnapshot) }, [])
  useEffect(() => () => controller.current?.dispose(), [])
  useEffect(() => { onActive(active) }, [active, onActive])
  useEffect(() => { if (disabled) controller.current?.cancel() }, [disabled])
  const stop = async () => {
    const text = await controller.current?.stop()
    if (!text) return
    onTranscript(text)
    controller.current?.transition('DONE')
  }
  const text = snapshot.partialTranscript || snapshot.transcript
  return <div className="ai-composer-voice">
    {(active || snapshot.error) && <div className={`ai-voice-status${snapshot.error ? ' error' : ''}`} role={snapshot.error ? 'alert' : 'status'}>
      <span>{snapshot.error?.message || (snapshot.state === 'TRANSCRIBING' ? '正在识别…' : '正在聆听，结束后填入输入框，不会自动发送。')}{active && text && <small>{text}</small>}</span>
      {active && <button type="button" aria-label="取消语音输入" onClick={() => controller.current?.cancel()}>取消</button>}
    </div>}
    <button type="button" className={`ai-voice-trigger${active ? ' active' : ''}`} aria-label={active ? '结束语音输入' : '开始语音输入'} aria-pressed={active} title={active ? '结束并填入输入框' : '语音输入'} disabled={disabled || snapshot.state === 'TRANSCRIBING'} onClick={() => { if (active) void stop(); else void controller.current?.start() }}>
      {active ? <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1" /></svg> : <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="5" y="1" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.4" /><path d="M3 6v1a4 4 0 0 0 8 0V6M7 11v2M5 13h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>}
    </button>
  </div>
}
