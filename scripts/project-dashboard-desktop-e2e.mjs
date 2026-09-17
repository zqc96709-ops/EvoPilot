import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

// Release embeds this repository's dist. Debug follows devUrl and can show an
// unrelated project already running on localhost:5173.
const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/evopolit')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-project-dashboard-e2e-'))
const screenshotPath = resolve('artifacts/project-dashboard-current.png')
const port = String(5600 + Math.floor(Math.random() * 200))
const endpoint = `http://127.0.0.1:${port}`
const log = []
let app
let sessionId = ''
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const request = async (path, body, method = body ? 'POST' : 'GET') => { const response = await fetch(endpoint + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response.json() }
const wait = async (check, label) => { const deadline = Date.now() + 20_000; while (Date.now() < deadline) { try { const value = await check(); if (value) return value } catch {} await pause(120) } throw new Error(`Timed out: ${label}`) }
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const executeAsync = (script, args = []) => request(`/session/${sessionId}/execute/async`, { script, args }).then((result) => result.value)
const save = async (entity, data) => { const result = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('save_record',{entity:arguments[0],data:arguments[1]}).then(done).catch((error)=>done({__error:String(error)}))`, [entity, data]); if (result?.__error) throw new Error(result.__error); return result }
const click = (selector, text) => execute(`const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.includes(${JSON.stringify(text)}));if(!node)throw new Error('Missing '+${JSON.stringify(text)}+' in '+${JSON.stringify(selector)});node.click();return true`)
const isoAgo = (days) => { const date = new Date(); date.setDate(date.getDate() - days); return date.toISOString() }
const dateAgo = (days) => isoAgo(days).slice(0, 10)
const responseMs = {}
const responsive = async (label, action, check, limit = 500) => { const started = Date.now(); await action(); await wait(check, label); const elapsed = Date.now() - started; if (elapsed > limit) throw new Error(`${label} response ${elapsed}ms exceeds ${limit}ms`); responseMs[label] = elapsed }

try {
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
  app.stdout.on('data', (chunk) => log.push(chunk.toString())); app.stderr.on('data', (chunk) => log.push(chunk.toString()))
  await wait(() => request('/status').then((result) => result.value?.ready), 'webdriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await request(`/session/${sessionId}/window/rect`, { width: 1536, height: 1024 }, 'POST').catch(() => undefined)
  await pause(900)
  await wait(() => execute('return [...document.querySelectorAll(".sidebar nav button")].some((item)=>item.textContent.includes("项目"))'), 'sidebar navigation')

  const goal = await save('goals', { title: '项目目标', status: 'active' })
  const names = ['美国 TikTok', 'Jason OS', '内容矩阵', '日本市场', '个人成长', '风险项目']
  const projects = await Promise.all(names.map((title, index) => save('projects', { title, status: index === 5 ? 'blocked' : 'active', health: index === 4 ? 'at_risk' : index === 5 ? 'blocked' : 'healthy', goalId: index < 4 ? goal.id : '', priority: index < 3 ? 'high' : 'medium', progress: 20 + index * 10, blockers: index === 5 ? '关键供应商未确认' : '', nextAction: index === 3 ? '' : `推进 ${title} 下一步`, createdAt: isoAgo(index + 2) })))
  for (let index = 0; index < 25; index += 1) {
    const project = projects[index % projects.length]
    await save('projectMilestones', { title: `${project.title} 里程碑 ${index + 1}`, projectId: project.id, dueDate: dateAgo(index % 5), status: index < 17 ? 'completed' : 'planned', completedAt: index < 17 ? isoAgo(index % 5) : '', importance: index % 6 === 0 ? 'high' : 'medium' })
  }
  for (let index = 0; index < 8; index += 1) await save('results', { title: `真实 Outcome ${index + 1}`, projectId: projects[index % 4].id, date: dateAgo(index), status: 'SUCCESS' })
  for (let index = 0; index < 6; index += 1) await save('timeLogs', { title: `真实投入 ${index + 1}`, projectId: projects[index].id, startAt: isoAgo(index), durationMinutes: 60 * (index + 1) })
  await save('tasks', { title: '项目受阻任务', projectId: projects[5].id, status: 'blocked', priority: 'high', blockedSince: isoAgo(4) })
  await save('workflowRuns', { title: '美国 TikTok · 实际工作链', projectId: projects[0].id, status: 'RUNNING', startedAt: isoAgo(1) })
  await save('templateInstances', { title: '美国 TikTok · 复盘数据表', projectId: projects[0].id, instanceKind: 'TABLE', status: 'DRAFT', schemaSnapshot: JSON.stringify(['指标', '数值']), rowsData: JSON.stringify([{ 指标: 'GMV', 数值: '1000' }]) })
  const capabilityAsset = await save('capabilityAssets', { title: '项目检查清单', assetKind: 'CHECKLIST_TEMPLATE', status: 'DRAFT' })
  const capabilityVersion = await save('capabilityAssetVersions', { title: '项目检查清单 v1', capabilityAssetId: capabilityAsset.id, versionNumber: 'v1', status: 'ACTIVE', structuredData: '[]' })
  const capabilityPack = await save('capabilityPacks', { title: '项目执行能力包', status: 'DRAFT' })
  await save('capabilityPackItems', { title: '项目检查清单', packId: capabilityPack.id, capabilityAssetId: capabilityAsset.id, capabilityAssetVersionId: capabilityVersion.id, status: 'ACTIVE', orderIndex: 1 })
  const fixtureFile = await save('notebookFiles', { name: '项目资料.xlsx', originalName: '项目资料.xlsx', extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 1024, status: 'ACTIVE' })
  await save('deliverables', { title: '项目资料.xlsx', fileId: fixtureFile.id, projectId: projects[0].id, status: 'DRAFT', assetType: 'DATA', versionNumber: 'v1' })
  await execute('location.reload();return true')
  await wait(() => execute('return [...document.querySelectorAll(".sidebar nav button")].some((item)=>item.textContent.includes("项目"))'), 'reloaded Jason OS')
  await click('.sidebar nav button', '项目')
  await wait(() => execute('return Boolean(document.querySelector(".project-intelligence"))'), 'project dashboard overview')
  const dashboardText = await execute('return document.querySelector(".project-intelligence").innerText')
  for (const expected of ['活跃项目', '高风险项目', '项目进度', '实际投入', '结果产出', '目标对齐率', '项目健康分布', '项目生命周期漏斗', '焦点项目', '投入 vs 产出', '月度项目进度趋势', 'CEO Attention', '最近里程碑']) if (!dashboardText.includes(expected)) throw new Error(`Missing dashboard area: ${expected}`)
  if (!dashboardText.includes('6') || !dashboardText.includes('68%') || !dashboardText.includes('8')) throw new Error(`Fixture totals are not rendered: ${dashboardText}`)
  await responsive('period change', () => execute(`const node=document.querySelector('.project-period-select select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(node,'90d');node.dispatchEvent(new Event('change',{bubbles:true}));return node.value`), () => execute('return document.querySelector(".project-period-select select")?.value === "90d"'))
  await responsive('focus project drilldown', () => execute('document.querySelector(".project-focus-table button")?.click();return true'), () => execute('return Boolean(document.querySelector(".project-workbench"))'))
  const workbenchTabs = await execute('return [...document.querySelectorAll(".project-workbench .workspace-tabs button")].map((item)=>item.textContent.replace(/[0-9]+/g, "").trim())')
  if (JSON.stringify(workbenchTabs) !== JSON.stringify(['总览', '执行', '数据', '资料', '复盘'])) throw new Error(`Unexpected Project Workbench tabs: ${JSON.stringify(workbenchTabs)}`)
  await responsive('header quick capture open', () => click('.project-workbench-actions button', '快速记录'), () => execute('return Boolean(document.querySelector(".project-workbench-dialog .quick-operational-log"))'))
  await execute(`const input=document.querySelector('.project-workbench-dialog .quick-log-input textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'真实 UI 项目快速记录');input.dispatchEvent(new Event('input',{bubbles:true}));return input.value`)
  await responsive('header quick capture save', () => click('.project-workbench-dialog .quick-log-input .primary', '保存'), () => execute('return !document.querySelector(".project-workbench-dialog") && [...document.querySelectorAll(".compact-record")].some((item)=>item.textContent.includes("真实 UI 项目快速记录"))'))
  await responsive('capability picker open', () => click('.project-workbench-actions button', '调用能力'), () => execute('return document.querySelector(".project-capability-picker")?.innerText.includes("项目执行能力包")'))
  await responsive('capability quick use', () => click('.project-capability-picker .button', '应用'), () => execute('return !document.querySelector(".project-capability-picker")'))
  await responsive('project operating state edit', () => click('.operating-state .panel-header button', '更新状态'), () => execute('return Boolean(document.querySelector(".operating-state-form"))'))
  await execute(`const input=document.querySelector('.operating-state-form input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'增长验证');input.dispatchEvent(new Event('input',{bubbles:true}));return input.value`)
  await responsive('project operating state save', () => click('.operating-state-form .primary', '保存当前状态'), () => execute('return document.querySelector(".operating-state-grid")?.innerText.includes("增长验证")'))
  await responsive('execution tab', () => click('.project-workbench .workspace-tabs button', '执行'), () => execute('return Boolean(document.querySelector(".quick-operational-log"))'))
  await execute(`const input=document.querySelector('.quick-log-input textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'真实 UI 快速记录');input.dispatchEvent(new Event('input',{bubbles:true}));return input.value`)
  await responsive('quick operational log save', () => click('.quick-log-input .primary', '保存'), () => execute('return [...document.querySelectorAll(".operation-log-row")].some((item)=>item.textContent.includes("真实 UI 快速记录"))'))
  await responsive('data tab', () => click('.project-workbench .workspace-tabs button', '数据'), () => execute('return Boolean(document.querySelector(".project-table-editor"))'))
  await execute(`const input=document.querySelector('.project-table-editor tbody input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'GMV 更新');input.dispatchEvent(new Event('input',{bubbles:true}));return input.value`)
  await responsive('project table save', () => click('.project-table-editor .primary', '保存数据'), () => execute('return document.querySelector(".project-table-editor .primary")?.textContent.includes("保存数据")'))
  await responsive('materials tab', () => click('.project-workbench .workspace-tabs button', '资料'), () => execute('return document.querySelector(".material-list")?.innerText.includes("项目资料.xlsx")'))
  await responsive('review tab', () => click('.project-workbench .workspace-tabs button', '复盘'), () => execute('return Boolean(document.querySelector(".project-review"))'))
  await responsive('return dashboard', () => click('.project-workspace .back-link', '返回项目'), () => execute('return Boolean(document.querySelector(".project-intelligence"))'))
  await click('.page-heading .primary', '新建项目')
  await wait(() => execute('return Boolean(document.querySelector(".record-modal"))'), 'new project modal')
  await execute(`const input=document.querySelector('.record-modal input[type="text"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'真实 UI 新建项目');input.dispatchEvent(new Event('input',{bubbles:true}));return input.value`)
  await click('.record-modal footer .primary', '保存到本机')
  await wait(() => execute('return !document.querySelector(".record-modal") && document.querySelector(".project-kpi strong")?.textContent === "7"'), 'new project updates dashboard')
  const screenshot = await request(`/session/${sessionId}/screenshot`)
  await mkdir(dirname(screenshotPath), { recursive: true }); await writeFile(screenshotPath, Buffer.from(screenshot.value, 'base64'))
  console.log(JSON.stringify({ status: 'passed', screenshotPath, responseMs, checks: ['real project dashboard fixture', 'period change', 'five-tab project workbench', 'header quick capture', 'capability quick use', 'operating state save', 'operational quick capture', 'structured table save', 'materials link visibility', 'review tab', 'UI project creation updates dashboard', '1536 desktop screenshot'] }))
} catch (error) {
  const body = sessionId ? await execute('return document.documentElement.outerHTML').catch(() => '') : ''
  await writeFile(join(dataDir, 'failure.log'), `${String(error)}\n\n${body}\n\n${log.join('')}`)
  console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) })); process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app?.kill('SIGTERM'); await pause(500); if (!process.exitCode) await rm(dataDir, { recursive: true, force: true })
}
