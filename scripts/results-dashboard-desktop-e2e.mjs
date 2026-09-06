import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

// Release-only: a debug Tauri binary can load an unrelated dev server.
const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/evopolit')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-results-dashboard-e2e-'))
const screenshotPath = resolve('artifacts/results-dashboard-1536x1024.png')
const port = String(5800 + Math.floor(Math.random() * 100))
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
const isoAgo = (days) => { const point = new Date(); point.setDate(point.getDate() - days); return point.toISOString() }
const dateAgo = (days) => isoAgo(days).slice(0, 10)
const responseMs = {}
const responsive = async (label, action, check, limit = 500) => { const started = Date.now(); await action(); await wait(check, label); const elapsed = Date.now() - started; if (elapsed > limit) throw new Error(`${label} response ${elapsed}ms exceeds ${limit}ms`); responseMs[label] = elapsed }

try {
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
  app.stdout.on('data', (chunk) => log.push(chunk.toString())); app.stderr.on('data', (chunk) => log.push(chunk.toString()))
  await wait(() => request('/status').then((result) => result.value?.ready), 'webdriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  // Tauri reports Retina pixels to WebDriver: 3072×2048 produces the required
  // 1536×1024 CSS desktop viewport instead of a cropped 768px layout.
  await request(`/session/${sessionId}/window/rect`, { width: 3072, height: 2048 }, 'POST').catch(() => undefined)
  await pause(900)
  const projects = await Promise.all(['AI 产品平台', '海外市场拓展', '企业效率提升', '内容平台升级', '组织与人才建设', '其他项目'].map((title) => save('projects', { title, status: 'active' })))
  const results = []
  for (let index = 0; index < 48; index += 1) {
    const isFailure = index >= 42
    const result = await save('results', { title: `验收成果 ${index + 1}`, projectId: projects[index % projects.length].id, date: dateAgo(index % 28), status: isFailure ? 'FAILED' : 'SUCCESS', outcomeType: index < 34 ? 'MILESTONE' : 'QUANTITATIVE', evidenceStatus: index < 32 ? 'VERIFIED' : 'RECORDED', validatedAt: index < 32 ? isoAgo(index % 20) : '', valueClassification: index < 12 ? 'HIGH' : 'UNASSESSED', cycleStartedAt: index < 32 ? isoAgo((index % 12) + 4) : '', deliveredAt: !isFailure ? isoAgo(index % 20) : '', nextAction: index < 12 ? '沉淀为可复用模板' : '', failureReason: isFailure ? '已记录的真实失败原因' : '' })
    results.push(result)
  }
  for (let index = 0; index < 23; index += 1) await save('deliverables', { title: `正式资产 ${index + 1}`, projectId: projects[index % projects.length].id, resultId: results[index].id, status: 'FINAL', assetType: 'TEMPLATE', finalizedAt: isoAgo(index % 16) })
  await execute('location.reload();return true')
  await wait(() => execute('return [...document.querySelectorAll(".sidebar nav button")].some((item)=>item.textContent.includes("成果"))'), 'reloaded Jason OS')
  await click('.sidebar nav button', '成果')
  await wait(() => execute('return Boolean(document.querySelector(".results-intelligence"))'), 'results dashboard overview')
  const dashboardText = await execute('return document.querySelector(".results-intelligence").innerText')
  for (const expected of ['本期成果总数', '已验证成果', '高价值成果', '失败 / 无效成果', '成果资产化率', '平均产出周期', '成果产出趋势', '各项目成果贡献', '成果沉淀路径', '高价值成果清单', '失败 / 无效成果复盘', '可复用资产', '需 CEO 关注']) if (!dashboardText.includes(expected)) throw new Error(`Missing dashboard area: ${expected}`)
  for (const expected of ['48', '32', '12', '6', '68%']) if (!dashboardText.includes(expected)) throw new Error(`Fixture metric not rendered: ${expected}`)
  await responsive('period change', () => execute(`const node=document.querySelector('.ri-head select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(node,'7d');node.dispatchEvent(new Event('change',{bubbles:true}));return node.value`), () => execute('return document.querySelector(".ri-head select")?.value === "7d"'))
  await responsive('show all high value', () => click('.ri-table header button', '查看全部'), () => execute('return [...document.querySelectorAll(".ri-table header button")].some((item)=>item.textContent.includes("收起"))'))
  await responsive('result drilldown', () => execute('document.querySelector(".ri-table>div>button")?.click();return true'), () => execute('return Boolean(document.querySelector(".record-drawer"))'))
  await click('.record-drawer header button', '×')
  await responsive('return to 30 day period', () => execute(`const node=document.querySelector('.ri-head select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(node,'30d');node.dispatchEvent(new Event('change',{bubbles:true}));return node.value`), () => execute('return document.querySelector(".ri-head select")?.value === "30d"'))
  await click('.ri-head .primary', '新建结果')
  await wait(() => execute('return Boolean(document.querySelector(".record-modal"))'), 'new result modal')
  await execute(`const input=document.querySelector('.record-modal input[type="text"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'真实 UI 新建结果');input.dispatchEvent(new Event('input',{bubbles:true}));return input.value`)
  await click('.record-modal footer .primary', '保存到本机')
  await wait(() => execute('return !document.querySelector(".record-modal") && document.querySelector(".ri-kpis article strong")?.textContent === "49"'), 'new result updates dashboard')
  const viewport = await execute('return { innerWidth, innerHeight, devicePixelRatio, main:document.querySelector(".main-content").getBoundingClientRect().toJSON(), dashboard:document.querySelector(".results-intelligence").getBoundingClientRect().toJSON(), kpis:document.querySelector(".ri-kpis").getBoundingClientRect().toJSON(), columns:getComputedStyle(document.querySelector(".ri-kpis")).gridTemplateColumns }')
  if (viewport.innerWidth < 1500 || viewport.columns.split(' ').length !== 6) throw new Error(`Expected a 1536px CSS six-KPI desktop layout: ${JSON.stringify(viewport)}`)
  const screenshot = await request(`/session/${sessionId}/screenshot`)
  await mkdir(dirname(screenshotPath), { recursive: true }); await writeFile(screenshotPath, Buffer.from(screenshot.value, 'base64'))
  console.log(JSON.stringify({ status: 'passed', screenshotPath, viewport, responseMs, checks: ['release Results dashboard fixture', 'six KPI values', 'period interaction', 'high-value expand', 'Result drilldown', 'real UI Result create updates dashboard', '1536 CSS desktop screenshot'] }))
} catch (error) {
  const body = sessionId ? await execute('return document.documentElement.outerHTML').catch(() => '') : ''
  await writeFile(join(dataDir, 'failure.log'), `${String(error)}\n\n${body}\n\n${log.join('')}`)
  console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) })); process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app?.kill('SIGTERM'); await pause(500); if (!process.exitCode) await rm(dataDir, { recursive: true, force: true })
}
