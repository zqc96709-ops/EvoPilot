import type { RecordData } from '../model'

export const SYNC_PROTOCOL_VERSION = 1
export const CLIENT_SCHEMA_VERSION = 19

export type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE' | 'RELATION_ADD' | 'RELATION_REMOVE'

export type SyncMutation = {
  mutationId: string
  transactionId?: string
  workspaceId: string
  deviceId: string
  entityType: string
  entityId: string
  operation: SyncOperation
  baseRevision: number
  changedFields: string[]
  payload: Record<string, unknown>
  protocolVersion: number
  createdAt: string
}

export type SyncChange = SyncMutation & {
  serverRevision: number
  serverSequence: number
}

export type SyncConflict = {
  conflictId: string
  entityType: string
  entityId: string
  localRevision: number
  serverRevision: number
  fields: string[]
  localPayload: Record<string, unknown>
  remotePayload: Record<string, unknown>
}

const protectedConflictEntities = new Set(['decisions', 'reviews', 'principles', 'notes', 'knowledge'])
const envelopeFields = new Set(['id', 'entity', 'createdAt', 'updatedAt', 'revision', 'workspaceId', 'createdBy', 'updatedBy'])

export const changedFields = (base: Record<string, unknown>, next: Record<string, unknown>) =>
  [...new Set([...Object.keys(base), ...Object.keys(next)])]
    .filter((key) => !envelopeFields.has(key) && JSON.stringify(base[key]) !== JSON.stringify(next[key]))
    .sort()

export type MergeResult =
  | { kind: 'merged'; value: RecordData }
  | { kind: 'conflict'; conflict: SyncConflict }

export const mergeConcurrentRecord = (
  base: RecordData,
  local: RecordData,
  remote: RecordData,
): MergeResult => {
  if (local.deletedAt || remote.deletedAt) {
    return { kind: 'merged', value: { ...(local.deletedAt ? local : remote) } }
  }
  const localFields = changedFields(base, local)
  const remoteFields = changedFields(base, remote)
  const collisions = localFields.filter((field) => remoteFields.includes(field))
  if (collisions.length) {
    return {
      kind: 'conflict',
      conflict: {
        conflictId: crypto.randomUUID(),
        entityType: local.entity,
        entityId: local.id,
        localRevision: Number(local.revision || 0),
        serverRevision: Number(remote.revision || 0),
        fields: protectedConflictEntities.has(local.entity) ? collisions : collisions,
        localPayload: local,
        remotePayload: remote,
      },
    }
  }
  const value = { ...base, ...remote } as RecordData
  for (const field of localFields) value[field] = local[field]
  value.revision = Math.max(Number(local.revision || 0), Number(remote.revision || 0))
  return { kind: 'merged', value }
}

export const assertProtocolCompatible = (server: { protocolVersion: number; minSupportedVersion: number }) => {
  if (SYNC_PROTOCOL_VERSION < server.minSupportedVersion || server.protocolVersion < SYNC_PROTOCOL_VERSION) {
    throw new Error('UPGRADE_REQUIRED')
  }
}
