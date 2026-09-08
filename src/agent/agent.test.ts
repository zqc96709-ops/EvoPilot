import { describe, expect, it } from 'vitest'
import { buildAgentContext } from './contextEngine'
import { schemaFor } from './schemaRegistry'
import { toolFor, toolRegistry } from './toolRegistry'
import type { RecordData } from '../model'

const record = (entity: RecordData['entity'], id: string, data: Record<string, unknown> = {}) => ({ id, entity, createdAt: '', updatedAt: '', ...data }) as RecordData

describe('EvoPilot Agent registries and context', () => {
  it('describes the MentalModel schema and save tool', () => {
    expect(schemaFor('mentalModels')?.requiredFields).toContain('name')
    expect(toolFor('createMentalModel')).toMatchObject({ entity: 'mentalModels', riskLevel: 'LOW_WRITE', requiresConfirmation: false })
    expect(toolRegistry.length).toBeGreaterThanOrEqual(30)
    expect(toolFor('readWorkspaceDocument')).toMatchObject({ entity: 'dataRecords', actionType: 'READ', riskLevel: 'READ', requiresConfirmation: false })
    expect(toolFor('importWorkspaceDocumentToNotebook')).toMatchObject({ entity: 'notebookFiles', actionType: 'CREATE', riskLevel: 'MEDIUM_WRITE', requiresConfirmation: true })
    expect(schemaFor('profiles')?.allowedActions).toContain('updateProfile')
    expect(toolFor('updateProfile')).toMatchObject({ entity: 'profiles', actionType: 'UPDATE', riskLevel: 'MEDIUM_WRITE', requiresConfirmation: true })
  })

  it('registers External Intelligence schemas, relations, and guarded write tools', () => {
    expect(schemaFor('externalSources')?.requiredFields).toContain('name')
    expect(schemaFor('decisions')?.relations).toMatchObject({ signalIds: 'signals', opportunityId: 'opportunities' })
    expect(toolFor('createExternalSource')).toMatchObject({ entity: 'externalSources', riskLevel: 'MEDIUM_WRITE', requiresConfirmation: true })
    expect(toolFor('createOpportunity')).toMatchObject({ entity: 'opportunities', riskLevel: 'LOW_WRITE', requiresConfirmation: false })
  })

  it('guards Outcome and financial writes while exposing read schemas', () => {
    expect(schemaFor('results')?.requiredFields).toContain('title')
    expect(schemaFor('financialTransactions')?.relations).toMatchObject({ accountId: 'financialAccounts', projectId: 'projects' })
    expect(toolFor('createOutcome')).toMatchObject({ entity: 'results', requiresConfirmation: true })
    expect(toolFor('createFinancialTransaction')).toMatchObject({ entity: 'financialTransactions', riskLevel: 'HIGH_RISK', requiresConfirmation: true })
  })

  it('derives Goal → Project → Task context from the current task', () => {
    const records = [record('goals', 'g1'), record('projects', 'p1', { goalId: 'g1' }), record('tasks', 't1', { projectId: 'p1', goalId: 'g1' })]
    expect(buildAgentContext({ currentRoute: 'tasks', records, selectedProjectId: null, detailId: 't1', conversation: [] })).toMatchObject({ currentEntityType: 'tasks', currentEntityId: 't1', currentTaskId: 't1', currentProjectId: 'p1', currentGoalId: 'g1' })
  })

  it('uses the current page entity when no record is selected', () => {
    expect(buildAgentContext({ currentRoute: 'mentalModels', records: [], selectedProjectId: null, detailId: null, conversation: [] }).currentEntityType).toBe('mentalModels')
  })
})
