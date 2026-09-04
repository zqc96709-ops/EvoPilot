export type ConflictStrategy = 'DISJOINT_FIELD_MERGE' | 'MANUAL_CONFLICT' | 'APPEND_ONLY' | 'SET_SEMANTICS' | 'DOCUMENT_REVISION' | 'DOMAIN_CUSTOM'

import policies from './conflict-policies.json'

export const conflictPolicyRegistry = policies as Record<string, ConflictStrategy>

export const conflictPolicyFor = (entityType: string): ConflictStrategy => conflictPolicyRegistry[entityType] || 'DISJOINT_FIELD_MERGE'
