import { financeDashboard, projectEconomics } from './finance'
import { durationMinutes, isActive, localDateKey, recordDate, titleFor, type RecordData } from './model'

export type CommandPeriodKey = '7d' | '30d' | 'quarter' | 'year' | 'custom'
export type CommandPeriod = { key: CommandPeriodKey; label: string; from: string; to: string; previousFrom: string; previousTo: string }
export type TrendPoint = { key: string; label: string; value: number | null; secondary?: number | null; tertiary?: number | null; raw?: string }
export type DashboardMetric = { label: string; value: string; numeric: number | null; delta: number | null; hint: string; formula: string; tone?: 'good' | 'warn' | 'danger' | 'neutral' }
export type PortfolioRow = { record: RecordData; goalAchievement: number | null; timeMinutes: number; expenseMinor: bigint; outcomeCount: number; health: 'healthy' | 'attention' | 'risk'; riskLabel: string; trend: number[] }
export type AllocationRow = { record?: RecordData; id: string; label: string; value: number; share: number }
export type AttentionItem = { record: RecordData; label: string; detail: string; kind: 'risk' | 'deviation' | 'decision' | 'signal' | 'budget'; score: number }
export type CommandCenterDashboardDTO = {
  period: CommandPeriod
  profileName: string
  updatedAt: string
  kpis: { goalAchievement: DashboardMetric; projectRisks: DashboardMetric; pendingDecisions: DashboardMetric; cashResult: DashboardMetric; resourceEfficiency: DashboardMetric }
  strategicTrend: TrendPoint[]
  inputOutcomeTrend: TrendPoint[]
  projectPortfolio: PortfolioRow[]
  timeAllocation: AllocationRow[]
  moneyAllocation: AllocationRow[]
  financialTrend: TrendPoint[]
  projectFinance: { record: RecordData; incomeMinor: bigint; expenseMinor: bigint }[]
  attention: AttentionItem[]
  decisionTimeline: RecordData[]
  externalSignals: RecordData[]
  recentKeyResults: RecordData[]
}

const DAY = 86_400_000
const asDate = (value: unknown) => { const date = new Date(Number(value) || String(value || '')); return Number.isNaN(date.getTime()) ? undefined : date }
const stableDateKey = (value: unknown) => { const raw = String(value || ''); return /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw) ? raw.slice(0, 10) : localDateKey(raw) }
const number = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined }
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const dateKey = (record: RecordData) => stableDateKey(recordDate(record) || record.updatedAt || record.createdAt)
const inRange = (record: RecordData, from: string, to: string) => { const key = dateKey(record); return Boolean(key && key >= from && key <= to) }
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next }
const startOfQuarter = (date: Date) => new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1)
const daysBetween = (from: string, to: string) => Math.max(1, Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / DAY) + 1)
const delta = (current: number | null, previous: number | null) => current === null || previous === null ? null : Math.round((current - previous) * 10) / 10
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
const percentLabel = (value: number | null) => value === null ? '数据不足' : `${Math.round(value)}%`
const countLabel = (value: number) => String(value)

export function resolveCommandPeriod(key: CommandPeriodKey, now = new Date(), custom?: { from?: string; to?: string }): CommandPeriod {
  const to = key === 'custom' && custom?.to ? custom.to : localDateKey(now)
  let fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (key === '7d') fromDate = addDays(fromDate, -6)
  if (key === '30d') fromDate = addDays(fromDate, -29)
  if (key === 'quarter') fromDate = startOfQuarter(now)
  if (key === 'year') fromDate = new Date(now.getFullYear(), 0, 1)
  const from = key === 'custom' && custom?.from ? custom.from : localDateKey(fromDate)
  const span = daysBetween(from, to)
  const previousToDate = addDays(new Date(`${from}T12:00:00`), -1)
  const previousFromDate = addDays(previousToDate, -(span - 1))
  const labels: Record<CommandPeriodKey, string> = { '7d': '近 7 天', '30d': '近 30 天', quarter: '本季度', year: '本年度', custom: '自定义' }
  return { key, label: labels[key], from, to, previousFrom: localDateKey(previousFromDate), previousTo: localDateKey(previousToDate) }
}

