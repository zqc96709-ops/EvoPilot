import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type AiProviderId, type BackupInfo, type CaptureProviderConfig, type CaptureProviderId, type HackStartConfig } from './api'
import type { RecordData } from './model'
import { PRODUCT_NAME, resolveUserIdentity } from './product'
import { readPersistedValue } from './navigationPersistence'
import './settingsWorkspace.css'

export type SettingsSection = 'account' | 'general' | 'appearance' | 'ai' | 'aiContext' | 'voice' | 'sync' | 'data' | 'storage' | 'notifications' | 'providers' | 'privacy' | 'shortcuts' | 'help' | 'about' | 'logout'

const sections: Array<{ id: SettingsSection; label: string; group: string }> = [
  { id: 'account', label: '账户', group: '账户' }, { id: 'general', label: '通用', group: '账户' }, { id: 'appearance', label: '外观', group: '偏好' }, { id: 'aiContext', label: 'AI 协作上下文', group: '智能' }, { id: 'ai', label: 'AI 与模型', group: '智能' }, { id: 'voice', label: '语音', group: '智能' }, { id: 'sync', label: '同步与设备', group: '数据' }, { id: 'data', label: '数据与备份', group: '数据' }, { id: 'storage', label: '存储', group: '数据' }, { id: 'notifications', label: '通知', group: '偏好' }, { id: 'providers', label: 'Provider / API', group: '智能' }, { id: 'privacy', label: '隐私与安全', group: '安全' }, { id: 'shortcuts', label: '快捷键', group: '偏好' }, { id: 'help', label: '帮助与反馈', group: '支持' }, { id: 'about', label: `关于 ${PRODUCT_NAME}`, group: '支持' }, { id: 'logout', label: '退出登录', group: '账户' },
]

const navSections = sections.filter((section) => section.id !== 'logout')

