import { describe, expect, it } from 'vitest'
import { capabilityApplicationPlan, currentCapabilityVersion, exportGuard, nextCapabilityVersionNumber, packItemsFor, templateInstanceKind } from './capability'
import type { RecordData } from './model'

const record = (entity: RecordData['entity'], id: string, data: Record<string, unknown> = {}): RecordData => ({ id, entity, createdAt: '2026-09-16T00:00:00.000Z', updatedAt: '2026-09-16T00:00:00.000Z', ...data })

describe('capability system helpers', () => {
  it('keeps pack entries as ordered references instead of copied assets', () => {
    const items = packItemsFor([record('capabilityPackItems', 'second', { packId: 'pack', capabilityAssetId: 'asset-b', orderIndex: 2 }), record('capabilityPackItems', 'first', { packId: 'pack', capabilityAssetId: 'asset-a', orderIndex: 1 })], 'pack')
    expect(items.map((item) => item.capabilityAssetId)).toEqual(['asset-a', 'asset-b'])
  })

  it('uses the pinned asset version and separates template instance kinds', () => {
    const asset = record('capabilityAssets', 'asset', { currentVersionId: 'v1', assetKind: 'TABLE_TEMPLATE' })
    const versions = [asset, record('capabilityAssetVersions', 'v1', { capabilityAssetId: 'asset', versionNumber: 'v1', status: 'ACTIVE' }), record('capabilityAssetVersions', 'v2', { capabilityAssetId: 'asset', versionNumber: 'v2', status: 'DRAFT' })]
    expect(currentCapabilityVersion(versions, asset)?.id).toBe('v1')
    expect(nextCapabilityVersionNumber(versions, 'asset')).toBe('v3')
    expect(templateInstanceKind(asset)).toBe('TABLE')
  })

  it('never treats a draft as an active version for a project application', () => {
    const asset = record('capabilityAssets', 'asset', { currentVersionId: 'draft', assetKind: 'PLAYBOOK' })
    const rows = [asset, record('capabilityAssetVersions', 'draft', { capabilityAssetId: 'asset', versionNumber: 'v1', status: 'DRAFT' })]
    expect(currentCapabilityVersion(rows, asset)).toBeUndefined()
  })

  it('blocks direct export of company and confidential capability assets', () => {
    expect(exportGuard(record('capabilityAssets', 'a', { portability: 'PERSONAL' })).allowed).toBe(true)
    expect(exportGuard(record('capabilityAssets', 'a', { portability: 'COMPANY_SPECIFIC' })).allowed).toBe(false)
    expect(exportGuard(record('capabilityAssets', 'a', { portability: 'CONFIDENTIAL' })).allowed).toBe(false)
  })

  it('plans exact version snapshots and keeps templates separate from execution tasks', () => {
    const pack = record('capabilityPacks', 'pack')
    const playbook = record('capabilityAssets', 'playbook', { assetKind: 'PLAYBOOK', currentVersionId: 'playbook-v1' })
    const checklist = record('capabilityAssets', 'checklist', { assetKind: 'CHECKLIST_TEMPLATE', currentVersionId: 'checklist-v1' })
    const rows = [pack, playbook, checklist,
      record('capabilityAssetVersions', 'playbook-v1', { capabilityAssetId: 'playbook', versionNumber: 'v1', status: 'ACTIVE', content: '原始方法' }),
      record('capabilityAssetVersions', 'checklist-v1', { capabilityAssetId: 'checklist', versionNumber: 'v1', status: 'ACTIVE', structuredData: '["检查项"]' }),
      record('capabilityPackItems', 'playbook-item', { packId: 'pack', capabilityAssetId: 'playbook', orderIndex: 1 }),
      record('capabilityPackItems', 'checklist-item', { packId: 'pack', capabilityAssetId: 'checklist', capabilityAssetVersionId: 'checklist-v1', orderIndex: 2 })]
    const plan = capabilityApplicationPlan(rows, pack.id)
    expect(plan.map((item) => item.version?.id)).toEqual(['playbook-v1', 'checklist-v1'])
    expect(plan[0].createsExecutionTask).toBe(true)
    expect(plan[1].instanceKind).toBe('CHECKLIST')
    expect(plan[1].asset).toBe(checklist)
  })
})