const resultAchievement = (record: RecordData) => {
  const bps = number(record.achievementBps)
  if (bps !== undefined) return clamp(bps / 100, 0, 150)
  const actual = number(record.actualValue ?? record.actualAmountMinor)
  const target = number(record.targetValue ?? record.targetAmountMinor)
  if (actual !== undefined && target !== undefined && target !== 0) return clamp(actual / target * 100, 0, 150)
  const status = String(record.status || '').toUpperCase()
  if (['SUCCESS', 'ACHIEVED'].includes(status)) return 100
  if (['PARTIAL', 'PARTIALLY_ACHIEVED'].includes(status)) return 50
  if (['FAILED', 'MISSED', 'INVALIDATED'].includes(status)) return 0
  return undefined
}

const goalAchievement = (records: RecordData[]) => {
  const keyResults = records.filter((record) => record.entity === 'keyResults' && isActive(record)).map((record) => {
    const target = number(record.targetValue); const current = number(record.currentValue)
    return target && current !== undefined ? clamp(current / target * 100, 0, 150) : undefined
  }).filter((value): value is number => value !== undefined)
  if (keyResults.length) return average(keyResults)
  const goals = records.filter((record) => record.entity === 'goals' && isActive(record)).map((record) => number(record.progress)).filter((value): value is number => value !== undefined)
  return average(goals)
}

const periodResultAchievement = (records: RecordData[], from: string, to: string) => average(records.filter((record) => record.entity === 'results' && inRange(record, from, to)).map(resultAchievement).filter((value): value is number => value !== undefined))
const riskyProjects = (records: RecordData[]) => records.filter((record) => record.entity === 'projects' && isActive(record) && (['blocked', 'at_risk'].includes(String(record.health || record.status).toLowerCase()) || Boolean(String(record.blockers || '').trim())))
const highDecision = (record: RecordData) => ['STRATEGIC', 'MATERIAL'].includes(String(record.decisionLevel || '').toUpperCase()) || ['high', 'critical'].includes(String(record.impactLevel || record.impact || record.priority || '').toLowerCase())
const pendingDecisions = (records: RecordData[]) => records.filter((record) => record.entity === 'decisions' && ['pending', 'monitoring'].includes(String(record.status).toLowerCase()) && highDecision(record))

const signedMoney = (records: RecordData[], from: string, to: string) => financeDashboard(records, { from, to }).economics.cashNetMinor
const resultCount = (records: RecordData[], from: string, to: string) => records.filter((record) => record.entity === 'results' && inRange(record, from, to) && resultAchievement(record) !== undefined).length
const timeMinutes = (records: RecordData[], from: string, to: string) => records.filter((record) => record.entity === 'timeLogs' && inRange(record, from, to)).reduce((sum, record) => sum + durationMinutes(record), 0)
const expenseMinor = (records: RecordData[], from: string, to: string) => financeDashboard(records, { from, to }).economics.expenseMinor
const efficiency = (records: RecordData[], from: string, to: string) => {
  const outcomes = resultCount(records, from, to); const minutes = timeMinutes(records, from, to); const expense = expenseMinor(records, from, to)
  if (!outcomes || !minutes || expense === 0n) return null
  const units = minutes / 60 + Number(expense) / 1_000_000
  return units > 0 ? outcomes / units * 100 : null
}

const bucketRanges = (period: CommandPeriod, count = 10) => {
  const total = daysBetween(period.from, period.to); const size = Math.max(1, Math.ceil(total / count)); const ranges: { from: string; to: string; label: string }[] = []
  let cursor = new Date(`${period.from}T12:00:00`); const end = new Date(`${period.to}T12:00:00`)
  while (cursor <= end) { const start = new Date(cursor); const finish = addDays(start, size - 1); if (finish > end) finish.setTime(end.getTime()); ranges.push({ from: localDateKey(start), to: localDateKey(finish), label: total <= 31 ? `${start.getMonth() + 1}/${start.getDate()}` : `${start.getMonth() + 1}月` }); cursor = addDays(finish, 1) }
  return ranges
}

const strategicTrend = (records: RecordData[], period: CommandPeriod) => bucketRanges(period).map((bucket) => {
  const values = records.filter((record) => record.entity === 'results' && inRange(record, bucket.from, bucket.to)).map(resultAchievement).filter((value): value is number => value !== undefined)
  const achieved = values.filter((value) => value >= 100).length; const missed = values.filter((value) => value < 100).length
  return { key: bucket.from, label: bucket.label, value: average(values), secondary: values.length ? achieved / values.length * 100 : null, tertiary: values.length ? missed / values.length * 100 : null, raw: `${values.length} 个可衡量结果` }
})

