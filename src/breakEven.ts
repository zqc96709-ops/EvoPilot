export const inputDefinitions = [
  { key: 'paidGmv', label: '支付 GMV', unit: 'money' },
  { key: 'aov', label: '客单价', unit: 'money' },
  { key: 'refundRate', label: '退款率', unit: 'percent' },
  { key: 'grossMarginRate', label: '毛利率', unit: 'percent' },
  { key: 'platformRate', label: '平台扣点', unit: 'percent' },
  { key: 'adCostRate', label: '投流费率', unit: 'percent' },
  { key: 'logisticsRate', label: '物流费率', unit: 'percent' },
  { key: 'hostFixedCost', label: '主播人工', unit: 'money' },
  { key: 'operationFixedCost', label: '运营人工', unit: 'money' },
  { key: 'venueEquipmentCost', label: '场地 / 设备', unit: 'money' },
  { key: 'otherFixedCost', label: '其他固定成本', unit: 'money' },
] as const

export type InputKey = typeof inputDefinitions[number]['key']
export type InputValues = Record<InputKey, string>
export type Scenario = 'BEAR' | 'BASE' | 'BULL'
export type CalculationType = 'FIXED_COST' | 'RATE_OF_PAID_GMV' | 'RATE_OF_NET_SALES' | 'PER_ORDER_COST' | 'INFORMATION_ONLY'
export type CustomMetric = { id: string; key: string; name: string; unit: 'money' | 'percent'; calculationType: CalculationType }
export type ScenarioValues = { inputs: InputValues; customValues: Record<string, string> }
export type BreakEvenModel = {
  id: string; name: string; templateType: string; roleLabel: string; linkedProjectId: string | null
  selectedScenario: Scenario; scenarios: Record<Scenario, ScenarioValues>; customMetrics: CustomMetric[]
  createdAt: string; updatedAt: string
}
export type SavedTemplate = { id: string; name: string; roleLabel: string; description: string; scenarios: Record<Scenario, ScenarioValues>; customMetrics: CustomMetric[] }
export type BreakEvenState = { models: BreakEvenModel[]; templates: SavedTemplate[]; selectedModelId: string | null }

export const emptyState = (): BreakEvenState => ({ models: [], templates: [], selectedModelId: null })
export const douyinDefaults: InputValues = {
  paidGmv: '400000', aov: '2000', refundRate: '25', grossMarginRate: '40', platformRate: '5',
  adCostRate: '20', logisticsRate: '5', hostFixedCost: '20000', operationFixedCost: '15000',
  venueEquipmentCost: '10000', otherFixedCost: '15000',
}
export const blankDefaults: InputValues = {
  paidGmv: '0', aov: '1', refundRate: '0', grossMarginRate: '0', platformRate: '0',
  adCostRate: '0', logisticsRate: '0', hostFixedCost: '0', operationFixedCost: '0',
  venueEquipmentCost: '0', otherFixedCost: '0',
}

export function scenariosFrom(inputs: InputValues): Record<Scenario, ScenarioValues> {
  const one = (): ScenarioValues => ({ inputs: { ...inputs }, customValues: {} })
  return { BEAR: one(), BASE: one(), BULL: one() }
}

export function createModel(name: string, roleLabel: string, templateType = 'blank', template?: SavedTemplate): BreakEvenModel {
  const now = new Date().toISOString()
  const source = template?.scenarios || scenariosFrom(templateType === 'douyin' ? douyinDefaults : blankDefaults)
  return {
    id: crypto.randomUUID(), name, roleLabel, templateType, linkedProjectId: null, selectedScenario: 'BASE',
    scenarios: structuredClone(source), customMetrics: structuredClone(template?.customMetrics || []), createdAt: now, updatedAt: now,
  }
}

