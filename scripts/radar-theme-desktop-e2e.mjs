import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const dataDir = await mkdtemp(join(tmpdir(), 'evopolit-radar-theme-'))
const port = String(5900 + Math.floor(Math.random() * 100))
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
try {
  await wait(() => request('/status').then((result) => result.value?.ready), 'WebDriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await wait(() => execute('return !!document.querySelector(".news-radar-shortcut")'), 'shell')
  await execute('document.querySelector(".news-radar-shortcut").click();return true')
  await wait(() => execute('return !!document.querySelector(".radar-story h4")'), 'live news')
  const result = await execute(`
    const root = document.querySelector('.app-shell');
    const selector = '.radar-story h4,.radar-title-en,.radar-why,.radar-why b,.radar-story-meta,.radar-story-meta>span,.radar-story-meta time,.radar-story footer span,.radar-story footer strong,.radar-summary b,.radar-summary small,.radar-summary>div:last-child span,.radar-controls button,.radar-top>header span,.radar-feed>header span,.radar-top>header small,.radar-feed>header small,.ai-news-toolbar>div>span';
    const nodes = [...document.querySelectorAll(selector)];
    root.classList.remove('light-theme');
    const dark = nodes.map((node) => { const s=getComputedStyle(node);return {color:s.color,font:s.fontFamily,size:s.fontSize} });
    root.classList.add('light-theme');
    const luminance=(rgb)=>{const c=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722};
    const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
    const backgrounds=[[255,255,255],[241,245,237],[234,241,228],[240,247,225]];
    const light=nodes.map((node,i)=>{const s=getComputedStyle(node);const rgb=s.color.match(/[\\d.]+/g).slice(0,3).map(Number);return {class:node.className,tag:node.tagName,color:s.color,ratio:Math.min(...backgrounds.map(bg=>contrast(rgb,bg))),sameFont:s.fontFamily===dark[i].font&&s.fontSize===dark[i].size} });
    root.classList.remove('light-theme');
    const darkUnchanged=nodes.every((node,i)=>getComputedStyle(node).color===dark[i].color);
    root.classList.add('light-theme');
    return {light,darkUnchanged};
  `)
  const failures = result.light.filter((item) => item.ratio < 4.5 || !item.sameFont)
  if (failures.length || !result.darkUnchanged) throw new Error(JSON.stringify({ failures, darkUnchanged: result.darkUnchanged }))
  if (process.env.RADAR_THEME_SCREENSHOT) {
    const shot = (await request(`/session/${sessionId}/screenshot`)).value
    await writeFile(process.env.RADAR_THEME_SCREENSHOT, Buffer.from(shot, 'base64'))
  }
  console.log(JSON.stringify({ status: 'passed', checkedTextElements: result.light.length, minimumContrast: Math.min(...result.light.map((item) => item.ratio)), fontUnchanged: true, darkUnchanged: result.darkUnchanged }))
} catch (error) {
  console.error(String(error)); process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app.kill('SIGTERM'); await pause(300)
  await rm(dataDir, { recursive: true, force: true })
}
