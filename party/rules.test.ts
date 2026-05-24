import { describe, it, expect } from 'vitest'
import { FIELD } from '../src/types'

describe('offside position', () => {
  function isOffsidePosition(attackerX: number, lastDefX: number, team: 'home' | 'away') {
    const dir = team === 'home' ? 1 : -1
    return dir === 1 ? attackerX > lastDefX : attackerX < lastDefX
  }

  it('home attacker ahead of last defender is offside', () => {
    expect(isOffsidePosition(75, 70, 'home')).toBe(true)
  })
  it('home attacker behind last defender is onside', () => {
    expect(isOffsidePosition(65, 70, 'home')).toBe(false)
  })
  it('away attacker works mirror', () => {
    expect(isOffsidePosition(25, 30, 'away')).toBe(true)
  })
})

describe('field boundaries', () => {
  it('penalty area bounds for home', () => {
    const inPA = (x: number, y: number) =>
      x >= 0 && x <= FIELD.PA_DEPTH &&
      y >= FIELD.CENTER_Y - FIELD.PA_HALF_WIDTH && y <= FIELD.CENTER_Y + FIELD.PA_HALF_WIDTH
    expect(inPA(5, 30)).toBe(true)
    expect(inPA(20, 30)).toBe(false)
  })
})