export function duplicateModel(model: BreakEvenModel): BreakEvenModel {
  return { ...structuredClone(model), id: crypto.randomUUID(), name: `${model.name} - 副本`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}

export function validateScenario(values: ScenarioValues, metrics: CustomMetric[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const definition of inputDefinitions) {
    const raw = values.inputs[definition.key]
    const value = Number(raw)
    if (raw === undefined || String(raw).trim() === '' || !Number.isFinite(value)) errors[definition.key] = '请输入有效数字'
    else if (definition.key === 'aov' && value <= 0) errors[definition.key] = '客单价必须大于 0'
    else if (value < 0 || (definition.unit === 'percent' && value > 100)) errors[definition.key] = definition.unit === 'percent' ? '请输入 0–100%' : '不能小于 0'
  }
  for (const metric of metrics) {
    const raw = values.customValues[metric.id]
    const value = Number(raw)
    if (raw === undefined || String(raw).trim() === '' || !Number.isFinite(value)) errors[metric.id] = '请输入有效数字'
    else if (value < 0 || (metric.unit === 'percent' && value > 100)) errors[metric.id] = metric.unit === 'percent' ? '请输入 0–100%' : '不能小于 0'
  }
  return errors
}

export type Calculation = {
  netSales: number; grossProfit: number; platformCost: number; adCost: number; logisticsCost: number
  fixedCost: number; customCost: number; operatingProfit: number; contributionRate: number
  breakEvenPaidGmv: number | null; breakEvenNetSales: number | null; breakEvenOrders: number | null
}

export function calculate(values: ScenarioValues, metrics: CustomMetric[], paidGmvOverride?: number): Calculation | null {
  if (Object.keys(validateScenario(values, metrics)).length) return null
  const input = Object.fromEntries(inputDefinitions.map(({ key }) => [key, Number(values.inputs[key])])) as Record<InputKey, number>
  const gmv = paidGmvOverride ?? input.paidGmv
  if (!Number.isFinite(gmv) || gmv < 0) return null
  const refund = input.refundRate / 100
  const netSales = gmv * (1 - refund)
  const grossProfit = netSales * input.grossMarginRate / 100
  const platformCost = netSales * input.platformRate / 100
  const adCost = gmv * input.adCostRate / 100
  const logisticsCost = netSales * input.logisticsRate / 100
  const baseFixed = input.hostFixedCost + input.operationFixedCost + input.venueEquipmentCost + input.otherFixedCost
  let extraFixed = 0
  let extraGmvRate = 0
  let extraNetRate = 0
  let extraPerOrder = 0
  for (const metric of metrics) {
    const value = Number(values.customValues[metric.id])
    if (metric.calculationType === 'FIXED_COST') extraFixed += value
    if (metric.calculationType === 'RATE_OF_PAID_GMV') extraGmvRate += value / 100
    if (metric.calculationType === 'RATE_OF_NET_SALES') extraNetRate += value / 100
    if (metric.calculationType === 'PER_ORDER_COST') extraPerOrder += value
  }
  const fixedCost = baseFixed + extraFixed
  const customCost = extraFixed + gmv * extraGmvRate + netSales * extraNetRate + gmv / input.aov * extraPerOrder
  const contributionRate = (1 - refund) * (input.grossMarginRate - input.platformRate - input.logisticsRate) / 100
    - input.adCostRate / 100 - extraGmvRate - (1 - refund) * extraNetRate - extraPerOrder / input.aov
  const operatingProfit = grossProfit - platformCost - adCost - logisticsCost - baseFixed - customCost
  const breakEvenPaidGmv = contributionRate > 0 ? fixedCost / contributionRate : null
  const breakEvenNetSales = breakEvenPaidGmv === null ? null : breakEvenPaidGmv * (1 - refund)
  const breakEvenOrders = breakEvenPaidGmv === null ? null : Math.ceil(Number((breakEvenPaidGmv / input.aov).toFixed(8)))
  return { netSales, grossProfit, platformCost, adCost, logisticsCost, fixedCost, customCost, operatingProfit, contributionRate, breakEvenPaidGmv, breakEvenNetSales, breakEvenOrders }
}

export const money = (amount: number | null) => amount === null ? '无法达到' : `${amount < 0 ? '-' : ''}¥${Math.abs(Math.round(amount)).toLocaleString('en-US')}`
