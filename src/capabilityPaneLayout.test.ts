import { describe, expect, it } from 'vitest'
import { capabilityCenterWidth, capabilityPaneSizesForDrag } from './capabilityPaneLayout'

describe('capability workspace pane sizing', () => {
  const layoutWidth = 1200
  const initial = { left: 220, right: 320 }

  it('resizes the left workspace tree and the center pane together', () => {
    const next = capabilityPaneSizesForDrag(initial, 'left', 120, layoutWidth)
    expect(next).toEqual({ left: 340, right: 320 })
    expect(capabilityCenterWidth(layoutWidth, next)).toBe(capabilityCenterWidth(layoutWidth, initial) - 120)
  })

  it('resizes the right preview and the center pane together', () => {
    const next = capabilityPaneSizesForDrag(initial, 'right', -100, layoutWidth)
    expect(next).toEqual({ left: 220, right: 420 })
    expect(capabilityCenterWidth(layoutWidth, next)).toBe(capabilityCenterWidth(layoutWidth, initial) - 100)
  })

  it('keeps every pane usable at its minimum width', () => {
    expect(capabilityPaneSizesForDrag(initial, 'left', 2000, layoutWidth)).toEqual({ left: 572, right: 320 })
    expect(capabilityPaneSizesForDrag(initial, 'right', 2000, layoutWidth)).toEqual({ left: 220, right: 260 })
  })
})
