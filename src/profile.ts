import type { RecordData } from './model'

export type ProfileDraft = Record<string, string>

/**
 * Account Settings only edits identity fields. Preserve the rest of the
 * Profile record so a nickname update cannot discard AI/user context.
 */
export const profileSavePayload = (existing: RecordData | undefined, draft: ProfileDraft): Partial<RecordData> => {
  const { id, entity: _entity, createdAt: _createdAt, updatedAt: _updatedAt, revision: _revision, workspaceId: _workspaceId, ...profile } = existing || {} as RecordData
  const title = draft.nickname || draft.displayName || draft.name || draft.role || String(profile.title || '') || '我的档案'
  return { ...profile, ...draft, ...(id ? { id } : {}), title }
}
