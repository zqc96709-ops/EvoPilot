import { readFileSync } from 'node:fs'

export const conflictPolicyRegistry = Object.freeze(JSON.parse(readFileSync(new URL('../src/sync/conflict-policies.json', import.meta.url), 'utf8')))

export const conflictPolicyFor = (entityType) => conflictPolicyRegistry[entityType] || 'DISJOINT_FIELD_MERGE'
