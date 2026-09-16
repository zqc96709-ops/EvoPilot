import { useState } from 'react'
import { api } from './api'
import CapabilityWorkspace, { CreatePack } from './CapabilityWorkspace'
import { packItemsFor } from './capability'
import { titleFor, type RecordData } from './model'

const packTypeLabel: Record<string, string> = { ROLE: '岗位能力包', MANAGEMENT: '管理能力包', VENTURE: '创业经营能力包', CUSTOM: '自定义能力包' }

export default function CapabilityLibrary({ records, onOpen, onApply, onRefresh }: { records: RecordData[]; onOpen: (record: RecordData) => void; onApply: (pack: RecordData, projectId: string) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(''); const [createOpen, setCreateOpen] = useState(false); const [query, setQuery] = useState(''); const [notice, setNotice] = useState('')
  const packs = records.filter((record) => record.entity === 'capabilityPacks' && !record.archivedAt && !record.deletedAt).filter((record) => `${titleFor(record)} ${record.summary || ''} ${record.domain || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = packs.find((pack) => pack.id === selectedId) || records.find((record) => record.id === selectedId && record.entity === 'capabilityPacks')
  const create = async (input: { title: string; packType: string; domain: string; summary: string }) => { try { const pack = await api.save('capabilityPacks', { ...input, status: 'ACTIVE', packVersion: 'v1', portability: 'PERSONAL' }); await onRefresh(); setSelectedId(pack.id); setCreateOpen(false) } catch (error) { setNotice(`创建失败：${String(error)}`) } }
  if (selected) return <CapabilityWorkspace records={records} pack={selected} onBack={() => setSelectedId('')} onOpen={onOpen} onApply={onApply} onRefresh={onRefresh} />
  return <section className="capability-library" aria-label="能力资产">
    <header className="capability-head"><div><p>CAPABILITY SYSTEM · REUSABLE EXECUTION ASSETS</p><h2>能力资产</h2><small>能力包是长期工作区：整理内容、方法、证据和改进；项目应用始终保存精确版本快照。</small></div><button className="button primary" onClick={() => setCreateOpen(true)}>＋ 新建能力包</button></header>
    {notice && <p className="cw-notice">{notice}</p>}<div className="capability-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索能力包…" /></div>
    <div className="capability-quick-create"><span>从结构模板开始：</span><button onClick={() => setCreateOpen(true)}>岗位能力包</button><button onClick={() => setCreateOpen(true)}>管理能力包</button><button onClick={() => setCreateOpen(true)}>创业能力包</button></div>
    <div className="capability-pack-grid">{packs.length ? packs.map((pack) => { const items = packItemsFor(records, pack.id); const entries = records.filter((record) => record.entity === 'capabilityWorkspaceEntries' && record.packId === pack.id && !record.archivedAt && !record.deletedAt); return <article key={pack.id}><header><i>▦</i><span><small>{packTypeLabel[String(pack.packType || 'CUSTOM')] || '能力包'}</small><strong>{titleFor(pack)}</strong></span><em>{String(pack.status || 'DRAFT')}</em></header><p>{String(pack.summary || '把经验、方法和资料沉淀成可重复使用的能力。')}</p><dl><div><dt>工作区内容</dt><dd>{entries.length} 项</dd></div><div><dt>可执行资产</dt><dd>{items.length} 项</dd></div><div><dt>版本</dt><dd>{String(pack.packVersion || 'v1')}</dd></div></dl><footer><button className="button primary" onClick={() => setSelectedId(pack.id)}>打开工作区</button></footer></article> }) : <section className="capability-empty"><strong>还没有能力包</strong><span>创建一个岗位、管理或创业能力包，打开后即可组织资料、沉淀方法并应用到项目。</span><button className="button primary" onClick={() => setCreateOpen(true)}>创建能力包</button></section>}</div>
    {createOpen && <CreatePack onCancel={() => setCreateOpen(false)} onCreate={(input) => void create(input)} />}
  </section>
}
