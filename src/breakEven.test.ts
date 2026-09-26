import { describe, expect, it } from 'vitest'
import { blankDefaults, calculate, createModel, douyinDefaults, duplicateModel, scenariosFrom, validateScenario, type CustomMetric } from './breakEven'

const base = () => scenariosFrom(douyinDefaults).BASE

describe('break-even engine', () => {
  it('uses the canonical formula, not the screenshot example output', () => {
    const result = calculate(base(), [])!
    expect(result.netSales).toBe(300000)
    expect(result.grossProfit).toBe(120000)
    expect(result.platformCost).toBe(15000)
    expect(result.adCost).toBe(80000)
    expect(result.logisticsCost).toBe(15000)
    expect(result.fixedCost).toBe(60000)
    expect(result.operatingProfit).toBe(-50000)
    expect(result.contributionRate).toBeCloseTo(0.025)
    expect(result.breakEvenPaidGmv).toBeCloseTo(2400000)
    expect(result.breakEvenNetSales).toBeCloseTo(1800000)
    expect(result.breakEvenOrders).toBe(1200)
    expect(calculate(base(), [], result.breakEvenPaidGmv!)!.operatingProfit).toBeCloseTo(0, 7)
  })

  it('returns no false break-even when contribution is zero or negative', () => {
    const zero = base(); zero.inputs.adCostRate = '22.5'
    expect(calculate(zero, [])!.breakEvenPaidGmv).toBeNull()
    const negative = base(); negative.inputs.adCostRate = '30'
    expect(calculate(negative, [])!.breakEvenPaidGmv).toBeNull()
    expect(calculate(negative, [])!.operatingProfit).toBeLessThan(0)
  })

  it('handles full refunds, zero fixed costs, and negative gross margin after fees', () => {
    const refund = base(); refund.inputs.refundRate = '100'
    expect(calculate(refund, [])!.breakEvenPaidGmv).toBeNull()
    const noFixed = base(); for (const key of ['hostFixedCost','operationFixedCost','venueEquipmentCost','otherFixedCost'] as const) noFixed.inputs[key] = '0'
    expect(calculate(noFixed, [])!.breakEvenPaidGmv).toBe(0)
    const lowMargin = base(); lowMargin.inputs.grossMarginRate = '1'
    expect(calculate(lowMargin, [])!.contributionRate).toBeLessThan(0)
  })

  it('rejects invalid and non-finite input without NaN or Infinity output', () => {
    const invalid = base(); invalid.inputs.aov = '0'; invalid.inputs.refundRate = '101'; invalid.inputs.paidGmv = ''
    expect(validateScenario(invalid, [])).toMatchObject({ aov: expect.any(String), refundRate: expect.any(String), paidGmv: expect.any(String) })
    expect(calculate(invalid, [])).toBeNull()
    invalid.inputs.paidGmv = 'Infinity'
    expect(calculate(invalid, [])).toBeNull()
  })

  it('deducts custom metrics according to their calculation type', () => {
    const metrics: CustomMetric[] = [
      { id:'fixed', key:'storage', name:'仓储', unit:'money', calculationType:'FIXED_COST' },
      { id:'paid', key:'paid_fee', name:'渠道', unit:'percent', calculationType:'RATE_OF_PAID_GMV' },
      { id:'net', key:'net_fee', name:'仓储费率', unit:'percent', calculationType:'RATE_OF_NET_SALES' },
      { id:'order', key:'order_fee', name:'打包', unit:'money', calculationType:'PER_ORDER_COST' },
      { id:'info', key:'view_count', name:'观看', unit:'money', calculationType:'INFORMATION_ONLY' },
    ]
    const values = base(); values.customValues = { fixed:'1000', paid:'0.5', net:'1', order:'3', info:'9999' }
    const result = calculate(values, metrics)!
    expect(result.customCost).toBe(1000 + 2000 + 3000 + 600)
    expect(result.operatingProfit).toBe(-56600)
    expect(result.breakEvenPaidGmv).toBeCloseTo(61000 / (0.025 - 0.005 - 0.0075 - 0.0015), 3)
  })

  it('keeps scenario values and duplicated models isolated', () => {
    const model = createModel('原模型','抖音渠道负责人','douyin')
    model.scenarios.BEAR.inputs.refundRate = '35'
    expect(model.scenarios.BASE.inputs.refundRate).toBe('25')
    const copy = duplicateModel(model)
    copy.scenarios.BASE.inputs.refundRate = '5'
    expect(copy.id).not.toBe(model.id)
    expect(model.scenarios.BASE.inputs.refundRate).toBe('25')
    expect(blankDefaults.paidGmv).toBe('0')
  })
})