const sectionFromHash = (): SettingsSection => {
  const value = window.location.hash.replace(/^#(?:settings(?:\/)?|settings-data\/?)/, '').replace(/^\//, '') as SettingsSection
  return readPersistedValue(value || localStorage.getItem('evopilot-settings-section'), sections.map((section) => section.id), 'account')
}

type Props = {
  profile?: RecordData
  themePreference: 'dark' | 'light' | 'auto'
  activeTheme: 'dark' | 'light'
  onThemeChange: (theme: 'dark' | 'light' | 'auto') => void
  aiConfig: HackStartConfig | null
  captureConfig: CaptureProviderConfig | null
  onSaveAiProvider: (provider: AiProviderId, key: string, model: string) => void
  onSaveCaptureProvider: (provider: CaptureProviderId, key: string) => void
  onSaveProfile: (data: Record<string, string>) => Promise<void>
  onExport: (format: 'json' | 'markdown' | 'csv') => void
  onBackup: () => void
  backups: BackupInfo[]
  onRestoreBackup: (path: string) => Promise<void>
  syncPanel: ReactNode
  onOpenVoice: () => void
  onNotice: (message: string, tone?: 'success' | 'danger') => void
}

const Unavailable = ({ title, text }: { title: string; text: string }) => <section className="settings-card unavailable"><h3>{title}</h3><p>{text}</p><span>当前版本未配置此能力</span></section>

const accountProfileFields = ['nickname', 'displayName', 'name', 'email', 'avatar'] as const
const aiContextProfileFields = ['occupation', 'role', 'organization', 'workDomains', 'longTermDirection', 'currentFocus', 'workStyle', 'decisionStyle', 'commonTools', 'otherContext', 'aiAssistancePreference', 'aiResponsePreference', 'aiDecisionPreference', 'aiOtherContext'] as const
const profileDraftFrom = (profile?: RecordData): Record<string, string> => Object.fromEntries([...accountProfileFields, ...aiContextProfileFields].map((key) => [key, String(profile?.[key] || '')]))
const pickProfileFields = (draft: Record<string, string>, fields: readonly string[]) => Object.fromEntries(fields.map((key) => [key, draft[key] || '']))

export default function SettingsWorkspace(props: Props) {
  const [section, setSection] = useState<SettingsSection>(sectionFromHash)
  const [profileDraft, setProfileDraft] = useState(() => profileDraftFrom(props.profile))
  const [savingProfile, setSavingProfile] = useState(false)
  const [provider, setProvider] = useState<AiProviderId>(props.aiConfig?.provider || 'deepseek')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [captureKey, setCaptureKey] = useState<Record<string, string>>({})
  const [provenance, setProvenance] = useState<Awaited<ReturnType<typeof api.buildProvenance>> | null>(null)
  const [cloudStatus, setCloudStatus] = useState(api.cloudStatus())
  const [restorePath, setRestorePath] = useState('')
  const [restoring, setRestoring] = useState(false)
  const identity = useMemo(() => resolveUserIdentity(props.profile), [props.profile])
  const select = (next: SettingsSection) => { setSection(next); localStorage.setItem('evopilot-settings-section', next); window.location.hash = `settings/${next}` }

  useEffect(() => { setProfileDraft(profileDraftFrom(props.profile)) }, [props.profile])
  useEffect(() => { const update = () => setSection(sectionFromHash()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update) }, [])
  useEffect(() => { api.buildProvenance().then(setProvenance).catch(() => {}) }, [])
  useEffect(() => { const active = props.aiConfig?.providers.find((item) => item.id === provider); setModel(active?.model || active?.models[0]?.id || '') }, [provider, props.aiConfig])

  const saveAccount = async () => { setSavingProfile(true); try { await props.onSaveProfile(pickProfileFields(profileDraft, accountProfileFields)); props.onNotice('账户资料已保存到本机。') } finally { setSavingProfile(false) } }
  const saveAiContext = async () => { setSavingProfile(true); try { await props.onSaveProfile(pickProfileFields(profileDraft, aiContextProfileFields)); props.onNotice('AI 协作上下文已保存到本机。') } finally { setSavingProfile(false) } }
  const restoreBackup = async () => { if (!restorePath) return; setRestoring(true); try { await props.onRestoreBackup(restorePath); setRestorePath('') } catch (error) { props.onNotice(`恢复失败：${String(error)}`, 'danger') } finally { setRestoring(false) } }
  const renderBody = () => {
    if (section === 'account') return <section className="settings-card account-card"><header><span className="settings-avatar">{identity.avatarUrl ? <img src={identity.avatarUrl} alt="" /> : identity.initial}</span><div><h2>{identity.accountLabel}</h2><p>账户资料仅保存在本机；不会改动现有项目、笔记或同步数据。</p></div></header><div className="settings-form"><label>昵称<input value={profileDraft.nickname} onChange={(event) => setProfileDraft({ ...profileDraft, nickname: event.target.value })} placeholder="侧栏显示名称" /></label><label>显示名称<input value={profileDraft.displayName} onChange={(event) => setProfileDraft({ ...profileDraft, displayName: event.target.value })} placeholder="昵称为空时使用" /></label><label>姓名<input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} /></label><label>邮箱<input value={profileDraft.email} onChange={(event) => setProfileDraft({ ...profileDraft, email: event.target.value })} placeholder="可选；只用于本机显示回退" /></label><label className="wide">头像 URL<input value={profileDraft.avatar} onChange={(event) => setProfileDraft({ ...profileDraft, avatar: event.target.value })} placeholder="可选" /></label></div><footer><span>订阅与 Credits：当前未配置。</span><button className="button primary" disabled={savingProfile} onClick={() => void saveAccount()}>{savingProfile ? '保存中…' : '保存账户资料'}</button></footer></section>
    if (section === 'general') return <Unavailable title="通用偏好" text="语言、启动行为与默认工作区尚未做成可配置项；系统不会伪造已生效的偏好。" />
    if (section === 'appearance') return <section className="settings-card"><h2>外观</h2><p>当前主题真实保存到本机。</p><div className="theme-picker">{(['dark', 'light', 'auto'] as const).map((item) => <button className={props.themePreference === item ? 'active' : ''} onClick={() => props.onThemeChange(item)} key={item}><strong>{{ dark: '深色', light: '浅色', auto: '自动' }[item]}</strong><small>{item === 'auto' ? '07:00–19:00 使用浅色' : item === props.activeTheme ? '当前正在使用' : '点击切换'}</small></button>)}</div></section>
    if (section === 'aiContext') return <section className="settings-card ai-context-card"><h2>AI 协作上下文</h2><p>类似 AGENTS.md / CLAUDE.md：记录长期有效的背景、协作偏好、决策原则与边界。内容只保存在本机，并仅在相关的 CEO、决策或个人问题中以精简摘要提供给 AI。</p><div className="settings-form settings-context-form"><label>职业 / 身份<input value={profileDraft.occupation} onChange={(event) => setProfileDraft({ ...profileDraft, occupation: event.target.value })} placeholder="例如：创业者、产品负责人" /></label><label>当前角色<input value={profileDraft.role} onChange={(event) => setProfileDraft({ ...profileDraft, role: event.target.value })} placeholder="例如：CEO、运营负责人" /></label><label>公司 / 组织<input value={profileDraft.organization} onChange={(event) => setProfileDraft({ ...profileDraft, organization: event.target.value })} placeholder="可选" /></label><label>主要工作领域<input value={profileDraft.workDomains} onChange={(event) => setProfileDraft({ ...profileDraft, workDomains: event.target.value })} placeholder="例如：跨境电商、产品、内容" /></label><label className="wide">长期方向<textarea value={profileDraft.longTermDirection} onChange={(event) => setProfileDraft({ ...profileDraft, longTermDirection: event.target.value })} placeholder="希望长期达成什么？" /></label><label className="wide">当前重点<textarea value={profileDraft.currentFocus} onChange={(event) => setProfileDraft({ ...profileDraft, currentFocus: event.target.value })} placeholder="当前最重要的项目、目标或约束" /></label><label className="wide">工作方式与决策原则<textarea value={profileDraft.workStyle} onChange={(event) => setProfileDraft({ ...profileDraft, workStyle: event.target.value })} placeholder="例如：先验证再投入；给出可执行的下一步" /></label><label>常用工具<input value={profileDraft.commonTools} onChange={(event) => setProfileDraft({ ...profileDraft, commonTools: event.target.value })} placeholder="例如：Notion、Excel、Figma" /></label><label>AI 决策支持偏好<input value={profileDraft.aiDecisionPreference} onChange={(event) => setProfileDraft({ ...profileDraft, aiDecisionPreference: event.target.value })} placeholder="例如：先给证据和风险" /></label><label className="wide">决策偏好<textarea value={profileDraft.decisionStyle} onChange={(event) => setProfileDraft({ ...profileDraft, decisionStyle: event.target.value })} placeholder="例如：偏好数据、风险、长期价值如何权衡" /></label><label className="wide">希望 AI 如何帮助我<textarea value={profileDraft.aiAssistancePreference} onChange={(event) => setProfileDraft({ ...profileDraft, aiAssistancePreference: event.target.value })} placeholder="例如：先指出假设与风险，再给出最小可执行方案" /></label><label className="wide">回答偏好<textarea value={profileDraft.aiResponsePreference} onChange={(event) => setProfileDraft({ ...profileDraft, aiResponsePreference: event.target.value })} placeholder="例如：中文、简洁、附带验证标准" /></label><label className="wide">其他长期背景<textarea value={profileDraft.otherContext} onChange={(event) => setProfileDraft({ ...profileDraft, otherContext: event.target.value })} placeholder="长期有效的个人或业务背景" /></label><label className="wide">AI 协作边界与其他上下文<textarea value={profileDraft.aiOtherContext} onChange={(event) => setProfileDraft({ ...profileDraft, aiOtherContext: event.target.value })} placeholder="例如：哪些事情必须先征求确认；不希望 AI 做什么" /></label></div><footer><span>AI 不能静默改写此说明；任何改动都由你在这里保存。</span><button className="button primary" disabled={savingProfile} onClick={() => void saveAiContext()}>{savingProfile ? '保存中…' : '保存 AI 上下文'}</button></footer></section>
    if (section === 'ai') { const selected = props.aiConfig?.providers.find((item) => item.id === provider); return <section className="settings-card"><h2>AI 与模型</h2><p>密钥仅写入应用私有凭据文件（0600），不会进入 SQLite 或导出文件。</p><div className="settings-form"><label>服务商<select value={provider} onChange={(event) => setProvider(event.target.value as AiProviderId)}>{props.aiConfig?.providers.map((item) => <option key={item.id} value={item.id}>{item.label}{item.configured ? '（已配置）' : ''}</option>)}</select></label><label>模型<select value={model} onChange={(event) => setModel(event.target.value)}>{selected?.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="wide">API Key<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={selected?.configured ? '已配置；留空只切换模型' : '粘贴 API Key'} /></label></div><footer><span>Endpoint：{selected?.baseUrl || '未配置'}</span><button className="button primary" onClick={() => { props.onSaveAiProvider(provider, apiKey, model); setApiKey('') }}>保存、测试并启用</button></footer></section> }
    if (section === 'voice') return <section className="settings-card"><h2>语音</h2><p>语音输入使用系统语音识别；只有你主动打开语音操作时才请求麦克风权限。原始录音不会写入本机记录或同步。</p><footer><span>状态：按需授权</span><button className="button primary" onClick={props.onOpenVoice}>打开语音操作</button></footer></section>
    if (section === 'sync') return <div className="settings-embedded">{props.syncPanel}</div>
    if (section === 'data') return <><section className="settings-card"><h2>数据与备份</h2><p>核心数据保存在本机 SQLite；导出和快照均为真实操作。</p><div className="settings-actions"><button onClick={() => props.onExport('json')}>导出 JSON</button><button onClick={() => props.onExport('markdown')}>导出 Markdown</button><button onClick={() => props.onExport('csv')}>导出 CSV</button><button className="button primary" onClick={props.onBackup}>创建 SQLite 快照</button></div></section><section className="settings-card"><h3>可恢复快照</h3>{props.backups.length ? <div className="settings-backups">{props.backups.slice(0, 8).map((backup) => <div key={backup.path}><span><b>{backup.name}</b><small>{new Date(Number(backup.modified)).toLocaleString('zh-CN')} · {(backup.size / 1024).toFixed(1)} KB</small></span><button onClick={() => setRestorePath(backup.path)}>恢复</button></div>)}</div> : <p>暂没有本地快照。</p>}</section></>
    if (section === 'storage') return <section className="settings-card"><h2>存储</h2><p>收纳箱附件保存在当前应用私有数据目录。文件资产引用使用稳定 FileAsset ID，不同步 Mac 绝对路径或临时链接。</p><span className="settings-status">本地优先 · Remote FileAsset 按需下载</span></section>
    if (section === 'notifications') return <Unavailable title="通知" text="桌面通知、邮件和推送尚未配置；不会显示虚假的开关状态。" />
    if (section === 'providers') return <section className="settings-card"><h2>外部情报 Provider / API</h2><p>每个 Provider 的 Key 独立保存并在保存时真实测试。</p><div className="provider-list">{props.captureConfig?.providers.map((item) => <div key={item.id}><span><b>{item.label}</b><small>{item.configured ? '已配置' : '未配置'} · {item.supportedPlatforms.join(' · ')}</small></span><input type="password" value={captureKey[item.id] || ''} onChange={(event) => setCaptureKey({ ...captureKey, [item.id]: event.target.value })} placeholder={item.configured ? '留空保留当前 Key' : '粘贴 API Key'} /><button onClick={() => { props.onSaveCaptureProvider(item.id, captureKey[item.id] || ''); setCaptureKey({ ...captureKey, [item.id]: '' }) }}>保存并测试</button></div>)}</div></section>
    if (section === 'privacy') return <section className="settings-card"><h2>隐私与安全</h2><p>本机数据库、附件和 API 凭据默认不上传。AI 与外部 Provider 仅在你发起请求时访问所需内容。</p><span className="settings-status">凭据文件权限：0600</span></section>
    if (section === 'shortcuts') return <section className="settings-card"><h2>快捷键</h2><div className="shortcut-list"><span><kbd>⌘ K</kbd> 命令面板</span><span><kbd>⌘ ⇧ Space</kbd> 打开收纳箱</span></div></section>
    if (section === 'help') return <Unavailable title="帮助与反馈" text="当前没有内建的反馈上传服务；请勿把问题提交到不明地址。" />
    if (section === 'about') return <section className="settings-card"><h2>关于 {PRODUCT_NAME}</h2><p>本机优先的个人操作系统。以下为当前运行版本的真实 provenance。</p>{provenance ? <dl className="provenance-list"><div><dt>应用路径</dt><dd>{provenance.appPath}</dd></div><div><dt>版本</dt><dd>{provenance.appVersion}</dd></div><div><dt>Git Commit</dt><dd>{provenance.gitCommit}</dd></div><div><dt>Build Time</dt><dd>{provenance.buildTime}</dd></div><div><dt>Schema / Protocol</dt><dd>{provenance.schemaVersion} / {provenance.syncProtocolVersion}</dd></div></dl> : <p>正在读取版本信息…</p>}</section>
    return <section className="settings-card"><h2>退出登录</h2><p>{cloudStatus.signedIn ? '这会退出兼容云同步账户，不会删除本机数据。' : '当前未登录兼容云同步账户。'}</p><button className="button danger" disabled={!cloudStatus.signedIn} onClick={() => void api.signOutFromCloud().then(() => { setCloudStatus(api.cloudStatus()); props.onNotice('已退出同步账户；本机数据未删除。') })}>退出同步账户</button></section>
  }

  return <div className="settings-workspace"><header className="settings-workspace-head"><div><p>{PRODUCT_NAME} · SETTINGS</p><h1>设置与工作区</h1><small>管理身份、偏好、AI、同步与本地数据。</small></div></header><div className="settings-workspace-body"><nav aria-label="设置分类">{Array.from(new Set(navSections.map((item) => item.group))).map((group) => <section key={group}><p>{group}</p>{navSections.filter((item) => item.group === group).map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => select(item.id)}>{item.label}</button>)}</section>)}<section className="settings-logout-nav"><button className={section === 'logout' ? 'active' : ''} onClick={() => select('logout')}>退出登录</button></section></nav><main>{renderBody()}</main></div>{restorePath && <div className="overlay-backdrop notebook-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !restoring && setRestorePath('')}><section className="notebook-action-dialog danger" role="dialog" aria-modal="true" aria-labelledby="restore-backup-title"><header><div><p>数据与备份</p><h3 id="restore-backup-title">确认恢复备份？</h3></div><button aria-label="关闭恢复确认" disabled={restoring} onClick={() => setRestorePath('')}>×</button></header><small>恢复前会自动创建当前数据库的安全备份，然后用所选快照替换本机数据。</small><footer><button className="button ghost" disabled={restoring} onClick={() => setRestorePath('')}>取消</button><button className="button danger" disabled={restoring} onClick={() => void restoreBackup()}>{restoring ? '正在恢复…' : '确认恢复'}</button></footer></section></div>}</div>
}
