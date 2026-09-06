import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/bundle/macos/EVOPOLIT.app/Contents/MacOS/evopolit')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-note-autosave-e2e-'))
const port = String(5500 + Math.floor(Math.random() * 200))
const endpoint = `http://127.0.0.1:${port}`
let app
let sessionId = ''
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const request = async (path, body) => { const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response.json() }
const wait = async (check, label) => { const deadline = Date.now() + 15000; while (Date.now() < deadline) { try { const value = await check(); if (value) return value } catch {} await pause(100) } throw new Error(`Timed out: ${label}`) }
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const executeAsync = (script, args = []) => request(`/session/${sessionId}/execute/async`, { script, args }).then((result) => result.value)
const invoke = async (command, args) => { const result = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done).catch((error)=>done({__error:String(error)}))`, [command, args]); if (result?.__error) throw new Error(result.__error); return result }
const clickText = (selector, value) => execute(`const node=[...document.querySelectorAll(arguments[0])].find((item)=>item.textContent.includes(arguments[1]));if(!node)throw new Error('Missing '+arguments[1]);node.click();return true`, [selector, value])
const launch = async () => {
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: 'ignore' })
  await wait(() => request('/status').then((result) => result.value?.ready), 'WebDriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await pause(700)
  await wait(() => execute('return Boolean(document.querySelector(".sidebar .quick-capture"))'), 'app shell')
}
const openNote = async (title) => {
  await clickText('.notebook-content-list article', title)
  await wait(() => execute('return document.querySelector(".notebook-editor-title")?.value===arguments[0]', [title]), `open ${title}`)
  await wait(() => execute('return Boolean(document.querySelector(".notebook-rich-editor"))'), 'note editor')
}
const editBody = (content) => wait(() => execute(`const editor=document.querySelector('.notebook-rich-editor');if(!editor)return false;editor.textContent=arguments[0];editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:arguments[0]}));return true`, [content]), `note editor input: ${content.slice(0, 18)}`)
const record = (id) => invoke('get_record', { id })

try {
  await launch()
  const category = await invoke('save_record', { entity: 'notebookCategories', data: { name: '自动保存验收分类' } })
  const secondCategory = await invoke('save_record', { entity: 'notebookCategories', data: { name: '分类切换验收分类' } })
  const note = await invoke('save_record', { entity: 'notes', data: { title: '自动保存 P0 验收', content: '', status: 'INBOX', type: 'NOTE' } })
  await invoke('save_record', { entity: 'notes', data: { title: '切换目标笔记', content: '切换目标', status: 'INBOX', type: 'NOTE', notebookCategoryId: category.id } })
  await execute('document.querySelector("[aria-label=\\"刷新指挥中心\\"]")?.click();return true')
  await clickText('.sidebar .quick-capture', '收纳箱')
  await wait(() => execute('return document.querySelector(".notebook-content-list")?.innerText.includes("自动保存 P0 验收")'), 'note list')
  await openNote('自动保存 P0 验收')

  const idleContent = '600ms idle autosave：' + '甲'.repeat(320)
  await editBody(idleContent)
  await wait(async () => (await record(note.id)).content === idleContent, 'idle autosave persisted')

  const categoryContent = '分类前立即输入：' + '乙'.repeat(360)
  await editBody(categoryContent)
  await execute(`const select=document.querySelector('.notebook-category-control.compact select');select.value=arguments[0];select.dispatchEvent(new Event('change',{bubbles:true}));return true`, [category.id])
  await wait(async () => { const saved = await record(note.id); return saved.notebookCategoryId === category.id && saved.content === categoryContent }, 'category flush kept body')
  await wait(() => execute('return !document.querySelector(".notebook-content-list")?.innerText.includes("自动保存 P0 验收")'), 'categorized note leaves unorganized immediately')

  await clickText('.notebook-category-list button', '自动保存验收分类')
  await openNote('自动保存 P0 验收')
  await execute(`const select=document.querySelector('.notebook-category-control.compact select');select.value=arguments[0];select.dispatchEvent(new Event('change',{bubbles:true}));return true`, [secondCategory.id])
  await wait(async () => (await record(note.id)).notebookCategoryId === secondCategory.id, 'category switch persisted')
  await clickText('.notebook-category-list button', '自动保存验收分类')
  await wait(() => execute('return !document.querySelector(".notebook-content-list")?.innerText.includes("自动保存 P0 验收")'), 'note leaves previous category immediately')
  await clickText('.notebook-category-list button', '分类切换验收分类')
  await openNote('自动保存 P0 验收')
  await execute(`const select=document.querySelector('.notebook-category-control.compact select');select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));return true`)
  await wait(async () => !(await record(note.id)).notebookCategoryId, 'category clear persisted')
  await clickText('.notebook-filter-group button', '未整理')
  await wait(() => execute('return document.querySelector(".notebook-content-list")?.innerText.includes("自动保存 P0 验收")'), 'cleared category returns to unorganized')
  await openNote('自动保存 P0 验收')
  await execute(`const select=document.querySelector('.notebook-category-control.compact select');select.value=arguments[0];select.dispatchEvent(new Event('change',{bubbles:true}));return true`, [category.id])
  await wait(async () => (await record(note.id)).notebookCategoryId === category.id, 'category restored for restart coverage')
  await clickText('.notebook-category-list button', '自动保存验收分类')
  await openNote('自动保存 P0 验收')
  const switchContent = '切换笔记前输入：' + '丙'.repeat(340)
  await editBody(switchContent)
  await openNote('切换目标笔记')
  await wait(async () => (await record(note.id)).content === switchContent, 'note switch flushed latest body')

  await openNote('自动保存 P0 验收')
  const recoveredContent = '强杀恢复：' + '丁'.repeat(380)
  await editBody(recoveredContent)
  app.kill('SIGKILL'); sessionId = ''; await pause(500)
  await launch()
  await clickText('.sidebar .quick-capture', '收纳箱')
  await clickText('.notebook-category-list button', '自动保存验收分类')
  await openNote('自动保存 P0 验收')
  await wait(() => execute('return document.querySelector(".notebook-rich-editor")?.innerText===arguments[0]', [recoveredContent]), 'crash recovery restored editor')
  await wait(async () => (await record(note.id)).content === recoveredContent, 'recovered draft promoted to database')

  const outbox = await invoke('list_sync_outbox', { limit: 1000 })
  const noteUpdates = outbox.filter((item) => item.entityType === 'notes' && item.entityId === note.id && item.operation === 'UPDATE')
  if (noteUpdates.length !== 1) throw new Error(`Expected one coalesced note UPDATE, got ${noteUpdates.length}`)
  console.log(JSON.stringify({ status: 'passed', noteId: note.id, checks: ['600ms idle autosave', 'category flush preserves 300+ chars', 'categorized note leaves unorganized', 'category switch removes old membership', 'category clear returns to unorganized', 'note switch flush', 'SIGKILL recovery', 'recovery promoted to SQLite', 'one pending note UPDATE'] }))
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) }))
  process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app?.kill('SIGTERM')
  await pause(300)
  if (!process.exitCode) await rm(dataDir, { recursive: true, force: true })
}
