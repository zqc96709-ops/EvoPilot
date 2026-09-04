import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/jason-os')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-time-e2e-'))
const screenshotPath = resolve('artifacts/time-intelligence-e2e.png')
const port = String(5200 + Math.floor(Math.random() * 150))
const logs = []
const frontend = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
frontend.stdout.on('data', (chunk) => logs.push(chunk.toString())); frontend.stderr.on('data', (chunk) => logs.push(chunk.toString()))
let app; let sessionId = ''
const endpoint = `http://127.0.0.1:${port}`
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const request = async (path, body) => { const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response.json() }
const wait = async (check, label) => { const deadline = Date.now() + 15000; while (Date.now() < deadline) { try { const value = await check(); if (value) return value } catch {} await pause(100) } throw new Error(`Timed out: ${label}`) }
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const executeAsync = (script, args = []) => request(`/session/${sessionId}/execute/async`, { script, args }).then((result) => result.value)
const click = (selector, text = '') => execute(`const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.includes(${JSON.stringify(text)}));if(!node)throw new Error('Missing '+${JSON.stringify(text)}+' in '+${JSON.stringify(selector)});node.click();return true`)
const save = async (entity, data) => { const result = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('save_record',{entity:arguments[0],data:arguments[1]}).then(done).catch((error)=>done({__error:String(error)}))`, [entity, data]); if (result?.__error) throw new Error(result.__error); return result }
const localKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

try {
  await wait(() => fetch('http://127.0.0.1:5174').then((response) => response.ok), 'Vite frontend')
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
  app.stdout.on('data', (chunk) => logs.push(chunk.toString())); app.stderr.on('data', (chunk) => logs.push(chunk.toString()))
  await wait(() => request('/status').then((result) => result.value?.ready), 'webdriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await wait(() => execute('return [...document.querySelectorAll(".sidebar nav button")].some((item)=>item.textContent.includes("时间"))'), 'sidebar')
  await click('.sidebar nav button', '时间')
  await wait(() => execute('return Boolean(document.querySelector(".time-intelligence"))'), 'empty time dashboard')
  const empty = await execute('return document.querySelector(".time-intelligence").innerText')
  if (!empty.includes('开始记录时间后')) throw new Error('Missing empty-state guidance')

  const goal = await save('goals', { title: '增长目标', status: 'active' })
  const project = await save('projects', { title: '美国 TikTok', goalId: goal.id, status: 'active' })
  const task = await save('tasks', { title: '投放优化', projectId: project.id, status: 'todo' })
  const now = new Date()
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(now); date.setDate(now.getDate() - index)
    const key = localKey(date)
    await save('timeLogs', { title: `深度分析 ${index + 1}`, taskId: task.id, startAt: `${key}T09:00:00`, durationMinutes: 80 + index * 10, plannedMinutes: 90, category: '项目', workMode: 'DEEP_WORK', status: 'completed' })
    await save('timeLogs', { title: `团队会议 ${index + 1}`, projectId: project.id, startAt: `${key}T14:00:00`, durationMinutes: 35, plannedMinutes: 30, category: '会议', workMode: 'MEETING', status: 'completed' })
  }
  await save('timeLogs', { title: '未关联整理', startAt: `${localKey(now)}T18:00:00`, durationMinutes: 45, category: '杂项', workMode: 'NORMAL', status: 'completed' })
  await click('.sidebar nav button', '指挥中心')
  await wait(() => execute('return Boolean(document.querySelector("[aria-label=\\"刷新指挥中心\\"]"))'), 'command center refresh')
  await execute('document.querySelector("[aria-label=\\"刷新指挥中心\\"]").click();return true')
  await wait(() => execute('return document.querySelector(".ceo-command-center")?.innerText.includes("美国 TikTok")'), 'record refresh')
  await click('.sidebar nav button', '时间')
  await wait(() => execute('return document.querySelector(".time-intelligence")?.innerText.includes("美国 TikTok")'), 'dashboard refresh')
  const text = await execute('return document.querySelector(".time-intelligence").innerText')
  for (const expected of ['总投入时间', '目标一致时间', '项目时间', '深度工作时间', '计划 / 实际', '时间花费结构', '各项目时间投入', '近7天时间趋势', '计划 vs 实际', '时间热力图', '最耗时项目 / 任务', '时间效率信号', '未关联时间']) if (!text.includes(expected)) throw new Error(`Missing Time area: ${expected}`)

  await click('.ti-kpi', '总投入时间'); await wait(() => execute('return Boolean(document.querySelector(".ti-drilldown"))'), 'KPI drilldown'); await click('.ti-drilldown footer button', '完成')
  await click('.ti-legend button', '项目'); await wait(() => execute('return Boolean(document.querySelector(".ti-drilldown"))'), 'category drilldown'); await click('.ti-drilldown footer button', '完成')
  await click('.ti-heat-row button'); await wait(() => execute('return Boolean(document.querySelector(".ti-drilldown"))'), 'heatmap drilldown'); await click('.ti-drilldown footer button', '完成')
  await click('.ti-unlinked footer button', '去关联'); await wait(() => execute('return Boolean(document.querySelector(".ti-drilldown"))'), 'unlinked drilldown'); await click('.ti-drilldown article > button:last-child', '关联 / 编辑'); await wait(() => execute('return Boolean(document.querySelector(".record-modal"))'), 'unlinked relation form'); await click('.record-modal header button'); await click('.ti-drilldown footer button', '完成')
  await click('.ti-header button', '手动记录'); await wait(() => execute('return Boolean(document.querySelector(".record-modal"))'), 'manual record form'); await click('.record-modal header button')
  await click('.ti-header button', '计划时间'); await wait(() => execute('return Boolean(document.querySelector(".record-modal"))'), 'planned record form'); await click('.record-modal header button')
  await click('.ti-header button', '开始计时'); await wait(() => execute('return Boolean(document.querySelector(".timer-start-modal"))'), 'timer form'); await click('.timer-start-modal footer button', '开始计时'); await wait(() => execute('return [...document.querySelectorAll(".ti-header button")].some((item)=>item.textContent.includes("停止计时"))'), 'timer running'); await click('.ti-header button', '停止计时'); await wait(() => execute('return [...document.querySelectorAll(".ti-header button")].some((item)=>item.textContent.includes("开始计时"))'), 'timer stopped')

  const screenshot = await request(`/session/${sessionId}/screenshot`)
  await mkdir(dirname(screenshotPath), { recursive: true }); await writeFile(screenshotPath, Buffer.from(screenshot.value, 'base64'))
  console.log(JSON.stringify({ status: 'passed', screenshotPath, checks: ['empty state', 'real record aggregation', 'dashboard modules', 'KPI/category/heatmap/unlinked drilldowns', 'relation form', 'manual and planned forms', 'timer start/stop'] }))
} catch (error) {
  await writeFile(join(dataDir, 'failure.log'), `${String(error)}\n\n${logs.join('')}`)
  console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) })); process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app?.kill('SIGTERM'); await pause(400); frontend.kill('SIGTERM')
  if (!process.exitCode) await rm(dataDir, { recursive: true, force: true })
}
