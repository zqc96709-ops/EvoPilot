import { describe, expect, it } from 'vitest'
import { decimalToMinor, financeDashboard, minorToDecimal, projectEconomics } from './finance'
import type { RecordData } from './model'

const record = (entity: RecordData['entity'], data: Record<string, unknown>): RecordData => ({ id: Math.random().toString(), entity, createdAt: '', updatedAt: '', ...data }) as RecordData

describe('Finance and Outcome calculations', () => {
  it('converts money without JavaScript floating-point arithmetic', () => {
    expect(decimalToMinor('1000.25', 'CNY')).toBe('100025')
    expect(minorToDecimal('100025', 'CNY')).toBe('1000.25')
    expect(decimalToMinor('1200', 'JPY')).toBe('1200')
    expect(decimalToMinor('1.999', 'CNY')).toBe('1.999')
  })

  it('separates transfers from income and expense', () => {
    const records = [
      record('financialTransactions', { status: 'POSTED', transactionType: 'INCOME', baseAmountMinor: '10000000', projectId: 'p1' }),
      record('financialTransactions', { status: 'POSTED', transactionType: 'EXPENSE', baseAmountMinor: '6000000', projectId: 'p1' }),
      record('financialTransactions', { status: 'POSTED', transactionType: 'TRANSFER', baseAmountMinor: '2000000', projectId: 'p1' }),
      record('timeLogs', { projectId: 'p1', durationMinutes: 7200 }),
      record('results', { projectId: 'p1', actualAmountMinor: '4000000', evidenceStatus: 'VERIFIED' }),
    ]
    const result = projectEconomics(records, 'p1')
    expect(result.managementContributionMinor).toBe(4000000n)
    expect(result.cashNetMinor).toBe(4000000n)
    expect(result.unitTimeContributionMinor).toBe(33333n)
    expect(result.dataCoverage).toBe(100)
  })

  it('does not treat missing data as a complete zero result', () => {
    const result = projectEconomics([], 'p1')
    expect(result.incomeMinor).toBe(0n)
    expect(result.dataCoverage).toBe(0)
  })

  it('allocates one transaction across projects without double counting', () => {
    const transaction = record('financialTransactions', { status: 'POSTED', transactionType: 'EXPENSE', baseAmountMinor: '100000' })
    const records = [
      transaction,
      record('financialTransactionAllocations', { transactionId: transaction.id, projectId: 'p1', amountMinor: '40000' }),
      record('financialTransactionAllocations', { transactionId: transaction.id, projectId: 'p2', amountMinor: '60000' }),
    ]
    expect(projectEconomics(records, 'p1').expenseMinor).toBe(40000n)
    expect(projectEconomics(records, 'p2').expenseMinor).toBe(60000n)
    expect(projectEconomics(records).expenseMinor).toBe(100000n)
  })

  it('surfaces unallocated and low-quality financial facts instead of treating them as zero', () => {
    const records = [
      record('financialTransactions', { status: 'POSTED', transactionType: 'EXPENSE', baseAmountMinor: '100000', occurredAt: '2026-08-01' }),
      record('financialTransactions', { status: 'POSTED', transactionType: 'EXPENSE', baseAmountMinor: '80000', occurredAt: '2026-08-02', projectId: 'p1', evidenceStatus: 'VERIFIED' }),
    ]
    const dashboard = financeDashboard(records)
    expect(dashboard.unallocatedMinor).toBe(100000n)
    expect(dashboard.unassignedTransactions).toBe(1)
    expect(dashboard.missingCategoryTransactions).toBe(2)
    expect(dashboard.unverifiedTransactions).toBe(1)
  })

  it('compares active budgets with actual expense without turning missing facts into income', () => {
    const records = [
      record('financialBudgets', { title: '广告预算', projectId: 'p1', categoryId: 'ads', amountMinor: '100000', periodStart: '2026-08-01', periodEnd: '2026-08-31', status: 'ACTIVE' }),
      record('financialTransactions', { status: 'POSTED', transactionType: 'EXPENSE', baseAmountMinor: '60000', projectId: 'p1', categoryId: 'ads', occurredAt: '2026-08-10' }),
      record('financialTransactions', { status: 'POSTED', transactionType: 'EXPENSE', baseAmountMinor: '50000', projectId: 'p1', categoryId: 'ads', occurredAt: '2026-09-01' }),
    ]
    const budget = financeDashboard(records, { from: '2026-08-01', to: '2026-08-31' }).budgets[0]
    expect(budget.plannedMinor).toBe(100000n)
    expect(budget.actualExpenseMinor).toBe(60000n)
    expect(budget.varianceMinor).toBe(40000n)
    expect(budget.observedTransactions).toBe(1)
  })

  it('compares a project budget with the project allocation, not the full shared expense', () => {
    const sharedExpense = record('financialTransactions', { status: 'POSTED', transactionType: 'EXPENSE', baseAmountMinor: '100000', categoryId: 'ads', occurredAt: '2026-08-10' })
    const records = [
      record('financialBudgets', { title: '项目广告预算', projectId: 'p1', categoryId: 'ads', amountMinor: '80000', periodStart: '2026-08-01', periodEnd: '2026-08-31', status: 'ACTIVE' }),
      sharedExpense,
      record('financialTransactionAllocations', { transactionId: sharedExpense.id, projectId: 'p1', amountMinor: '60000' }),
      record('financialTransactionAllocations', { transactionId: sharedExpense.id, projectId: 'p2', amountMinor: '40000' }),
    ]
    const budget = financeDashboard(records, { from: '2026-08-01', to: '2026-08-31' }).budgets[0]
    expect(budget.actualExpenseMinor).toBe(60000n)
    expect(budget.varianceMinor).toBe(20000n)
  })
})
