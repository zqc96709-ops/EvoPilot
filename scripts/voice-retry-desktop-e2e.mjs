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
  assert(await execute('return document.querySelector(".sidebar-voice strong")?.textContent==="语音"'), 'sidebar timer entry replaced by voice')
  const entryHeight=await execute('return document.querySelector(".sidebar-voice").getBoundingClientRect().height')
  const captureHeight=await execute('return document.querySelector(".quick-capture").getBoundingClientRect().height')
  assert(entryHeight>0&&Math.abs(entryHeight-captureHeight)<.5,`voice entry preserves existing card height (${entryHeight}/${captureHeight})`)
  await execute('document.querySelector(".sidebar-voice").click();return true')
  await wait(() => execute('return !!document.querySelector(".voice-panel")'), 'voice panel')

  // Browser-event mocks only; no real microphone, speech service or AI network request.
  await execute(`
    window.__voiceStarts=0;window.__voiceStops=0;window.__voiceMode="error";window.__voiceText="打开今天";
    class Recognition {
      start(){window.__voiceStarts++;queueMicrotask(()=>{
        if(window.__voiceMode==="error")this.onerror?.({error:"service-not-allowed"});
        else {
          this.onresult?.({results:[{0:{transcript:window.__voiceMode==="success"?window.__voiceText:"打开开始界面"},isFinal:window.__voiceMode==="success"}]});
          if(window.__voiceMode==="interim-end")this.onend?.();
        }
      })}
      stop(){queueMicrotask(()=>this.onend?.())} abort(){}
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
  for(const mode of ['interim-end','interim-stop']) {
    await execute(`window.__voiceMode="${mode}";[...document.querySelectorAll(".voice-panel footer button")].find(node=>node.textContent.includes("开始说话")).click();return true`)
    await wait(() => execute('return document.querySelector(".voice-transcript")?.innerText.includes("打开开始界面")'), 'displayed interim transcript')
    assert(await execute('return !document.querySelector(".voice-result")'), 'interim text does not auto-execute or produce a false empty-speech error')
    await execute('[...document.querySelectorAll(".voice-panel footer button")].find(node=>node.textContent.includes("停止并执行")).click();return true')
    await wait(() => execute('return document.querySelector(".voice-result")?.innerText.includes("已打开指挥中心")'), `${mode} preserves displayed text for explicit navigation`)
  }
  const database=join(dataDir,'jason-os.sqlite3')
  const timerCount=(runningOnly=false)=>Number(execFileSync('sqlite3',[database,`SELECT count(*) FROM records WHERE entity='timeLogs'${runningOnly?" AND json_extract(data_json,'$.isRunning')=1":""}`],{encoding:'utf8'}).trim())
  const voiceCommand=async(text,expected)=>{
    await execute(`window.__voiceMode="success";window.__voiceText=${JSON.stringify(text)};[...document.querySelectorAll(".voice-panel footer button")].find(node=>node.textContent.includes("开始说话")).click();return true`)
    await wait(()=>execute(`return !document.querySelector(".voice-result")&&[...document.querySelectorAll(".voice-panel footer button")].some(node=>node.textContent.includes("停止并执行"))&&document.querySelector(".voice-transcript")?.innerText.includes(${JSON.stringify(text)})`),'timer command transcript')
    await execute('[...document.querySelectorAll(".voice-panel footer button")].find(node=>node.textContent.includes("停止并执行")).click();return true')
    await wait(()=>execute(`return document.querySelector(".voice-result")?.innerText.includes(${JSON.stringify(expected)})`),'timer command result')
  }
  await voiceCommand('开始计时','已开始计时')
  assert(timerCount(true)===1&&timerCount()===1,'voice creates one real running timer')
  await wait(()=>execute('return document.querySelector(".sidebar-voice")?.innerText.includes("计时中")'),'running status on voice entry')
  await execute('document.querySelector("[aria-label=\\"关闭语音操作\\"]").click();return true')
  await wait(()=>execute('return !document.querySelector(".voice-panel")'),'voice panel closes')
  await execute('document.querySelector(".sidebar-voice").click();return true')
  await wait(()=>execute('return !!document.querySelector(".voice-panel")'),'voice entry works while timer runs')
  assert(timerCount(true)===1,'opening voice never stops a running timer')
  await voiceCommand('开始计时','已有计时正在运行')
  assert(timerCount()===1,'repeated start never creates a duplicate timer')
  await voiceCommand('停止计时','已停止计时')
  assert(timerCount(true)===0&&timerCount()===1,'voice stops and saves the same timer')
  assert(Number(execFileSync('sqlite3',[database,"SELECT count(*) FROM records WHERE entity='timeLogs' AND json_extract(data_json,'$.endAt') IS NOT NULL AND json_extract(data_json,'$.durationMinutes')>=1"],{encoding:'utf8'}).trim())===1,'stopped timer has an end time and recorded duration')
  await voiceCommand('停止计时','当前没有正在运行的计时')
  assert(timerCount()===1,'repeated stop does not write an extra timer')
  await execute('document.querySelector("[aria-label=\\"关闭语音操作\\"]").click();[...document.querySelectorAll(".sidebar nav button")].find(node=>node.textContent.includes("时间")).click();return true')
  await wait(()=>execute('return !!document.querySelector(".time-intelligence")'),'manual timer page remains available')
  await execute('[...document.querySelectorAll(".ti-header button")].find(node=>node.textContent.includes("开始计时")).click();return true')
  await wait(()=>execute('return !!document.querySelector(".timer-start-modal")'),'manual timer dialog preserved')
  await execute('[...document.querySelectorAll(".timer-start-modal footer button")].find(node=>node.textContent.includes("开始计时")).click();return true')
  await wait(()=>execute('return [...document.querySelectorAll(".ti-header button")].some(node=>node.textContent.includes("停止计时"))'),'manual timer starts')
  await execute('[...document.querySelectorAll(".ti-header button")].find(node=>node.textContent.includes("停止计时")).click();return true')
  await wait(()=>execute('return [...document.querySelectorAll(".ti-header button")].some(node=>node.textContent.includes("开始计时"))'),'manual timer stops')
  assert(timerCount()===2&&timerCount(true)===0,'manual timing still writes a completed log')
  await execute('document.querySelector(".sidebar-voice").click();return true')
  await wait(()=>execute('return !!document.querySelector(".voice-panel")'),'voice entry remains available on time page')
  await execute('document.querySelector(".app-shell").classList.add("light-theme");return true')
  const contrast=await execute('const panel=document.querySelector(".voice-panel"),shell=document.querySelector(".app-shell");return {background:getComputedStyle(panel).backgroundColor,text:getComputedStyle(panel).color,expectedText:getComputedStyle(shell).getPropertyValue("--text").trim()}')
  assert(contrast.background==='rgb(255, 255, 255)','voice panel uses light theme surface')
  assert(contrast.text!==contrast.background,'voice panel text visible')
  if(process.env.VOICE_RETRY_SCREENSHOT) {
    const shot=(await request(`/session/${sessionId}/screenshot`)).value
    await writeFile(process.env.VOICE_RETRY_SCREENSHOT,Buffer.from(shot,'base64'))
  }
  assert(execFileSync('sqlite3',[database,'PRAGMA integrity_check'],{encoding:'utf8'}).trim()==='ok','database integrity')
  console.log(JSON.stringify({status:'passed',sidebarVoiceEntry:true,entryHeight,voiceTimerStartStop:true,duplicateTimerPrevented:true,manualTimerPreserved:true,retryClicks:starts,transcriptNavigation:true,interimEndNavigation:true,interimStopNavigation:true,noAutomaticExecution:true,contrast,realMicrophoneTested:false,realSpeechServiceTested:false}))
} catch(error) {
  if(sessionId)console.error(await execute('return {panel:document.querySelector(".voice-panel")?.innerText,starts:window.__voiceStarts,stops:window.__voiceStops}').catch(()=>null))
  console.error(String(error));process.exitCode=1
} finally {
  if(sessionId)await fetch(`${endpoint}/session/${sessionId}`,{method:'DELETE'}).catch(()=>undefined)
  app.kill('SIGTERM');await pause(300)
  await rm(dataDir,{recursive:true,force:true})
}
