import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/release/bundle/macos/Jason OS.app/Contents/MacOS/jason-os')
const repositoryFixtureCount = Number(process.env.JASON_OS_E2E_REPOSITORY_COUNT || 2000)
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-decision-dashboard-e2e-'))
const screenshotPath = resolve('artifacts/decision-dashboard-1536x1024.png')
const port = String(5900 + Math.floor(Math.random() * 90)); const endpoint = `http://127.0.0.1:${port}`; const log = []
let app; let sessionId = ''
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const request = async (path, body, method = body ? 'POST' : 'GET') => { const response = await fetch(endpoint + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response.json() }
const wait = async (check, label) => { const deadline = Date.now() + 20_000; while (Date.now() < deadline) { try { const value = await check(); if (value) return value } catch {} await pause(120) } throw new Error(`Timed out: ${label}`) }
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const executeAsync = (script, args = []) => request(`/session/${sessionId}/execute/async`, { script, args }).then((result) => result.value)
const save = async (entity, data) => { const result = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('save_record',{entity:arguments[0],data:arguments[1]}).then(done).catch((error)=>done({__error:String(error)}))`, [entity, data]); if (result?.__error) throw new Error(result.__error); return result }
const seedDecisionRepository = async (count) => {
  const result = await executeAsync(`const done=arguments[arguments.length-1];const count=arguments[0];let next=0;const save=(index)=>window.__TAURI_INTERNALS__.invoke('save_record',{entity:'decisions',data:{title:'Repository load decision '+index,problem:'真实 SQLite 决策日志负载验证',date:'2026-09-01',decisionAt:'2026-09-01T00:00:00.000Z',importance:index%2?'HIGH':'LOW',riskLevel:index%2?'MEDIUM':'LOW',choiceStatus:index%3?'PENDING':'DECIDED',validationStatus:'PENDING'}});const worker=async()=>{while(next<count){const index=next++;await save(index)}};Promise.all(Array.from({length:16},worker)).then(()=>done({ok:true})).catch((error)=>done({__error:String(error)}))`, [count]); if (result?.__error) throw new Error(result.__error)
}
const click = (selector, text) => execute(`const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.includes(${JSON.stringify(text)}));if(!node)throw new Error('Missing '+${JSON.stringify(text)}+' in '+${JSON.stringify(selector)});node.click();return true`)
const setField = (labelText, value, kind = 'input') => execute(`const label=[...document.querySelectorAll('.record-modal label')].find((item)=>item.querySelector('span')?.textContent.includes(arguments[0]));const node=label?.querySelector(arguments[2]);if(!node)throw new Error('Missing field '+arguments[0]);const setter=Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement?HTMLSelectElement.prototype:node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(node,arguments[1]);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));return node.value`, [labelText, value, kind])

try {
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
  app.stdout.on('data', (chunk) => log.push(chunk.toString())); app.stderr.on('data', (chunk) => log.push(chunk.toString()))
  await wait(() => request('/status').then((result) => result.value?.ready), 'webdriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await request(`/session/${sessionId}/window/rect`, { width: 3072, height: 2048 }, 'POST').catch(() => undefined); await pause(900)
  const isoAgo = (days) => { const point = new Date(); point.setDate(point.getDate() - days); return point.toISOString() }
  const supported = await save('decisions', { title: '已得到支持的市场决策', problem: '是否进入新市场', evidence: '已核验市场数据', assumptions: '目标客群存在', selectedOption: '小规模进入', date: isoAgo(20).slice(0, 10), decisionAt: isoAgo(20), importance: 'HIGH', riskLevel: 'HIGH', confidenceAtDecision: 80, evidenceAssessment: 'SUFFICIENT', successCriteria: '首月完成真实验证', choiceStatus: 'DECIDED', executionStatus: 'EXECUTED', executedAt: isoAgo(15), validationDueAt: isoAgo(3).slice(0, 10), validationStatus: 'SUPPORTED', validatedAt: isoAgo(2), status: 'validated' })
  await save('results', { title: '真实市场结果', decisionId: supported.id, status: 'SUCCESS', evidenceStatus: 'VERIFIED', date: isoAgo(3).slice(0, 10) })
  const contradicted = await save('decisions', { title: '被现实反驳的投放决策', problem: '是否扩大投放', selectedOption: '扩大投放', date: isoAgo(24).slice(0, 10), decisionAt: isoAgo(24), importance: 'HIGH', riskLevel: 'CRITICAL', confidenceAtDecision: 90, evidenceAssessment: 'MODERATE', successCriteria: '获客成本不增加', choiceStatus: 'DECIDED', executionStatus: 'EXECUTED', executedAt: isoAgo(18), validationStatus: 'CONTRADICTED', validatedAt: isoAgo(4), status: 'wrong' })
  await save('results', { title: '投放实际结果', decisionId: contradicted.id, status: 'FAILED', evidenceStatus: 'VERIFIED', date: isoAgo(5).slice(0, 10) })
  await save('reviews', { title: '投放错误假设复盘', decisionId: contradicted.id, decisionErrorClassification: 'WRONG_ASSUMPTION', whatFailed: '样本不具代表性' })
  await save('decisions', { title: '已逾期待校准决策', problem: '是否扩展渠道', selectedOption: '开始执行', date: isoAgo(18).slice(0, 10), decisionAt: isoAgo(18), importance: 'HIGH', riskLevel: 'HIGH', evidenceAssessment: 'INSUFFICIENT', choiceStatus: 'DECIDED', validationDueAt: isoAgo(9).slice(0, 10), validationStatus: 'PENDING' })
  await save('decisions', { title: '临近截止但尚未选择', problem: '是否做不可逆选择', date: isoAgo(2).slice(0, 10), importance: 'CRITICAL', riskLevel: 'HIGH', reversibility: 'IRREVERSIBLE', validationDueAt: isoAgo(1).slice(0, 10), choiceStatus: 'PENDING', validationStatus: 'PENDING' })
  await seedDecisionRepository(repositoryFixtureCount)
  await execute('location.reload();return true'); await wait(() => execute('return [...document.querySelectorAll(".sidebar nav button")].some((item)=>item.textContent.includes("决策中心"))'), 'reloaded Jason OS')
  await click('.sidebar nav button', '决策中心'); await wait(() => execute('return Boolean(document.querySelector(".decision-intelligence"))'), 'decision dashboard overview')
  if (await execute('return [...document.querySelectorAll(".sidebar nav button")].some((item)=>item.textContent.includes("决策日志"))')) throw new Error('Decision log must not remain a standalone sidebar entry')
  const dashboardText = await execute('return document.querySelector(".decision-intelligence").innerText')
  for (const expected of ['本期重要决策', '已验证决策', '待验证决策', '高风险决策', '决策命中率', '平均验证周期', '决策校准链路', '决策质量趋势', '关键决策列表', '待校准 / 待验证', '证据充分度分布', '误判 / 偏差复盘', '需 CEO 立即判断']) if (!dashboardText.includes(expected)) throw new Error(`Missing dashboard area: ${expected}`)
  for (const expected of ['3', '2', '1', '50%', '样本不具代表性']) if (!dashboardText.includes(expected)) throw new Error(`Fixture metric not rendered: ${expected}`)
  await click('.di-table header button', '查看全部'); await wait(() => execute('return [...document.querySelectorAll(".di-table header button")].some((item)=>item.textContent.includes("收起"))'), 'critical expand')
  await execute('document.querySelector(".di-table>div>button")?.click();return true'); await wait(() => execute('return Boolean(document.querySelector(".record-drawer"))'), 'decision drilldown'); await click('.record-drawer header button', '×')
  await execute(`const node=document.querySelector('.di-head select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(node,'90d');node.dispatchEvent(new Event('change',{bubbles:true}));return node.value`); await wait(() => execute('return document.querySelector(".di-head select")?.value === "90d"'), 'period change')
  await click('.di-head .primary', '新建决策'); await wait(() => execute('return Boolean(document.querySelector(".record-modal"))'), 'new decision modal')
  await setField('决策名称', '真实 UI 高风险决策'); await setField('问题', '是否进入新渠道', 'textarea'); await setField('重要性', 'HIGH', 'select'); await setField('风险等级', 'HIGH', 'select'); await setField('选择状态', 'DECIDED', 'select'); await setField('选择', '先做最小验证', 'textarea'); await setField('校准结论', 'PENDING', 'select')
  await click('.record-modal footer .primary', '保存到本机'); await wait(() => execute('return !document.querySelector(".record-modal") && document.querySelector(".decision-intelligence").innerText.includes("真实 UI 高风险决策")'), 'real UI new decision updates dashboard')
  await click('.decision-center-tabs button', '决策日志'); await wait(() => execute('return Boolean(document.querySelector(".decision-log-repository .decision-log-table"))'), 'decision repository tab')
  const repository = await execute('return {rows:document.querySelectorAll(".decision-log-table>button").length, text:document.querySelector(".decision-log-summary").innerText}')
  if (repository.rows !== Math.min(50, repositoryFixtureCount + 5) || !repository.text.includes(String(repositoryFixtureCount + 5))) throw new Error(`Expected SQLite repository pagination: ${JSON.stringify(repository)}`)
  await execute(`const node=document.querySelector('[aria-label="搜索决策日志"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(node,'Repository load decision '+arguments[0]);node.dispatchEvent(new Event('input',{bubbles:true}));return node.value`, [repositoryFixtureCount - 1])
  await wait(() => execute('return document.querySelectorAll(".decision-log-table>button").length === 1'), 'repository native search')
  await execute('document.querySelector(".decision-log-table>button")?.click();return true'); await wait(() => execute('return Boolean(document.querySelector(".record-drawer .decision-detail-lifecycle"))'), 'decision lifecycle detail')
  await click('.record-drawer header button', '×'); await execute('location.reload();return true'); await wait(() => execute('return document.querySelector(".decision-center-tabs button.active")?.textContent.includes("决策日志")'), 'persistent decision log tab')
  await click('.decision-center-tabs button', '总览'); await wait(() => execute('return Boolean(document.querySelector(".di-kpis"))'), 'return to overview')
  const overview = await execute('return {innerWidth,innerHeight,devicePixelRatio, dashboard:document.querySelector(".decision-intelligence").getBoundingClientRect().toJSON(), kpis:document.querySelector(".di-kpis").getBoundingClientRect().toJSON(), columns:getComputedStyle(document.querySelector(".di-kpis")).gridTemplateColumns}')
  if (overview.innerWidth < 1500 || overview.columns.split(' ').length !== 6) throw new Error(`Expected a 1536px CSS six-KPI desktop layout: ${JSON.stringify(overview)}`)
  const screenshot = await request(`/session/${sessionId}/screenshot`); await mkdir(dirname(screenshotPath), { recursive: true }); await writeFile(screenshotPath, Buffer.from(screenshot.value, 'base64'))
  console.log(JSON.stringify({ status: 'passed', screenshotPath, viewport: overview, checks: ['Decision dashboard fixture', 'single sidebar navigation', 'Decision log tab', '2K SQLite repository pagination', 'repository native search', 'decision lifecycle detail', 'persistent tab', 'six KPI values', 'period interaction', 'real UI Decision create updates dashboard', '1536 CSS desktop screenshot'] }))
} catch (error) {
  const body = sessionId ? await execute('return document.documentElement.outerHTML').catch(() => '') : ''; await writeFile(join(dataDir, 'failure.log'), `${String(error)}\n\n${body}\n\n${log.join('')}`); console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) })); process.exitCode = 1
} finally { if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined); app?.kill('SIGTERM'); await pause(500); if (!process.exitCode) await rm(dataDir, { recursive: true, force: true }) }
