import type { RecordData } from './model'

export const capabilityKinds = ['PLAYBOOK', 'SOP', 'STANDARD', 'CHECKLIST_TEMPLATE', 'DOCUMENT_TEMPLATE', 'TABLE_TEMPLATE', 'PATTERN'] as const
export type CapabilityKind = typeof capabilityKinds[number]

export const templateInstanceKind = (asset: RecordData): 'CHECKLIST' | 'DOCUMENT' | 'TABLE' | undefined => {
  if (asset.assetKind === 'CHECKLIST_TEMPLATE') return 'CHECKLIST'
  if (asset.assetKind === 'DOCUMENT_TEMPLATE') return 'DOCUMENT'
  if (asset.assetKind === 'TABLE_TEMPLATE') return 'TABLE'
  return undefined
}

export const live = (record: RecordData) => !record.archivedAt && !record.deletedAt

export const packItemsFor = (records: RecordData[], packId: string) => records
  .filter(live)
  .filter((record) => record.entity === 'capabilityPackItems' && record.packId === packId)
  .sort((left, right) => Number(left.orderIndex || 0) - Number(right.orderIndex || 0))

export const versionsFor = (records: RecordData[], assetId: string) => records
  .filter(live)
  .filter((record) => record.entity === 'capabilityAssetVersions' && record.capabilityAssetId === assetId)
  .sort((left, right) => String(right.versionNumber || '').localeCompare(String(left.versionNumber || '')) || String(right.updatedAt).localeCompare(String(left.updatedAt)))

export const currentCapabilityVersion = (records: RecordData[], asset: RecordData) => {
  const explicit = records.find((record) => live(record) && record.id === asset.currentVersionId && record.entity === 'capabilityAssetVersions')
  return explicit?.status === 'ACTIVE' ? explicit : versionsFor(records, asset.id).find((record) => record.status === 'ACTIVE')
}

export const nextCapabilityVersionNumber = (records: RecordData[], assetId: string) => {
  const highest = versionsFor(records, assetId).reduce((max, version) => Math.max(max, Number(String(version.versionNumber || '').replace(/^v/i, '')) || 0), 0)
  return `v${highest + 1}`
}

export type CapabilityApplicationPlanItem = {
  packItem: RecordData
  asset: RecordData
  version?: RecordData
  instanceKind?: 'CHECKLIST' | 'DOCUMENT' | 'TABLE'
  createsExecutionTask: boolean
}

export const capabilityApplicationPlan = (records: RecordData[], packId: string): CapabilityApplicationPlanItem[] => packItemsFor(records, packId).flatMap((packItem) => {
  const asset = records.find((record) => live(record) && record.entity === 'capabilityAssets' && record.id === packItem.capabilityAssetId)
  if (!asset) return []
  const pinned = records.find((record) => live(record) && record.entity === 'capabilityAssetVersions' && record.id === packItem.capabilityAssetVersionId)
  const version = pinned?.status === 'ACTIVE' ? pinned : currentCapabilityVersion(records, asset)
  const instanceKind = templateInstanceKind(asset)
  return [{ packItem, asset, version, instanceKind, createsExecutionTask: ['PLAYBOOK', 'SOP', 'PATTERN'].includes(String(asset.assetKind)) }]
})

export const exportGuard = (record: RecordData) => {
  const portability = String(record.portability || 'PERSONAL')
  if (portability === 'CONFIDENTIAL') return { allowed: false, reason: '该能力资产标记为保密，不能导出。' }
  if (portability === 'COMPANY_SPECIFIC') return { allowed: false, reason: '该能力资产包含公司特定内容，需先脱敏后导出。' }
  return { allowed: true, reason: '' }
}
