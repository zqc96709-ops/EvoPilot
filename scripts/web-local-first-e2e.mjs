import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const webPort = 5178; const syncPort = 8793; const token = 'web-e2e'; const temp = mkdtempSync(join(tmpdir(), 'jason-web-sync-'))
const children = []
const start = (command, args, env = {}) => { const child = spawn(command, args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: 'ignore' }); children.push(child); return child }
const waitHttp = async (url, options, timeout = 15_000) => { const until = Date.now() + timeout; while (Date.now() < until) { try { const response = await fetch(url, options); if (response.ok) return response } catch {} await new Promise((resolve) => setTimeout(resolve, 150)) } throw new Error(`Timed out: ${url}`) }

let browser
try {
  start('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(webPort)], { VITE_JASON_SYNC_URL: `http://127.0.0.1:${syncPort}`, VITE_JASON_SYNC_TOKEN: token })
  await waitHttp(`http://127.0.0.1:${webPort}`)
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  let page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${webPort}`)
  const id = await page.evaluate(async () => { const { api } = await import('/src/api.ts'); await api.initialize(); return (await api.save('tasks', { title: 'Offline Chrome task' })).id })
  await page.reload()
  const offline = await page.evaluate(async (recordId) => { const request = indexedDB.open('jason-os-working-replica'); const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }); const read = (store, key) => new Promise((resolve, reject) => { const transaction = db.transaction(store); const query = key ? transaction.objectStore(store).get(key) : transaction.objectStore(store).getAll(); query.onsuccess = () => resolve(query.result); query.onerror = () => reject(query.error) }); return { record: await read('records', recordId), pending: (await read('outbox')).length } }, id)
  if (offline.record?.title !== 'Offline Chrome task' || offline.pending !== 1) throw new Error(`Offline persistence failed: ${JSON.stringify(offline)}`)
  start('node', ['sync-server/server.mjs'], { JASON_SYNC_PORT: String(syncPort), JASON_SYNC_TOKEN: token, JASON_SYNC_DB: join(temp, 'sync.sqlite3'), JASON_SYNC_OBJECT_DIR: join(temp, 'objects') })
  await waitHttp(`http://127.0.0.1:${syncPort}/health`)
  const headers = { authorization: `Bearer ${token}` }
  const until = Date.now() + 10_000; let snapshot
  while (Date.now() < until) { snapshot = await fetch(`http://127.0.0.1:${syncPort}/sync/snapshot`, { headers }).then((response) => response.json()); if (snapshot.records?.some((item) => item.entityId === id)) break; await new Promise((resolve) => setTimeout(resolve, 300)) }
  const pending = await page.evaluate(async () => { const { api } = await import('/src/api.ts'); return (await api.syncV1Status()).pending })
  if (!snapshot?.records?.some((item) => item.entityId === id) || pending !== 0) throw new Error('Reconnect synchronization failed')
  console.log(JSON.stringify({ ok: true, browser: 'Google Chrome', offlineRefresh: true, pendingPersisted: true, reconnectPush: true, entityId: id }))
} finally {
  await browser?.close(); for (const child of children.reverse()) child.kill('SIGTERM'); rmSync(temp, { recursive: true, force: true })
}
