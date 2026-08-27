import { entities, type Entity } from '../model'
import type { SchemaDefinition } from './types'

const required: Partial<Record<Entity, string[]>> = {
  goals: ['title'], projects: ['title'], tasks: ['title'], timeLogs: ['title', 'startAt'], results: ['title'], deliverables: ['title'], resultPackages: ['title'], workflows: ['name'], workflowVersions: ['workflowId', 'versionNumber'], workflowSteps: ['workflowVersionId', 'title'], workflowGates: ['workflowVersionId', 'title'], workflowRuns: ['title', 'workflowId'], workflowRunSteps: ['workflowRunId', 'title'], workflowMetricDefinitions: ['workflowVersionId', 'name'], workflowImprovementProposals: ['title', 'workflowId'], knowledge: ['title', 'content'], reviews: ['title'], insights: ['statement'], principles: ['statement'], mentalModels: ['name'], notes: ['title'], notebookCategories: ['name'], notebookFolders: ['name'], notebookFiles: ['name'], decisions: ['title'], events: ['title'], people: ['name'], externalSources: ['name'], signals: ['title'], opportunities: ['title'], intelligenceBriefs: ['title'], financialAccounts: ['name'], financialCategories: ['name'], financialTransactions: ['title', 'transactionType', 'amountMinor'],
}

const allowed: Partial<Record<Entity, string[]>> = { profiles: ['getProfile', 'updateProfile'],
  goals: ['createGoal', 'getGoal', 'searchGoals', 'updateGoal'],
  projects: ['createProject', 'getProject', 'searchProjects', 'updateProject'],
  tasks: ['createTask', 'getTask', 'searchTasks', 'updateTask', 'completeTask'],
  timeLogs: ['startTimer', 'stopTimer', 'createTimeRecord', 'getTimeRecords'],
  results: ['createOutcome', 'getOutcomes', 'updateOutcome'], deliverables: ['createDeliverable', 'getDeliverable', 'listDeliverables', 'updateDeliverable'], resultPackages: ['createResultPackage', 'getResultPackage', 'listResultPackages', 'updateResultPackage'], workflows: ['createWorkflow', 'getWorkflow', 'listWorkflows', 'updateWorkflow'], workflowVersions: ['createWorkflowVersion', 'getWorkflowVersion', 'updateWorkflowVersion', 'promoteWorkflowVersion', 'rollbackWorkflowVersion'], workflowSteps: ['createWorkflowStep', 'updateWorkflowStep'], workflowGates: ['createWorkflowGate', 'updateWorkflowGate'], workflowRuns: ['createWorkflowRun', 'getWorkflowRun', 'listWorkflowRuns', 'updateWorkflowRun', 'compareWorkflowRuns', 'getWorkflowScorecard'], workflowRunSteps: ['createWorkflowRunStep', 'updateWorkflowRunStep'], workflowMetricDefinitions: ['createWorkflowMetric', 'updateWorkflowMetric'], workflowImprovementProposals: ['createWorkflowImprovementProposal', 'updateWorkflowImprovementProposal'],
  knowledge: ['createKnowledge', 'getKnowledge', 'searchKnowledge', 'updateKnowledge'],
  reviews: ['createReview', 'getReview'], insights: ['createInsight'], principles: ['createPrinciple', 'searchPrinciples'],
  mentalModels: ['createMentalModel', 'getMentalModel', 'searchMentalModels', 'updateMentalModel'],
  notes: ['createNote', 'getNote', 'searchNotes', 'updateNote'],
  notebookCategories: ['createNotebookCategory', 'getNotebookCategories', 'updateNotebookCategory'],
  notebookFolders: ['createNotebookFolder', 'getNotebookFolders', 'updateNotebookFolder'],
  notebookFiles: ['getNotebookFiles', 'searchNotebookFiles', 'updateNotebookFile'],
  decisions: ['createDecision', 'getDecision', 'searchDecisions', 'updateDecision'],
  externalSources: ['createExternalSource', 'getExternalSources', 'updateExternalSource'],
  signals: ['getExternalSignals', 'updateExternalSignal'], opportunities: ['createOpportunity', 'getOpportunities', 'updateOpportunity'], intelligenceBriefs: ['getExternalBriefing'], financialAccounts: ['createFinancialAccount', 'getFinancialAccounts'], financialCategories: ['createFinancialCategory', 'getFinancialCategories'], financialTransactions: ['createFinancialTransaction', 'getFinancialTransactions', 'getProjectFinancials', 'voidFinancialTransaction'],
}

const relationMap = (entity: Entity) => Object.fromEntries(entities.find((item) => item.entity === entity)?.fields.filter((field) => field.relation).map((field) => [field.key, field.relation!]) || [])

export const schemaRegistry: SchemaDefinition[] = entities.filter((config) => ['profiles', 'goals', 'projects', 'tasks', 'timeLogs', 'results', 'deliverables', 'resultPackages', 'workflows', 'workflowVersions', 'workflowSteps', 'workflowGates', 'workflowRuns', 'workflowRunSteps', 'workflowMetricDefinitions', 'workflowImprovementProposals', 'knowledge', 'reviews', 'insights', 'principles', 'mentalModels', 'notes', 'notebookCategories', 'notebookFolders', 'notebookFiles', 'decisions', 'events', 'people', 'externalSources', 'signals', 'opportunities', 'intelligenceBriefs', 'financialAccounts', 'financialCategories', 'financialTransactions'].includes(config.entity)).map((config) => ({
  entityName: config.entity,
  description: config.description,
  fields: config.fields.map((field) => field.key),
  requiredFields: required[config.entity] || [],
  relations: relationMap(config.entity),
  allowedActions: allowed[config.entity] || [],
  validationRules: ['仅写入 Schema Registry 声明的字段', '所有关系 ID 必须来自真实本地记录', '更新操作必须提供真实 entityId'],
}))

export const schemaFor = (entity: Entity) => schemaRegistry.find((item) => item.entityName === entity)
