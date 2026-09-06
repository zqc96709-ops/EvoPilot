export type VoiceState = 'IDLE' | 'LISTENING' | 'TRANSCRIBING' | 'UNDERSTANDING' | 'FETCHING_CONTEXT' | 'READY_TO_EXECUTE' | 'AWAITING_CONFIRMATION' | 'EXECUTING' | 'DONE' | 'ERROR' | 'CANCELLED'

export type VoiceIntent = 'START_TIMER' | 'STOP_TIMER' | 'OPEN_PAGE' | 'SEARCH_SIMPLE' | 'CONFIRM' | 'CANCEL' | 'FAST_AI' | 'STRONG_AI'
export type VoiceRoute = { intent: VoiceIntent; page?: string; query?: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; reason: 'deterministic' | 'fast_ai' | 'strong_ai' }

export type VoiceSessionSnapshot = {
  state: VoiceState
  transcript: string
  partialTranscript: string
  level: number
  error?: { kind: 'MIC' | 'STT' | 'INTENT' | 'ENTITY' | 'TOOL' | 'PERMISSION' | 'SERVICE' | 'SYNC'; message: string }
}

export type SpeechCapabilities = { streaming: boolean; microphone: boolean; provider: string }
export type SpeechToTextProvider = {
  capabilities(): SpeechCapabilities
  startTranscription(input: { onPartial: (text: string) => void; onFinal: (text: string) => void; onError: (error: Error) => void }): void
  transcribeAudio(audio: Blob): Promise<string>
  finish?(): void
  cancel(): void
  health(): Promise<{ ok: boolean; message: string }>
}

export type VoiceExecutionResult = { state: Extract<VoiceState, 'DONE' | 'AWAITING_CONFIRMATION' | 'ERROR' | 'CANCELLED'>; message: string; actionId?: string; viewLabel?: string }
