import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { VoiceSessionController } from './VoiceSessionController'
import type { VoiceExecutionResult, VoiceSessionSnapshot, VoiceState } from './types'
import './voice.css'

const copy: Partial<Record<VoiceState, string>> = { IDLE: '点击开始说话', LISTENING: '正在聆听…', TRANSCRIBING: '正在识别…', UNDERSTANDING: '正在理解你的操作…', FETCHING_CONTEXT: '正在读取必要上下文…', READY_TO_EXECUTE: '已理解，准备执行', AWAITING_CONFIRMATION: '请确认本次操作', EXECUTING: '正在执行…', DONE: '已完成', ERROR: '语音操作未完成', CANCELLED: '已取消，没有执行任何操作' }

export default function VoiceOperatingPanel({ onClose, onTranscript, onConfirm, onCancel }: { onClose: () => void; onTranscript: (transcript: string) => Promise<VoiceExecutionResult>; onConfirm: (actionId: string) => Promise<VoiceExecutionResult>; onCancel: (actionId: string) => Promise<VoiceExecutionResult> }) {
  const controller = useRef<VoiceSessionController | null>(null); const [snapshot, setSnapshot] = useState<VoiceSessionSnapshot>(() => ({ state: 'IDLE' as VoiceState, transcript: '', partialTranscript: '', level: 0 })); const [result, setResult] = useState<VoiceExecutionResult | null>(null); const [busy, setBusy] = useState(false)
  if (!controller.current) controller.current = new VoiceSessionController()
  useEffect(() => { const active = controller.current!; return active.subscribe(setSnapshot) }, [])
  useEffect(() => () => controller.current?.dispose(), [])
  const start = async () => { setResult(null); await controller.current?.start() }
  const stop = async () => {
    const transcript = await controller.current?.stop(); if (!transcript) return
    controller.current?.transition('FETCHING_CONTEXT')
    setBusy(true); setResult(null)
    try { controller.current?.transition('EXECUTING'); setResult(await onTranscript(transcript)) } catch (error) { setResult({ state: 'ERROR', message: String(error) }) } finally { setBusy(false) }
  }
  const act = async (kind: 'confirm' | 'cancel') => {
    if (!result?.actionId) return; setBusy(true)
    try { setResult(kind === 'confirm' ? await onConfirm(result.actionId) : await onCancel(result.actionId)) } catch (error) { setResult({ state: 'ERROR', message: String(error) }) } finally { setBusy(false) }
  }
  const state = result?.state || (busy ? 'EXECUTING' : snapshot.state); const transcript = snapshot.partialTranscript || snapshot.transcript
  return <div className="voice-modal-backdrop" role="presentation"><section className="voice-panel" role="dialog" aria-modal="true" aria-label="语音操作"><header><div><span className="voice-panel-kicker">VOICE OPERATING LAYER</span><h2>🎙 语音操作</h2><p>{copy[state] || '处理中…'}</p></div><button aria-label="关闭语音操作" onClick={onClose}>×</button></header><div className="voice-body">
    {(state === 'LISTENING' || state === 'TRANSCRIBING') && <div className="voice-waveform" aria-label="麦克风音量"><i style={{ '--voice-level': `${Math.max(.16, snapshot.level)}` } as CSSProperties} /><i style={{ '--voice-level': `${Math.max(.12, snapshot.level * .75)}` } as CSSProperties} /><i style={{ '--voice-level': `${Math.max(.18, snapshot.level * 1.2)}` } as CSSProperties} /><i style={{ '--voice-level': `${Math.max(.12, snapshot.level * .65)}` } as CSSProperties} /><i style={{ '--voice-level': `${Math.max(.16, snapshot.level * .9)}` } as CSSProperties} /></div>}
    {transcript && <section className="voice-transcript"><small>系统听到：</small><p>{transcript}</p></section>}
    {result && <section className={`voice-result ${result.state.toLowerCase()}`}><strong>{result.message}</strong>{result.viewLabel && <small>{result.viewLabel}</small>}</section>}
    {snapshot.error && <section className="voice-result error"><strong>{snapshot.error.message}</strong><small>未写入任何 EvoPilot 数据。</small></section>}
  </div><footer>
    {state === 'IDLE' || state === 'CANCELLED' || state === 'ERROR' || state === 'DONE' ? <button className="button primary" disabled={busy} onClick={() => void start()}>🎙 开始说话</button> : state === 'LISTENING' ? <><button className="button" onClick={() => controller.current?.cancel()}>取消</button><button className="button primary" onClick={() => void stop()}>停止并执行</button></> : state === 'AWAITING_CONFIRMATION' ? <><button className="button" disabled={busy} onClick={() => void act('cancel')}>取消</button><button className="button primary" disabled={busy} onClick={() => void act('confirm')}>确认执行</button></> : <button className="button" onClick={() => controller.current?.cancel()}>取消</button>}
  </footer></section></div>
}
