import { durationMinutes, linkedTo, type RecordData } from './model'

export type ProjectEconomics = {
  incomeMinor: bigint
  expenseMinor: bigint
  cashNetMinor: bigint
  managementContributionMinor: bigint
  timeMinutes: number
  unitTimeContributionMinor?: bigint
  postedTransactions: number
  outcomeCount: number
  verifiedOutcomeCount: number
  dataCoverage: number
}

const integer = (value: unknown) => {
  const raw = String(value ?? '').trim()
  return /^-?\d+$/.test(raw) ? BigInt(raw) : 0n
}

export const currencyDecimals = (currency: unknown) => ['JPY', 'KRW'].includes(String(currency || '').toUpperCase()) ? 0 : 2

export function decimalToMinor(value: unknown, currency = 'CNY') {
  const raw = String(value ?? '').trim().replace(/,/g, '')
  if (!raw) return ''
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match) return raw
  const decimals = currencyDecimals(currency)
  const enteredFraction = match[3] || ''
  if (enteredFraction.length > decimals && /[1-9]/.test(enteredFraction.slice(decimals))) return raw
  const fraction = `${enteredFraction}${'0'.repeat(decimals)}`.slice(0, decimals)
  const minor = BigInt(match[2]) * (10n ** BigInt(decimals)) + BigInt(fraction || '0')
  return `${match[1] ? '-' : ''}${minor}`
}

export function minorToDecimal(value: unknown, currency = 'CNY') {
  const raw = String(value ?? '').trim()
  if (!/^-?\d+$/.test(raw)) return raw
  const decimals = currencyDecimals(currency)
  if (!decimals) return raw
  const negative = raw.startsWith('-'); const digits = raw.replace('-', '').padStart(decimals + 1, '0')
  const whole = digits.slice(0, -decimals); const fraction = digits.slice(-decimals).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

export function formatMoneyMinor(value: bigint | string | number | undefined, currency = 'CNY') {
  const decimal = minorToDecimal(value ?? '0', currency)
  try { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: currencyDecimals(currency), maximumFractionDigits: currencyDecimals(currency) }).format(Number(decimal)) } catch { return `${currency} ${decimal}` }
}

export function transactionBaseMinor(record: Partial<RecordData>) {
  return integer(record.baseAmountMinor || record.amountMinor)
}

export function accountBalanceMinor(records: RecordData[], accountId: string) {
  const account = records.find((record) => record.entity === 'financialAccounts' && record.id === accountId)
  let balance = integer(account?.openingBalanceMinor)
  records.filter((record) => record.entity === 'financialTransactions' && String(record.status || 'POSTED') === 'POSTED').forEach((transaction) => {
    const amount = integer(transaction.amountMinor)
    const source = transaction.accountId === accountId
    const destination = transaction.destinationAccountId === accountId
    switch (String(transaction.transactionType)) {
      case 'INCOME': if (source) balance += amount; break
      case 'EXPENSE': if (source) balance -= amount; break
      case 'TRANSFER': if (source) balance -= amount; if (destination) balance += amount; break
      case 'REFUND': if (source) balance += transaction.refundKind === 'INCOME_REFUND' ? -amount : amount; break
      case 'ADJUSTMENT': if (source) balance += transaction.adjustmentDirection === 'DECREASE' ? -amount : amount; break
    }
  })
  return balance
}

export function projectEconomics(records: RecordData[], projectId?: string | null): ProjectEconomics {
  const taskIds = projectId ? new Set(records.filter((record) => record.entity === 'tasks' && linkedTo(record, projectId)).map((record) => record.id)) : new Set<string>()
  const belongsToProject = (record: RecordData) => !projectId || linkedTo(record, projectId) || (typeof record.taskId === 'string' && taskIds.has(record.taskId))
  const transactions = records.filter((record) => record.entity === 'financialTransactions' && String(record.status || 'POSTED') === 'POSTED' && belongsToProject(record))
  let income = 0n; let expense = 0n; let cashNet = 0n
  transactions.forEach((transaction) => {
    const amount = transactionBaseMinor(transaction)
    switch (String(transaction.transactionType)) {
      case 'INCOME': income += amount; cashNet += amount; break
      case 'EXPENSE': expense += amount; cashNet -= amount; break
      case 'REFUND':
        if (transaction.refundKind === 'INCOME_REFUND') { income -= amount; cashNet -= amount } else { expense -= amount; cashNet += amount }
        break
      case 'ADJUSTMENT': cashNet += transaction.adjustmentDirection === 'DECREASE' ? -amount : amount; break
    }
  })
  const timeMinutes = records.filter((record) => record.entity === 'timeLogs' && belongsToProject(record)).reduce((total, record) => total + durationMinutes(record), 0)
  const outcomes = records.filter((record) => record.entity === 'results' && belongsToProject(record))
  const verified = outcomes.filter((record) => record.evidenceStatus === 'VERIFIED').length
  const contribution = income - expense
  const required = [transactions.length > 0, timeMinutes > 0, outcomes.length > 0, verified > 0]
  return {
    incomeMinor: income,
    expenseMinor: expense,
    cashNetMinor: cashNet,
    managementContributionMinor: contribution,
    timeMinutes,
    unitTimeContributionMinor: timeMinutes > 0 && transactions.length > 0 ? contribution * 60n / BigInt(timeMinutes) : undefined,
    postedTransactions: transactions.length,
    outcomeCount: outcomes.length,
    verifiedOutcomeCount: verified,
    dataCoverage: Math.round(required.filter(Boolean).length / required.length * 100),
  }
}
