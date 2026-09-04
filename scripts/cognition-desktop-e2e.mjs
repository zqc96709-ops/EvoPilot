import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/jason-os')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-cognition-e2e-'))
const screenshotPath = resolve('artifacts/cognitive-center-e2e.png')
const port = String(5350 + Math.floor(Math.random() * 120)); const output = []
const frontend = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
frontend.stdout.on('data', (chunk) => output.push(chunk.toString())); frontend.stderr.on('data', (chunk) => output.push(chunk.toString()))
let app; let sessionId = ''; const endpoint = `http://127.0.0.1:${port}`
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const request = async (path, body) => { const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); if (!response.ok) throw new Error(`${path}: ${response.status}`); return response.json() }
const wait = async (check, label) => { const end = Date.now() + 15000; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await pause(100) } throw new Error(`Timed out: ${label}`) }
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const executeAsync = (script, args = []) => request(`/session/${sessionId}/execute/async`, { script, args }).then((result) => result.value)
const click = (selector, text = '') => execute(`const n=[...document.querySelectorAll(${JSON.stringify(selector)})].find((x)=>x.textContent.includes(${JSON.stringify(text)}));if(!n)throw new Error('Missing ${text}');n.click();return true`)
const save = async (entity, data) => { const result = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('save_record',{entity:arguments[0],data:arguments[1]}).then(done).catch((e)=>done({__error:String(e)}))`, [entity, data]); if (result?.__error) throw new Error(result.__error); return result }

try {
  await wait(() => fetch('http://127.0.0.1:5174').then((response) => response.ok), 'frontend')
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] }); app.stdout.on('data', (chunk) => output.push(chunk.toString())); app.stderr.on('data', (chunk) => output.push(chunk.toString()))
  await wait(() => request('/status').then((result) => result.value?.ready), 'webdriver'); sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await wait(() => execute('return [...document.querySelectorAll(".sidebar nav button")].some((x)=>x.textContent.includes("认知中心"))'), 'consolidated sidebar')
  const recent = (days = 0) => new Date(Date.now() - days * 86_400_000).toISOString()
  const insightNames = ['高客单直播冷启动期不应过早放量', '内容结构清晰度是首要因素', '资源有限时聚焦单点突破更有效', '投放前需要先验证自然转化链路', '用户反馈应进入决策证据链', '高频复盘能缩短验证周期', '项目目标需要连接可观察结果', '待验证的渠道假设', '历史待验证洞见', '已被反证的旧假设', '长期样本洞见', '历史验证记录']
  const insights = []
  for (let index = 0; index < insightNames.length; index += 1) {
    const isRecent = index < 8
    const validationStatus = index < 7 ? 'SUPPORTED' : index < 9 ? 'PENDING' : 'CONTRADICTED'
    insights.push(await save('insights', { statement: insightNames[index], validationStatus, confidence: 90 - index, importance: index < 3 ? 90 - index : 0, source: index < 3 ? '实木床直播项目复盘' : '认知记录', createdAt: recent(isRecent ? index + 1 : 40 + index), updatedAt: recent(isRecent ? index + 1 : 40 + index), validatedAt: validationStatus === 'SUPPORTED' ? recent(index + 1) : undefined }))
  }
  const principles = []
  for (const statement of ['重大投放扩量前，先验证自然转化链路', '不可逆决策必须提高证据门槛', '资源有限时优先解决增长瓶颈']) principles.push(await save('principles', { statement, status: 'ACTIVE', insightIds: [insights[0].id], validatedAt: recent(2), createdAt: recent(2) }))
  for (const statement of ['候选原则：先验证再扩量', '候选原则：先聚焦再扩展']) await save('principles', { statement, status: 'CANDIDATE', createdAt: recent(3) })
  const reviews = []
  for (let index = 0; index < 18; index += 1) reviews.push(await save('reviews', { title: `认知复盘 ${index + 1}`, lesson: '真实复盘记录', insightIds: index < 5 ? [insights[0].id] : [], createdAt: recent(index + 1) }))
  const models = []
  for (const [index, name] of ['反向思维', '机会成本', '二阶效应', '第一性原理', '概率思维', '系统思维'].entries()) models.push(await save('mentalModels', { name, slug: `fixture-model-${index}`, status: 'active', createdAt: recent(index + 1) }))
  const decisions = []
  for (let index = 0; index < 12; index += 1) decisions.push(await save('decisions', { title: `认知驱动决策 ${index + 1}`, status: 'active', insightIds: [insights[index % insights.length].id], principleIds: [principles[index % principles.length].id], mentalModelIds: [models[index % models.length].id], createdAt: recent(index + 1) }))
  for (let index = 0; index < 9; index += 1) await save('projects', { title: `认知应用项目 ${index + 1}`, status: 'active', insightIds: [insights[0].id], createdAt: recent(index + 1) })
  for (let index = 0; index < 6; index += 1) await save('workflowRuns', { title: `认知工作流 ${index + 1}`, status: 'running', principleIds: [principles[0].id], createdAt: recent(index + 1) })
  for (let index = 0; index < 3; index += 1) await save('results', { title: `待复盘成果 ${index + 1}`, status: 'completed', createdAt: recent(index + 1) })
  for (let index = 0; index < models.length; index += 1) await save('mentalModelUsages', { context: `用于${decisions[index].title}`, mentalModelId: models[index].id, decisionId: decisions[index].id, createdAt: recent(index + 1) })
  await click('.sidebar nav button', '指挥中心'); await wait(() => execute('return Boolean(document.querySelector("[aria-label=\\"刷新指挥中心\\"]"))'), 'refresh'); await execute('document.querySelector("[aria-label=\\"刷新指挥中心\\"]").click();return true'); await pause(500)
  await click('.sidebar nav button', '认知中心'); await wait(() => execute('return Boolean(document.querySelector(".cognition-center"))'), 'cognition center')
  const text = await execute('return document.querySelector(".cognition-center").innerText')
  for (const label of ['待复盘', '新洞见', '原则候选', '待验证认知', '最近重要洞见', '认知待处理', '最近形成的原则', '认知沉淀路径', '认知应用情况', '常用思维模型']) if (!text.includes(label)) throw new Error(`Missing ${label}`)
  if ((await execute('return document.querySelectorAll(".ci-kpis>button").length')) !== 4) throw new Error('KPI count is not four')
  if ((await execute('return [...document.querySelectorAll(".sidebar>nav>section>button")].filter((x)=>["知识","复盘","洞见","原则","思维模型"].includes(x.textContent.trim())).length')) !== 0) throw new Error('Old cognition top-level navigation remains')
  const metrics = await execute('return {innerWidth,innerHeight,outerWidth,outerHeight,devicePixelRatio,screenWidth:screen.width,screenHeight:screen.height}')
  const expected = { kpis: [3, 8, 2, 4], funnel: [18, 12, 7, 3], applications: [12, 9, 6, 5], models: 6 }
  const actual = await execute(`return {kpis:[...document.querySelectorAll('.ci-kpis>button>strong')].map((x)=>Number(x.textContent)),funnel:[...document.querySelectorAll('.ci-funnel-stats strong')].map((x)=>Number(x.textContent)),applications:[...document.querySelectorAll('.ci-applications strong')].map((x)=>Number(x.textContent)),models:document.querySelectorAll('.ci-models>button').length,sparklines:document.querySelectorAll('.ci-sparkline').length}`)
  if (JSON.stringify(actual.kpis) !== JSON.stringify(expected.kpis) || JSON.stringify(actual.funnel) !== JSON.stringify(expected.funnel) || JSON.stringify(actual.applications) !== JSON.stringify(expected.applications) || actual.models !== 6 || actual.sparklines !== 4) throw new Error(`Visual fixture mismatch: ${JSON.stringify({ expected, actual })}`)
  for (const option of ['近 7 天', '近 30 天', '本季度', '今年', '自定义']) { await click('[aria-label="认知分析周期"]'); await click('.ci-period-menu>button', option); if (option === '自定义') { await wait(() => execute('return Boolean(document.querySelector("[aria-label=\\"自定义开始日期\\"]"))'), 'custom dates'); await click('.ci-period-custom>button', '应用') } }
  await click('[aria-label="认知分析周期"]'); await click('.ci-period-menu>button', '近 30 天')
  await click('.ci-list button', '高客单'); await wait(() => execute('return Boolean(document.querySelector(".record-drawer"))'), 'insight row'); await click('.record-drawer header button')
  const applicationState = await execute(`const n=[...document.querySelectorAll('.ci-applications button')].find((x)=>x.textContent.includes('用于决策'));return {text:n?.textContent,disabled:n?.disabled}`)
  if (applicationState.disabled) throw new Error(`Decision application disabled: ${JSON.stringify(applicationState)}`)
  await click('.ci-applications button', '用于决策'); await wait(() => execute('return Boolean(document.querySelector(".record-drawer"))'), `application relation ${JSON.stringify(applicationState)}`); await click('.record-drawer header button')
  await click('.ci-models button', '反向思维'); await wait(() => execute('return Boolean(document.querySelector(".record-drawer"))'), 'model usage'); await click('.record-drawer header button')
  await click('.ci-attention button'); await wait(() => execute('return Boolean(document.querySelector(".record-drawer"))'), 'attention detail'); await click('.record-drawer header button')
  await click('.ci-list.principles button'); await wait(() => execute('return Boolean(document.querySelector(".record-drawer"))'), 'principle detail'); await click('.record-drawer header button')
  await click('.ci-funnel-stats button', 'Review'); await wait(() => execute('return [...document.querySelectorAll(".ci-toolbar nav button")].some((x)=>x.classList.contains("active")&&x.textContent==="复盘")'), 'funnel route'); await click('.ci-toolbar nav button', '总览')
  for (const tab of ['洞见', '复盘', '知识', '原则', '思维模型', '总览']) { await click('.ci-toolbar nav button', tab); await wait(() => execute(`return [...document.querySelectorAll('.ci-toolbar nav button')].some((x)=>x.classList.contains('active')&&x.textContent===${JSON.stringify(tab)})`), `${tab} tab`) }
  await click('.ci-header button', '新建'); await wait(() => execute('return Boolean(document.querySelector(".record-modal"))'), 'create'); await click('.record-modal header button')
  await click('.ci-header button', 'AI 洞察推荐'); await wait(() => execute('return Boolean(document.querySelector(".ai-drawer"))'), 'AI entry'); await click('.ai-drawer header button')
  for (const route of ['今天', '时间', '项目', '财务', '决策日志']) { await click('.sidebar nav button', route); await wait(() => execute(`return [...document.querySelectorAll('.sidebar nav button')].some((x)=>x.classList.contains('active')&&x.textContent.includes(${JSON.stringify(route)}))`), `${route} global route`) }
  await click('.quick-capture'); await wait(() => execute('return Boolean(document.querySelector(".notebook-space"))'), 'notebook global route')
  await click('.sidebar nav button', '认知中心'); await wait(() => execute('return Boolean(document.querySelector(".cognition-center"))'), 'return cognition center')
  const responsive = []
  for (const [width, height] of [[1440, 900], [1280, 800], [1680, 1000], [1536, 1024]]) {
    await request(`/session/${sessionId}/window/rect`, { x: 0, y: 0, width: width * metrics.devicePixelRatio, height: height * metrics.devicePixelRatio }); await pause(250)
    const layout = await execute('return {innerWidth,innerHeight,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,kpiColumns:getComputedStyle(document.querySelector(".ci-kpis")).gridTemplateColumns.split(" ").length,modelColumns:getComputedStyle(document.querySelector(".ci-models")).gridTemplateColumns.split(" ").length}')
    if (layout.overflow || layout.kpiColumns !== 4 || (layout.innerWidth >= 1280 && layout.modelColumns !== 3)) throw new Error(`Responsive layout failed at ${width}x${height}: ${JSON.stringify(layout)}`)
    responsive.push({ requested: [width, height], ...layout })
  }
  const screenshot = await request(`/session/${sessionId}/screenshot`); await mkdir(dirname(screenshotPath), { recursive: true }); await writeFile(screenshotPath, Buffer.from(screenshot.value, 'base64'))
  console.log(JSON.stringify({ status: 'passed', screenshotPath, metrics, responsive, fixture: actual, checks: ['single cognition navigation', 'six tabs', 'four KPIs and sparklines', 'three plus three panels', 'small funnel with stats', 'six-model grid', 'real relation drilldown', 'five custom periods', 'create', 'AI entry', 'negative cognition data'] }))
} catch (error) { await writeFile(join(dataDir, 'failure.log'), `${String(error)}\n${output.join('')}`); console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) })); process.exitCode = 1 }
finally { if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined); app?.kill('SIGTERM'); await pause(400); frontend.kill('SIGTERM'); if (!process.exitCode) await rm(dataDir, { recursive: true, force: true }) }
