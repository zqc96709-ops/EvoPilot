import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/jason-os')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-finance-e2e-'))
const screenshotPath = resolve('artifacts/finance-intelligence-e2e.png')
const port = String(5400 + Math.floor(Math.random() * 200))
const log = []
const frontend = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
frontend.stdout.on('data', (chunk) => log.push(chunk.toString()))
frontend.stderr.on('data', (chunk) => log.push(chunk.toString()))
let app
let sessionId = ''
const endpoint = `http://127.0.0.1:${port}`
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const request = async (path, body) => { const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response.json() }
const wait = async (check, label) => { const deadline = Date.now() + 15000; while (Date.now() < deadline) { try { const value = await check(); if (value) return value } catch {} await pause(120) } throw new Error(`Timed out: ${label}`) }
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const executeAsync = (script, args = []) => request(`/session/${sessionId}/execute/async`, { script, args }).then((result) => result.value)
const click = (selector, text) => execute(`const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.includes(${JSON.stringify(text)}));if(!node)throw new Error('Missing '+${JSON.stringify(text)}+' in '+${JSON.stringify(selector)});node.click();return true`)
const selectOption = (selector, value) => execute(`const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('Missing select '+${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));return node.value`)
const save = async (entity, data) => { const result = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('save_record',{entity:arguments[0],data:arguments[1]}).then(done).catch((error)=>done({__error:String(error)}))`, [entity, data]); if (result?.__error) throw new Error(result.__error); return result }
const responseMs = {}
const responsive = async (label, action, check, limit = 500) => { const started = Date.now(); await action(); await wait(check, label); const elapsed = Date.now() - started; if (elapsed > limit) throw new Error(`${label} response ${elapsed}ms exceeds ${limit}ms`); responseMs[label] = elapsed }
const transaction = (id, title, type, amount, projectId, categoryId, date, accountId = 'cash', destinationAccountId = '') => save('financialTransactions', { id, title, status: 'POSTED', transactionType: type, amountMinor: String(amount), baseAmountMinor: String(amount), currency: 'CNY', baseCurrency: 'CNY', projectId, categoryId, accountId, destinationAccountId, occurredAt: `${date}T12:00:00`, evidenceStatus: 'VERIFIED' })

try {
  await wait(() => fetch('http://127.0.0.1:5174').then((response) => response.ok), 'Vite frontend')
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
  app.stdout.on('data', (chunk) => log.push(chunk.toString()))
  app.stderr.on('data', (chunk) => log.push(chunk.toString()))
  await wait(() => request('/status').then((result) => result.value?.ready), 'WebDriver server')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await wait(() => execute('return [...document.querySelectorAll(".sidebar nav button")].some((item)=>item.textContent.includes("财务"))'), 'sidebar navigation')

  const cash = await save('financialAccounts', { name: '主账户', accountType: 'BANK', currency: 'CNY', openingBalanceMinor: '30000000', status: 'ACTIVE', evidenceStatus: 'VERIFIED' })
  const bank = await save('financialAccounts', { name: '备用账户', accountType: 'BANK', currency: 'CNY', openingBalanceMinor: '0', status: 'ACTIVE', evidenceStatus: 'VERIFIED' })
  const ads = await save('financialCategories', { name: '广告投放', direction: 'EXPENSE', status: 'ACTIVE' })
  const software = await save('financialCategories', { name: '软件 / API', direction: 'EXPENSE', status: 'ACTIVE' })
  const content = await save('financialCategories', { name: '内容制作', direction: 'EXPENSE', status: 'ACTIVE' })
  const growth = await save('projects', { title: '美国 TikTok 项目', health: 'healthy', stage: 'GROWTH', status: 'active' })
  const risk = await save('projects', { title: 'Project B', health: 'at_risk', stage: 'OPTIMIZATION', status: 'active' })
  const investment = await save('projects', { title: 'Jason OS', health: 'healthy', stage: 'INVESTMENT', status: 'active' })
  const months = ['2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10']
  for (let index = 0; index < months.length; index += 1) {
    await transaction(`income-${index}`, `TikTok 收入 ${index + 1}`, 'INCOME', 1200000 + index * 120000, growth.id, '', months[index], cash.id)
    await transaction(`ads-${index}`, `广告投入 ${index + 1}`, 'EXPENSE', 520000 + index * 20000, growth.id, ads.id, months[index], cash.id)
    await transaction(`software-${index}`, `软件成本 ${index + 1}`, 'EXPENSE', 100000 + index * 30000, '', software.id, months[index], cash.id)
  }
  const riskExpense = await transaction('risk-expense', 'Project B 高投入', 'EXPENSE', 1500000, risk.id, content.id, '2026-08-16', cash.id)
  await transaction('jason-expense', 'Jason OS 投资', 'EXPENSE', 900000, investment.id, software.id, '2026-08-18', cash.id)
  await transaction('transfer', '账户调拨', 'TRANSFER', 1000000, '', '', '2026-08-20', cash.id, bank.id)
  await save('financialTransactionAllocations', { transactionId: riskExpense.id, projectId: risk.id, amountMinor: '1200000', baseCurrency: 'CNY' })
  await save('financialBudgets', { title: 'Project B 内容预算', projectId: risk.id, categoryId: content.id, amountMinor: '1000000', baseCurrency: 'CNY', periodStart: '2026-08-01', periodEnd: '2026-08-31', status: 'ACTIVE' })
  await save('results', { title: 'TikTok Outcome', projectId: growth.id, achievementBps: '8600', evidenceStatus: 'VERIFIED', date: '2026-08-20' })
  await save('results', { title: 'Project B Outcome', projectId: risk.id, achievementBps: '3100', evidenceStatus: 'VERIFIED', date: '2026-08-20' })
  await save('results', { title: 'Jason OS Outcome', projectId: investment.id, achievementBps: '7100', evidenceStatus: 'VERIFIED', date: '2026-08-20' })
  await click('.sidebar nav button', '指挥中心')
  await execute('document.querySelector("[aria-label=\\"刷新指挥中心\\"]")?.click();return true')
  await wait(() => execute('return document.body.innerText.includes("美国 TikTok 项目")'), 'refreshed seeded records')
  await click('.sidebar nav button', '财务')
  await wait(() => execute('return Boolean(document.querySelector(".finance-intelligence"))'), 'finance intelligence dashboard')
  const text = await execute('return document.querySelector(".finance-intelligence").innerText')
  for (const expected of ['财务总览', '现金余额', '本期收入', '本期支出', '经营现金结果', '财务关注事项', '整体经营趋势', '趋势解读', '各项目收入 vs 支出', '项目资本配置组合', '资金去向', 'Financial Attention', '经营洞察 AI', '快速操作']) if (!text.includes(expected)) throw new Error(`Missing Finance area: ${expected}`)
  if (text.includes('毛利率') || text.includes('净利润')) throw new Error('Finance dashboard used forbidden accounting metric')
  await responsive('period dropdown', () => selectOption('.fi-controls select', '3m'), () => execute('return document.querySelector(".fi-overall header small")?.textContent.includes("3")'), 300)
  await responsive('more filters', () => click('.fi-icon-button', ''), () => execute('return Boolean(document.querySelector(".fi-filters"))'), 150)
  const selectedProject = await selectOption('.fi-filters select', risk.id)
  if (selectedProject !== risk.id) {
    const availableProjects = await execute('return [...document.querySelectorAll(".fi-filters select")[0].options].map((option) => ({ value: option.value, text: option.textContent }))')
    throw new Error(`project filter selection returned ${selectedProject}; available=${JSON.stringify(availableProjects)}`)
  }
  await wait(() => execute(`return document.querySelector(".fi-filters select")?.value === ${JSON.stringify(risk.id)}`), 'project filter')
  await click('.fi-filters button', '清除筛选')
  await responsive('expense KPI drill-down', () => click('.fi-kpis button', '本期支出'), () => execute('return document.querySelector(".finance-tabs .active")?.textContent.trim()==="流水"'), 300)
  await wait(() => execute('return document.querySelector(".finance-transaction-list")?.innerText.includes("广告投入")'), 'expense transaction filter')
  await click('.finance-tabs button', '总览')
  await wait(() => execute('return Boolean(document.querySelector(".finance-intelligence"))'), 'return finance dashboard')
  await responsive('trend point drill-down', () => execute('document.querySelector(".fi-trend-point")?.dispatchEvent(new MouseEvent("click",{bubbles:true}));return true'), () => execute('return document.querySelector(".finance-tabs .active")?.textContent.trim()==="流水"'), 300)
  await click('.finance-tabs button', '总览')
  await wait(() => execute('return Boolean(document.querySelector(".finance-intelligence"))'), 'return after trend drill-down')
  await responsive('project drill-down', () => execute('[...document.querySelectorAll(".fi-project-bars button")].find((item)=>item.textContent.includes("Project B"))?.click();return true'), () => execute('return document.body.innerText.includes("Project B") && !document.querySelector(".finance-intelligence")'), 400)
  await click('.sidebar nav button', '财务')
  await wait(() => execute('return Boolean(document.querySelector(".finance-intelligence"))'), 'finance after project')
  await responsive('expense category drill-down', () => execute('[...document.querySelectorAll(".fi-expense-bars button")].find((item)=>item.textContent.includes("软件"))?.click();return true'), () => execute('return document.querySelector(".finance-tabs .active")?.textContent.trim()==="流水"'), 300)
  await click('.finance-tabs button', '总览')
  await wait(() => execute('return Boolean(document.querySelector(".finance-intelligence"))'), 'finance after category')
  await click('.fi-record', '')
  await wait(() => execute('return Boolean(document.querySelector(".record-modal"))'), 'record transaction modal')
  await click('.record-modal header button', '')
  await wait(() => execute('return !document.querySelector(".record-modal")'), 'close record transaction modal')
  await click('.fi-quick button', '预算管理')
  await wait(() => execute('return document.querySelector(".finance-tabs .active")?.textContent.trim()==="预算"'), 'quick budget action')
  await click('.finance-tabs button', '总览')
  const screenshot = await request(`/session/${sessionId}/screenshot`)
  await mkdir(dirname(screenshotPath), { recursive: true })
  await writeFile(screenshotPath, Buffer.from(screenshot.value, 'base64'))
  console.log(JSON.stringify({ status: 'passed', screenshotPath, responseMs, checks: ['real desktop runtime', 'five KPIs', 'period and detail filters', 'income expense operating-cash aggregation', 'transfer exclusion', 'project allocation', 'budget/outcome attention', 'trend project category drill-down', 'record modal', 'quick action', 'reference-aligned screenshot'] }))
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
