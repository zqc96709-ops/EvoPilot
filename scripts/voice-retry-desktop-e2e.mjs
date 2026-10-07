import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const dataDir = await mkdtemp(join(tmpdir(), 'evopolit-voice-retry-'))
const port = String(6000 + Math.floor(Math.random() * 100))
const endpoint = `http://127.0.0.1:${port}`
const app = spawn(process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/bundle/macos/EvoPilot.app/Contents/MacOS/evopolit'), [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port }, stdio: 'ignore' })
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
const assert = (condition, label) => { if (!condition) throw new Error(label) }
try {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :NSSpeechRecognitionUsageDescription', resolve('src-tauri/target/debug/bundle/macos/EvoPilot.app/Contents/Info.plist')])
  await wait(() => request('/status').then(result => result.value?.ready), 'WebDriver')
  sessionId = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } })).value.sessionId
  await wait(() => execute('return !!document.querySelector(".account-footer")'), 'shell')
  await execute('document.querySelector(".account-footer").click();return true')
  await wait(() => execute('return !!document.querySelector(".settings-workspace")'), 'settings')
  await execute('[...document.querySelectorAll(".settings-workspace nav button")].find(node=>node.textContent.trim()==="语音").click();return true')
  await execute('[...document.querySelectorAll(".settings-workspace main button")].find(node=>node.textContent.includes("打开语音操作")).click();return true')
  await wait(() => execute('return !!document.querySelector(".voice-panel")'), 'voice panel')

  // Browser-event mocks only; no real microphone, speech service or AI network request.
  await execute(`
    window.__voiceStarts=0;window.__voiceStops=0;window.__voiceMode="error";
    class Recognition {
      start(){window.__voiceStarts++;queueMicrotask(()=>{
        if(window.__voiceMode==="error")this.onerror?.({error:"service-not-allowed"});
        else this.onresult?.({results:[{0:{transcript:"打开今天"},isFinal:true}]});
      })}
      stop(){} abort(){}
    }
    Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:Recognition});
    Object.defineProperty(window,"webkitSpeechRecognition",{configurable:true,value:Recognition});
    Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){window.__voiceStops++}}]})}});
    Object.defineProperty(window,"AudioContext",{configurable:true,value:class{
      createMediaStreamSource(){return {connect(){}}}createAnalyser(){return {fftSize:256,getByteTimeDomainData(){}}}close(){return Promise.resolve()}
    }});
    Object.defineProperty(window,"MediaRecorder",{configurable:true,value:class{constructor(){throw Error("No recording in test")}}});
    return true;
  `)
  for (let i=0;i<10;i++) {
    await execute('[...document.querySelectorAll(".voice-panel footer button")].find(node=>node.textContent.includes("开始说话")).click();return true')
    await wait(() => execute(`const button=[...document.querySelectorAll(".voice-panel footer button")].find(node=>node.textContent.includes("开始说话"));return window.__voiceStarts===${i+1}&&document.querySelector(".voice-panel").innerText.includes("service-not-allowed")&&!!button&&!button.disabled`), 'retryable recognition error')
    const usable=await execute('const button=[...document.querySelectorAll(".voice-panel footer button")].find(node=>node.textContent.includes("开始说话"));return !!button&&!button.disabled')
    assert(usable,'start button usable after error')
  }
  const starts=await execute('return window.__voiceStarts')
  assert(starts===10,'all ten retry clicks start a fresh recognition')
  assert(await execute('return window.__voiceStops===10'),'microphone tracks released after failures')
  await execute('window.__voiceMode="success";[...document.querySelectorAll(".voice-panel footer button")].find(node=>node.textContent.includes("开始说话")).click();return true')
  await wait(() => execute('return document.querySelector(".voice-transcript")?.innerText.includes("打开今天")'), 'recognized transcript')
  await execute('[...document.querySelectorAll(".voice-panel footer button")].find(node=>node.textContent.includes("停止并执行")).click();return true')
  await wait(() => execute('return document.querySelector(".voice-result")?.innerText.includes("已打开")'), 'deterministic voice navigation')
  await execute('document.querySelector(".app-shell").classList.add("light-theme");return true')
  const contrast=await execute('const panel=document.querySelector(".voice-panel"),shell=document.querySelector(".app-shell");return {background:getComputedStyle(panel).backgroundColor,text:getComputedStyle(panel).color,expectedText:getComputedStyle(shell).getPropertyValue("--text").trim()}')
  assert(contrast.background==='rgb(255, 255, 255)','voice panel uses light theme surface')
  assert(contrast.text!==contrast.background,'voice panel text visible')
  if(process.env.VOICE_RETRY_SCREENSHOT) {
    const shot=(await request(`/session/${sessionId}/screenshot`)).value
    await writeFile(process.env.VOICE_RETRY_SCREENSHOT,Buffer.from(shot,'base64'))
  }
  const database=join(dataDir,'jason-os.sqlite3')
  assert(execFileSync('sqlite3',[database,'PRAGMA integrity_check'],{encoding:'utf8'}).trim()==='ok','database integrity')
  console.log(JSON.stringify({status:'passed',retryClicks:starts,transcriptNavigation:true,contrast,realMicrophoneTested:false,realSpeechServiceTested:false}))
} catch(error) {
  if(sessionId)console.error(await execute('return {panel:document.querySelector(".voice-panel")?.innerText,starts:window.__voiceStarts,stops:window.__voiceStops}').catch(()=>null))
  console.error(String(error));process.exitCode=1
} finally {
  if(sessionId)await fetch(`${endpoint}/session/${sessionId}`,{method:'DELETE'}).catch(()=>undefined)
  app.kill('SIGTERM');await pause(300)
  await rm(dataDir,{recursive:true,force:true})
}
