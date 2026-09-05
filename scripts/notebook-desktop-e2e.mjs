import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const binary = process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/jason-os')
const dataDir = await mkdtemp(join(tmpdir(), 'jason-os-notebook-e2e-'))
const screenshotPath = resolve('artifacts/notebook-unified-capture-e2e.png')
const port = String(5300 + Math.floor(Math.random() * 200))
const endpoint = `http://127.0.0.1:${port}`
const log = []
const sourceImagePath = join(process.env.HOME, 'Downloads', `jason-image-persistence-${Date.now()}.png`)
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const frontend = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
frontend.stdout.on('data', (chunk) => log.push(chunk.toString()))
frontend.stderr.on('data', (chunk) => log.push(chunk.toString()))
let app
let sessionId = ''
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const request = async (path, body) => { const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response.json() }
const wait = async (check, label) => { const deadline = Date.now() + 15000; while (Date.now() < deadline) { try { const value = await check(); if (value) return value } catch {} await pause(120) } throw new Error(`Timed out: ${label}`) }
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args }).then((result) => result.value)
const executeAsync = (script, args = []) => request(`/session/${sessionId}/execute/async`, { script, args }).then((result) => result.value)
const click = (selector, text) => execute(`const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.includes(${JSON.stringify(text)}));if(!node)throw new Error('Missing '+${JSON.stringify(text)}+' in '+${JSON.stringify(selector)});node.click();return true`)
const save = async (entity, data) => { const result = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('save_record',{entity:arguments[0],data:arguments[1]}).then(done).catch((error)=>done({__error:String(error)}))`, [entity, data]); if (result?.__error) throw new Error(result.__error); return result }
const responseMs = {}
const responsive = async (label, action, check, limit = 500) => { const started = Date.now(); await action(); await wait(check, label); const elapsed = Date.now() - started; if (elapsed > limit) throw new Error(`${label} response ${elapsed}ms exceeds ${limit}ms`); responseMs[label] = elapsed }

try {
  await writeFile(sourceImagePath, Buffer.from(pngBase64, 'base64'))
  await wait(() => fetch('http://127.0.0.1:5174').then((response) => response.ok), 'Vite frontend')
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
  app.stdout.on('data', (chunk) => log.push(chunk.toString()))
  app.stderr.on('data', (chunk) => log.push(chunk.toString()))
  await wait(() => request('/status').then((result) => result.value?.ready), 'WebDriver server')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await pause(900)
  await wait(() => execute('return Boolean(document.querySelector(".sidebar .quick-capture"))'), 'sidebar navigation')

  const product = await save('notebookCategories', { name: '产品' })
  const ideas = await save('notebookCategories', { name: '商业想法' })
  const relationProject = await save('projects', { title: '关联项目验收' })
  for (let index = 0; index < 100; index += 1) await save('notebookCategories', { name: `长期分类 ${index + 1}` })
  await save('notes', { title: 'TikTok 工厂溯源直播灵感', content: '用真实工厂溯源与透明生产线直播，建立信任与差异化。', status: 'INBOX', type: 'NOTE', notebookCategoryId: product.id, tags: ['直播', '供应链'] })
  await save('notes', { title: 'OpenAI 发布升级版', content: '整理产品与行业动态。', status: 'INBOX', type: 'NOTE', notebookCategoryId: ideas.id, tags: ['AI'] })
  const longNote = await save('notes', { title: '长笔记滚动验收', content: Array.from({ length: 180 }, (_, index) => `第 ${index + 1} 行：用于验证右侧详情栏独立滚动，不能推动其他栏。`).join('\n'), status: 'INBOX', type: 'NOTE' })
  for (let index = 0; index < 28; index += 1) await save('notes', { title: `分类滚动验收 ${index + 1}`, content: '用于收纳箱独立滚动验收。', status: 'INBOX', type: 'NOTE' })
  await execute('document.querySelector("[aria-label=\\"刷新指挥中心\\"]")?.click();return true')
  await responsive('open inbox', () => click('.sidebar .quick-capture', '收纳箱'), () => execute('return Boolean(document.querySelector(".notebook-space"))'), 500)
  const text = await execute('return document.querySelector(".notebook-space").innerText')
  for (const expected of ['快速记录', '全部内容', '笔记', '链接', '图片', '视频', '文件', '语音', '稍后处理', '已归档', '管理分类', '今天收集', '本周收集', '有附件', '未分类', '立即收纳']) if (!text.includes(expected)) throw new Error(`Missing Unified Capture area: ${expected}`)
  const layout = await execute(`const box=(selector)=>document.querySelector(selector).getBoundingClientRect().toJSON();const nav=box('.notebook-sidebar'),header=box('.notebook-workspace-title'),capture=box('.notebook-capture'),list=box('.notebook-main'),detail=box('.notebook-preview');return {nav,header,capture,list,detail,body:document.scrollingElement.scrollHeight,viewport:window.innerHeight}`)
  if (Math.abs(layout.nav.top - layout.header.top) > 2 || layout.capture.left < layout.nav.right - 1 || Math.abs(layout.capture.right - layout.detail.right) > 2 || Math.abs(layout.list.top - layout.detail.top) > 2 || layout.body > layout.viewport + 2) throw new Error(`Workspace grid boundary mismatch: ${JSON.stringify(layout)}`)
  await responsive('all content filter', () => click('.notebook-filter-group button', '全部内容'), () => execute('return document.querySelector(".notebook-filter-group button.active")?.textContent.includes("全部内容")'), 100)
  await responsive('category filter', () => click('.notebook-category-list button', '产品'), () => execute('return document.querySelector(".notebook-category-list button.active")?.textContent.includes("产品") && document.querySelector(".notebook-content-list")?.innerText.includes("TikTok 工厂")'), 150)
  await responsive('return to inbox', () => click('.notebook-filter-group button', '未整理'), () => execute('return document.querySelector(".notebook-filter-group button.active")?.textContent.includes("未整理")'), 100)
  await responsive('quick capture', () => execute(`const input=document.querySelector('[aria-label="快速记录"]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'桌面端快速收纳验收');input.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('.notebook-capture-actions .button')].find((node)=>node.textContent.includes('立即收纳')).click();return true`), () => execute('return document.querySelector(".notebook-content-list")?.innerText.includes("桌面端快速收纳验收")'), 800)
  await responsive('open deletion fixture', () => click('.notebook-content-list article', '桌面端快速收纳验收'), () => execute('return document.querySelector(".notebook-editor-title")?.value === "桌面端快速收纳验收"'), 250)
  await responsive('open delete confirmation', () => execute('document.querySelector(".notebook-delete-note").click();return true'), () => execute('return Boolean(document.querySelector(".notebook-action-dialog.danger"))'), 150)
  await responsive('delete selected note', () => click('.notebook-action-dialog.danger .button', '确认删除'), () => execute('return !document.querySelector(".notebook-content-list")?.innerText.includes("桌面端快速收纳验收")'), 900)
  await responsive('open long note', () => click('.notebook-content-list article', '长笔记滚动验收'), () => execute('return document.querySelector(".notebook-editor-title")?.value === "长笔记滚动验收"'), 250)
  await execute(`document.querySelector('.notebook-image-button').click();return true`)
  await wait(() => execute('return Boolean(document.querySelector(".notebook-image-picker input[type=file]"))'), 'image picker')
  await execute(`const input=document.querySelector('.notebook-image-picker input[type=file]');const bytes=Uint8Array.from(atob(${JSON.stringify(pngBase64)}),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'jason-image-persistence.png',{type:'image/png'}));Object.defineProperty(input,'files',{value:transfer.files,configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));return true`)
  await wait(() => execute('return Boolean(document.querySelector(".notebook-rich-editor img[data-jason-file-id]")?.complete)'), 'managed image inserted')
  const managedFileId = await execute('return document.querySelector(".notebook-rich-editor img[data-jason-file-id]").dataset.jasonFileId')
  await unlink(sourceImagePath)
  await execute(`const editor=document.querySelector('.notebook-rich-editor');editor.focus();const bytes=Uint8Array.from(atob(${JSON.stringify(pngBase64)}),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'pasted.png',{type:'image/png'}));const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:transfer});editor.dispatchEvent(event);return true`)
  await wait(() => execute('return document.querySelectorAll(".notebook-rich-editor img[data-jason-file-id]").length===2'), 'clipboard image inserted')
  await execute(`const editor=document.querySelector('.notebook-rich-editor');editor.focus();const bytes=Uint8Array.from(atob(${JSON.stringify(pngBase64)}),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'dropped.png',{type:'image/png'}));const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:transfer});editor.dispatchEvent(event);return true`)
  await wait(() => execute('return document.querySelectorAll(".notebook-rich-editor img[data-jason-file-id]").length===3'), 'drag-drop image inserted')
  await responsive('save managed image note', () => execute('document.querySelector(".notebook-save-note").click();return true'), () => execute('return document.body.innerText.includes("笔记已保存")'), 900)
  const persistedImage = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('get_record',{id:arguments[0]}).then(done).catch((error)=>done({__error:String(error)}))`, [longNote.id])
  if (persistedImage?.__error || !String(persistedImage.contentHtml || '').includes(`jason-file://${managedFileId}`) || String(persistedImage.contentHtml || '').includes('blob:') || persistedImage.fileIds?.length !== 3) throw new Error(`Images did not persist as stable FileAsset references: ${JSON.stringify(persistedImage)}`)
  const persistedAsset = await executeAsync(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('get_record',{id:arguments[0]}).then(done).catch((error)=>done({__error:String(error)}))`, [managedFileId])
  if (persistedAsset?.__error || !persistedAsset.storageKey || !persistedAsset.sha256 || persistedAsset.storagePath || persistedAsset.localState !== 'LOCAL_AVAILABLE') throw new Error(`FileAsset metadata is not durable: ${JSON.stringify(persistedAsset)}`)
  await responsive('open relation picker', () => click('.notebook-editor-actions .button', '关联记录'), () => execute(`return [...document.querySelectorAll('.notebook-relation-popover option')].some((option)=>option.value===${JSON.stringify(relationProject.id)})`), 200)
  await responsive('save optional relation', () => execute(`const select=document.querySelector('.notebook-relation-popover select');select.value=${JSON.stringify(relationProject.id)};select.dispatchEvent(new Event('change',{bubbles:true}));[...document.querySelectorAll('.notebook-relation-popover .button')].find((node)=>node.textContent.includes('确认关联')).click();return true`), () => execute('return document.querySelector(".notebook-editor-relations")?.innerText.includes("关联项目验收")'), 700)
  const independentScroll = await execute(`const nav=document.querySelector('.notebook-sidebar');const main=document.querySelector('.notebook-main');const detail=document.querySelector('.notebook-preview');const body=document.scrollingElement;nav.scrollTop=9999;const afterNav={nav:nav.scrollTop,main:main.scrollTop,detail:detail.scrollTop,body:body.scrollTop};main.scrollTop=9999;const afterMain={nav:nav.scrollTop,main:main.scrollTop,detail:detail.scrollTop,body:body.scrollTop};detail.scrollTop=9999;return {afterNav,afterMain,afterDetail:{nav:nav.scrollTop,main:main.scrollTop,detail:detail.scrollTop,body:body.scrollTop},navHeight:nav.scrollHeight,navClient:nav.clientHeight,mainHeight:main.scrollHeight,mainClient:main.clientHeight,detailHeight:detail.scrollHeight,detailClient:detail.clientHeight}`)
  if (independentScroll.afterNav.nav <= 0 || independentScroll.afterNav.main !== 0 || independentScroll.afterNav.detail !== 0 || independentScroll.afterMain.main <= 0 || independentScroll.afterDetail.detail <= 0 || independentScroll.afterDetail.body !== 0) throw new Error(`Independent pane scrolling failed: ${JSON.stringify(independentScroll)}`)
  const colorToolbar = await execute(`const editor=document.querySelector('.notebook-rich-editor');editor.focus();const selection=getSelection();selection.selectAllChildren(editor);const color=document.querySelector('[aria-label="文字颜色"]');const highlight=document.querySelector('[aria-label="高亮颜色"]');color.value='#ff0000';color.dispatchEvent(new Event('input',{bubbles:true}));highlight.value='#00ff00';highlight.dispatchEvent(new Event('input',{bubbles:true}));return {color:Boolean(color),highlight:Boolean(highlight),toolbar:color.closest('[role="toolbar"]')===highlight.closest('[role="toolbar"]')}`)
  if (!colorToolbar.color || !colorToolbar.highlight || !colorToolbar.toolbar) throw new Error(`Editor color toolbar failed: ${JSON.stringify(colorToolbar)}`)
  const toolbarOverflow = await execute(`const compact=matchMedia('(max-width: 1350px)').matches;const more=document.querySelector('.notebook-toolbar-more');if(compact)more.querySelector('summary').click();return {compact,display:getComputedStyle(more).display,open:more.open,hasTextColor:Boolean(more.querySelector('[aria-label="更多文字颜色"]')),hasHighlight:Boolean(more.querySelector('[aria-label="更多高亮颜色"]'))}`)
  if (toolbarOverflow.compact && (toolbarOverflow.display === 'none' || !toolbarOverflow.open || !toolbarOverflow.hasTextColor || !toolbarOverflow.hasHighlight)) throw new Error(`Compact toolbar overflow failed: ${JSON.stringify(toolbarOverflow)}`)
  await responsive('smart filter', () => click('.notebook-smart-filter-row button', '今天收集'), () => execute('return document.querySelector(".notebook-smart-filter-row button.active")?.textContent.includes("今天收集")'), 100)
  await wait(() => execute('return document.querySelector(".notebook-content-list")?.innerText.includes("长笔记滚动验收")'), 'today smart-filter contents')
  await responsive('return to inbox after filter', () => click('.notebook-filter-group button', '未整理'), () => execute('return document.querySelector(".notebook-filter-group button.active")?.textContent.includes("未整理")'), 100)
  await execute(`document.querySelector('.notebook-sidebar').scrollTop=0;document.querySelector('.notebook-main').scrollTop=0;document.querySelector('.notebook-preview').scrollTop=0;return true`)
  const screenshot = await request(`/session/${sessionId}/screenshot`)
  await mkdir(dirname(screenshotPath), { recursive: true })
  await writeFile(screenshotPath, Buffer.from(screenshot.value, 'base64'))
  await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }); sessionId = ''
  app.kill('SIGTERM'); await pause(700)
  app = spawn(binary, [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
  await wait(() => request('/status').then((result) => result.value?.ready), 'WebDriver after restart')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await pause(700)
  await wait(() => execute('return Boolean(document.querySelector(".sidebar .quick-capture"))'), 'sidebar after restart')
  await click('.sidebar .quick-capture', '收纳箱')
  await wait(() => execute('return document.querySelector(".notebook-content-list")?.innerText.includes("长笔记滚动验收")'), 'persisted note after restart')
  await click('.notebook-content-list article', '长笔记滚动验收')
  await wait(() => execute(`const images=[...document.querySelectorAll('.notebook-rich-editor img[data-jason-file-id]')];return images.length===3 && images.every((image)=>image.complete && image.naturalWidth>0 && image.src.startsWith('data:image/'))`), 'managed file-picker, paste and drop images after offline restart')
  console.log(JSON.stringify({ status: 'passed', screenshotPath, responseMs, managedFileId, checks: ['four-column workspace', 'inbox navigation spans header/capture/body', '100-category independent navigation scroll', 'content and detail independent scrolling', 'quick capture defaults to inbox', 'smart filters in content pane', 'stable FileAsset image reference', 'source image deleted before restart', 'paste image restart', 'drag-drop image restart', 'offline app restart image hydration', 'sha256 and storageKey metadata', 'no absolute storagePath', 'editor text/highlight colors in toolbar', 'desktop screenshot'] }))
} catch (error) {
  const body = sessionId ? await execute('return document.documentElement.outerHTML').catch(() => '') : ''
  await writeFile(join(dataDir, 'failure.log'), `${String(error)}\n\n${body}\n\n${log.join('')}`)
  console.error(JSON.stringify({ status: 'failed', dataDir, error: String(error) }))
  process.exitCode = 1
} finally {
  if (sessionId) await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
  app?.kill('SIGTERM'); await pause(500)
  frontend.kill('SIGTERM')
  await unlink(sourceImagePath).catch(() => undefined)
  if (!process.exitCode) await rm(dataDir, { recursive: true, force: true })
}
