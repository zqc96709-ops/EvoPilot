import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/bundle/macos/Jason OS.app/Contents/MacOS/jason-os')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-voice-e2e-'))
const port = String(5960 + Math.floor(Math.random() * 30))
const endpoint = `http://127.0.0.1:${port}`
let app; let sessionId = ''
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const request = async (path, body, method = body ? 'POST' : 'GET') => {
  const response = await fetch(endpoint + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response.json()
}
const wait = async (check, label) => {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) { try { const value = await check(); if (value) return value } catch {} await pause(120) }
  throw new Error(`Timed out: ${label}`)
}
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)

try {
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: 'ignore' })
  await wait(() => request('/status').then((result) => result.value?.ready), 'webdriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await wait(() => execute('return Boolean(document.querySelector(".voice-operating-entry"))'), 'voice entry')
  await execute('document.querySelector(".voice-operating-entry").click(); return true')
  await wait(() => execute('return document.querySelector(".voice-panel")?.innerText.includes("语音操作")'), 'voice panel')
  const initial = await execute('return document.querySelector(".voice-panel").innerText')
  if (!initial.includes('点击开始说话')) throw new Error(`Unexpected initial voice state: ${initial}`)
  await execute('return [...document.querySelectorAll(".voice-panel button")].find((node) => node.textContent.includes("开始说话"))?.click() || false')
  const status = await wait(() => execute('const text=document.querySelector(".voice-panel")?.innerText||""; return /系统语音识别可用|当前 Mac WebView 未提供系统语音识别|正在聆听/.test(text) ? text : ""'), 'explicit STT capability state')
  const storedAudio = await execute(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('list_records',{entity:'all'}).then((records)=>done(records.filter((record)=>JSON.stringify(record).includes('voice transcript')||record.entity==='voiceAudio'))).catch((error)=>done({__error:String(error)}))`)
  if (storedAudio?.__error) throw new Error(storedAudio.__error)
  if (Array.isArray(storedAudio) && storedAudio.length) throw new Error(`Voice audio/transcript persisted unexpectedly: ${JSON.stringify(storedAudio)}`)
  await mkdir(resolve('artifacts'), { recursive: true })
  await writeFile(resolve('artifacts/voice-operating-e2e-status.txt'), status)
  console.log(JSON.stringify({ status: 'passed', checks: ['packaged desktop voice entry', 'voice panel opens', 'STT capability is explicit', 'no audio/transcript entity persisted'], sttCapability: status.includes('未提供') ? 'unavailable-with-explicit-fallback' : 'system-provider-available' }))
} catch (error) {
  const html = sessionId ? await execute('return document.documentElement.outerHTML').catch(() => '') : ''
  await writeFile(join(dataDir, 'failure.html'), html)
  console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) }))
  process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app?.kill('SIGTERM')
  await pause(400)
  if (!process.exitCode) await rm(dataDir, { recursive: true, force: true })
}
