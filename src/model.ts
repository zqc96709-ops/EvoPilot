import { timelineOccurredAt, timelineRecords } from './timeline'
export type Entity =
  | 'goals' | 'keyResults' | 'projects' | 'tasks' | 'hypotheses' | 'experiments' | 'timeLogs' | 'results' | 'deliverables' | 'resultPackages'
  | 'workflows' | 'workflowVersions' | 'workflowSteps' | 'workflowGates' | 'workflowRuns' | 'workflowRunSteps' | 'workflowMetricDefinitions' | 'workflowImprovementProposals'
  | 'reviews' | 'knowledge' | 'insights' | 'principles' | 'mentalModels' | 'mentalModelUsages'
  | 'decisions' | 'notes' | 'notebookCategories' | 'notebookFolders' | 'notebookFiles' | 'inbox' | 'events' | 'people' | 'dataRecords' | 'attachments' | 'timelineEvents' | 'agentRuns' | 'agentActions'
  | 'externalSources' | 'signals' | 'opportunities' | 'intelligenceBriefs' | 'researchThreads' | 'researchRequests' | 'researchRuns' | 'researchResults' | 'researchFindings'
  | 'financialAccounts' | 'financialCategories' | 'financialTransactions' | 'financialTransactionAllocations' | 'financialBudgets'
  | 'decisionFrameworks' | 'ceoPrinciples' | 'decisionLenses' | 'profiles'

export type RecordData = Record<string, unknown> & {
  id: string
  entity: Entity
  createdAt: string
  updatedAt: string
  revision?: number
  workspaceId?: string
  createdBy?: string
  updatedBy?: string
  archivedAt?: string
  deletedAt?: string
  relationType?: string
  relationDirection?: 'incoming' | 'outgoing'
}

export type FieldOption = string | { value: string; label: string }
export type Field = {
  key: string
  label: string
  multiline?: boolean
  type?: 'date' | 'datetime-local' | 'number' | 'select' | 'money'
  options?: FieldOption[]
  relation?: Entity
  multiple?: boolean
  placeholder?: string
  readOnly?: boolean
  currencyKey?: string
}
export type EntityConfig = {
  entity: Entity
  label: string
  singular: string
  icon: string
  titleKey: string
  description: string
  fields: Field[]
}

const option = (value: string, label = value): FieldOption => ({ value, label })
const statuses = {
  goal: [option('active', '进行中'), option('planned', '计划中'), option('paused', '已暂停'), option('completed', '已完成'), option('archived', '已归档')],
  project: [option('active', '进行中'), option('planned', '计划中'), option('blocked', '受阻'), option('paused', '已暂停'), option('completed', '已完成')],
  task: [option('inbox', '收集箱'), option('todo', '待办'), option('in_progress', '进行中'), option('waiting', '等待中'), option('blocked', '受阻'), option('completed', '已完成'), option('cancelled', '已取消')],
  hypothesis: [option('untested', '未测试'), option('testing', '测试中'), option('validated', '已验证'), option('rejected', '已否定'), option('inconclusive', '无结论')],
  decision: [option('pending', '待决定'), option('decided', '已决定'), option('monitoring', '观察中'), option('validated', '已验证'), option('partially_correct', '部分正确'), option('wrong', '错误'), option('unknown', '未知')],
}
const priorities = [option('high', '高'), option('medium', '中'), option('low', '低')]