const inputOutcomeTrend = (records: RecordData[], period: CommandPeriod) => {
  const raw = bucketRanges(period).map((bucket) => ({ bucket, time: timeMinutes(records, bucket.from, bucket.to) / 60, money: Number(expenseMinor(records, bucket.from, bucket.to)) / 100, outcomes: resultCount(records, bucket.from, bucket.to) }))
  const baseline = (key: 'time' | 'money' | 'outcomes') => raw.find((item) => item[key] > 0)?.[key] || 0
  const timeBase = baseline('time'); const moneyBase = baseline('money'); const outcomeBase = baseline('outcomes')
  return raw.map(({ bucket, time, money, outcomes }) => ({ key: bucket.from, label: bucket.label, value: timeBase ? time / timeBase * 100 : null, secondary: moneyBase ? money / moneyBase * 100 : null, tertiary: outcomeBase ? outcomes / outcomeBase * 100 : null, raw: `${time.toFixed(1)} 小时 · ¥${Math.round(money).toLocaleString()} · ${outcomes} 个结果` }))
}

const scopedRecords = (records: RecordData[], from: string, to: string) => records.filter((record) => !['timeLogs', 'financialTransactions', 'results'].includes(record.entity) || inRange(record, from, to))
const projectResults = (records: RecordData[], project: RecordData) => records.filter((record) => record.entity === 'results' && (record.projectId === project.id || (project.goalId && record.goalId === project.goalId)))
const healthRank = { risk: 0, attention: 1, healthy: 2 } as const
const projectPortfolio = (records: RecordData[], period: CommandPeriod): PortfolioRow[] => {
  const scoped = scopedRecords(records, period.from, period.to)
  return records.filter((record) => record.entity === 'projects' && isActive(record)).map((project) => {
    const economics = projectEconomics(scoped, project.id); const outcomes = projectResults(scoped, project); const values = outcomes.map(resultAchievement).filter((value): value is number => value !== undefined)
    const progress = number(project.progress); const achievement = values.length ? average(values) : progress ?? null
    const risky = ['blocked', 'at_risk'].includes(String(project.health || project.status).toLowerCase()) || Boolean(String(project.blockers || '').trim())
    const health: PortfolioRow['health'] = risky ? String(project.health || project.status).toLowerCase() === 'blocked' ? 'risk' : 'attention' : 'healthy'
    return { record: project, goalAchievement: achievement, timeMinutes: economics.timeMinutes, expenseMinor: economics.expenseMinor, outcomeCount: outcomes.length, health, riskLabel: health === 'risk' ? '高' : health === 'attention' ? '中' : '低', trend: bucketRanges(period, 6).map((bucket) => average(projectResults(records.filter((item) => inRange(item, bucket.from, bucket.to) || !['results'].includes(item.entity)), project).map(resultAchievement).filter((value): value is number => value !== undefined)) ?? 0) }
  }).sort((left, right) => healthRank[left.health] - healthRank[right.health] || Number(right.expenseMinor - left.expenseMinor)).slice(0, 8)
}

const allocations = (records: RecordData[], period: CommandPeriod, type: 'time' | 'money'): AllocationRow[] => {
  const projects = records.filter((record) => record.entity === 'projects')
  const scoped = scopedRecords(records, period.from, period.to)
  const values = projects.map((project) => ({ record: project, id: project.id, label: titleFor(project), value: type === 'time' ? projectEconomics(scoped, project.id).timeMinutes : Number(projectEconomics(scoped, project.id).expenseMinor) })).filter((item) => item.value > 0)
  const total = values.reduce((sum, item) => sum + item.value, 0)
  return values.map((item) => ({ ...item, share: total ? item.value / total * 100 : 0 })).sort((a, b) => b.value - a.value).slice(0, 6)
}

const sixMonthTrend = (records: RecordData[], now: Date): TrendPoint[] => Array.from({ length: 6 }, (_, index) => {
  const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1); const end = new Date(date.getFullYear(), date.getMonth() + 1, 0); const dashboard = financeDashboard(records, { from: localDateKey(date), to: localDateKey(end) })
  return { key: localDateKey(date), label: `${date.getMonth() + 1}月`, value: Number(dashboard.economics.incomeMinor) / 100, secondary: Number(dashboard.economics.expenseMinor) / 100, tertiary: Number(dashboard.economics.cashNetMinor) / 100, raw: `收入 ¥${Math.round(Number(dashboard.economics.incomeMinor) / 100).toLocaleString()} · 支出 ¥${Math.round(Number(dashboard.economics.expenseMinor) / 100).toLocaleString()}` }
})

