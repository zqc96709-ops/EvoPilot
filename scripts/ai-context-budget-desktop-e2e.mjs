import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const dataDir = await mkdtemp(join(tmpdir(), 'evopolit-ai-context-budget-'))
const port = String(6000 + Math.floor(Math.random() * 100))
const endpoint = `http://127.0.0.1:${port}`
const app = spawn(process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/evopolit'), [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: 'ignore' })
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
let sessionId = ''
const request = async (path, body) => {
  const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  return response.json()
}
const execute = (script) => request(`/session/${sessionId}/execute/sync`, { script, args: [] }).then((result) => result.value)
const wait = async (check, label) => {
  for (let i = 0; i < 300; i += 1) { try { if (await check()) return } catch {} await pause(100) }
  throw new Error(`Timed out: ${label}`)
}
const invoke = (command, args = {}) => request(`/session/${sessionId}/execute/async`, {
  script: "const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done).catch(error=>done({__error:String(error)}))",
  args: [command, args],
}).then(result => result.value)
const assert = (condition, label) => { if (!condition) throw new Error(label) }
try {
  await wait(() => request('/status').then(result => result.value?.ready), 'WebDriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await wait(() => execute('return !!document.querySelector(".news-radar-shortcut")'), 'shell')
  const database = join(dataDir, 'jason-os.sqlite3')
  // Fixtures live only in the isolated test database; user records and credentials are untouched.
  const seed = []
  for (let i = 0; i < 101; i += 1) {
    const entity = i === 100 ? 'notes' : i % 2 === 0 ? 'agentRuns' : 'agentActions'
    const id = 'budget-test-' + i
    const record = { id, entity, title: 'context budget test', content: entity === 'notes' ? 'Original note' : 'recursive context '.repeat(2000) }
    seed.push("INSERT INTO records(id,entity,data_json,title,body,created_at,updated_at) VALUES('" + id + "','" + entity + "','" + JSON.stringify(record) + "','context budget test','context budget test','0','" + (i === 100 ? '0' : '1') + "');")
    seed.push("INSERT INTO records_fts(id,entity,title,body) VALUES('" + id + "','" + entity + "','context budget test','context budget test');")
  }
  execFileSync('sqlite3', [database], { input: seed.join('') })
  for (const query of ['', 'context budget test']) {
    const records = await invoke('search_ai_records', { query })
    assert(Array.isArray(records) && records.every(record => !['agentRuns', 'agentActions'].includes(record.entity)), 'AI retrieval excludes audit logs')
    if (query) assert(records.length === 1 && records[0].id === 'budget-test-100', 'AI retrieves original note before result limit')
    const global = await invoke('search_records', { query })
    assert(global.some(record => ['agentRuns', 'agentActions'].includes(record.entity)), 'global search retains audit access')
  }
  await execute('document.querySelectorAll(".global-actions>button")[1].click();return true')
  await wait(() => execute('return !!document.querySelector(".ai-drawer")'), 'assistant drawer')
  assert(execFileSync('sqlite3', [database, 'PRAGMA integrity_check'], { encoding: 'utf8' }).trim() === 'ok', 'database integrity')
  if (process.env.AI_CONTEXT_SCREENSHOT) {
    const shot = (await request(`/session/${sessionId}/screenshot`)).value
    await writeFile(process.env.AI_CONTEXT_SCREENSHOT, Buffer.from(shot, 'base64'))
  }
  console.log(JSON.stringify({ status: 'passed', isolatedAuditRecords: 100, realNoteRetrieved: true, globalSearchPreserved: true, realAiRequests: 0 }))
} catch (error) {
  console.error(String(error)); process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app.kill('SIGTERM'); await pause(300)
  await rm(dataDir, { recursive: true, force: true })
}
