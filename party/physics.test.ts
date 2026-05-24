import { describe, it, expect } from 'vitest'

// Inline copies of helpers for isolated testing
function gridSlotToRole(slotIdx: number): 'fwd' | 'mid' | 'def' {
  const row = Math.floor(slotIdx / 3)
  if (row === 0) return 'fwd'
  if (row === 1) return 'mid'
  return 'def'
}

function gridSlotToStartPos(slotIdx: number, team: 'home' | 'away'): { x: number; y: number } {
  const col = slotIdx % 3
  const row = Math.floor(slotIdx / 3)
  const yPositions = [15, 30, 45] as const
  const xPositionsHome = [72, 58, 35] as const
  const xPositionsAway = [28, 42, 65] as const
  const y = yPositions[col]
  const x = team === 'home' ? xPositionsHome[row] : xPositionsAway[row]
  return { x, y }
}

describe('gridSlotToRole', () => {
  it('top row (0,1,2) is fwd', () => {
    expect(gridSlotToRole(0)).toBe('fwd')
    expect(gridSlotToRole(1)).toBe('fwd')
    expect(gridSlotToRole(2)).toBe('fwd')
  })
  it('middle row (3,4,5) is mid', () => {
    expect(gridSlotToRole(3)).toBe('mid')
    expect(gridSlotToRole(4)).toBe('mid')
    expect(gridSlotToRole(5)).toBe('mid')
  })
  it('bottom row (6,7,8) is def', () => {
    expect(gridSlotToRole(6)).toBe('def')
    expect(gridSlotToRole(7)).toBe('def')
    expect(gridSlotToRole(8)).toBe('def')
  })
})

describe('gridSlotToStartPos', () => {
  it('left column (col 0) → y=15', () => {
    expect(gridSlotToStartPos(0, 'home').y).toBe(15)
    expect(gridSlotToStartPos(3, 'home').y).toBe(15)
    expect(gridSlotToStartPos(6, 'home').y).toBe(15)
  })
  it('center column (col 1) → y=30', () => {
    expect(gridSlotToStartPos(1, 'home').y).toBe(30)
  })
  it('right column (col 2) → y=45', () => {
    expect(gridSlotToStartPos(2, 'home').y).toBe(45)
  })
  it('home FWD starts near opponent half', () => {
    const pos = gridSlotToStartPos(0, 'home')  // slot 0 = FWD left
    expect(pos.x).toBe(72)
  })
  it('away FWD starts near opponent half (mirrored)', () => {
    const pos = gridSlotToStartPos(0, 'away')  // slot 0 = FWD left for away
    expect(pos.x).toBe(28)
  })
  it('home DEF starts in own half', () => {
    const pos = gridSlotToStartPos(6, 'home')  // slot 6 = DEF left
    expect(pos.x).toBe(35)
    expect(pos.x).toBeLessThan(50)
  })
  it('away DEF starts in own half (mirrored)', () => {
    const pos = gridSlotToStartPos(6, 'away')
    expect(pos.x).toBe(65)
    expect(pos.x).toBeGreaterThan(50)
  })
})

describe('player count', () => {
  it('home and away positions are mirrored (FWD)', () => {
    const homeFWD = gridSlotToStartPos(1, 'home')  // FWD center
    const awayFWD = gridSlotToStartPos(1, 'away')  // FWD center
    expect(homeFWD.x + awayFWD.x).toBe(100)  // symmetric around x=50
    expect(homeFWD.y).toBe(awayFWD.y)
  })
})