const impactScore = (record: RecordData) => ({ critical: 4, high: 3, medium: 2, low: 1 }[String(record.impactLevel || record.impact || record.priority || '').toLowerCase()] || 1)
const urgencyScore = (record: RecordData) => ({ critical: 4, high: 3, urgent: 3, medium: 2, low: 1 }[String(record.urgencyLevel || record.urgency || record.priority || '').toLowerCase()] || 1)
const linkedSignal = (record: RecordData) => Boolean(record.projectId || record.goalId || record.decisionId)
const externalSignals = (records: RecordData[], period: CommandPeriod) => records.filter((record) => record.entity === 'signals' && inRange(record, period.from, period.to) && linkedSignal(record) && ['HIGH', 'CRITICAL'].includes(String(record.impactLevel || record.impact || record.importance || '').toUpperCase())).sort((a, b) => impactScore(b) - impactScore(a) || dateKey(b).localeCompare(dateKey(a))).slice(0, 5)

const attentionItems = (records: RecordData[], period: CommandPeriod): AttentionItem[] => {
  const items: AttentionItem[] = []
  riskyProjects(records).forEach((record) => items.push({ record, label: titleFor(record), detail: String(record.blockers || '项目健康状态需要关注'), kind: 'risk', score: 40 + impactScore(record) * 4 }))
  records.filter((record) => record.entity === 'goals' && isActive(record)).forEach((record) => {
    const start = asDate(record.startDate); const target = asDate(record.targetDate); const progress = number(record.progress)
    if (!start || !target || progress === undefined || target <= start) return
    const expected = clamp((Date.now() - start.getTime()) / (target.getTime() - start.getTime()) * 100); const gap = expected - progress
    if (gap >= 15) items.push({ record, label: titleFor(record), detail: `实际 ${Math.round(progress)}%，时间进度 ${Math.round(expected)}%，偏差 -${Math.round(gap)} 个百分点`, kind: 'deviation', score: 30 + gap })
  })
  pendingDecisions(records).forEach((record) => items.push({ record, label: titleFor(record), detail: '高影响决策仍待 CEO 明确下一步', kind: 'decision', score: 35 + impactScore(record) * urgencyScore(record) }))
  externalSignals(records, period).forEach((record) => items.push({ record, label: titleFor(record), detail: String(record.summary || record.description || '外部变化已关联内部对象'), kind: 'signal', score: 30 + impactScore(record) * 4 }))
  financeDashboard(records, { from: period.from, to: period.to }).budgets.filter((item) => item.varianceMinor < 0n).forEach((item) => items.push({ record: item.budget, label: titleFor(item.budget), detail: `预算超支 ¥${Math.round(Number(-item.varianceMinor) / 100).toLocaleString()}`, kind: 'budget', score: 34 + Math.min(20, Number(-item.varianceMinor / 10000n)) }))
  return items.sort((a, b) => b.score - a.score).slice(0, 5)
}

const decisionDueKey = (record: RecordData) => stableDateKey(record.reviewDueDate || record.expectedCompletionDate || record.date)
const decisionTimeline = (records: RecordData[], now: Date) => { const from = localDateKey(now); const to = localDateKey(addDays(now, 7)); return pendingDecisions(records).filter((record) => { const key = decisionDueKey(record); return key >= from && key <= to }).sort((a, b) => decisionDueKey(a).localeCompare(decisionDueKey(b))).slice(0, 5) }
const recentKeyResults = (records: RecordData[], period: CommandPeriod) => records.filter((record) => record.entity === 'results' && inRange(record, period.from, period.to) && (['STRATEGIC', 'FINANCIAL', 'MILESTONE'].includes(String(record.outcomeType).toUpperCase()) || record.evidenceStatus === 'VERIFIED') && ['SUCCESS', 'ACHIEVED', 'PARTIAL', 'PARTIALLY_ACHIEVED'].includes(String(record.status).toUpperCase())).sort((a, b) => dateKey(b).localeCompare(dateKey(a))).slice(0, 5)

