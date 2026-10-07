import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const dataDir = await mkdtemp(join(tmpdir(), 'evopolit-voice-retry-'))
const port = String(6000 + Math.floor(Math.random() * 100))
const endpoint = `http://127.0.0.1:${port}`
const app = spawn(process.env.JASON_OS_E2E_BIN || resolve('src-tauri/target/debug/bundle/macos/EvoPilot.app/Contents/MacOS/evopolit'), [], { env: { ...process.env, JASON_OS_DATA_DIR: dataDir, TAURI_WEBDRIVER_PORT: port, HACKSTART_API_KEY: 'test-no-network', DEEPSEEK_API_KEY: 'test-no-network', MINIMAX_TOKEN_PLAN_API_KEY: 'test-no-network' }, stdio: 'ignore' })
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
const invoke = (command, args = {}) => request(`/session/${sessionId}/execute/async`, { script: "const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done).catch(error=>done({__error:String(error)}))", args: [command, args] }).then(result=>result.value)
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
    await execute(`window.__voiceMode="${mode}";[...document.querySelectorAll(".voice-panel footer button")].find(node=>/开始说话|继续说话/.test(node.textContent)).click();return true`)
    await wait(() => execute('return document.querySelector(".voice-transcript")?.innerText.includes("打开开始界面")'), 'displayed interim transcript')
    assert(await execute('return !document.querySelector(".voice-result")'), 'interim text does not auto-execute or produce a false empty-speech error')
    await execute('[...document.querySelectorAll(".voice-panel footer button")].find(node=>node.textContent.includes("停止并执行")).click();return true')
    await wait(() => execute('return document.querySelector(".voice-result")?.innerText.includes("已打开指挥中心")'), `${mode} preserves displayed text for explicit navigation`)
  }
  const database=join(dataDir,'jason-os.sqlite3')
  const timerCount=(runningOnly=false)=>Number(execFileSync('sqlite3',[database,`SELECT count(*) FROM records WHERE entity='timeLogs'${runningOnly?" AND json_extract(data_json,'$.isRunning')=1":""}`],{encoding:'utf8'}).trim())
  const voiceCommand=async(text,expected)=>{
    await execute(`window.__voiceMode="success";window.__voiceText=${JSON.stringify(text)};[...document.querySelectorAll(".voice-panel footer button")].find(node=>/开始说话|继续说话/.test(node.textContent)).click();return true`)
    await wait(()=>execute(`return !document.querySelector(".voice-result")&&[...document.querySelectorAll(".voice-panel footer button")].some(node=>node.textContent.includes("停止并执行"))&&document.querySelector(".voice-transcript")?.innerText.includes(${JSON.stringify(text)})`),'voice command transcript')
    await execute('[...document.querySelectorAll(".voice-panel footer button")].find(node=>node.textContent.includes("停止并执行")).click();return true')
    await wait(()=>execute(`return document.querySelector(".voice-result")?.innerText.includes(${JSON.stringify(expected)})`),'voice command result')
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
  const pages=[['收纳箱','notebook'],['任务','tasks'],['项目','projects'],['今天','today'],['时间','time'],['成果','outcomes'],['财务','finance'],['决策中心','decisionCenter'],['认知中心','cognition'],['知识','knowledge'],['复盘','reviews'],['洞见','insights'],['原则','principles'],['思维模型','mentalModels'],['指挥中心','command'],['事件','events'],['人物','people'],['时间线','timeline'],['AI News Radar','aiNews'],['设置','settings'],['我的档案','profile']]
  for(const [label,page] of pages) {
    await voiceCommand('打开'+label,'已打开'+label)
    await wait(()=>execute(`return localStorage.getItem('evopilot-last-view')===${JSON.stringify(page)}`),'actual page '+page)
  }
  const settings=[['外观设置','appearance','外观'],['设置中的语音','voice','语音'],['账户设置','account','账户'],['AI 与模型设置','ai','AI 与模型'],['AI 协作上下文','aiContext','AI 协作上下文'],['同步与设备','sync','同步与设备'],['数据与备份','data','数据与备份'],['隐私与安全','privacy','隐私与安全'],['通知设置','notifications','通知'],['快捷键设置','shortcuts','快捷键'],['Provider / API','providers','Provider / API'],['退出登录页面','logout','退出登录'],['关于 EvoPilot','about','关于 EvoPilot'],['存储设置','storage','存储'],['帮助与反馈','help','帮助与反馈'],['通用设置','general','通用']]
  for(const [command,section,label] of settings) {
    await voiceCommand('打开'+command,'已打开'+label)
    await wait(()=>execute(`return location.hash===${JSON.stringify('#settings/'+section)}&&localStorage.getItem('evopilot-settings-section')===${JSON.stringify(section)}&&document.querySelector('.settings-workspace nav button.active')?.textContent.includes(${JSON.stringify(label)})`),'actual settings section '+section)
  }
  await voiceCommand('打开外观设置','已打开外观')
  const countBeforeThemes=execFileSync('sqlite3',[database,'SELECT count(*) FROM records'],{encoding:'utf8'}).trim()
  for(const [command,preference] of [['打开暗色模式','dark'],['打开浅色模式','light'],['切换到自动主题','auto'],['打开浅色模式','light']]) {
    await voiceCommand(command,preference==='auto'?'已开启自动主题':'已切换为')
    await wait(()=>execute(`const active=${JSON.stringify(preference)}==='auto'?(new Date().getHours()>=7&&new Date().getHours()<19?'light':'dark'):${JSON.stringify(preference)};return localStorage.getItem('jason-os-theme')===${JSON.stringify(preference)}&&document.documentElement.dataset.theme===active&&document.querySelector('.app-shell').classList.contains('light-theme')===(active==='light')&&document.querySelector('.theme-picker button.active strong')?.textContent===${JSON.stringify({dark:'深色',light:'浅色',auto:'自动'}[preference])}`),'theme changes live and persists '+preference)
  }
  assert(execFileSync('sqlite3',[database,'SELECT count(*) FROM records'],{encoding:'utf8'}).trim()===countBeforeThemes,'settings shortcuts do not write business or audit records')
  await voiceCommand('打开 AI 助理','已打开AI 助理')
  assert(await execute('return !!document.querySelector(".ai-drawer")'),'assistant actually opens')
  await execute('document.querySelector("[aria-label=\\"关闭语音操作\\"]").click();return true')
  assert(await execute('const voice=document.querySelector(".ai-composer-voice"),model=document.querySelector(".ai-composer-model");return !!voice&&voice.nextElementSibling===model'),'voice input is immediately left of model selector')
  assert(await execute('const voice=document.querySelector(".ai-voice-trigger").getBoundingClientRect(),model=document.querySelector(".ai-composer-model-trigger").getBoundingClientRect();return voice.right<=model.left&&Math.abs(voice.height-model.height)<1&&model.right<innerWidth'),'voice matches model button height and does not overlap')
  for(const light of [false,true]) {
    assert(await execute(`document.querySelector('.app-shell').classList.toggle('light-theme',${light});const s=getComputedStyle(document.querySelector('.ai-voice-trigger'));return s.color!==s.backgroundColor&&s.color===getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--text').trim().replace(/^#([0-9a-f]{6})$/i,(_,h)=>'rgb('+[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)).join(', ')+')')`),'inline voice contrast in '+(light?'light':'dark')+' theme')
  }
  await execute('document.querySelector(".ai-composer-model-trigger").click();return true')
  assert(await execute('return !!document.querySelector(".ai-composer-model-menu")'),'model selector remains usable next to microphone')
  await execute('document.querySelector(".ai-composer-model-trigger").click();return true')
  const chatCount=await execute('return document.querySelectorAll(".ai-chat article").length')
  const setDraft=async(text)=>execute(`const input=document.querySelector('.ai-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));return true`)
  await setDraft('原有草稿')
  for(let i=0;i<3;i++) {
    await execute('window.__voiceMode="error";document.querySelector(".ai-voice-trigger").click();return true')
    await wait(()=>execute('return document.querySelector(".ai-voice-status")?.innerText.includes("service-not-allowed")&&!document.querySelector(".ai-voice-trigger").disabled'),'inline speech failure can retry')
    assert(await execute('return document.querySelector(".ai-composer textarea").value==="原有草稿"'),'error preserves draft')
  }
  await execute('window.__voiceMode="success";window.__voiceText="语音输入验收";document.querySelector(".ai-voice-trigger").click();return true')
  await wait(()=>execute('return document.querySelector(".ai-voice-status")?.innerText.includes("语音输入验收")'),'inline transcript preview')
  assert(await execute('return document.querySelector(".ai-composer textarea").disabled&&document.querySelector(".ai-send").disabled&&!document.querySelector(".voice-panel")'),'dictation stays inline and cannot send before finishing')
  await execute('document.querySelector(".ai-voice-trigger").click();return true')
  await wait(()=>execute('return document.querySelector(".ai-composer textarea").value==="原有草稿\\n语音输入验收"&&!document.querySelector(".ai-composer textarea").disabled'),'dictation appends editable text to existing draft')
  assert(await execute(`return document.querySelectorAll('.ai-chat article').length===${chatCount}`),'dictation never automatically sends a message')
  await execute('window.__voiceText="取消后不应填入";document.querySelector(".ai-voice-trigger").click();return true')
  await wait(()=>execute('return document.querySelector(".ai-voice-status")?.innerText.includes("取消后不应填入")'),'second dictation starts')
  await execute('document.querySelector("[aria-label=\\"取消语音输入\\"]").click();return true')
  await wait(()=>execute('return !document.querySelector(".ai-voice-status")&&!document.querySelector(".ai-composer textarea").disabled'),'cancel releases inline input')
  assert(await execute('return document.querySelector(".ai-composer textarea").value==="原有草稿\\n语音输入验收"'),'cancel does not append discarded speech')
  const stopsBeforeClose=await execute('return window.__voiceStops')
  await execute('document.querySelector(".ai-voice-trigger").click();return true')
  await wait(()=>execute('return document.querySelector(".ai-voice-trigger").getAttribute("aria-pressed")==="true"'),'dictation starts before close')
  await execute('document.querySelector(".ai-drawer>header>button").click();return true')
  await wait(()=>execute(`return !document.querySelector('.ai-drawer')&&window.__voiceStops>${stopsBeforeClose}`),'drawer close releases microphone')
  await execute('document.querySelector(".sidebar-voice").click();return true')
  await wait(()=>execute('return !!document.querySelector(".voice-panel")'),'sidebar voice remains available after inline dictation')
  await voiceCommand('搜索语音验收','正在搜索：语音验收')
  await wait(()=>execute('return !!document.querySelector(".search-overlay")'),'global search actually opens')
  // Only the model planning response is mocked. Confirmation, cancellation and writes use real Rust + isolated SQLite.
  await execute(`window.__realVoiceInvoke=window.__TAURI_INTERNALS__.invoke;window.__voicePlans=0;
    const realFetch=window.fetch.bind(window), plannerUrl=window.__TAURI_INTERNALS__.convertFileSrc('ask_chief','ipc');
    window.fetch=async(url,options)=>{
      if(String(url)!==plannerUrl)return realFetch(url,options);
      const args=JSON.parse(options.body);window.__voicePlans++;window.__lastVoiceRequest=args;
      if(!args.context.voiceMode||!args.toolDefinitions.some(tool=>tool.name==='deleteNote'))throw Error('global voice tools missing');
      const action=window.__voicePlan?await window.__realVoiceInvoke('save_record',{entity:'agentActions',data:window.__voicePlan}):undefined;
      return new Response(JSON.stringify({answer:action?'请确认':'本月财务查询已完成（模拟模型回答）',action}),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}});
    };return true`)
  assert(await execute('return window.fetch.toString().includes("__voicePlans")'),'planner mock installed')
  const row=async(id)=>{const value=await invoke('get_record',{id});assert(!value?.__error,'read record');return value}
  let planNumber=0
  const plan=async(tool,entity,input)=>{
    const id='voice-global-action-'+(++planNumber)
    await execute(`window.__voicePlan=${JSON.stringify({id,actionId:id,toolName:tool,entityType:entity,input,status:'CONFIRM_REQUIRED',requiresConfirmation:true,userConfirmed:false,source:'VOICE',previewTitle:'准备执行：'+tool,previewFields:[{label:'目标',value:input.title||input.name||input.id}]})};return true`)
    return id
  }
  await execute('window.__voicePlan=null;return true')
  await voiceCommand('查看项目本月收入','本月财务查询已完成')
  assert(await execute('return window.__lastVoiceRequest.question==="查看项目本月收入"'),'specific query reaches global agent unchanged')
  for(const [tool,entity,input] of [['createEvent','events',{id:'voice-event',title:'语音验收会议'}],['createPerson','people',{id:'voice-person',name:'语音验收联系人'}]]) {
    await plan(tool,entity,input)
    await voiceCommand('创建'+(entity==='events'?'事件语音验收会议':'人物语音验收联系人'),'准备执行')
    assert(!(await row(input.id)),'no business write before confirmation')
    await voiceCommand('确认执行','已完成')
    assert((await row(input.id))?.entity===entity,'confirmed voice creation persisted')
  }
  const note=await invoke('save_record',{entity:'notes',data:{id:'voice-note',title:'语音验收笔记',content:'原文'}})
  assert(note?.id==='voice-note','real note fixture')
  await plan('updateNote','notes',{id:note.id,title:'语音验收笔记',content:'修改后的正文'})
  await voiceCommand('修改笔记语音验收笔记正文为修改后的正文','准备执行')
  assert((await row(note.id)).content==='原文','update waits for confirmation')
  await voiceCommand('确认执行','已完成')
  assert((await row(note.id)).content==='修改后的正文','confirmed update persisted')
  await plan('deleteNote','notes',{id:note.id})
  await voiceCommand('删除笔记语音验收笔记','准备执行')
  assert((await row(note.id)).content==='修改后的正文','delete waits for confirmation')
  await voiceCommand('取消操作','已取消')
  assert(!(await row(note.id)).deletedAt,'cancellation preserves note')
  await plan('deleteNote','notes',{id:note.id})
  await voiceCommand('删除笔记语音验收笔记','准备执行')
  await voiceCommand('确认执行','已删除')
  assert(!(await row(note.id))&&Number(execFileSync('sqlite3',[database,"SELECT count(*) FROM records WHERE id='voice-note' AND deleted_at IS NOT NULL"],{encoding:'utf8'}).trim())===1,'confirmed deletion uses real soft-delete')
  const wrong=await plan('deleteProject','projects',{id:'voice-person'})
  await invoke('save_record',{entity:'agentActions',data:{id:wrong,actionId:wrong,toolName:'deleteProject',input:{id:'voice-person'},status:'CONFIRM_REQUIRED'}})
  const rejected=await invoke('execute_ai_action',{actionId:wrong})
  assert(rejected.__error?.includes('不匹配'),'backend rejects mismatched record type')
  assert(!(await row('voice-person')).deletedAt,'mismatched target remains intact')
  await execute('document.querySelector(".app-shell").classList.add("light-theme");return true')
  const contrast=await execute('const panel=document.querySelector(".voice-panel"),shell=document.querySelector(".app-shell");return {background:getComputedStyle(panel).backgroundColor,text:getComputedStyle(panel).color,expectedText:getComputedStyle(shell).getPropertyValue("--text").trim()}')
  assert(contrast.background==='rgb(255, 255, 255)','voice panel uses light theme surface')
  assert(contrast.text!==contrast.background,'voice panel text visible')
  if(process.env.VOICE_RETRY_SCREENSHOT) {
    const shot=(await request(`/session/${sessionId}/screenshot`)).value
    await writeFile(process.env.VOICE_RETRY_SCREENSHOT,Buffer.from(shot,'base64'))
  }
  assert(execFileSync('sqlite3',[database,'PRAGMA integrity_check'],{encoding:'utf8'}).trim()==='ok','database integrity')
  await execute('location.reload();return true')
  await wait(()=>execute('return !!document.querySelector(".settings-workspace")&&document.documentElement.dataset.theme==="light"&&localStorage.getItem("jason-os-theme")==="light"&&document.querySelector(".settings-workspace nav button.active")?.textContent.includes("外观")'),'voice appearance settings survive reload')
  console.log(JSON.stringify({status:'passed',sidebarVoiceEntry:true,inlineAssistantVoice:true,dictationPreservesDraft:true,dictationRequiresSend:true,dictationRetryCancelAndClose:true,entryHeight,voiceTimerStartStop:true,duplicateTimerPrevented:true,manualTimerPreserved:true,globalPages:pages.length,settingsSections:settings.length,themeSwitchAndPersistence:true,globalQuery:true,confirmedCreateUpdateDelete:true,cancelPreservesRecord:true,wrongTargetBlocked:true,realAiRequests:0,retryClicks:starts,transcriptNavigation:true,interimEndNavigation:true,interimStopNavigation:true,noAutomaticExecution:true,contrast,realMicrophoneTested:false,realSpeechServiceTested:false}))
} catch(error) {
  if(sessionId)console.error(await execute('return {panel:document.querySelector(".voice-panel")?.innerText,toast:document.querySelector(".toast")?.innerText,plans:window.__voicePlans,last:window.__lastVoiceRequest?.question,starts:window.__voiceStarts,stops:window.__voiceStops}').catch(()=>null))
  console.error(String(error));process.exitCode=1
} finally {
  if(sessionId)await fetch(`${endpoint}/session/${sessionId}`,{method:'DELETE'}).catch(()=>undefined)
  app.kill('SIGTERM');await pause(300)
  await rm(dataDir,{recursive:true,force:true})
}
