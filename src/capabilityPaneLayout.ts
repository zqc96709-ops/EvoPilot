export type CapabilityPaneSizes = { left: number; right: number }
export type CapabilityPaneSide = keyof CapabilityPaneSizes

const MIN_LEFT = 160
const MIN_CENTER = 280
const MIN_RIGHT = 260
const RESIZER_WIDTH = 14
const RESIZER_TOTAL = RESIZER_WIDTH * 2

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

export const capabilityPaneSizesForDrag = (initial: CapabilityPaneSizes, side: CapabilityPaneSide, delta: number, layoutWidth: number): CapabilityPaneSizes => {
  const maximum = Math.max(side === 'left' ? MIN_LEFT : MIN_RIGHT, layoutWidth - RESIZER_TOTAL - MIN_CENTER - (side === 'left' ? initial.right : initial.left))
  const value = side === 'left' ? initial.left + delta : initial.right - delta
  return { ...initial, [side]: clamp(value, side === 'left' ? MIN_LEFT : MIN_RIGHT, maximum) }
}

export const capabilityCenterWidth = (layoutWidth: number, sizes: CapabilityPaneSizes) => Math.max(0, layoutWidth - RESIZER_TOTAL - sizes.left - sizes.right)