export function commandCenterDashboard(records: RecordData[], period: CommandPeriod, now = new Date()): CommandCenterDashboardDTO {
  const currentGoal = goalAchievement(records); const previousGoal = periodResultAchievement(records, period.previousFrom, period.previousTo)
  const risks = riskyProjects(records); const decisions = pendingDecisions(records); const cash = signedMoney(records, period.from, period.to); const previousCash = signedMoney(records, period.previousFrom, period.previousTo)
  const currentEfficiency = efficiency(records, period.from, period.to); const previousEfficiency = efficiency(records, period.previousFrom, period.previousTo)
  const finance = financeDashboard(records, { from: period.from, to: period.to })
  const projectRecords = records.filter((record) => record.entity === 'projects')
  return {
    period,
    profileName: String(records.find((record) => record.entity === 'profiles')?.nickname || records.find((record) => record.entity === 'profiles')?.name || 'Jason'),
    updatedAt: now.toISOString(),
    kpis: {
      goalAchievement: { label: '目标达成率', value: percentLabel(currentGoal), numeric: currentGoal, delta: delta(currentGoal, previousGoal), hint: currentGoal === null ? '需要目标进度或关键结果' : '当前目标 / KR 的平均完成率', formula: '优先使用活跃关键结果 currentValue ÷ targetValue；无 KR 时使用活跃目标 progress。', tone: currentGoal === null ? 'neutral' : currentGoal >= 80 ? 'good' : currentGoal >= 60 ? 'warn' : 'danger' },
      projectRisks: { label: '关键项目风险', value: countLabel(risks.length), numeric: risks.length, delta: null, hint: `${risks.filter((item) => String(item.health || item.status).toLowerCase() === 'blocked').length} 个受阻`, formula: '活跃项目中 health/status 为 blocked、at_risk，或存在 blockers 的数量。', tone: risks.length ? 'danger' : 'good' },
      pendingDecisions: { label: '待决策事项', value: countLabel(decisions.length), numeric: decisions.length, delta: null, hint: '仅统计战略级 / 重大 / 高影响', formula: 'status 为 pending/monitoring，且 decisionLevel 为 STRATEGIC/MATERIAL 或 impact 为 high/critical。', tone: decisions.length ? 'warn' : 'good' },
      cashResult: { label: '经营现金结果', value: finance.economics.postedTransactions ? `${cash < 0n ? '-' : '+'}¥${Math.abs(Number(cash) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : '未记录', numeric: finance.economics.postedTransactions ? Number(cash) / 100 : null, delta: finance.economics.postedTransactions ? delta(Number(cash) / 100, Number(previousCash) / 100) : null, hint: `${finance.economics.postedTransactions} 笔已入账流水`, formula: '所选周期内已入账收入－支出，退款与调整按方向计入，转账不计经营结果。', tone: cash > 0n ? 'good' : cash < 0n ? 'danger' : 'neutral' },
      resourceEfficiency: { label: '资源效率指数', value: currentEfficiency === null ? '数据不足' : currentEfficiency.toFixed(2), numeric: currentEfficiency, delta: delta(currentEfficiency, previousEfficiency), hint: currentEfficiency === null ? '需同时具备时间、支出和可衡量结果' : '每 100 个投入单位产生的结果数', formula: '可衡量结果数 ÷（投入小时＋支出金额/10,000 元）×100。仅用于同系统内同期比较。', tone: currentEfficiency === null ? 'neutral' : 'good' },
    },
    strategicTrend: strategicTrend(records, period), inputOutcomeTrend: inputOutcomeTrend(records, period), projectPortfolio: projectPortfolio(records, period),
    timeAllocation: allocations(records, period, 'time'), moneyAllocation: allocations(records, period, 'money'), financialTrend: sixMonthTrend(records, now),
    projectFinance: projectRecords.map((record) => ({ record, incomeMinor: projectEconomics(scopedRecords(records, period.from, period.to), record.id).incomeMinor, expenseMinor: projectEconomics(scopedRecords(records, period.from, period.to), record.id).expenseMinor })).filter((item) => item.incomeMinor || item.expenseMinor).sort((a, b) => Number((b.incomeMinor + b.expenseMinor) - (a.incomeMinor + a.expenseMinor))).slice(0, 5),
    attention: attentionItems(records, period), decisionTimeline: decisionTimeline(records, now), externalSignals: externalSignals(records, period), recentKeyResults: recentKeyResults(records, period),
  }
}