export const entities: EntityConfig[] = [
  { entity: 'profiles', label: '我的档案', singular: '档案', icon: '◌', titleKey: 'title', description: 'Jason OS 的长期个人与 AI 上下文；不作为业务模块或左侧导航。', fields: [
    { key: 'title', label: '档案名称' }, { key: 'name', label: '姓名' }, { key: 'nickname', label: '昵称' }, { key: 'avatar', label: '头像 URL（可选）' },
    { key: 'occupation', label: '职业 / 身份' }, { key: 'role', label: '当前角色' }, { key: 'organization', label: '公司 / 组织' }, { key: 'workDomains', label: '主要工作领域（逗号分隔）' },
    { key: 'longTermDirection', label: '长期方向', multiline: true }, { key: 'currentFocus', label: '当前重点（逗号分隔）' }, { key: 'workStyle', label: '我的工作方式', multiline: true }, { key: 'decisionStyle', label: '我的决策方式', multiline: true }, { key: 'commonTools', label: '常用工具（逗号分隔）' }, { key: 'otherContext', label: '其他长期背景', multiline: true },
    { key: 'aiAssistancePreference', label: '希望 AI 如何帮助我', multiline: true }, { key: 'aiResponsePreference', label: '我的回答偏好', multiline: true }, { key: 'aiDecisionPreference', label: '我的决策偏好', multiline: true }, { key: 'aiOtherContext', label: 'AI 其他上下文', multiline: true },
  ] },
  { entity: 'goals', label: '目标', singular: '目标', icon: '◎', titleKey: 'title', description: '目标定义方向与为什么值得投入。', fields: [
    { key: 'title', label: '目标' }, { key: 'description', label: '说明', multiline: true }, { key: 'why', label: '为什么重要', multiline: true },
    { key: 'status', label: '状态', type: 'select', options: statuses.goal }, { key: 'timeframe', label: '时间范围' },
    { key: 'progress', label: '进度（%）', type: 'number' }, { key: 'priority', label: '优先级', type: 'select', options: priorities },
    { key: 'startDate', label: '开始日期', type: 'date' }, { key: 'targetDate', label: '目标日期', type: 'date' },
  ] },
  { entity: 'keyResults', label: '关键结果', singular: '关键结果', icon: '↗', titleKey: 'title', description: '用可衡量结果判断目标是否真正推进。', fields: [
    { key: 'goalId', label: '所属目标', relation: 'goals' }, { key: 'title', label: '关键结果' }, { key: 'targetValue', label: '目标值', type: 'number' },
    { key: 'currentValue', label: '当前值', type: 'number' }, { key: 'unit', label: '单位' }, { key: 'status', label: '状态', type: 'select', options: statuses.goal },
  ] },
  { entity: 'projects', label: '项目', singular: '项目', icon: '◈', titleKey: 'title', description: '项目是把目标变成结果的工作空间。', fields: [
    { key: 'title', label: '项目名称' }, { key: 'goalId', label: '所属目标', relation: 'goals' }, { key: 'why', label: '为什么做', multiline: true },
    { key: 'description', label: '说明', multiline: true }, { key: 'status', label: '状态', type: 'select', options: statuses.project },
    { key: 'health', label: '健康度', type: 'select', options: [option('healthy', '健康'), option('at_risk', '有风险'), option('blocked', '受阻')] },
    { key: 'progress', label: '进度（%）', type: 'number' }, { key: 'priority', label: '优先级', type: 'select', options: priorities },
    { key: 'startDate', label: '开始日期', type: 'date' }, { key: 'targetDate', label: '目标日期', type: 'date' },
    { key: 'blockers', label: '阻塞', multiline: true }, { key: 'nextAction', label: '下一步行动', multiline: true },
    { key: 'sourceDecisionId', label: '来源决策', relation: 'decisions' }, { key: 'sourceOpportunityId', label: '来源机会', relation: 'opportunities' }, { key: 'sourceSignalIds', label: '来源信号', relation: 'signals', multiple: true },
    { key: 'workflowRunId', label: '当前工作链', relation: 'workflowRuns' },
  ] },
  { entity: 'tasks', label: '任务', singular: '任务', icon: '□', titleKey: 'title', description: '任务是可以立即执行的下一步行动。', fields: [
    { key: 'title', label: '任务' }, { key: 'description', label: '说明', multiline: true }, { key: 'decisionId', label: '来源决策', relation: 'decisions' }, { key: 'projectId', label: '所属项目', relation: 'projects' },
    { key: 'goalId', label: '所属目标', relation: 'goals' }, { key: 'status', label: '状态', type: 'select', options: statuses.task },
    { key: 'priority', label: '优先级', type: 'select', options: priorities },
    { key: 'importance', label: '重要程度', type: 'select', options: [option('important', '重要'), option('not_important', '不重要')] },
    { key: 'urgency', label: '紧急程度', type: 'select', options: [option('urgent', '紧急'), option('not_urgent', '不紧急')] },
    { key: 'dueDate', label: '截止日期', type: 'date' }, { key: 'dueAt', label: '具体时间', type: 'datetime-local' },
    { key: 'estimateMinutes', label: '预估分钟', type: 'number' }, { key: 'tags', label: '标签（逗号分隔）' }, { key: 'blockedSince', label: '受阻开始时间', type: 'datetime-local', readOnly: true },
    { key: 'dependencyIds', label: '依赖任务', relation: 'tasks', multiple: true }, { key: 'completedAt', label: '完成时间', type: 'datetime-local' },
  ] },
  { entity: 'hypotheses', label: '假设', singular: '假设', icon: '⌁', titleKey: 'title', description: '用实验和证据验证，而不是用感觉判断。', fields: [
    { key: 'title', label: '假设名称' }, { key: 'statement', label: '假设陈述', multiline: true }, { key: 'rationale', label: '依据', multiline: true },
    { key: 'projectId', label: '所属项目', relation: 'projects' }, { key: 'experimentId', label: '实验', relation: 'experiments' },
    { key: 'expectedOutcome', label: '预期结果', multiline: true }, { key: 'actualOutcome', label: '实际结果', multiline: true },
    { key: 'evidence', label: '证据', multiline: true }, { key: 'status', label: '状态', type: 'select', options: statuses.hypothesis }, { key: 'conclusion', label: '结论', multiline: true },
  ] },
  { entity: 'experiments', label: '实验', singular: '实验', icon: '⚗', titleKey: 'title', description: '为假设设计可执行、可复核的验证动作。', fields: [
    { key: 'title', label: '实验名称' }, { key: 'projectId', label: '所属项目', relation: 'projects' }, { key: 'hypothesisId', label: '验证假设', relation: 'hypotheses' },
    { key: 'method', label: '方法', multiline: true }, { key: 'successCriteria', label: '成功标准', multiline: true }, { key: 'startDate', label: '开始日期', type: 'date' },
    { key: 'endDate', label: '结束日期', type: 'date' }, { key: 'status', label: '状态', type: 'select', options: [option('planned', '计划中'), option('running', '进行中'), option('completed', '已完成'), option('cancelled', '已取消')] },
  ] },
  { entity: 'timeLogs', label: '时间', singular: '时间记录', icon: '◷', titleKey: 'title', description: '时间记录现实，而不是计划。', fields: [
    { key: 'title', label: '活动' }, { key: 'notes', label: '备注', multiline: true }, { key: 'startAt', label: '开始时间', type: 'datetime-local' },
    { key: 'endAt', label: '结束时间', type: 'datetime-local' }, { key: 'durationMinutes', label: '时长（分钟）', type: 'number' },
    { key: 'plannedMinutes', label: '明确计划时长（分钟）', type: 'number' },
    { key: 'goalId', label: '目标', relation: 'goals' }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'taskId', label: '任务', relation: 'tasks' },
    { key: 'category', label: '类别' }, { key: 'workMode', label: '工作模式', type: 'select', options: [option('NORMAL', '普通工作'), option('DEEP_WORK', '深度工作'), option('MEETING', '会议')] },
    { key: 'energyLevel', label: '精力（1-5）', type: 'number' },
  ] },
  { entity: 'results', label: '成果 Outcome', singular: '结果', icon: '✓', titleKey: 'title', description: '记录项目或行动产生的现实结果，并用证据比较预期与实际。', fields: [
    { key: 'title', label: '结果名称' }, { key: 'summary', label: '结果摘要', multiline: true }, { key: 'description', label: '结果说明', multiline: true },
    { key: 'outcomeType', label: '结果类型', type: 'select', options: [option('FINANCIAL', '财务结果'), option('QUANTITATIVE', '数量结果'), option('QUALITATIVE', '定性结果'), option('MILESTONE', '里程碑'), option('LEARNING', '学习结果'), option('STRATEGIC', '战略结果')] },
    { key: 'status', label: '状态', type: 'select', options: [option('PLANNED', '计划中'), option('IN_PROGRESS', '进行中'), option('SUCCESS', '成功'), option('PARTIAL', '部分达成'), option('FAILED', '失败'), option('INVALIDATED', '已失效'), option('ABANDONED', '已放弃'), option('ACHIEVED', '已达成'), option('PARTIALLY_ACHIEVED', '部分达成'), option('MISSED', '未达成'), option('CANCELLED', '已取消')] },
    { key: 'metricKind', label: '衡量方式', type: 'select', options: [option('MONEY', '金额'), option('NUMBER', '数值'), option('TIME', '时间'), option('PERCENTAGE', '百分比'), option('QUALITATIVE', '定性描述')] },
    { key: 'currency', label: '币种', type: 'select', options: [option('CNY'), option('USD'), option('JPY'), option('EUR'), option('HKD')] }, { key: 'unit', label: '单位' },
    { key: 'targetAmountMinor', label: '预期金额', type: 'money', currencyKey: 'currency' }, { key: 'actualAmountMinor', label: '实际金额', type: 'money', currencyKey: 'currency' },
    { key: 'targetValue', label: '预期数值' }, { key: 'actualValue', label: '实际数值' },
    { key: 'achievementBps', label: '完成率（基点）', readOnly: true }, { key: 'varianceAmountMinor', label: '金额偏差', type: 'money', currencyKey: 'currency', readOnly: true }, { key: 'varianceValue', label: '数值偏差', readOnly: true },
    { key: 'expected', label: '预期描述（兼容旧记录）', multiline: true }, { key: 'actual', label: '实际描述（兼容旧记录）', multiline: true },
    { key: 'variance', label: '偏差说明', multiline: true }, { key: 'impact', label: '影响', multiline: true }, { key: 'evidence', label: '证据', multiline: true },
    { key: 'evidenceStatus', label: '证据状态', type: 'select', options: [option('VERIFIED', '已核验'), option('RECORDED', '已记录'), option('ESTIMATED', '估算'), option('MISSING', '数据缺失')] },
    { key: 'startDate', label: '开始日期', type: 'date' }, { key: 'endDate', label: '结束日期', type: 'date' }, { key: 'date', label: '结果日期', type: 'date' }, { key: 'source', label: '来源' },
    { key: 'metricData', label: '多指标（JSON）', multiline: true }, { key: 'completedAt', label: '完成时间', type: 'datetime-local' },
    { key: 'taskId', label: '任务', relation: 'tasks' }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'goalId', label: '目标', relation: 'goals' }, { key: 'decisionId', label: '决策', relation: 'decisions' }, { key: 'hypothesisId', label: '假设', relation: 'hypotheses' }, { key: 'workflowRunId', label: '工作链运行', relation: 'workflowRuns' },
  ] },
  { entity: 'deliverables', label: '成果资产', singular: '成果资产', icon: '▣', titleKey: 'title', description: '正式输出资产的元数据；复用 Notebook 文件，不复制原始文件。', fields: [
    { key: 'title', label: '资产名称' }, { key: 'summary', label: '说明', multiline: true }, { key: 'status', label: '版本状态', type: 'select', options: [option('DRAFT', '草稿'), option('FINAL', '当前正式版'), option('SUPERSEDED', '已被新版替代'), option('ARCHIVED', '已归档')] },
    { key: 'assetType', label: '成果类型', type: 'select', options: [option('RESEARCH', '研究与分析'), option('STRATEGY', '策略与方案'), option('SOP', 'SOP 与流程'), option('PRODUCT', '产品与技术'), option('CONTENT', '内容与创意'), option('DELIVERY', '商务与交付'), option('DATA', '数据与模型'), option('OTHER', '其他')] },
    { key: 'versionNumber', label: '版本号' }, { key: 'fileId', label: 'Notebook 文件', relation: 'notebookFiles' }, { key: 'previousDeliverableId', label: '上一版本', relation: 'deliverables' }, { key: 'resultId', label: '所属结果', relation: 'results' }, { key: 'sourceResearchResultId', label: '来源调研结果', relation: 'researchResults' }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'decisionId', label: '决策', relation: 'decisions' }, { key: 'workflowRunId', label: '工作链运行', relation: 'workflowRuns' }, { key: 'tags', label: '标签（逗号分隔）' }, { key: 'finalizedAt', label: '正式完成时间', type: 'datetime-local' },
  ] },
  { entity: 'resultPackages', label: '成果包', singular: '成果包', icon: '▰', titleKey: 'title', description: '聚合结果、正式资产、决策、复盘与工作链；不复制文件或原始数据。', fields: [
    { key: 'title', label: '成果包名称' }, { key: 'summary', label: '摘要', multiline: true }, { key: 'status', label: '状态', type: 'select', options: [option('ACTIVE', '进行中'), option('ARCHIVED', '已归档')] }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'decisionId', label: '决策', relation: 'decisions' }, { key: 'workflowRunId', label: '工作链运行', relation: 'workflowRuns' }, { key: 'resultIds', label: '结果', relation: 'results', multiple: true }, { key: 'deliverableIds', label: '成果资产', relation: 'deliverables', multiple: true }, { key: 'reviewIds', label: '复盘', relation: 'reviews', multiple: true }, { key: 'insightIds', label: '洞见', relation: 'insights', multiple: true },
  ] },
  { entity: 'workflows', label: '工作链', singular: '工作链', icon: '⇢', titleKey: 'name', description: '一类工作从立项、执行到结果与复盘的可演进方法，不等于时间线。', fields: [
    { key: 'name', label: '工作链名称' }, { key: 'description', label: '说明', multiline: true }, { key: 'workflowType', label: '工作链类型' }, { key: 'status', label: '状态', type: 'select', options: [option('ACTIVE', '启用'), option('ARCHIVED', '归档')] }, { key: 'currentVersionId', label: '当前版本', relation: 'workflowVersions' },
  ] },
  { entity: 'workflowVersions', label: '工作链版本', singular: '工作链版本', icon: 'V', titleKey: 'name', description: '工作链的可追溯版本；升级、推荐和回滚都必须由用户确认。', fields: [
    { key: 'workflowId', label: '工作链', relation: 'workflows' }, { key: 'versionNumber', label: '版本号' }, { key: 'name', label: '版本名称' }, { key: 'description', label: '说明', multiline: true }, { key: 'maturity', label: '成熟度', type: 'select', options: [option('EXPERIMENTAL', '实验中'), option('TESTED', '已测试'), option('VALIDATED', '已验证'), option('RECOMMENDED', '推荐'), option('STANDARD', '标准'), option('REJECTED', '已拒绝')] }, { key: 'changeSummary', label: '变更摘要', multiline: true }, { key: 'createdFromVersionId', label: '来源版本', relation: 'workflowVersions' },
  ] },
  { entity: 'workflowSteps', label: '工作链步骤', singular: '步骤', icon: '≡', titleKey: 'title', description: '模板中的步骤定义；实际执行记录保存在工作链运行步骤。', fields: [
    { key: 'workflowVersionId', label: '工作链版本', relation: 'workflowVersions' }, { key: 'title', label: '步骤名称' }, { key: 'description', label: '说明', multiline: true }, { key: 'orderIndex', label: '顺序', type: 'number' }, { key: 'stepType', label: '步骤类型', type: 'select', options: [option('REQUIRED', '必需'), option('OPTIONAL', '可选'), option('CONDITIONAL', '条件执行')] }, { key: 'executionType', label: '执行方式', type: 'select', options: [option('HUMAN', '人工'), option('AI', 'AI'), option('AUTOMATION', '自动化'), option('HYBRID', '混合')] }, { key: 'estimatedTime', label: '预计时间（分钟）', type: 'number' }, { key: 'estimatedCost', label: '预计成本' },
  ] },
  { entity: 'workflowGates', label: '工作链决策关口', singular: '决策关口', icon: '◇', titleKey: 'title', description: '工作链中的 Continue、Adjust、Stop、Escalate 判断点；真实决策可关联现有 Decision。', fields: [
    { key: 'workflowVersionId', label: '工作链版本', relation: 'workflowVersions' }, { key: 'workflowStepId', label: '关联步骤', relation: 'workflowSteps' }, { key: 'title', label: '关口名称' }, { key: 'description', label: '说明', multiline: true }, { key: 'gateRule', label: '判断规则', multiline: true }, { key: 'decisionId', label: '真实决策', relation: 'decisions' },
  ] },
  { entity: 'workflowRuns', label: '工作链运行', singular: '工作链运行', icon: '▶', titleKey: 'title', description: '某次项目实际采用的工作链运行，与模板定义保持分开。', fields: [
    { key: 'title', label: '运行名称' }, { key: 'workflowId', label: '工作链', relation: 'workflows' }, { key: 'workflowVersionId', label: '工作链版本', relation: 'workflowVersions' }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'status', label: '状态', type: 'select', options: [option('PLANNED', '计划中'), option('RUNNING', '进行中'), option('PAUSED', '已暂停'), option('COMPLETED', '已完成'), option('CANCELLED', '已取消')] }, { key: 'startedAt', label: '开始时间', type: 'datetime-local' }, { key: 'completedAt', label: '完成时间', type: 'datetime-local' }, { key: 'contextSnapshot', label: '执行环境（JSON）', multiline: true }, { key: 'scorecard', label: '多维评分（JSON）', multiline: true }, { key: 'confidence', label: '证据强度', type: 'select', options: [option('LOW', '低'), option('MEDIUM', '中'), option('HIGH', '高')] },
  ] },
  { entity: 'workflowRunSteps', label: '工作链运行步骤', singular: '运行步骤', icon: '›', titleKey: 'title', description: '实际执行步骤；实际时间和成本优先聚合现有 Time / Finance。', fields: [
    { key: 'workflowRunId', label: '工作链运行', relation: 'workflowRuns' }, { key: 'workflowStepId', label: '模板步骤', relation: 'workflowSteps' }, { key: 'title', label: '步骤名称' }, { key: 'status', label: '状态', type: 'select', options: [option('PLANNED', '计划中'), option('RUNNING', '进行中'), option('COMPLETED', '已完成'), option('SKIPPED', '已跳过'), option('BLOCKED', '受阻')] }, { key: 'startedAt', label: '开始时间', type: 'datetime-local' }, { key: 'completedAt', label: '完成时间', type: 'datetime-local' }, { key: 'notes', label: '记录', multiline: true }, { key: 'evidenceIds', label: '证据记录', relation: 'results', multiple: true },
  ] },
  { entity: 'workflowMetricDefinitions', label: '工作链指标', singular: '工作链指标', icon: '↗', titleKey: 'name', description: '为某个工作链版本配置多维评价和 Guardrail，不建立万能总分。', fields: [
    { key: 'workflowVersionId', label: '工作链版本', relation: 'workflowVersions' }, { key: 'name', label: '指标名称' }, { key: 'metricKey', label: '事实口径', type: 'select', options: [option('timeMinutes', '实际时间（分钟）'), option('costMinor', '实际成本（最小货币单位）'), option('resultCount', '结果数量'), option('verifiedResultCount', '已核验结果数量'), option('completionRate', '步骤完成率')] }, { key: 'dimension', label: '评价维度', type: 'select', options: [option('EFFECTIVENESS', '目标有效性'), option('QUALITY', '成果质量'), option('TIME_EFFICIENCY', '时间效率'), option('COST_EFFICIENCY', '资金效率'), option('RELIABILITY', '稳定性'), option('PREDICTABILITY', '可预测性'), option('LEVERAGE', '复用杠杆'), option('STRATEGIC_VALUE', '战略价值')] }, { key: 'unit', label: '单位' }, { key: 'direction', label: '方向', type: 'select', options: [option('HIGHER_IS_BETTER', '越高越好'), option('LOWER_IS_BETTER', '越低越好'), option('TARGET_RANGE', '目标区间')] }, { key: 'targetValue', label: '目标值' }, { key: 'weight', label: '权重（可选）', type: 'number' }, { key: 'isGuardrail', label: '是否 Guardrail', type: 'select', options: [option('true', '是'), option('false', '否')] }, { key: 'minimumAcceptable', label: '最低可接受值' }, { key: 'maximumAcceptable', label: '最高可接受值' },
  ] },
  { entity: 'workflowImprovementProposals', label: '工作链改进提案', singular: '改进提案', icon: '↑', titleKey: 'title', description: '从复盘到下一版工作链的可验证提案；不会直接修改正式工作链。', fields: [
    { key: 'title', label: '提案名称' }, { key: 'workflowId', label: '工作链', relation: 'workflows' }, { key: 'sourceWorkflowVersionId', label: '来源版本', relation: 'workflowVersions' }, { key: 'sourceWorkflowRunId', label: '来源运行', relation: 'workflowRuns' }, { key: 'reviewId', label: '来源复盘', relation: 'reviews' }, { key: 'problem', label: '问题', multiline: true }, { key: 'hypothesis', label: '改进假设', multiline: true }, { key: 'proposedChange', label: '拟议变更', multiline: true }, { key: 'expectedImpact', label: '预期影响', multiline: true }, { key: 'guardrailDefinition', label: 'Guardrail', multiline: true }, { key: 'status', label: '状态', type: 'select', options: [option('DRAFT', '草稿'), option('PROPOSED', '待确认'), option('APPROVED', '已批准'), option('IMPLEMENTED', '已实现'), option('VALIDATED', '已验证'), option('REJECTED', '已拒绝')] },
  ] },
  { entity: 'financialAccounts', label: '财务账户', singular: '账户', icon: '◉', titleKey: 'name', description: '记录真实资金账户；余额由已入账流水计算，不允许直接修改当前余额。', fields: [
    { key: 'name', label: '账户名称' }, { key: 'accountType', label: '账户类型', type: 'select', options: [option('BANK', '银行'), option('CASH', '现金'), option('PAYMENT_PLATFORM', '支付平台'), option('WALLET', '钱包'), option('OTHER', '其他')] },
    { key: 'currency', label: '币种', type: 'select', options: [option('CNY'), option('USD'), option('JPY'), option('EUR'), option('HKD')] }, { key: 'openingBalanceMinor', label: '期初余额', type: 'money', currencyKey: 'currency' },
    { key: 'status', label: '状态', type: 'select', options: [option('ACTIVE', '启用'), option('INACTIVE', '停用')] }, { key: 'evidenceStatus', label: '余额状态', type: 'select', options: [option('VERIFIED', '已核验'), option('RECORDED', '按流水计算'), option('MISSING', '数据缺失')] },
    { key: 'verifiedAt', label: '最近核验时间', type: 'datetime-local' }, { key: 'description', label: '说明', multiline: true },
  ] },
  { entity: 'financialCategories', label: '财务分类', singular: '财务分类', icon: '≡', titleKey: 'name', description: '用于经营分析的轻量分类，不建立复杂会计科目。', fields: [
    { key: 'name', label: '分类名称' }, { key: 'direction', label: '方向', type: 'select', options: [option('INCOME', '收入'), option('EXPENSE', '支出'), option('BOTH', '通用')] }, { key: 'parentCategoryId', label: '上级分类', relation: 'financialCategories' }, { key: 'status', label: '状态', type: 'select', options: [option('ACTIVE', '启用'), option('INACTIVE', '停用')] },
  ] },
  { entity: 'financialTransactions', label: '财务流水', singular: '财务流水', icon: '¥', titleKey: 'title', description: '记录资金事实。已入账流水不能删除；错误通过作废、退款或调整修正。', fields: [
    { key: 'title', label: '交易说明' }, { key: 'transactionType', label: '交易类型', type: 'select', options: [option('INCOME', '收入'), option('EXPENSE', '支出'), option('TRANSFER', '转账'), option('REFUND', '退款'), option('ADJUSTMENT', '余额调整')] },
    { key: 'status', label: '状态', type: 'select', options: [option('DRAFT', '草稿'), option('POSTED', '已入账'), option('VOIDED', '已作废')] },
    { key: 'amountMinor', label: '原币金额', type: 'money', currencyKey: 'currency' }, { key: 'currency', label: '原币币种', type: 'select', options: [option('CNY'), option('USD'), option('JPY'), option('EUR'), option('HKD')] },
    { key: 'baseCurrency', label: '基础币种', type: 'select', options: [option('CNY'), option('USD'), option('JPY'), option('EUR'), option('HKD')] }, { key: 'baseAmountMinor', label: '基础币金额', type: 'money', currencyKey: 'baseCurrency' }, { key: 'exchangeRate', label: '手动汇率' },
    { key: 'occurredAt', label: '发生时间', type: 'datetime-local' }, { key: 'accountId', label: '来源账户', relation: 'financialAccounts' }, { key: 'destinationAccountId', label: '目标账户（转账）', relation: 'financialAccounts' }, { key: 'categoryId', label: '分类', relation: 'financialCategories' },
    { key: 'goalId', label: '目标', relation: 'goals' }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'taskId', label: '任务', relation: 'tasks' },
    { key: 'refundKind', label: '退款类型', type: 'select', options: [option('EXPENSE_REFUND', '费用退款'), option('INCOME_REFUND', '收入退款')] }, { key: 'refundOfTransactionId', label: '原交易', relation: 'financialTransactions' }, { key: 'adjustmentDirection', label: '调整方向', type: 'select', options: [option('INCREASE', '增加'), option('DECREASE', '减少')] },
    { key: 'channel', label: '渠道' }, { key: 'evidenceStatus', label: '证据状态', type: 'select', options: [option('VERIFIED', '已核验'), option('RECORDED', '已记录'), option('ESTIMATED', '估算'), option('MISSING', '数据缺失')] }, { key: 'description', label: '备注', multiline: true }, { key: 'voidReason', label: '作废原因', multiline: true },
  ] },
  { entity: 'financialTransactionAllocations', label: '项目分摊', singular: '项目分摊', icon: '÷', titleKey: 'title', description: '将一笔已记录的收入、支出或退款分摊给多个项目；分摊合计不能超过流水基础币金额。', fields: [
    { key: 'title', label: '分摊说明' }, { key: 'transactionId', label: '财务流水', relation: 'financialTransactions' }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'amountMinor', label: '分摊基础币金额', type: 'money', currencyKey: 'baseCurrency' }, { key: 'baseCurrency', label: '基础币种', type: 'select', options: [option('CNY'), option('USD'), option('JPY'), option('EUR'), option('HKD')] }, { key: 'description', label: '备注', multiline: true },
  ] },
  { entity: 'financialBudgets', label: '财务预算', singular: '预算', icon: '▣', titleKey: 'title', description: '预算是管理约束，不是资金事实；实际支出始终以已入账流水为准。', fields: [
    { key: 'title', label: '预算名称' }, { key: 'projectId', label: '项目（可选）', relation: 'projects' }, { key: 'categoryId', label: '分类（可选）', relation: 'financialCategories' }, { key: 'amountMinor', label: '预算基础币金额', type: 'money', currencyKey: 'baseCurrency' }, { key: 'baseCurrency', label: '基础币种', type: 'select', options: [option('CNY'), option('USD'), option('JPY'), option('EUR'), option('HKD')] },
    { key: 'periodStart', label: '预算开始', type: 'date' }, { key: 'periodEnd', label: '预算结束', type: 'date' }, { key: 'status', label: '状态', type: 'select', options: [option('ACTIVE', '启用'), option('ARCHIVED', '归档')] }, { key: 'description', label: '备注', multiline: true },
  ] },
  { entity: 'reviews', label: '复盘', singular: '复盘', icon: '◑', titleKey: 'title', description: '把现实转化为可以改变未来行动的经验。', fields: [
    { key: 'title', label: '复盘主题' }, { key: 'whatHappened', label: '发生了什么', multiline: true }, { key: 'whyItHappened', label: '为什么', multiline: true },
    { key: 'whatWorked', label: '哪些有效', multiline: true }, { key: 'whatFailed', label: '哪些无效', multiline: true }, { key: 'lesson', label: '学到了什么', multiline: true },
    { key: 'doDifferently', label: '下次如何不同', multiline: true }, { key: 'nextAction', label: '下一步行动', multiline: true },
    { key: 'taskId', label: '任务', relation: 'tasks' }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'goalId', label: '目标', relation: 'goals' },
    { key: 'periodStart', label: '周期开始', type: 'date' }, { key: 'periodEnd', label: '周期结束', type: 'date' }, { key: 'resultId', label: '结果', relation: 'results' }, { key: 'decisionId', label: '决策', relation: 'decisions' }, { key: 'sourceNoteId', label: '来源笔记', relation: 'notes' },
  ] },
  { entity: 'knowledge', label: '知识', singular: '知识', icon: '⌘', titleKey: 'title', description: '保存可以长期复用的信息与理解。', fields: [
    { key: 'title', label: '标题' }, { key: 'content', label: '内容', multiline: true }, { key: 'source', label: '来源' }, { key: 'category', label: '分类' },
    { key: 'tags', label: '标签（逗号分隔）' }, { key: 'projectIds', label: '相关项目', relation: 'projects', multiple: true }, { key: 'reviewIds', label: '相关复盘', relation: 'reviews', multiple: true }, { key: 'sourceNoteId', label: '来源笔记', relation: 'notes' },
  ] },
  { entity: 'notes', label: 'Notebook', singular: '笔记', icon: '✎', titleKey: 'title', description: '自由记录任何想法、观察、经历或灵感，不需要先判断分类或关系。', fields: [
    { key: 'title', label: '标题' }, { key: 'content', label: '正文', multiline: true },
    { key: 'type', label: '类型', type: 'select', options: [option('NOTE', '笔记'), option('IDEA', '想法'), option('JOURNAL', '日记'), option('OBSERVATION', '观察'), option('LEARNING', '学习'), option('DRAFT', '草稿')] },
    { key: 'status', label: '状态', type: 'select', options: [option('INBOX', 'Inbox'), option('ACTIVE', 'Notes'), option('ARCHIVED', '已归档')] },
    { key: 'notebookCategoryId', label: 'Notebook 分类', relation: 'notebookCategories' }, { key: 'notebookFolderId', label: 'Notebook 文件夹', relation: 'notebookFolders' },
    { key: 'favorite', label: '收藏', type: 'select', options: [option('false', '否'), option('true', '是')] },
  ] },
  { entity: 'notebookCategories', label: 'Notebook 分类', singular: '分类', icon: '▦', titleKey: 'name', description: 'Notebook 内部的自定义分类；不是 Jason OS Project。', fields: [
    { key: 'name', label: '分类名称' }, { key: 'description', label: '说明', multiline: true }, { key: 'sortOrder', label: '排序', type: 'number' }, { key: 'parentNotebookCategoryId', label: '上级分类', relation: 'notebookCategories' },
  ] },
  { entity: 'notebookFolders', label: 'Notebook 文件夹', singular: '文件夹', icon: '□', titleKey: 'name', description: '用于整理 Notebook 笔记与文件，支持子文件夹。', fields: [
    { key: 'name', label: '文件夹名称' }, { key: 'notebookCategoryId', label: '所属分类', relation: 'notebookCategories' }, { key: 'parentNotebookFolderId', label: '上级文件夹', relation: 'notebookFolders' }, { key: 'sortOrder', label: '排序', type: 'number' }, { key: 'favorite', label: '收藏', type: 'select', options: [option('false', '否'), option('true', '是')] },
  ] },
  { entity: 'notebookFiles', label: 'Notebook 文件', singular: '文件', icon: '⊞', titleKey: 'name', description: 'Notebook 中保存的本地文件元数据；原始文件保存在本地 Storage。', fields: [
    { key: 'name', label: '文件名' }, { key: 'originalName', label: '原始文件名' }, { key: 'extension', label: '扩展名' }, { key: 'mimeType', label: 'MIME 类型' }, { key: 'size', label: '大小（bytes）', type: 'number' }, { key: 'storagePath', label: '存储路径', readOnly: true }, { key: 'extractStatus', label: '内容提取状态', readOnly: true }, { key: 'extractedContent', label: '已提取文本', multiline: true, readOnly: true },
    { key: 'notebookCategoryId', label: 'Notebook 分类', relation: 'notebookCategories' }, { key: 'notebookFolderId', label: 'Notebook 文件夹', relation: 'notebookFolders' }, { key: 'status', label: '状态', type: 'select', options: [option('ACTIVE', 'Active'), option('ARCHIVED', '已归档')] }, { key: 'favorite', label: '收藏', type: 'select', options: [option('false', '否'), option('true', '是')] },
  ] },
  { entity: 'insights', label: '洞见', singular: '洞见', icon: '✦', titleKey: 'statement', description: '从经验中提炼“我发现了什么”。', fields: [
    { key: 'statement', label: '洞见' }, { key: 'explanation', label: '解释', multiline: true }, { key: 'evidence', label: '证据', multiline: true },
    { key: 'validationStatus', label: '验证状态', type: 'select', options: [option('PENDING', '待验证'), option('SUPPORTED', '已验证'), option('CONTRADICTED', '已反驳'), option('INSUFFICIENT', '证据不足')] }, { key: 'validatedAt', label: '验证时间', type: 'datetime-local' },
    { key: 'source', label: '来源' }, { key: 'taskId', label: '任务', relation: 'tasks' }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'goalId', label: '目标', relation: 'goals' },
    { key: 'reviewId', label: '复盘', relation: 'reviews' }, { key: 'resultId', label: '结果', relation: 'results' }, { key: 'knowledgeId', label: '知识', relation: 'knowledge' }, { key: 'sourceNoteId', label: '来源笔记', relation: 'notes' }, { key: 'confidence', label: '置信度（0-100）', type: 'number' },
  ] },
  { entity: 'principles', label: '原则', singular: '原则', icon: '∴', titleKey: 'statement', description: '记录长期相信并愿意用于决策的原则。', fields: [
    { key: 'statement', label: '原则' }, { key: 'explanation', label: '解释', multiline: true }, { key: 'evidence', label: '证据', multiline: true },
    { key: 'status', label: '生命周期', type: 'select', options: [option('CANDIDATE', '候选'), option('ACTIVE', '已验证/启用'), option('UNDER_REVIEW', '重新验证中'), option('RETIRED', '已退役'), option('REJECTED', '已拒绝')] }, { key: 'validatedAt', label: '最近验证时间', type: 'datetime-local' }, { key: 'revalidationDueAt', label: '重新验证日期', type: 'date' },
    { key: 'examples', label: '示例', multiline: true }, { key: 'limitations', label: '局限', multiline: true }, { key: 'source', label: '来源' },
    { key: 'usage', label: '使用说明', multiline: true }, { key: 'insightIds', label: '来源洞见', relation: 'insights', multiple: true }, { key: 'reviewIds', label: '来源复盘', relation: 'reviews', multiple: true }, { key: 'mentalModelIds', label: '相关思维模型', relation: 'mentalModels', multiple: true },
  ] },
  { entity: 'mentalModels', label: 'CEO 决策思维模型', singular: '思维模型', icon: '◇', titleKey: 'name', description: '把认知工具变成可调用、可解释、可复盘的 CEO 决策资产。', fields: [
    { key: 'name', label: '模型名称' }, { key: 'slug', label: '唯一标识' }, { key: 'categoryId', label: '一级分类', type: 'select', options: [option('problem-cognition', '问题认知'), option('risk-error', '风险与错误'), option('decision-judgment', '决策判断'), option('strategy', '战略'), option('customer-product', '客户与产品'), option('growth', '增长'), option('organization', '组织'), option('learning-evolution', '学习与进化')] }, { key: 'category', label: '分类显示名' },
    { key: 'definition', label: '模型定义', multiline: true }, { key: 'coreIdea', label: '核心思想', multiline: true }, { key: 'corePrinciple', label: '核心原则（兼容）', multiline: true }, { key: 'problem', label: '解决的问题', multiline: true },
    { key: 'applicationScenarios', label: '适用场景', multiline: true }, { key: 'useCases', label: '适用场景（兼容）', multiline: true }, { key: 'triggerConditions', label: '触发条件', multiline: true }, { key: 'trigger', label: '何时使用（兼容）', multiline: true },
    { key: 'keyQuestions', label: '关键问题', multiline: true }, { key: 'methodSteps', label: '使用方法', multiline: true }, { key: 'steps', label: '流程步骤（兼容）', multiline: true }, { key: 'outputStructure', label: '输出结构', multiline: true }, { key: 'outputTemplate', label: '输出模板（兼容）', multiline: true },
    { key: 'sourcePerson', label: '来源人物' }, { key: 'sourceTheory', label: '来源理论' }, { key: 'source', label: '来源（兼容）' }, { key: 'relatedModelIds', label: '关联模型', relation: 'mentalModels', multiple: true }, { key: 'oppositeModelIds', label: '对立/互补模型', relation: 'mentalModels', multiple: true }, { key: 'parentModelId', label: '上级模型', relation: 'mentalModels' },
    { key: 'assumptions', label: '关键假设', multiline: true }, { key: 'validationMethods', label: '验证方式', multiline: true }, { key: 'validationCost', label: '验证成本', multiline: true }, { key: 'validationResult', label: '验证结果', multiline: true }, { key: 'confidenceBefore', label: '验证前置信度', type: 'number' }, { key: 'confidenceAfter', label: '验证后置信度', type: 'number' }, { key: 'stopConditions', label: '停止条件', multiline: true },
    { key: 'tags', label: '标签（逗号分隔）' }, { key: 'difficulty', label: '难度', type: 'select', options: [option('beginner', '入门'), option('intermediate', '进阶'), option('advanced', '高级')] }, { key: 'status', label: '状态', type: 'select', options: [option('draft', '草稿'), option('active', '启用'), option('archived', '归档')] }, { key: 'needsReview', label: '需要人工复核' }, { key: 'usageCount', label: '调用次数', type: 'number' }, { key: 'successCount', label: '有效次数', type: 'number' }, { key: 'effectivenessScore', label: '有效性评分（1-5）', type: 'number' },
    { key: 'framework', label: '框架（兼容）', multiline: true }, { key: 'questions', label: '关键问题（兼容旧记录）', multiline: true }, { key: 'method', label: '方法（兼容旧记录）', multiline: true }, { key: 'application', label: '应用（兼容旧记录）', multiline: true }, { key: 'limitations', label: '局限', multiline: true }, { key: 'examples', label: '示例', multiline: true },
    { key: 'insightId', label: '来源洞见', relation: 'insights' }, { key: 'reviewId', label: '来源复盘', relation: 'reviews' }, { key: 'sourceNoteId', label: '来源笔记', relation: 'notes' }, { key: 'principleIds', label: '相关原则', relation: 'principles', multiple: true },
  ] },
  { entity: 'mentalModelUsages', label: '模型使用', singular: '模型使用记录', icon: '⇄', titleKey: 'context', description: '追踪思维模型是否真正改善了结果。', fields: [
    { key: 'mentalModelId', label: '思维模型', relation: 'mentalModels' }, { key: 'decisionId', label: '决策', relation: 'decisions' },
    { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'context', label: '使用情境', multiline: true }, { key: 'outcome', label: '结果', multiline: true },
    { key: 'effective', label: '是否有效', type: 'select', options: [option('yes', '有效'), option('partial', '部分有效'), option('no', '无效'), option('unknown', '未知')] }, { key: 'effectivenessRating', label: '帮助评分（1-5）', type: 'number' }, { key: 'notes', label: '备注', multiline: true },
  ] },
  { entity: 'decisions', label: '决策日志', singular: '决策', icon: '◆', titleKey: 'title', description: '记录问题、预测、结果与校准过程。', fields: [
    { key: 'title', label: '决策名称' }, { key: 'problem', label: '问题', multiline: true }, { key: 'context', label: '背景', multiline: true },
    { key: 'options', label: '备选方案', multiline: true }, { key: 'selectedOption', label: '选择', multiline: true }, { key: 'reasoning', label: '理由', multiline: true },
    { key: 'evidence', label: '证据', multiline: true }, { key: 'prediction', label: '预测', multiline: true }, { key: 'confidence', label: '置信度（0-100）', type: 'number' },
    { key: 'decisionLevel', label: '决策级别', type: 'select', options: [option('OPERATIONAL', '日常'), option('MATERIAL', '重要'), option('STRATEGIC', '战略')] },
    { key: 'expectedOutcome', label: '预期结果', multiline: true }, { key: 'expectedRevenueMinor', label: '预期收入', type: 'money', currencyKey: 'currency' }, { key: 'expectedCostMinor', label: '预期成本', type: 'money', currencyKey: 'currency' }, { key: 'currency', label: '币种', type: 'select', options: [option('CNY'), option('USD'), option('JPY'), option('EUR'), option('HKD')] },
    { key: 'expectedTimeMinutes', label: '预期时间（分钟）', type: 'number' }, { key: 'expectedCompletionDate', label: '预期完成日期', type: 'date' }, { key: 'reviewDueDate', label: '复盘日期', type: 'date' },
    { key: 'evidenceSnapshotAt', label: '证据快照时间', type: 'datetime-local', readOnly: true }, { key: 'dataCoverage', label: '决策数据覆盖（%）', type: 'number', readOnly: true }, { key: 'knownUnknowns', label: '已知数据缺口', multiline: true }, { key: 'evidenceSnapshot', label: '决策时证据快照', multiline: true, readOnly: true },
    { key: 'date', label: '决策日期', type: 'date' }, { key: 'status', label: '状态', type: 'select', options: statuses.decision }, { key: 'outcome', label: '实际结果', multiline: true },
    { key: 'actualRevenueMinor', label: '实际收入', type: 'money', currencyKey: 'currency' }, { key: 'actualCostMinor', label: '实际成本', type: 'money', currencyKey: 'currency' }, { key: 'actualTimeMinutes', label: '实际时间（分钟）', type: 'number' }, { key: 'actualCompletionDate', label: '实际完成日期', type: 'date' },
    { key: 'taskId', label: '任务', relation: 'tasks' }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'goalId', label: '目标', relation: 'goals' },
    { key: 'knowledgeId', label: '知识', relation: 'knowledge' }, { key: 'insightId', label: '洞见', relation: 'insights' }, { key: 'resultId', label: '结果', relation: 'results' }, { key: 'reviewId', label: '复盘', relation: 'reviews' },
    { key: 'signalIds', label: '来源信号', relation: 'signals', multiple: true }, { key: 'opportunityId', label: '来源机会', relation: 'opportunities' }, { key: 'sourceNoteId', label: '来源笔记', relation: 'notes' },
    { key: 'principleIds', label: '调用原则', relation: 'principles', multiple: true }, { key: 'mentalModelIds', label: '调用思维模型', relation: 'mentalModels', multiple: true },
  ] },
  { entity: 'externalSources', label: '情报源', singular: '情报源', icon: '◉', titleKey: 'name', description: '定义 Jason OS 应持续观察的关键词、账号、竞品和主题。', fields: [
    { key: 'name', label: '名称' }, { key: 'type', label: '类型', type: 'select', options: [option('LINK', '固定链接'), option('KEYWORD', '关键词'), option('ACCOUNT', '账号'), option('COMPETITOR', '竞品'), option('MARKET', '市场'), option('TOPIC', '主题')] },
    { key: 'platform', label: '平台', type: 'select', options: ['网页', '微信公众号', '抖音', '小红书', 'X', 'Instagram', 'Facebook', 'Reddit', 'TikTok', 'YouTube'] }, { key: 'query', label: '关键词 / 账号' }, { key: 'url', label: '公开链接' },
    { key: 'status', label: '状态', type: 'select', options: [option('active', '启用'), option('paused', '暂停'), option('unsupported', '接口待接入')] }, { key: 'pollInterval', label: '同步频率', type: 'select', options: [option('manual', '仅手动'), option('daily', '应用打开时每日一次')] },
    { key: 'providerPreference', label: '采集服务', type: 'select', options: [option('auto', '自动选择'), option('redfox', 'RedFoxHub'), option('apify', 'Apify'), option('tikhub', 'TikHub'), option('scrapecreators', 'Scrape Creators')] }, { key: 'lastPolledAt', label: '最近同步', type: 'datetime-local' },
    { key: 'goalId', label: '目标', relation: 'goals' }, { key: 'projectId', label: '项目', relation: 'projects' },
  ] },
  { entity: 'signals', label: '外部信号', singular: '外部信号', icon: '⌁', titleKey: 'title', description: '由可追溯的外部变化形成，等待观察、验证或进入决策。', fields: [
    { key: 'title', label: '信号' }, { key: 'type', label: '类型', type: 'select', options: ['GROWTH', 'VIRAL', 'COMPETITOR_ACTIVITY', 'DEMAND', 'RISK'] }, { key: 'summary', label: '摘要', multiline: true },
    { key: 'status', label: '状态', type: 'select', options: [option('DETECTED', '已发现'), option('WATCHING', '观察中'), option('VALIDATED', '已验证'), option('DISMISSED', '已忽略'), option('EXPIRED', '已过期'), option('CONVERTED', '已转化')] },
    { key: 'platform', label: '平台' }, { key: 'topic', label: '主题' }, { key: 'baselineValue', label: '基线值' }, { key: 'currentValue', label: '当前值' }, { key: 'changeRate', label: '变化率' },
    { key: 'baselineStart', label: '基线开始', type: 'date' }, { key: 'baselineEnd', label: '基线结束', type: 'date' }, { key: 'currentStart', label: '当前开始', type: 'date' }, { key: 'currentEnd', label: '当前结束', type: 'date' },
    { key: 'sampleSize', label: '样本量' }, { key: 'independentAuthorCount', label: '独立作者' }, { key: 'calculationMethod', label: '计算口径', multiline: true }, { key: 'evidenceItemIds', label: '证据内容 ID', multiple: true },
    { key: 'detectedAt', label: '发现时间', type: 'datetime-local' }, { key: 'expiresAt', label: '过期时间', type: 'datetime-local' }, { key: 'goalId', label: '目标', relation: 'goals' }, { key: 'projectId', label: '项目', relation: 'projects' },
    { key: 'opportunityId', label: '机会', relation: 'opportunities' }, { key: 'decisionId', label: '决策', relation: 'decisions' },
  ] },
  { entity: 'opportunities', label: '机会', singular: '机会', icon: '◇', titleKey: 'title', description: '由已确认的信号形成，进入 CEO 判断而不是自动立项。', fields: [
    { key: 'title', label: '机会名称' }, { key: 'problem', label: '要解决的问题', multiline: true }, { key: 'hypothesis', label: '机会假设', multiline: true }, { key: 'market', label: '市场' }, { key: 'category', label: '分类' },
    { key: 'status', label: '状态', type: 'select', options: [option('draft', '草稿'), option('evaluating', '评估中'), option('decided', '已决策'), option('dismissed', '已放弃')] },
    { key: 'signalIds', label: '来源信号', relation: 'signals', multiple: true }, { key: 'evidence', label: '证据', multiline: true }, { key: 'dataGaps', label: '数据缺口', multiline: true },
    { key: 'demandEvidence', label: '需求证据', multiline: true }, { key: 'growthEvidence', label: '增长证据', multiline: true }, { key: 'competitionEvidence', label: '竞争证据', multiline: true }, { key: 'contentEvidence', label: '内容证据', multiline: true }, { key: 'marginEvidence', label: '利润证据', multiline: true }, { key: 'strategicFit', label: '战略适配', multiline: true },
    { key: 'decisionId', label: '决策', relation: 'decisions' }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'goalId', label: '目标', relation: 'goals' }, { key: 'resultId', label: '结果', relation: 'results' },
  ] },
  { entity: 'intelligenceBriefs', label: '情报简报', singular: '情报简报', icon: '✺', titleKey: 'title', description: '把少量重要信号、机会和风险整理成 CEO 可以快速阅读的简报。', fields: [
    { key: 'title', label: '简报标题' }, { key: 'periodStart', label: '周期开始', type: 'date' }, { key: 'periodEnd', label: '周期结束', type: 'date' }, { key: 'signalIds', label: '信号', relation: 'signals', multiple: true }, { key: 'opportunityIds', label: '机会', relation: 'opportunities', multiple: true }, { key: 'riskSignalIds', label: '风险信号', relation: 'signals', multiple: true }, { key: 'summary', label: '摘要', multiline: true }, { key: 'dataGaps', label: '数据缺口', multiline: true }, { key: 'generatedAt', label: '生成时间', type: 'datetime-local' }, { key: 'status', label: '状态', type: 'select', options: [option('draft', '草稿'), option('published', '已确认')] },
  ] },
  { entity: 'researchThreads', label: '调研主题', singular: '调研主题', icon: '◌', titleKey: 'title', description: '一个调研主题可包含多轮需求、执行与结果快照；不会自动合并历史调研。', fields: [
    { key: 'title', label: '主题名称' }, { key: 'summary', label: '主题说明', multiline: true }, { key: 'status', label: '状态', type: 'select', options: [option('ACTIVE', '进行中'), option('COMPLETED', '已完成'), option('ARCHIVED', '已归档')] }, { key: 'primaryProjectId', label: '主要项目（可选）', relation: 'projects' }, { key: 'tags', label: '标签（逗号分隔）' },
  ] },
  { entity: 'researchRequests', label: '调研需求', singular: '调研需求', icon: '⌕', titleKey: 'title', description: '在收纳箱中提出外部调研需求；确认前不会执行，也不会自动关联 Jason OS。', fields: [
    { key: 'title', label: '调研标题' }, { key: 'request', label: '调研要求', multiline: true }, { key: 'status', label: '状态', type: 'select', options: [option('DRAFT', '方案待确认'), option('RUNNING', '调研中'), option('COMPLETED', '已完成'), option('FAILED', '未完成'), option('CANCELLED', '已取消')] },
    { key: 'researchThreadId', label: '所属调研主题', relation: 'researchThreads' }, { key: 'scope', label: '调研范围' }, { key: 'dimensions', label: '研究维度' }, { key: 'deliverables', label: '交付内容' }, { key: 'sourceSelectionMode', label: '情报源选择模式' }, { key: 'allowedProviderIds', label: '手动允许的 Provider', multiline: true }, { key: 'researchMode', label: '调研深度' }, { key: 'sourcePlan', label: '情报源方案', multiline: true }, { key: 'selectedSourceKeys', label: '已选择情报源', multiline: true }, { key: 'executionStatus', label: '执行结果' },
    { key: 'notebookCategoryId', label: '收纳箱分类', relation: 'notebookCategories' }, { key: 'tags', label: '标签（逗号分隔）' }, { key: 'startedAt', label: '开始时间', type: 'datetime-local', readOnly: true }, { key: 'completedAt', label: '完成时间', type: 'datetime-local', readOnly: true },
  ] },
  { entity: 'researchRuns', label: '调研运行', singular: '调研运行', icon: '▶', titleKey: 'title', description: '一次确认后的调研执行；保留方案、范围与 Provider 运行快照。', fields: [
    { key: 'title', label: '运行标题' }, { key: 'researchThreadId', label: '所属调研主题', relation: 'researchThreads' }, { key: 'researchRequestId', label: '调研需求', relation: 'researchRequests' }, { key: 'status', label: '状态', type: 'select', options: [option('RUNNING', '调研中'), option('COMPLETED', '已完成'), option('PARTIAL', '部分完成'), option('FAILED', '未完成'), option('CANCELLED', '已取消')] }, { key: 'planSnapshot', label: '方案快照', multiline: true, readOnly: true }, { key: 'scopeSnapshot', label: '范围快照', multiline: true, readOnly: true }, { key: 'providerRunIds', label: 'Provider 运行 ID', multiline: true, readOnly: true }, { key: 'startedAt', label: '开始时间', type: 'datetime-local', readOnly: true }, { key: 'completedAt', label: '完成时间', type: 'datetime-local', readOnly: true },
  ] },
  { entity: 'researchResults', label: '调研结果', singular: '调研结果', icon: '◈', titleKey: 'title', description: '外部调研的结果与证据；由用户决定是否分类、存入知识或关联 Jason OS。', fields: [
    { key: 'title', label: '结果标题' }, { key: 'summary', label: '调研摘要（兼容）', multiline: true }, { key: 'executiveSummary', label: '执行摘要', multiline: true, readOnly: true }, { key: 'scopeSnapshot', label: '范围快照', multiline: true, readOnly: true }, { key: 'planSnapshot', label: '方案快照', multiline: true, readOnly: true }, { key: 'metricsSummary', label: '指标概览', multiline: true, readOnly: true }, { key: 'sourceCoverage', label: '来源覆盖', multiline: true, readOnly: true }, { key: 'missingData', label: '数据缺口', multiline: true, readOnly: true }, { key: 'limitations', label: '局限说明', multiline: true, readOnly: true }, { key: 'confidence', label: '置信度', readOnly: true }, { key: 'recommendations', label: '建议', multiline: true, readOnly: true }, { key: 'userNotes', label: '用户备注', multiline: true }, { key: 'evidenceUrls', label: '证据链接', multiline: true, readOnly: true }, { key: 'evidenceItemIds', label: '标准化证据内容 ID', multiline: true, readOnly: true }, { key: 'researchRunIds', label: '旧 Provider 运行 ID', multiline: true, readOnly: true }, { key: 'provenanceCount', label: '来源追溯数量', type: 'number', readOnly: true }, { key: 'researchThreadId', label: '所属调研主题', relation: 'researchThreads' }, { key: 'researchRequestId', label: '来源调研需求', relation: 'researchRequests' }, { key: 'researchRunId', label: '来源调研运行', relation: 'researchRuns' },
    { key: 'status', label: '状态', type: 'select', options: [option('COMPLETED', '已完成'), option('PARTIAL', '部分完成'), option('FAILED', '未完成')] }, { key: 'notebookCategoryId', label: '收纳箱分类', relation: 'notebookCategories' }, { key: 'tags', label: '标签（逗号分隔）' }, { key: 'completedAt', label: '完成时间', type: 'datetime-local', readOnly: true },
  ] },
  { entity: 'researchFindings', label: '调研发现', singular: '调研发现', icon: '◇', titleKey: 'title', description: '由调研结果提炼的可追溯发现；不覆盖原始证据。', fields: [
    { key: 'title', label: '发现标题' }, { key: 'finding', label: '发现内容', multiline: true }, { key: 'dimension', label: '研究维度' }, { key: 'importance', label: '重要性', type: 'select', options: [option('HIGH', '高'), option('MEDIUM', '中'), option('LOW', '低')] }, { key: 'confidence', label: '置信度' }, { key: 'evidenceItemIds', label: '关联证据', multiple: true }, { key: 'evidenceCount', label: '证据数量', type: 'number', readOnly: true }, { key: 'orderIndex', label: '顺序', type: 'number', readOnly: true }, { key: 'researchThreadId', label: '所属调研主题', relation: 'researchThreads' }, { key: 'researchResultId', label: '调研结果', relation: 'researchResults' }, { key: 'researchRunId', label: '调研运行', relation: 'researchRuns' },
  ] },
  { entity: 'inbox', label: '收集箱', singular: '收集', icon: '↓', titleKey: 'content', description: '先记录事实，稍后再分类。', fields: [
    { key: 'content', label: '内容或链接', multiline: true, placeholder: '粘贴微信公众号、抖音、小红书、X、Instagram、Reddit、Facebook 等公开链接' }, { key: 'type', label: '建议类型' }, { key: 'status', label: '状态', type: 'select', options: [option('unprocessed', '待处理'), option('processed', '已处理'), option('archived', '已归档')] },
    { key: 'platform', label: '来源平台' }, { key: 'sourceUrl', label: '原始链接' }, { key: 'author', label: '作者' }, { key: 'captureStatus', label: '采集状态' }, { key: 'notebookCategoryId', label: 'Notebook 分类', relation: 'notebookCategories' },
  ] },
  { entity: 'events', label: '事件', singular: '事件', icon: '●', titleKey: 'title', description: '记录会议、约会、截止日与外部事件。', fields: [
    { key: 'title', label: '事件' }, { key: 'type', label: '类型', type: 'select', options: ['会议', '约会', '截止日', '重要事件', '外部事件'] },
    { key: 'startAt', label: '开始', type: 'datetime-local' }, { key: 'endAt', label: '结束', type: 'datetime-local' }, { key: 'location', label: '地点' },
    { key: 'notes', label: '备注', multiline: true }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'goalId', label: '目标', relation: 'goals' },
    { key: 'personIds', label: '人物', relation: 'people', multiple: true }, { key: 'decisionId', label: '决策', relation: 'decisions' }, { key: 'taskId', label: '任务', relation: 'tasks' },
  ] },
  { entity: 'people', label: '人物', singular: '人物', icon: '♙', titleKey: 'name', description: '为项目、事件和决策提供关系上下文，不是 CRM。', fields: [
    { key: 'name', label: '姓名' }, { key: 'organization', label: '组织' }, { key: 'role', label: '角色' }, { key: 'contact', label: '联系方式' }, { key: 'notes', label: '备注', multiline: true },
    { key: 'projectIds', label: '相关项目', relation: 'projects', multiple: true },
  ] },
  { entity: 'dataRecords', label: '数据记录', singular: '数据记录', icon: '▦', titleKey: 'title', description: '未来扩展的结构化本地数据。', fields: [{ key: 'type', label: '类型' }, { key: 'title', label: '标题' }, { key: 'dataJson', label: 'JSON 数据', multiline: true }, { key: 'source', label: '来源' }] },
  { entity: 'attachments', label: '附件', singular: '附件', icon: '⊞', titleKey: 'fileName', description: '保存在本地文件系统的附件元数据。', fields: [{ key: 'fileName', label: '文件名' }, { key: 'path', label: '本地路径' }, { key: 'mimeType', label: 'MIME 类型' }, { key: 'relatedEntityType', label: '关联实体类型' }, { key: 'relatedEntityId', label: '关联实体 ID' }] },
  { entity: 'timelineEvents', label: '时间线事件', singular: '时间线事件', icon: '⌁', titleKey: 'title', description: '保存关键状态变化的不可变证据，不作为普通内容手动创建。', fields: [
    { key: 'title', label: '事件' }, { key: 'eventType', label: '事件类型' }, { key: 'occurredAt', label: '发生时间', type: 'datetime-local' },
    { key: 'timeMeaning', label: '时间语义' }, { key: 'timelineImportance', label: '重要性' }, { key: 'evidenceLevel', label: '证据等级' },
    { key: 'sourceEntityType', label: '来源类型' }, { key: 'sourceEntityId', label: '来源记录 ID' }, { key: 'beforeValue', label: '变更前' }, { key: 'afterValue', label: '变更后' },
    { key: 'goalId', label: '目标', relation: 'goals' }, { key: 'projectId', label: '项目', relation: 'projects' }, { key: 'taskId', label: '任务', relation: 'tasks' },
  ] },
  { entity: 'agentRuns', label: 'AI 运行', singular: 'AI 运行', icon: 'AI', titleKey: 'input', description: 'AI 分析的审计记录。', fields: [] },
  { entity: 'agentActions', label: 'AI 操作', singular: 'AI 操作', icon: '→', titleKey: 'actionType', description: 'AI 实际动作的审计记录。', fields: [] },
  { entity: 'decisionFrameworks', label: '决策框架', singular: '决策框架', icon: '▦', titleKey: 'name', description: '把分析问题的方式沉淀为可复用的决策框架。', fields: [
    { key: 'name', label: '框架名称' }, { key: 'slug', label: '唯一标识' }, { key: 'purpose', label: '用于回答什么', multiline: true }, { key: 'components', label: '核心构成', multiline: true }, { key: 'useCases', label: '适用场景', multiline: true }, { key: 'output', label: '输出结果', multiline: true }, { key: 'status', label: '状态', type: 'select', options: [option('active', '启用'), option('archived', '归档')] },
  ] },
  { entity: 'ceoPrinciples', label: 'CEO 决策原则', singular: 'CEO 原则', icon: '∴', titleKey: 'name', description: '在冲突中指导 CEO 做取舍的长期原则。', fields: [
    { key: 'name', label: '原则名称' }, { key: 'slug', label: '唯一标识' }, { key: 'definition', label: '定义', multiline: true }, { key: 'decisionRule', label: '决策规则', multiline: true }, { key: 'useCases', label: '适用场景', multiline: true }, { key: 'antiPatterns', label: '反模式', multiline: true }, { key: 'example', label: '商业案例', multiline: true }, { key: 'status', label: '状态', type: 'select', options: [option('active', '启用'), option('archived', '归档')] },
  ] },
  { entity: 'decisionLenses', label: '决策视角', singular: '决策视角', icon: '◎', titleKey: 'name', description: '根据决策类型选择最合适的分析视角。', fields: [
    { key: 'name', label: '视角名称' }, { key: 'slug', label: '唯一标识' }, { key: 'focus', label: '关注什么', multiline: true }, { key: 'recommendedModelSlugs', label: '推荐模型', multiline: true }, { key: 'recommendedFrameworkSlugs', label: '推荐框架', multiline: true }, { key: 'description', label: '说明', multiline: true }, { key: 'status', label: '状态', type: 'select', options: [option('active', '启用'), option('archived', '归档')] },
  ] },
]

