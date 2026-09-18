import { describe, expect, it } from 'vitest'
import { buildAgentContext, buildContextRelationIndex, buildGlobalContext, detectContextGaps, detectGlobalIntent } from './contextEngine'
import type { RecordData } from '../model'

const record = (entity: RecordData['entity'], id: string, data: Record<string, unknown> = {}) => ({ id, entity, createdAt: '', updatedAt: '', ...data }) as RecordData
const contextFor = (records: RecordData[], id = 'p1') => buildAgentContext({ currentRoute: 'projects', records, selectedProjectId: id, detailId: id, conversation: [] })

describe('Global Context Engine', () => {
  it('uses bounded structured project relations before search results', () => {
    const records = [
      record('goals', 'g1', { title: '增长目标' }), record('projects', 'p1', { title: '项目 A', goalId: 'g1', status: 'active' }),
      record('tasks', 't1', { title: '执行页', projectId: 'p1', goalId: 'g1', status: 'completed' }), record('timeLogs', 'time1', { taskId: 't1', durationMinutes: 120 }),
      record('financialTransactions', 'money1', { taskId: 't1', status: 'POSTED', transactionType: 'EXPENSE', amountMinor: '2500' }),
      record('results', 'r1', { projectId: 'p1', title: '已验证结果', status: 'SUCCESS', evidenceStatus: 'VERIFIED' }), record('inbox', 'i1', { title: '碎片', content: '不应默认发送' }),
    ]
    const result = buildGlobalContext({ query: '这个项目投入了多少时间和钱？', currentRoute: 'projects', records, context: contextFor(records), relationIndex: buildContextRelationIndex(records), retrievedRecords: [records[6], records[5]] })
    expect(result.intent).toBe('PROJECT_ANALYSIS'); expect(result.relatedEntities.map((item) => item.id)).toContain('time1'); expect(result.relatedEntities.map((item) => item.id)).not.toContain('i1')
    expect(result.summaries.time).toMatchObject({ totalMinutes: 120 }); expect(result.summaries.finance).toMatchObject({ expenseMinor: '2500' }); expect(result.contextBudget.usedRelatedEntities).toBeLessThanOrEqual(result.contextBudget.maxRelatedEntities)
  })

  it('only admits inbox records for an explicit inbox retrieval', () => {
    const records = [record('inbox', 'i1', { title: '美国宠物市场想法', content: 'TikTok' })]
    const result = buildGlobalContext({ query: '看看收纳箱有没有美国宠物市场想法', currentRoute: 'projects', records, context: contextFor(records, 'missing'), relationIndex: buildContextRelationIndex(records), retrievedRecords: records })
    expect(result.includeInbox).toBe(true); expect(result.retrievedEntities[0]?.id).toBe('i1')
  })

  it('labels task alignment without claiming an unlinked task has no value', () => {
    const records = [record('projects', 'p1', { title: '项目 A', goalId: 'g1' }), record('goals', 'g1', { title: '方向' }), record('tasks', 't1', { title: '明确任务', projectId: 'p1' }), record('tasks', 't2', { title: '独立任务' })]
    const result = buildGlobalContext({ query: '哪些任务没有服务于目标？', currentRoute: 'projects', records, context: contextFor(records), relationIndex: buildContextRelationIndex(records), retrievedRecords: [] })
    expect(result.goalAlignment).toMatchObject({ weaklyAligned: 1 }); expect(result.goalAlignment?.examples[0]?.summary).toContain('间接服务')
  })

  it('detects only high-value closed-loop gaps', () => {
    const records = [record('projects', 'p1', { title: '已完成项目', status: 'completed' }), record('results', 'r1', { title: '结果', status: 'SUCCESS' }), record('deliverables', 'd1', { title: '最终方案', status: 'FINAL' })]
    const gaps = detectContextGaps(records)
    expect(gaps.map((gap) => gap.kind)).toEqual(expect.arrayContaining(['PROJECT_WITHOUT_RESULT', 'RESULT_WITHOUT_REVIEW', 'DELIVERABLE_WITHOUT_SOURCE']))
    expect(gaps).toHaveLength(3)
  })

  it('includes extended saved AI collaboration context only for relevant questions', () => {
    const records = [record('profiles', 'profile-1', { role: 'CEO', workDomains: '跨境电商', aiResponsePreference: '中文、简洁', aiOtherContext: '涉及外部操作先确认' })]
    const result = buildGlobalContext({ query: '帮我生成本周 CEO 简报', currentRoute: 'command', records, context: contextFor(records, 'missing'), relationIndex: buildContextRelationIndex(records) })
    expect(result.personalContext).toMatchObject({ role: 'CEO', workDomains: '跨境电商', aiResponsePreference: '中文、简洁', aiOtherContext: '涉及外部操作先确认' })
  })

  it('routes CEO and workflow questions through the one assistant intent layer', () => {
    expect(detectGlobalIntent('帮我生成本周 CEO 简报')).toBe('CEO_ANALYSIS')
    expect(detectGlobalIntent('v4 和 v3 哪个工作流程更好')).toBe('WORKFLOW_ANALYSIS')
  })
})
