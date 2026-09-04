import { describe, expect, it } from 'vitest'
import { financeIntelligenceDashboard } from './finance'
import type { RecordData } from './model'

const record = (entity: RecordData['entity'], id: string, data: Record<string, unknown> = {}): RecordData => ({ id, entity, createdAt: '2026-08-01T00:00:00', updatedAt: '2026-08-01T00:00:00', ...data }) as RecordData
const options = { from: '2026-03-01', to: '2026-08-31', previousFrom: '2025-09-01', previousTo: '2026-02-28', trendMonths: 6 }

describe('Finance Intelligence Dashboard', () => {
  it('keeps transfer out of operating cash while preserving account balance and refund rule', () => {
    const records = [
      record('financialAccounts', 'cash', { name: '现金', currency: 'CNY', openingBalanceMinor: '10000', status: 'ACTIVE' }),
      record('financialAccounts', 'bank', { name: '银行', currency: 'CNY', openingBalanceMinor: '0', status: 'ACTIVE' }),
      record('financialTransactions', 'income', { status: 'POSTED', transactionType: 'INCOME', accountId: 'cash', amountMinor: '10000', baseAmountMinor: '10000', occurredAt: '2026-08-05' }),
      record('financialTransactions', 'expense', { status: 'POSTED', transactionType: 'EXPENSE', accountId: 'cash', amountMinor: '4000', baseAmountMinor: '4000', occurredAt: '2026-08-06' }),
      record('financialTransactions', 'transfer', { status: 'POSTED', transactionType: 'TRANSFER', accountId: 'cash', destinationAccountId: 'bank', amountMinor: '5000', baseAmountMinor: '5000', occurredAt: '2026-08-07' }),
      record('financialTransactions', 'refund', { status: 'POSTED', transactionType: 'REFUND', refundKind: 'EXPENSE_REFUND', accountId: 'cash', amountMinor: '1000', baseAmountMinor: '1000', occurredAt: '2026-08-08' }),
    ]
    const dashboard = financeIntelligenceDashboard(records, options)
    expect(dashboard.summary.cashBalanceMinor).toBe(17000n)
    expect(dashboard.summary.incomeMinor).toBe(10000n)
    expect(dashboard.summary.expenseMinor).toBe(3000n)
    expect(dashboard.summary.operatingCashResultMinor).toBe(7000n)
  })

  it('keeps global cost and multi-project allocations consistent', () => {
    const expense = record('financialTransactions', 'shared', { status: 'POSTED', transactionType: 'EXPENSE', amountMinor: '100000', baseAmountMinor: '100000', categoryId: 'software', occurredAt: '2026-08-08' })
    const records = [record('projects', 'a', { title: '项目 A' }), record('projects', 'b', { title: '项目 B' }), record('financialCategories', 'software', { name: '软件 / API' }), expense, record('financialTransactionAllocations', 'a-split', { transactionId: expense.id, projectId: 'a', amountMinor: '60000' }), record('financialTransactionAllocations', 'b-split', { transactionId: expense.id, projectId: 'b', amountMinor: '30000' })]
    const dashboard = financeIntelligenceDashboard(records, options)
    expect(dashboard.summary.expenseMinor).toBe(100000n)
    expect(dashboard.capitalPortfolio.find((item) => item.project.id === 'a')?.expenseMinor).toBe(60000n)
    expect(dashboard.capitalPortfolio.find((item) => item.project.id === 'b')?.expenseMinor).toBe(30000n)
    expect(dashboard.expenseAllocation[0]).toMatchObject({ categoryId: 'software', amountMinor: 100000n })
  })

  it('does not mark an investment-stage project as failed only because operating cash is negative', () => {
    const records = [
      record('projects', 'investment', { title: 'Jason OS', stage: 'INVESTMENT', health: 'healthy' }),
      record('financialTransactions', 'cost', { status: 'POSTED', transactionType: 'EXPENSE', projectId: 'investment', amountMinor: '240000', baseAmountMinor: '240000', occurredAt: '2026-08-08' }),
      record('results', 'outcome', { projectId: 'investment', achievementBps: '7100', evidenceStatus: 'VERIFIED', date: '2026-08-12' }),
    ]
    const item = financeIntelligenceDashboard(records, options).capitalPortfolio[0]
    expect(item.stage).toBe('投资期')
    expect(item.operatingCashResultMinor).toBe(-240000n)
    expect(item.health).toBe('healthy')
    expect(item.outcomeProgress).toBe(71)
  })

  it('aggregates budget and outcome signals into one project attention item', () => {
    const records = [
      record('projects', 'risk', { title: 'Project B', health: 'at_risk' }),
      record('financialBudgets', 'budget', { title: 'Project B 预算', projectId: 'risk', amountMinor: '100000', periodStart: '2026-08-01', periodEnd: '2026-08-31', status: 'ACTIVE' }),
      record('financialTransactions', 'cost', { status: 'POSTED', transactionType: 'EXPENSE', projectId: 'risk', amountMinor: '130000', baseAmountMinor: '130000', occurredAt: '2026-08-15' }),
      record('results', 'outcome', { projectId: 'risk', achievementBps: '3100', evidenceStatus: 'VERIFIED', date: '2026-08-20' }),
    ]
    const attention = financeIntelligenceDashboard(records, options).financialAttention.filter((item) => item.projectId === 'risk')
    expect(attention).toHaveLength(1)
    expect(attention[0].type).toBe('CAPITAL_MISALLOCATION')
  })

  it('keeps a 10,000-transaction dashboard aggregation responsive', () => {
    const records: RecordData[] = [record('financialAccounts', 'cash', { name: '现金', currency: 'CNY', openingBalanceMinor: '1000000', status: 'ACTIVE' })]
    for (let index = 0; index < 10_000; index += 1) {
      const month = String(3 + index % 6).padStart(2, '0')
      records.push(record('financialTransactions', `transaction-${index}`, { status: 'POSTED', transactionType: index % 3 === 0 ? 'INCOME' : 'EXPENSE', accountId: 'cash', amountMinor: '1000', baseAmountMinor: '1000', occurredAt: `2026-${month}-15` }))
    }
    const started = performance.now()
    const dashboard = financeIntelligenceDashboard(records, options)
    expect(performance.now() - started).toBeLessThan(1_500)
    expect(dashboard.summary.incomeMinor + dashboard.summary.expenseMinor).toBe(10_000_000n)
  })
})
