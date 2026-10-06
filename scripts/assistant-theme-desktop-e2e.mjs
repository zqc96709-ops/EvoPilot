import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const dataDir = await mkdtemp(join(tmpdir(), 'evopolit-assistant-theme-'))
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
try {
  await wait(() => request('/status').then((result) => result.value?.ready), 'WebDriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await wait(() => execute('return !!document.querySelector(".news-radar-shortcut")'), 'shell')
  await execute('document.querySelectorAll(".global-actions>button")[1].click();return true')
  await wait(() => execute('return !!document.querySelector(".ai-chat")'), 'assistant drawer')
  const result = await execute(`
    const root = document.querySelector('.app-shell');
    // Style-only fixtures in an isolated WebView; no AI request or chat persistence.
    const fixtures=document.createElement('div');
    fixtures.innerHTML='<article class="assistant"><span>AI</span><div class="ai-message-body"><p>助理回复：今天的任务需要明确截止时间。</p><section class="ai-action-card"><header><div><span>→</span><div><strong>创建任务</strong><small>等待确认</small></div></div></header><dl><div><dt>任务标题</dt><dd>准备直播检查清单</dd></div></dl><p class="ai-action-error">测试错误提示</p><footer><button>取消</button><button class="confirm">确认执行</button></footer></section></div></article><article class="user"><span>你</span><p>用户提问：帮我整理任务</p></article><div class="ai-composer"><div class="ai-composer-input"><textarea placeholder="询问助理">输入内容</textarea><div class="ai-composer-bar"><button class="ai-composer-model-trigger"><span>模型名称</span><i>⌄</i></button></div></div><div class="ai-composer-model-menu"><header><strong>选择模型</strong><small>1 个可用</small></header><button class="active"><span>✓</span><div><strong>模型名称</strong><small>服务商</small></div></button></div></div>';
    document.querySelector('.ai-chat').append(fixtures);
    const selector = '.ai-chat article p,.ai-chat article>span,.ai-drawer>header small,.ai-action-card dd,.ai-action-card dt,.ai-action-card>header small,.ai-action-card>header>div>span,.ai-action-card>footer button,.ai-composer-model-trigger,.ai-composer-model-trigger i,.ai-composer-model-menu>button,.ai-composer-model-menu small,.ai-composer-model-menu>button>span,.ai-composer textarea';
    const nodes = [...document.querySelectorAll(selector)];
    root.classList.remove('light-theme');
    const dark = nodes.map((node) => { const s=getComputedStyle(node);return {color:s.color,font:s.fontFamily,size:s.fontSize} });
    root.classList.add('light-theme');
    const luminance=(rgb)=>{const c=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722};
    const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
    const backgrounds=[[255,255,255],[241,245,237],[234,241,228],[240,247,225]];
    const light=nodes.map((node,i)=>{const s=getComputedStyle(node);const rgb=s.color.match(/[\\d.]+/g).slice(0,3).map(Number);return {class:node.className,tag:node.tagName,color:s.color,ratio:Math.min(...backgrounds.map(bg=>contrast(rgb,bg))),sameFont:s.fontFamily===dark[i].font&&s.fontSize===dark[i].size} });
    const placeholder=getComputedStyle(fixtures.querySelector('textarea'),'::placeholder').color.match(/[\\d.]+/g).slice(0,3).map(Number);
    const placeholderContrast=contrast(placeholder,[255,255,255]);
    root.classList.remove('light-theme');
    const darkUnchanged=nodes.every((node,i)=>getComputedStyle(node).color===dark[i].color);
    root.classList.add('light-theme');
    return {light,darkUnchanged,placeholderContrast};
  `)
  const failures = result.light.filter((item) => item.ratio < 4.5 || !item.sameFont)
  if (failures.length || !result.darkUnchanged || result.placeholderContrast < 4.5) throw new Error(JSON.stringify({ failures, darkUnchanged: result.darkUnchanged, placeholderContrast: result.placeholderContrast }))
  if (process.env.ASSISTANT_THEME_SCREENSHOT) {
    const shot = (await request(`/session/${sessionId}/screenshot`)).value
    await writeFile(process.env.ASSISTANT_THEME_SCREENSHOT, Buffer.from(shot, 'base64'))
  }
  console.log(JSON.stringify({ status: 'passed', checkedTextElements: result.light.length, minimumContrast: Math.min(...result.light.map((item) => item.ratio)), placeholderContrast: result.placeholderContrast, fontUnchanged: true, darkUnchanged: result.darkUnchanged }))
} catch (error) {
  console.error(String(error)); process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app.kill('SIGTERM'); await pause(300)
  await rm(dataDir, { recursive: true, force: true })
}
