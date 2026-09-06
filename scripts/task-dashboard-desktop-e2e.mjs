import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

// Release embeds this repository's dist. Debug follows devUrl and can show an
// unrelated project already running on localhost:5173.
const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/release/bundle/macos/Jason OS.app/Contents/MacOS/jason-os')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-task-dashboard-e2e-'))
const screenshotPath = resolve('artifacts/task-dashboard-current.png')
const port = String(5400 + Math.floor(Math.random() * 200))
const endpoint = `http://127.0.0.1:${port}`
const log = []
let app
let sessionId = ''
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const request = async (path, body, method = body ? 'POST' : 'GET') => {
  const response = await fetch(endpoint + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response.json()
}
const wait = async (check, label) => { const deadline = Date.now() + 20_000; while (Date.now() < deadline) { try { const value = await check(); if (value) return value } catch {} await pause(120) } throw new Error(`Timed out: ${label}`) }
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const executeAsync = (script, args = []) => request(`/session/${sessionId}/execute/async`, { script, args }).then((result) => result.value)
const save = async (entity, data) => {
  const result = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('save_record',{entity:arguments[0],data:arguments[1]}).then(done).catch((error)=>done({__error:String(error)}))`, [entity, data])
  if (result?.__error) throw new Error(result.__error)
  return result
}
const click = (selector, text) => execute(`const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.includes(${JSON.stringify(text)}));if(!node)throw new Error('Missing '+${JSON.stringify(text)}+' in '+${JSON.stringify(selector)});node.click();return true`)
const isoAgo = (days) => { const date = new Date(); date.setDate(date.getDate() - days); return date.toISOString() }
const dateAgo = (days) => isoAgo(days).slice(0, 10)
const responseMs = {}
const responsive = async (label, action, check, limit = 500) => { const started = Date.now(); await action(); await wait(check, label); const elapsed = Date.now() - started; if (elapsed > limit) throw new Error(`${label} response ${elapsed}ms exceeds ${limit}ms`); responseMs[label] = elapsed }

try {
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
  app.stdout.on('data', (chunk) => log.push(chunk.toString()))
  app.stderr.on('data', (chunk) => log.push(chunk.toString()))
  await wait(() => request('/status').then((result) => result.value?.ready), 'webdriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await request(`/session/${sessionId}/window/rect`, { width: 1536, height: 1024 }, 'POST').catch(() => undefined)
  await pause(900)
  await wait(() => execute('return [...document.querySelectorAll(".sidebar nav button")].some((item)=>item.textContent.includes("任务"))'), 'sidebar navigation')

  const goal = await save('goals', { title: '增长目标', status: 'active' })
  const projects = await Promise.all(['美国 TikTok', 'Jason OS', '实木床直播', '内容矩阵', '个人成长'].map((title, index) => save('projects', { title, status: 'active', goalId: index < 3 ? goal.id : '' })))
  const sizes = [14, 10, 8, 6, 4]
  let ordinal = 0
  for (let projectIndex = 0; projectIndex < sizes.length; projectIndex += 1) for (let index = 0; index < sizes[projectIndex]; index += 1) {
    const isBlocked = ordinal < 6
    const isOverdue = ordinal < 4
    const isDirectGoal = projectIndex === 3 && index < 2
    await save('tasks', { title: `${projects[projectIndex].title} 执行任务 ${index + 1}`, projectId: projects[projectIndex].id, goalId: isDirectGoal ? goal.id : '', priority: ordinal < 5 || projectIndex === 4 && index === 0 ? 'high' : 'medium', status: isBlocked ? 'blocked' : 'todo', dueDate: isOverdue ? dateAgo(3) : dateAgo(-7), blockedSince: isBlocked ? isoAgo(5) : '', createdAt: isoAgo((ordinal % 28) + 1) })
    ordinal += 1
  }
  for (let index = 0; index < 54; index += 1) await save('tasks', { title: `已完成历史任务 ${index + 1}`, status: 'completed', priority: 'medium', createdAt: isoAgo(index < 26 ? index + 1 : index + 35), completedAt: isoAgo(index % 30) })
  await save('timeLogs', { title: '美国 TikTok 执行证据', projectId: projects[0].id, startAt: isoAgo(1), durationMinutes: 90 })
  await save('decisions', { title: '扩大广告投放', status: 'decided' })
  await execute('location.reload();return true')
  await wait(() => execute('return [...document.querySelectorAll(".sidebar nav button")].some((item)=>item.textContent.includes("任务"))'), 'reloaded Jason OS')
  await click('.sidebar nav button', '任务')
  await wait(() => execute('return Boolean(document.querySelector(".task-execution-dashboard"))'), 'task dashboard overview')
  const dashboardText = await execute('return document.querySelector(".task-execution-dashboard").innerText')
  for (const expected of ['活跃任务 / WIP', '关键逾期', '阻塞任务', '目标一致率', '新增任务 vs 完成任务趋势', '任务老化分布', '各项目执行负载', 'Execution Attention']) if (!dashboardText.includes(expected)) throw new Error(`Missing dashboard area: ${expected}`)
  if (!dashboardText.includes('42') || !dashboardText.includes('68') || !dashboardText.includes('54')) throw new Error(`Fixture totals are not rendered: ${dashboardText}`)
  await responsive('period change', () => execute(`const node=document.querySelector('.task-period-select select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(node,'7d');node.dispatchEvent(new Event('change',{bubbles:true}));return node.value`), () => execute('return document.querySelector(".task-period-select select")?.value === "7d"'))
  for (const [label, selector] of [['列表', '.work-panel'], ['看板', '.kanban'], ['四象限', '.task-matrix'], ['日历', '.task-calendar-v2']] ) {
    await responsive(`switch ${label}`, () => click('.task-view-tabs button', label), () => execute(`return Boolean(document.querySelector(${JSON.stringify(selector)}))`))
  }
  await responsive('return overview', () => click('.task-view-tabs button', '总览'), () => execute('return Boolean(document.querySelector(".task-execution-dashboard"))'))
  await click('.page-heading .primary', '新建任务')
  await wait(() => execute('return Boolean(document.querySelector(".record-modal"))'), 'new task modal')
  await execute(`const input=document.querySelector('.record-modal input[type="text"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'真实 UI 新建任务');input.dispatchEvent(new Event('input',{bubbles:true}));return input.value`)
  await click('.record-modal footer .primary', '保存到本机')
  await wait(() => execute('return !document.querySelector(".record-modal") && document.querySelector(".task-kpi strong")?.textContent === "43"'), 'new task updates dashboard')
  const screenshot = await request(`/session/${sessionId}/screenshot`)
  await mkdir(dirname(screenshotPath), { recursive: true })
  await writeFile(screenshotPath, Buffer.from(screenshot.value, 'base64'))
  console.log(JSON.stringify({ status: 'passed', screenshotPath, responseMs, checks: ['real task dashboard fixture', 'period change', 'all five task views', 'UI task creation updates WIP', '1536 desktop screenshot'] }))
} catch (error) {
  const body = sessionId ? await execute('return document.documentElement.outerHTML').catch(() => '') : ''
  await writeFile(join(dataDir, 'failure.log'), `${String(error)}\n\n${body}\n\n${log.join('')}`)
  console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) }))
  process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app?.kill('SIGTERM'); await pause(500)
  if (!process.exitCode) await rm(dataDir, { recursive: true, force: true })
}
