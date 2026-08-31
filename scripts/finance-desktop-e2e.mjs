import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/jason-os')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-finance-e2e-'))
const port = String(4400 + Math.floor(Math.random() * 300))
const log = []
const app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
app.stdout.on('data', (chunk) => log.push(chunk.toString()))
app.stderr.on('data', (chunk) => log.push(chunk.toString()))

const endpoint = `http://127.0.0.1:${port}`
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const request = async (path, body) => {
  const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${await response.text()}`)
  return response.json()
}
const wait = async (check, label) => {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { try { const value = await check(); if (value) return value } catch {} await pause(150) }
  throw new Error(`Timed out: ${label}`)
}
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const findAll = async (selector) => {
  const result = await request(`/session/${sessionId}/elements`, { using: 'css selector', value: selector })
  if (!Array.isArray(result.value)) throw new Error(`Cannot find ${selector}: ${JSON.stringify(result)}`)
  return result.value.map((item) => item['element-6066-11e4-a52e-4f735466cecf'])
}
const type = async (selector, text, index = 0) => { const ids = await findAll(selector); await request(`/session/${sessionId}/element/${ids[index]}/value`, { text }) }
const setInput = (index, value) => execute(`
  const input = document.querySelectorAll('form input')[${index}]
  if (!input) throw new Error('Missing form input at index ${index}')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return input.value
`)
const clickText = (text, selector = 'button') => execute(`const button=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.trim()===${JSON.stringify(text)}); if(!button) throw new Error('Missing button: '+${JSON.stringify(text)}); button.click(); return true`)
const clickContaining = (text, selector = 'button') => execute(`const button=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.includes(${JSON.stringify(text)})); if(!button) throw new Error('Missing button containing: '+${JSON.stringify(text)}); button.click(); return true`)
const chooseOption = (text) => execute(`const form=document.querySelector('form'); const select=[...form.querySelectorAll('select')].find((item)=>[...item.options].some((option)=>option.textContent.trim()===${JSON.stringify(text)})); if(!select) throw new Error('Missing option: '+${JSON.stringify(text)}); const option=[...select.options].find((item)=>item.textContent.trim()===${JSON.stringify(text)}); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(select,option.value); select.dispatchEvent(new Event('input',{bubbles:true})); select.dispatchEvent(new Event('change',{bubbles:true})); return option.value`)
const save = async (label) => {
  await clickText('保存到本机', 'form button')
  try {
    await wait(() => execute('return !document.querySelector("form")'), `${label} save`)
  } catch {
    const details = await execute('return document.querySelector("form")?.innerText || document.body.innerText.slice(-1200)')
    throw new Error(`${label} did not save: ${details}`)
  }
}
const openForm = async (text, selector = '.finance-page button') => { await clickText(text, selector); await wait(() => execute('return Boolean(document.querySelector("form"))'), `${text} form`) }

let sessionId = ''
try {
  await wait(() => request('/status').then((result) => result.value?.ready), 'WebDriver server')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await wait(() => execute('return document.body.innerText.includes("指挥中心")'), 'desktop app ready')

  await clickText('¥财务')
  await wait(() => execute('return Boolean(document.querySelector(".finance-page"))'), 'finance view')
  await openForm('创建账户 →')
  await type('form input', 'E2E 主账户')
  await chooseOption('银行')
  await save('account')

  await clickText('◈项目')
  await openForm('创建第一个项目 →', 'main button')
  await type('form input', 'E2E 项目 A')
  await save('project')

  await clickText('¥财务')
  await clickText('分类', '.finance-tabs button')
  await openForm('创建分类 →')
  await type('form input', 'E2E 广告')
  await save('category')

  await clickText('总览', '.finance-tabs button')
  await openForm('＋ 记录流水')
  await type('form input', 'E2E 广告支出')
  await type('form input', '600', 1)
  await chooseOption('E2E 主账户')
  await chooseOption('E2E 广告')
  await chooseOption('E2E 项目 A')
  await save('transaction')

  await clickText('预算', '.finance-tabs button')
  await openForm('创建预算 →')
  await setInput(0, 'E2E 广告预算')
  await setInput(1, '1000')
  // Native WebKit date controls do not reliably accept W3C sendKeys; dispatching
  // the same input/change events keeps this isolated UI flow deterministic.
  await setInput(2, '2026-08-01')
  await setInput(3, '2026-08-31')
  await chooseOption('E2E 项目 A')
  await chooseOption('E2E 广告')
  await save('budget')

  await clickText('总览', '.finance-tabs button')
  const overview = await execute('return document.querySelector(".finance-page").innerText')
  if (!overview.includes('E2E 广告预算') || !overview.includes('¥600.00')) throw new Error('Budget versus actual was not rendered from UI-created facts')
  await clickContaining('E2E 广告', '.finance-breakdown button')
  await wait(() => execute('return document.querySelector(".finance-tabs .active")?.textContent.trim()==="流水"'), 'category drill-down')
  const drilled = await execute('return document.querySelector(".finance-page").innerText')
  if (!drilled.includes('E2E 广告支出')) throw new Error('Category drill-down did not retain the transaction filter')
  await clickText('清除筛选')
  await clickText('预算', '.finance-tabs button')
  const budget = await execute('return document.querySelector(".finance-page").innerText')
  if (!budget.includes('余 ¥400.00')) throw new Error('Budget variance is incorrect')
  console.log(JSON.stringify({ status: 'passed', dataDir, checks: ['desktop webdriver', 'isolated database', 'account/project/category/transaction/budget creation', 'budget comparison', 'category drill-down', 'filter reset'] }))
} catch (error) {
  await writeFile(join(dataDir, 'failure.log'), log.join(''))
  console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) }))
  process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app.kill('SIGTERM')
  await pause(500)
  if (!process.exitCode) await rm(dataDir, { recursive: true, force: true })
}
