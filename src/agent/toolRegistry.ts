import { schemaFor } from './schemaRegistry'
import type { AgentRiskLevel, JsonObjectSchema, ToolDefinition } from './types'
import type { Entity } from '../model'

const outputSchema: JsonObjectSchema = { type: 'object', properties: { ok: { type: 'boolean' }, entityId: { type: 'string' }, message: { type: 'string' } }, required: ['ok'], additionalProperties: true }
const inputFor = (entity: Entity, update = false): JsonObjectSchema => {
  const schema = schemaFor(entity)
  const fields = entity === 'notes' ? ['title', 'content', 'type', 'status'] : (schema?.fields || [])
  return { type: 'object', properties: Object.fromEntries(fields.map((field) => [field, { type: field.endsWith('Ids') ? 'array' : 'string' }])), required: update ? ['id'] : schema?.requiredFields, additionalProperties: false }
}
const tool = (name: string, description: string, entity: Entity, actionType: ToolDefinition['actionType'], riskLevel: AgentRiskLevel, requiresConfirmation: boolean): ToolDefinition => {
  const inputSchema = inputFor(entity, actionType === 'UPDATE' || actionType === 'COMPLETE')
  if (actionType === 'UPDATE' || actionType === 'COMPLETE') inputSchema.properties.id = { type: 'string', description: '必须来自真实本地记录' }
  if (actionType === 'START_TIMER' || actionType === 'STOP_TIMER') inputSchema.required = []
  return { name, description, entity, actionType, riskLevel, requiresConfirmation, inputSchema, outputSchema, idempotencyKey: `${name}:normalized-input`, permission: actionType === 'READ' ? 'local_read' : 'local_write' }
}
const importWorkspaceDocumentToNotebook: ToolDefinition = {
  name: 'importWorkspaceDocumentToNotebook',
  description: '把用户明确指定、且位于 EVOPOLIT docs/ 目录内的本地文档复制到 Notebook Inbox。源文件保持不变，执行前必须确认。',
  entity: 'notebookFiles', actionType: 'CREATE', riskLevel: 'MEDIUM_WRITE', requiresConfirmation: true,
  inputSchema: { type: 'object', properties: { name: { type: 'string', description: '保存到 Notebook 后显示的文件名' }, sourcePath: { type: 'string', description: '用户明确提供的 EVOPOLIT docs 文件路径' }, notebookCategoryId: { type: 'string' }, notebookFolderId: { type: 'string' } }, required: ['name', 'sourcePath'], additionalProperties: false },
  outputSchema, idempotencyKey: 'importWorkspaceDocumentToNotebook:normalized-input', permission: 'local_write',
}

