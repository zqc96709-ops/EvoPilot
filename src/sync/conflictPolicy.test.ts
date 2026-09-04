import { describe, expect, it } from 'vitest'
import { conflictPolicyFor, conflictPolicyRegistry } from './conflictPolicy'

describe('ConflictPolicyRegistry', () => {
  it('publishes every required domain policy', () => {
    expect(conflictPolicyRegistry).toMatchObject({ tasks: 'DISJOINT_FIELD_MERGE', projects: 'DISJOINT_FIELD_MERGE', goals: 'DISJOINT_FIELD_MERGE', relations: 'SET_SEMANTICS', decisions: 'MANUAL_CONFLICT', reviews: 'MANUAL_CONFLICT', principles: 'MANUAL_CONFLICT', notes: 'DOCUMENT_REVISION', financialTransactions: 'APPEND_ONLY', timeLogs: 'DOMAIN_CUSTOM', notebookFiles: 'DOMAIN_CUSTOM' })
  })
  it('uses disjoint merge only as the compatibility fallback', () => expect(conflictPolicyFor('legacyEntity')).toBe('DISJOINT_FIELD_MERGE'))
})
