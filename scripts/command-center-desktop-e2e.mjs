import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/jason-os')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-command-e2e-'))
const screenshotPath = resolve('artifacts/command-center-e2e.png')
const port = String(4700 + Math.floor(Math.random() * 200))
const log = []
const app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
app.stdout.on('data', (chunk) => log.push(chunk.toString()))
app.stderr.on('data', (chunk) => log.push(chunk.toString()))
const endpoint = `http://127.0.0.1:${port}`
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const request = async (path, body) => { const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response.json() }
const wait = async (check, label) => { const deadline = Date.now() + 15000; while (Date.now() < deadline) { try { const value = await check(); if (value) return value } catch {} await pause(120) } throw new Error(`Timed out: ${label}`) }
let sessionId = ''
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const executeAsync = (script, args = []) => request(`/session/${sessionId}/execute/async`, { script, args }).then((result) => result.value)
const clickText = (text, selector = 'button') => execute(`const button=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.trim()===${JSON.stringify(text)});if(!button)throw new Error('Missing button '+${JSON.stringify(text)});button.click();return true`)
const clickContaining = (text, selector = 'button') => execute(`const button=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.includes(${JSON.stringify(text)}));if(!button)throw new Error('Missing button containing '+${JSON.stringify(text)});button.click();return true`)
const save = async (entity, data) => { const value = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('save_record',{entity:arguments[0],data:arguments[1]}).then(done).catch((error)=>done({__error:String(error)}))`, [entity, data]); if (value?.__error) throw new Error(value.__error); return value }

try {
  await wait(() => request('/status').then((result) => result.value?.ready), 'webdriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await wait(() => execute('return Boolean(document.querySelector(".ceo-command-center"))'), 'Command Center render')
  const profile = await save('profiles', { title: '我的档案', name: 'Jason', nickname: 'Jason' })
  const goal = await save('goals', { title: '建立可持续增长引擎', status: 'active', progress: 72, priority: 'high', startDate: '2026-08-01', targetDate: '2026-09-30' })
  await save('keyResults', { title: '验证增长模型', goalId: goal.id, status: 'active', currentValue: 72, targetValue: 100 })
  const projectA = await save('projects', { title: '美国 TikTok', goalId: goal.id, status: 'active', health: 'healthy', progress: 86, priority: 'high' })
  const projectB = await save('projects', { title: 'Project B', goalId: goal.id, status: 'blocked', health: 'blocked', blockers: '资金消耗扩大', progress: 31, priority: 'high' })
  await save('timeLogs', { title: '增长分析', projectId: projectA.id, startAt: '2026-08-25T09:00:00Z', durationMinutes: 420 })
  await save('timeLogs', { title: '风险处理', projectId: projectB.id, startAt: '2026-08-26T09:00:00Z', durationMinutes: 180 })
  await save('results', { title: '第一轮测试完成', projectId: projectA.id, goalId: goal.id, outcomeType: 'MILESTONE', status: 'ACHIEVED', achievementBps: 11800, evidenceStatus: 'VERIFIED', date: '2026-08-27' })
  await save('results', { title: '成本目标部分达成', projectId: projectB.id, goalId: goal.id, outcomeType: 'FINANCIAL', status: 'PARTIAL', achievementBps: 6200, evidenceStatus: 'RECORDED', date: '2026-08-22' })
  await save('financialTransactions', { title: 'TikTok 收入', projectId: projectA.id, status: 'POSTED', transactionType: 'INCOME', amountMinor: '2800000', occurredAt: '2026-08-25' })
  await save('financialTransactions', { title: 'Project B 广告', projectId: projectB.id, status: 'POSTED', transactionType: 'EXPENSE', amountMinor: '1100000', occurredAt: '2026-08-26' })
  await save('decisions', { title: '是否增加广告预算？', projectId: projectA.id, status: 'pending', decisionLevel: 'STRATEGIC', impactLevel: 'high', expectedOutcome: '验证增加预算是否能提高经营贡献', knownUnknowns: '增量转化仍需验证', reviewDueDate: '2026-09-02' })
  await save('signals', { title: 'TikTok 平台政策更新', projectId: projectA.id, status: 'observing', impactLevel: 'HIGH', summary: '可能影响广告投放和商品分类', detectedAt: '2026-08-28' })
  await clickText('↻')
  await wait(() => execute('return document.querySelector(".ceo-command-center")?.innerText.includes("Project B")'), 'seeded dashboard')
  const text = await execute('return document.querySelector(".ceo-command-center").innerText')
  for (const expected of ['目标达成率', '关键项目风险', '经营现金结果', '战略结果趋势', '投入与结果对比', 'CEO Attention', '项目组合概览', '资源配置', '经营财务概览', '关键决策日历', '高影响外部信号', '最近关键成果']) if (!text.includes(expected)) throw new Error(`Missing dashboard area: ${expected}`)
  if (text.includes('今日任务') || text.includes('Top 3')) throw new Error('Today execution content leaked into Command Center')
  await clickText('资金投入', '.ceo-segment button')
  if (!await execute('return document.querySelector(".ceo-segment .active")?.textContent==="资金投入"')) throw new Error('Resource allocation tab did not switch')
  await execute(`const select=document.querySelector('.ceo-command-controls select');select.value='7d';select.dispatchEvent(new Event('change',{bubbles:true}));return true`)
  await wait(() => execute('return document.querySelector(".ceo-command-controls select")?.value==="7d"'), 'period switch')
  await clickContaining('关键项目风险', '.ceo-kpi')
  await wait(() => execute('return Boolean(document.querySelector(".project-intelligence"))'), 'risk KPI drilldown')
  await clickText('⌂指挥中心', '.sidebar nav button')
  await wait(() => execute('return Boolean(document.querySelector(".ceo-command-center"))'), 'back to command center')
  if (!await execute('return document.querySelector(".ceo-command-controls select")?.value==="7d"')) throw new Error('Period state was not retained across drilldown')
  await execute(`const select=document.querySelector('.ceo-command-controls select');select.value='30d';select.dispatchEvent(new Event('change',{bubbles:true}));return true`)
  await wait(() => execute('return document.querySelector(".ceo-command-controls select")?.value==="30d"'), 'restore default period for screenshot')
  const screenshot = await request(`/session/${sessionId}/screenshot`)
  await mkdir(dirname(screenshotPath), { recursive: true })
  await writeFile(screenshotPath, Buffer.from(screenshot.value, 'base64'))
  console.log(JSON.stringify({ status: 'passed', screenshotPath, profileId: profile.id, checks: ['isolated real database', 'all dashboard regions', 'no Today/Top3 leakage', 'resource toggle', 'period state and retention', 'KPI drilldown', 'desktop screenshot'] }))
} catch (error) {
  const body = sessionId ? await execute('return document.documentElement.outerHTML').catch((failure) => `Cannot inspect body: ${String(failure)}`) : ''
  await writeFile(join(dataDir, 'failure.log'), `${String(error)}\n\n${body}\n\n${log.join('')}`)
  console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) }))
  process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app.kill('SIGTERM'); await pause(500)
  if (!process.exitCode) await rm(dataDir, { recursive: true, force: true })
}