export const toolRegistry: ToolDefinition[] = [
  tool('readWorkspaceDocument', '读取用户明确指定、且位于 EVOPOLIT docs/ 目录内的本地 Markdown、TXT、JSON 或 CSV 文档；只读，不修改文件。', 'dataRecords', 'READ', 'READ', false),
  tool('getProfile', '读取当前用户的我的档案与 AI 上下文；仅在当前问题相关时使用。', 'profiles', 'READ', 'READ', false),
  tool('updateProfile', '更新当前用户的我的档案；必须先向用户展示变更预览并等待确认。', 'profiles', 'UPDATE', 'MEDIUM_WRITE', true),
  importWorkspaceDocumentToNotebook,
  tool('createMentalModel', '保存结构化思维模型到思维模型库', 'mentalModels', 'CREATE', 'LOW_WRITE', false),
  tool('getMentalModel', '读取一个思维模型', 'mentalModels', 'READ', 'READ', false),
  tool('searchMentalModels', '搜索可用于当前问题的思维模型', 'mentalModels', 'READ', 'READ', false),
  tool('updateMentalModel', '更新已有思维模型', 'mentalModels', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createNote', '把一段内容保存为 Notebook 自由笔记', 'notes', 'CREATE', 'LOW_WRITE', false),
  tool('getNote', '读取一条 Notebook 笔记', 'notes', 'READ', 'READ', false),
  tool('searchNotes', '搜索历史 Notebook 笔记', 'notes', 'READ', 'READ', false),
  tool('updateNote', '更新已有 Notebook 笔记', 'notes', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createNotebookCategory', '创建 Notebook 自定义分类；不是项目', 'notebookCategories', 'CREATE', 'LOW_WRITE', false),
  tool('getNotebookCategories', '读取 Notebook 分类', 'notebookCategories', 'READ', 'READ', false),
  tool('updateNotebookCategory', '更新 Notebook 分类', 'notebookCategories', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createNotebookFolder', '创建 Notebook 文件夹或子文件夹', 'notebookFolders', 'CREATE', 'LOW_WRITE', false),
  tool('getNotebookFolders', '读取 Notebook 文件夹', 'notebookFolders', 'READ', 'READ', false),
  tool('updateNotebookFolder', '更新 Notebook 文件夹', 'notebookFolders', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('getNotebookFiles', '读取 Notebook 文件元数据', 'notebookFiles', 'READ', 'READ', false),
  tool('searchNotebookFiles', '按文件名、类型、目录和元数据搜索 Notebook 文件', 'notebookFiles', 'READ', 'READ', false),
  tool('updateNotebookFile', '更新 Notebook 文件元数据或移动文件；不修改原始文件内容', 'notebookFiles', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createKnowledge', '创建知识记录', 'knowledge', 'CREATE', 'LOW_WRITE', false), tool('getKnowledge', '读取知识', 'knowledge', 'READ', 'READ', false), tool('searchKnowledge', '搜索知识', 'knowledge', 'READ', 'READ', false), tool('updateKnowledge', '更新知识', 'knowledge', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createGoal', '创建目标', 'goals', 'CREATE', 'LOW_WRITE', false), tool('getGoal', '读取目标', 'goals', 'READ', 'READ', false), tool('searchGoals', '搜索目标', 'goals', 'READ', 'READ', false), tool('updateGoal', '更新目标', 'goals', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createProject', '创建项目并继承当前目标', 'projects', 'CREATE', 'LOW_WRITE', false), tool('getProject', '读取项目', 'projects', 'READ', 'READ', false), tool('searchProjects', '搜索项目', 'projects', 'READ', 'READ', false), tool('updateProject', '更新项目', 'projects', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createTask', '创建任务并继承当前项目和目标', 'tasks', 'CREATE', 'LOW_WRITE', false), tool('getTask', '读取任务', 'tasks', 'READ', 'READ', false), tool('searchTasks', '搜索任务', 'tasks', 'READ', 'READ', false), tool('updateTask', '更新任务', 'tasks', 'UPDATE', 'MEDIUM_WRITE', true), tool('completeTask', '完成任务', 'tasks', 'COMPLETE', 'MEDIUM_WRITE', true),
  tool('startTimer', '开始与当前任务、项目或目标关联的计时', 'timeLogs', 'START_TIMER', 'LOW_WRITE', false), tool('stopTimer', '停止当前计时并生成时间记录', 'timeLogs', 'STOP_TIMER', 'MEDIUM_WRITE', true), tool('createTimeRecord', '创建时间记录', 'timeLogs', 'CREATE', 'LOW_WRITE', false), tool('getTimeRecords', '读取时间记录', 'timeLogs', 'READ', 'READ', false),
  tool('createDecision', '创建结构化决策', 'decisions', 'CREATE', 'MEDIUM_WRITE', true), tool('getDecision', '读取决策', 'decisions', 'READ', 'READ', false), tool('searchDecisions', '搜索决策', 'decisions', 'READ', 'READ', false), tool('updateDecision', '更新决策', 'decisions', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createReview', '创建复盘', 'reviews', 'CREATE', 'LOW_WRITE', false), tool('getReview', '读取复盘', 'reviews', 'READ', 'READ', false), tool('createInsight', '创建洞见', 'insights', 'CREATE', 'LOW_WRITE', false), tool('createPrinciple', '创建原则', 'principles', 'CREATE', 'LOW_WRITE', false), tool('searchPrinciples', '搜索原则', 'principles', 'READ', 'READ', false),
  tool('createExternalSource', '创建外部情报监控源', 'externalSources', 'CREATE', 'MEDIUM_WRITE', true), tool('getExternalSources', '读取情报源与同步状态', 'externalSources', 'READ', 'READ', false), tool('updateExternalSource', '更新或暂停情报源', 'externalSources', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('getExternalBriefing', '读取有证据的 CEO 外部情报简报', 'intelligenceBriefs', 'READ', 'READ', false), tool('getExternalSignals', '读取外部信号及证据口径', 'signals', 'READ', 'READ', false), tool('updateExternalSignal', '观察、忽略或验证外部信号', 'signals', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createOpportunity', '把已确认信号转为机会草稿', 'opportunities', 'CREATE', 'LOW_WRITE', false), tool('getOpportunities', '读取机会与数据缺口', 'opportunities', 'READ', 'READ', false), tool('updateOpportunity', '更新机会评估', 'opportunities', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createOutcome', '创建带预期、实际和证据状态的 Outcome 草稿', 'results', 'CREATE', 'MEDIUM_WRITE', true), tool('getOutcomes', '读取 Outcome 与预期实际偏差', 'results', 'READ', 'READ', false), tool('updateOutcome', '更新 Outcome 实际结果与证据', 'results', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createDeliverable', '创建正式成果资产元数据并可关联现有 Notebook 文件；不会复制原始文件', 'deliverables', 'CREATE', 'MEDIUM_WRITE', true), tool('getDeliverable', '读取成果资产与当前版本', 'deliverables', 'READ', 'READ', false), tool('listDeliverables', '列出成果资产并优先识别当前 Final 版本', 'deliverables', 'READ', 'READ', false), tool('updateDeliverable', '更新成果资产版本或关联；不得删除历史版本', 'deliverables', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createResultPackage', '创建成果包，只聚合结果、资产、决策、复盘和工作链关联，不复制文件', 'resultPackages', 'CREATE', 'MEDIUM_WRITE', true), tool('getResultPackage', '读取成果包及其关联', 'resultPackages', 'READ', 'READ', false), tool('listResultPackages', '列出成果包', 'resultPackages', 'READ', 'READ', false), tool('updateResultPackage', '更新成果包聚合关系', 'resultPackages', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createWorkflow', '创建工作链模板；不会自动应用到项目', 'workflows', 'CREATE', 'MEDIUM_WRITE', true), tool('getWorkflow', '读取工作链模板', 'workflows', 'READ', 'READ', false), tool('listWorkflows', '列出工作链与当前版本', 'workflows', 'READ', 'READ', false), tool('updateWorkflow', '更新工作链模板元数据', 'workflows', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createWorkflowVersion', '创建新的工作链版本草案，保留原版本', 'workflowVersions', 'CREATE', 'MEDIUM_WRITE', true), tool('getWorkflowVersion', '读取工作链版本', 'workflowVersions', 'READ', 'READ', false), tool('updateWorkflowVersion', '更新工作链版本草案', 'workflowVersions', 'UPDATE', 'MEDIUM_WRITE', true), tool('promoteWorkflowVersion', '建议将工作链版本提升为推荐或标准；必须经用户确认', 'workflowVersions', 'UPDATE', 'HIGH_RISK', true), tool('rollbackWorkflowVersion', '回滚工作链默认版本；保留失败版本与运行证据，必须经用户确认', 'workflowVersions', 'UPDATE', 'HIGH_RISK', true),
  tool('createWorkflowStep', '创建工作链模板步骤', 'workflowSteps', 'CREATE', 'LOW_WRITE', false), tool('updateWorkflowStep', '更新工作链模板步骤', 'workflowSteps', 'UPDATE', 'MEDIUM_WRITE', true), tool('createWorkflowGate', '创建工作链决策关口；真实决策由用户确认', 'workflowGates', 'CREATE', 'MEDIUM_WRITE', true), tool('updateWorkflowGate', '更新工作链决策关口', 'workflowGates', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createWorkflowRun', '在项目中创建一条实际工作链运行', 'workflowRuns', 'CREATE', 'MEDIUM_WRITE', true), tool('getWorkflowRun', '读取工作链运行及事实关联', 'workflowRuns', 'READ', 'READ', false), tool('listWorkflowRuns', '列出工作链运行', 'workflowRuns', 'READ', 'READ', false), tool('updateWorkflowRun', '更新工作链运行状态与上下文', 'workflowRuns', 'UPDATE', 'MEDIUM_WRITE', true), tool('compareWorkflowRuns', '比较相似上下文下的多个工作链运行；只给出证据，不判定最佳', 'workflowRuns', 'READ', 'READ', false), tool('getWorkflowScorecard', '读取工作链多维 Scorecard 与 Guardrail', 'workflowRuns', 'READ', 'READ', false),
  tool('createWorkflowRunStep', '创建实际运行步骤', 'workflowRunSteps', 'CREATE', 'LOW_WRITE', false), tool('updateWorkflowRunStep', '更新实际运行步骤，不重复维护 Time 或 Finance', 'workflowRunSteps', 'UPDATE', 'MEDIUM_WRITE', true), tool('createWorkflowMetric', '配置工作链维度指标或 Guardrail', 'workflowMetricDefinitions', 'CREATE', 'MEDIUM_WRITE', true), tool('updateWorkflowMetric', '更新工作链指标配置', 'workflowMetricDefinitions', 'UPDATE', 'MEDIUM_WRITE', true), tool('createWorkflowImprovementProposal', '基于复盘创建工作链改进提案；不会自动修改正式工作链', 'workflowImprovementProposals', 'CREATE', 'MEDIUM_WRITE', true), tool('updateWorkflowImprovementProposal', '更新改进提案状态', 'workflowImprovementProposals', 'UPDATE', 'MEDIUM_WRITE', true),
  tool('createFinancialAccount', '创建资金账户', 'financialAccounts', 'CREATE', 'MEDIUM_WRITE', true), tool('getFinancialAccounts', '读取账户与核验状态', 'financialAccounts', 'READ', 'READ', false),
  tool('createFinancialCategory', '创建经营分类', 'financialCategories', 'CREATE', 'LOW_WRITE', false), tool('getFinancialCategories', '读取经营分类', 'financialCategories', 'READ', 'READ', false),
  tool('createFinancialTransaction', '创建财务流水草稿；不得直接入账', 'financialTransactions', 'CREATE', 'HIGH_RISK', true), tool('getFinancialTransactions', '读取财务流水事实', 'financialTransactions', 'READ', 'READ', false), tool('getProjectFinancials', '读取项目时间、资金、Outcome 与数据缺口', 'financialTransactions', 'READ', 'READ', false), tool('voidFinancialTransaction', '作废已入账流水并保留原因', 'financialTransactions', 'UPDATE', 'HIGH_RISK', true),
]

export const toolFor = (name: string) => toolRegistry.find((item) => item.name === name)