export const configFor = (entity: Entity) => entities.find((item) => item.entity === entity)!
export const titleFor = (record: Partial<RecordData>) => String(record.title || record.name || record.statement || record.content || record.context || '未命名')
export const descriptionFor = (record: Partial<RecordData>) => String(record.description || record.why || record.statement || record.content || record.problem || record.actual || record.actualResult || record.lesson || record.corePrinciple || record.framework || record.notes || '')
export const statusLabel = (value: unknown) => ({ active: '进行中', planned: '计划中', paused: '已暂停', completed: '已完成', archived: '已归档', blocked: '受阻', healthy: '健康', at_risk: '有风险', inbox: '收集箱', todo: '待办', in_progress: '进行中', waiting: '等待中', cancelled: '已取消', untested: '未测试', testing: '测试中', validated: '已验证', rejected: '已否定', inconclusive: '无结论', pending: '待决定', decided: '已决定', monitoring: '观察中', partially_correct: '部分正确', wrong: '错误', unknown: '未知', unprocessed: '待处理', processed: '已处理', running: '进行中', PLANNED: '计划中', IN_PROGRESS: '进行中', ACHIEVED: '已达成', PARTIALLY_ACHIEVED: '部分达成', MISSED: '未达成', SUCCESS: '成功', PARTIAL: '部分达成', FAILED: '失败', INVALIDATED: '已失效', ABANDONED: '已放弃', CANCELLED: '已取消', ACTIVE: '启用', INACTIVE: '停用', DRAFT: '草稿', FINAL: '当前正式版', SUPERSEDED: '已被新版替代', ARCHIVED: '已归档', POSTED: '已入账', VOIDED: '已作废', VERIFIED: '已核验', RECORDED: '已记录', ESTIMATED: '估算', MISSING: '数据缺失', RUNNING: '进行中', PAUSED: '已暂停', COMPLETED: '已完成', SKIPPED: '已跳过', BLOCKED: '受阻', EXPERIMENTAL: '实验中', TESTED: '已测试', RECOMMENDED: '推荐', STANDARD: '标准', LOW: '低', MEDIUM: '中', HIGH: '高', PROPOSED: '待确认', APPROVED: '已批准', IMPLEMENTED: '已实现' }[String(value)] || String(value || '未设置'))
export const priorityLabel = (value: unknown) => ({ high: '高', medium: '中', low: '低' }[String(value)] || String(value || '未设置'))
export const isActive = (record: Partial<RecordData>) => !['completed', 'archived', 'processed', 'cancelled', 'validated', 'rejected', 'wrong', '已完成', '已归档', '已处理', 'ACHIEVED', 'CANCELLED', 'VOIDED'].includes(String(record.status || 'active'))
export const localDateKey = (value: Date | string | number = new Date()) => { const date = value instanceof Date ? value : new Date(Number(value) || value); return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
export const recordDate = timelineOccurredAt
export const isToday = (value: unknown) => localDateKey(String(value || '')) === localDateKey()
export const isOverdue = (record: Partial<RecordData>) => Boolean(record.dueDate) && localDateKey(String(record.dueDate)) < localDateKey() && !['completed', 'cancelled'].includes(String(record.status))
export const durationMinutes = (record: Partial<RecordData>) => Number(record.durationMinutes || record.duration || 0)
export const minutesToday = (records: RecordData[]) => records.filter((record) => record.entity === 'timeLogs' && record.excludedFromTotals !== true && isToday(record.startAt)).reduce((total, record) => total + durationMinutes(record), 0)
export const timeline = timelineRecords
export const linkedTo = (record: Partial<RecordData>, id: string) => Object.entries(record).some(([key, value]) => (key.endsWith('Id') && value === id) || (key.endsWith('Ids') && (Array.isArray(value) ? value.includes(id) : String(value || '').split(',').map((item) => item.trim()).includes(id))))
export const percent = (value: unknown) => Math.max(0, Math.min(100, Number(value || 0)))
