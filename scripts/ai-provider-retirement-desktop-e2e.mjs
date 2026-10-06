import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const dataDir = await mkdtemp(join(tmpdir(), 'evopolit-ai-provider-retirement-'))
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
  const config = await invoke('get_ai_config')
  assert(JSON.stringify(config.providers.map(provider => provider.id)) === JSON.stringify(['hackstart', 'deepseek', 'minimax']), 'supported providers')
  assert(config.providers.find(provider => provider.id === 'deepseek').models.some(model => model.id === 'deepseek-v4-flash'), 'native DeepSeek Flash retained')
  assert(config.providers.find(provider => provider.id === 'minimax').models.some(model => model.id === 'MiniMax-M3'), 'native MiniMax retained')
  const retiredModels = ['kimi-k3', 'deepseek-v4-flash', 'glm-5.2', 'minimax-m3', 'doubao-seed-evolving', 'kimi-k2.7-code']
  for (const model of retiredModels) {
    for (const command of ['configure_ai_provider', 'test_ai_provider']) {
      const result = await invoke(command, { provider: 'volc-agent-plan', model, apiKey: '' })
      assert(result?.__error === '不支持的 AI 服务商', command + ': ' + model)
    }
  }
  // Only change the isolated test database, never the user's provider or keys.
  const database = join(dataDir, 'jason-os.sqlite3')
  execFileSync('sqlite3', [database, "INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES('ai_provider','volc-agent-plan','1'),('volc-agent-plan_model','kimi-k3','1')"])
  const fallback = await invoke('get_ai_config')
  const expected = config.providers.find(provider => provider.configured)?.id || 'hackstart'
  assert(fallback.provider === expected, 'legacy selection falls back to configured provider')
  await execute('location.reload();return true')
  await wait(() => execute('return !!document.querySelector(".news-radar-shortcut")'), 'reloaded shell')
  await execute('document.querySelectorAll(".global-actions>button")[1].click();return true')
  await wait(() => execute('return !!document.querySelector(".ai-drawer")'), 'assistant drawer')
  const trigger = await execute('return !!document.querySelector(".ai-composer-model-trigger")')
  let menuModels = []
  if (trigger) {
    await execute('document.querySelector(".ai-composer-model-trigger").click();return true')
    await wait(() => execute('return !!document.querySelector(".ai-composer-model-menu")'), 'model menu')
    menuModels = await execute('return [...document.querySelectorAll(".ai-composer-model-menu>button")].map(node=>node.innerText)')
    assert(!menuModels.some(text => text.includes('火山') || text.includes('Agent Plan')), 'retired provider absent from actual picker')
    const configuredCount = config.providers.filter(provider => provider.configured).reduce((sum, provider) => sum + provider.models.length, 0)
    assert(menuModels.length === configuredCount, 'remaining configured models all visible')
  } else {
    assert(!fallback.configured, 'model picker only absent when nothing configured')
  }
  assert(execFileSync('sqlite3', [database, 'PRAGMA integrity_check'], { encoding: 'utf8' }).trim() === 'ok', 'database integrity')
  if (process.env.AI_PROVIDER_SCREENSHOT) {
    const shot = (await request(`/session/${sessionId}/screenshot`)).value
    await writeFile(process.env.AI_PROVIDER_SCREENSHOT, Buffer.from(shot, 'base64'))
  }
  console.log(JSON.stringify({ status: 'passed', providers: config.providers.map(provider => provider.id), rejectedLegacySelections: 12, fallback: fallback.provider, menuModels, realAiRequests: 0 }))
} catch (error) {
  console.error(String(error)); process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app.kill('SIGTERM'); await pause(300)
  await rm(dataDir, { recursive: true, force: true })
}
