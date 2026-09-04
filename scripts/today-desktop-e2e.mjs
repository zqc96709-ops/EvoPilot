import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/jason-os')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-today-e2e-'))
const screenshotPath = resolve('artifacts/today-cockpit-e2e.png')
const port = String(5000 + Math.floor(Math.random() * 200))
const log = []
const frontend = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
frontend.stdout.on('data', (chunk) => log.push(chunk.toString()))
frontend.stderr.on('data', (chunk) => log.push(chunk.toString()))
let app
const endpoint = `http://127.0.0.1:${port}`
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const request = async (path, body) => { const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response.json() }
const wait = async (check, label) => { const deadline = Date.now() + 15000; while (Date.now() < deadline) { try { const value = await check(); if (value) return value } catch {} await pause(120) } throw new Error(`Timed out: ${label}`) }
let sessionId = ''
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const executeAsync = (script, args = []) => request(`/session/${sessionId}/execute/async`, { script, args }).then((result) => result.value)
const click = (selector, text) => execute(`const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.includes(${JSON.stringify(text)}));if(!node)throw new Error('Missing '+${JSON.stringify(text)}+' in '+${JSON.stringify(selector)});node.click();return true`)
const selectOption = (selector, value) => execute(`const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('Missing select '+${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('change',{bubbles:true}));return node.value`)
const save = async (entity, data) => { const result = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('save_record',{entity:arguments[0],data:arguments[1]}).then(done).catch((error)=>done({__error:String(error)}))`, [entity, data]); if (result?.__error) throw new Error(result.__error); return result }
const day = new Date(); const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`; const stamp = `${key}T09:00:00`
const responseMs = {}
const responsive = async (label, action, check, limit = 500) => { const started = Date.now(); await action(); await wait(check, label); const elapsed = Date.now() - started; if (elapsed > limit) throw new Error(`${label} response ${elapsed}ms exceeds ${limit}ms`); responseMs[label] = elapsed }

try {
  await wait(() => fetch('http://127.0.0.1:5174').then((response) => response.ok), 'Vite frontend')
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
  app.stdout.on('data', (chunk) => log.push(chunk.toString()))
  app.stderr.on('data', (chunk) => log.push(chunk.toString()))
  await wait(() => request('/status').then((result) => result.value?.ready), 'webdriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await pause(900)
  await wait(() => execute('return [...document.querySelectorAll(".sidebar nav button")].some((item)=>item.textContent.includes("今天"))'), 'sidebar navigation')
  const profile = await save('profiles', { title: '档案', name: 'Jason' })
  const project = await save('projects', { title: '美国 TikTok', status: 'active' })
  const openTask = await save('tasks', { title: '优化 TikTok 投放', projectId: project.id, dueDate: key, dueAt: stamp, priority: 'high', status: 'todo', estimateMinutes: 120 })
  await save('tasks', { title: '同步团队进展', projectId: project.id, dueDate: key, priority: 'medium', status: 'completed', estimateMinutes: 30 })
  await save('timeLogs', { title: '广告数据分析', projectId: project.id, taskId: openTask.id, startAt: stamp, durationMinutes: 75, category: '专注', status: 'completed' })
  await save('financialTransactions', { title: '广告支出', projectId: project.id, occurredAt: `${key}T10:00:00`, amountMinor: '268000', currency: 'CNY', baseCurrency: 'CNY', transactionType: 'EXPENSE', status: 'POSTED' })
  await save('results', { title: '完成投放优化', projectId: project.id, date: key, status: 'ACHIEVED', outcomeType: 'MILESTONE' })
  await save('reviews', { title: '今日复盘', projectId: project.id, periodStart: key, periodEnd: key })
  await save('notes', { title: '今日灵感', content: '下一轮测试要缩短反馈周期。', type: 'JOURNAL', status: 'ACTIVE' })
  await execute('document.querySelector("[aria-label=\\"刷新指挥中心\\"]")?.click();return true')
  await wait(() => execute('return document.querySelector(".ceo-command-center")?.innerText.includes("美国 TikTok")'), 'refreshed record state')
  await click('.sidebar nav button', '今天')
  await wait(() => execute('return Boolean(document.querySelector(".today-cockpit"))'), 'Today cockpit')
  await execute(`const input=document.querySelector('.today-date-controls input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(key)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return input.value`)
  await wait(() => execute(`return document.querySelector('.today-date-controls input')?.value===${JSON.stringify(key)} && document.querySelector('.today-tasks nav button')?.textContent.includes('(2)')`), 'selected-day aggregation')
  const text = await execute('return document.querySelector(".today-cockpit").innerText')
  for (const expected of ['今日核心目标', '今日关键任务', '今日时间投入', '今日专注时长', '今日支出', '今日成果', '今日时间分配', '今日日程安排', '今日任务清单', '今日关键成果', '今日复盘速览', '今日专注时间分布', '今日笔记']) if (!text.includes(expected)) throw new Error(`Missing Today area: ${expected}`)
  await selectOption('.today-left-column select', 'category')
  await wait(() => execute('return document.querySelector(".today-left-column select")?.value === "category" && document.querySelector(".today-allocation-content")?.innerText.includes("专注")'), 'allocation dropdown')
  await selectOption('.today-task-actions select', 'status')
  await wait(() => execute('return document.querySelector(".today-task-actions select")?.value === "status"'), 'task sort dropdown')
  await responsive('task filter', () => click('.today-tasks nav button', '已完成'), () => execute('return document.querySelector(".today-tasks nav button.active")?.textContent.includes("已完成")'), 100)
  await responsive('all task filter', () => click('.today-tasks nav button', '全部'), () => execute('return document.querySelector(".today-tasks nav button.active")?.textContent.includes("全部")'), 100)
  await responsive('focus mode', () => click('.today-mode-controls button', '专注模式'), () => execute('return document.querySelector(".today-cockpit")?.classList.contains("focus-mode")'), 100)
  await click('.today-mode-controls button', '专注模式')
  const before = await execute('return document.querySelector(".today-date-controls input").value')
  await responsive('previous day', () => click('.today-date-controls button', '‹'), () => execute('return document.querySelector(".today-date-controls input").value < arguments[0]', [before]), 500)
  const previous = await execute('return document.querySelector(".today-date-controls input").value')
  if (!(previous < before)) throw new Error('Previous-day control did not change the full dashboard date')
  await responsive('next day', () => click('.today-date-controls button', '›'), () => execute(`return document.querySelector(".today-date-controls input").value===${JSON.stringify(before)}`), 500)
  await click('.today-task-list article:not(.done) .today-task-check', '')
  await wait(() => execute('return document.querySelector(".today-tasks nav button")?.textContent.includes("全部") && document.querySelectorAll(".today-task-list article.done").length===2'), 'task completion')
  await click('.today-task-list article.done .today-task-check', '')
  await wait(() => execute('return document.querySelectorAll(".today-task-list article.done").length===1'), 'task restore')
  await click('.today-task-list article:not(.done) .today-task-start', '')
  await wait(() => execute('return Boolean(document.querySelector(".timer-start-modal"))'), 'timer start form')
  await click('.timer-start-modal footer button', '开始计时')
  await wait(() => execute('return Boolean(document.querySelector(".today-running"))'), 'running timer state')
  await click('.today-running', '停止并记录')
  await wait(() => execute('return !document.querySelector(".today-running")'), 'stopped timer state')
  for (const [selector, label] of [
    ['.today-add-task', 'task creation'],
    ['.today-kpi-grid button:nth-child(6)', 'result creation'],
    ['.today-review header button', 'review creation'],
    ['.today-notes header button', 'quick note creation'],
  ]) {
    await click(selector, '')
    await wait(() => execute('return Boolean(document.querySelector(".record-modal"))'), label)
    await click('.record-modal header button', '')
    await wait(() => execute('return !document.querySelector(".record-modal")'), `${label} close`)
  }
  const screenshot = await request(`/session/${sessionId}/screenshot`)
  await mkdir(dirname(screenshotPath), { recursive: true })
  await writeFile(screenshotPath, Buffer.from(screenshot.value, 'base64'))
  console.log(JSON.stringify({ status: 'passed', profileId: profile.id, screenshotPath, responseMs, checks: ['existing-record aggregation', 'six KPIs', 'three-column layout', 'allocation and task-sort dropdowns', 'task filter', 'focus mode', 'date navigation', 'task complete and restore', 'timer start and stop', 'task result review note entry points', 'desktop screenshot'] }))
} catch (error) {
  const body = sessionId ? await execute('return document.documentElement.outerHTML').catch(() => '') : ''
  await writeFile(join(dataDir, 'failure.log'), `${String(error)}\n\n${body}\n\n${log.join('')}`)
  console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) }))
  process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app?.kill('SIGTERM'); await pause(500)
  frontend.kill('SIGTERM')
  if (!process.exitCode) await rm(dataDir, { recursive: true, force: true })
}
