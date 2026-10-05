import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'

const seed = process.env.JASON_OS_E2E_SEED_DB
if (!seed) throw new Error('Set JASON_OS_E2E_SEED_DB to a SQLite backup; the original is never opened for writing.')
const dataDir = await mkdtemp(join(tmpdir(), 'evopolit-note-input-'))
const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/evopolit')
const keyboard = join(dataDir, 'native-keyboard')
const port = String(5700 + Math.floor(Math.random() * 200))
const endpoint = `http://127.0.0.1:${port}`
let app
let sessionId = ''
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const request = async (path, body) => {
  const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response.json()
}
const wait = async (check, label) => { for (let i = 0; i < 200; i += 1) { try { if (await check()) return } catch {} await pause(100) } throw new Error(`Timed out: ${label}`) }
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const executeAsync = (script, args = []) => request(`/session/${sessionId}/execute/async`, { script, args }).then((result) => result.value)
const invoke = (command, args) => executeAsync('const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done).catch((error)=>done({error:String(error)}))', [command, args])
const run = (file, args) => new Promise((resolve, reject) => execFile(file, args, (error) => error ? reject(error) : resolve(undefined)))

try {
  await copyFile(seed, join(dataDir, 'jason-os.sqlite3'))
  await run('swiftc', [resolve('scripts/native-keyboard.swift'), '-o', keyboard])
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: 'ignore' })
  await wait(() => request('/status').then((result) => result.value?.ready), 'WebDriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await request(`/session/${sessionId}/window/rect`, { width: 2600, height: 1600 }).catch(() => undefined)
  await wait(() => execute('return Boolean(document.querySelector(".sidebar .quick-capture"))'), 'app shell')
  const title = `隔离输入验收-${Date.now()}`
  const note = await invoke('save_record', { entity: 'notes', data: { title, content: '', status: 'INBOX', type: 'NOTE' } })
  if (note.error) throw new Error(note.error)
  await execute(`document.querySelector('.sidebar nav button')?.click();return true`)
  await wait(() => execute('return Boolean(document.querySelector("[aria-label=\\"刷新指挥中心\\"]"))'), 'command center')
  await execute('document.querySelector("[aria-label=\\"刷新指挥中心\\"]")?.click();return true')
  await execute('document.querySelector(".sidebar .quick-capture")?.click();return true')
  await wait(() => execute('return [...document.querySelectorAll(".notebook-content-list article")].some((item)=>item.textContent.includes(arguments[0]))', [title]), 'test note visible')
  await execute('const row=[...document.querySelectorAll(".notebook-content-list article")].find((item)=>item.textContent.includes(arguments[0]));row.click();return true', [title])
  await wait(() => execute('return document.querySelector(".notebook-editor-title")?.value===arguments[0]', [title]), 'test note open')
  await execute(`const editor=document.querySelector('.notebook-rich-editor');window.__paint=[];editor.addEventListener('input',()=>{const started=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>window.__paint.push(performance.now()-started))) });editor.focus();return true`)
  await run('osascript', ['-e', `tell application "System Events" to set frontmost of first application process whose unix id is ${app.pid} to true`])
  await pause(200)
  const typed = '真实键盘连续输入即时显示与手动保存'.repeat(10)
  await execute(`const editor=document.querySelector('.notebook-rich-editor');window.__captures=0;const clone=editor.cloneNode.bind(editor);editor.cloneNode=(deep)=>{window.__captures++;return clone(deep)};return true`)
  await run(keyboard, [typed])
  await wait(() => execute('return document.querySelector(".notebook-rich-editor")?.innerText.includes(arguments[0])', [typed]), 'native keyboard visible')
  await pause(100)
  const paint = await execute('return window.__paint')
  const maxPaintMs = Math.round(Math.max(...paint))
  if (!paint.length || maxPaintMs > 150) throw new Error(`Native paint latency ${maxPaintMs}ms exceeds 150ms`)
  const capturesDuringTyping = await execute('return window.__captures')
  if (capturesDuringTyping !== 0) throw new Error(`Full-note serialization during continuous typing: ${capturesDuringTyping}`)
  await pause(3500)
  if ((await invoke('get_record', { id: note.id })).content === typed) throw new Error('Typed content saved without clicking Save')
  await execute('document.querySelector(".notebook-save-note").click();return true')
  await wait(async () => (await invoke('get_record', { id: note.id })).content === typed, 'manual SQLite save')
  await execute('document.querySelector(".notebook-filter-group button:nth-child(2)")?.click();return true')
  await wait(() => execute('return document.querySelector(".notebook-filter-group button:nth-child(2)")?.classList.contains("active")'), 'filter feedback')
  const saved = await invoke('get_record', { id: note.id })
  if (saved.content !== typed) throw new Error('Filter navigation lost note content')
  console.log(JSON.stringify({ status: 'passed', maxPaintMs, capturesDuringTyping, checks: ['production-size SQLite clone', 'native macOS keyboard visible', 'no full-note serialization during continuous typing', 'no SQLite write during idle editing', 'manual SQLite save', 'filter click feedback', 'no original data writes'] }))
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', error: String(error) }))
  process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app?.kill('SIGTERM')
  await pause(300)
  await rm(dataDir, { recursive: true, force: true })
}
