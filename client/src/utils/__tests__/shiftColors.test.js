import { describe, it, expect } from 'vitest'
import { buildShiftStyle, resolveShiftBaseColors, __testUtils } from '../shiftColors'

const {
  normalizeHex,
  lighten,
  darken,
  buildKey,
  hashKey,
  SHIFT_PALETTE,
} = __testUtils()

describe('shift color utilities', () => {
  it('normalizes short hex colors', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc')
    expect(normalizeHex(' #ABC ')).toBe('#aabbcc')
    expect(normalizeHex('invalid')).toBeNull()
  })

  it('prefers custom background colors when provided', () => {
    const result = resolveShiftBaseColors({ bgColor: '#123456' })
    expect(result.base).toBe('#123456')
    expect(result.text).toBeTypeOf('string')
  })

  it('derives palette colors deterministically by key', () => {
    const shift = { _id: 'abc123', code: 'X1' }
    const key = buildKey(shift)
    const paletteIndex = hashKey(key) % SHIFT_PALETTE.length
    const expected = SHIFT_PALETTE[paletteIndex]
    const result = resolveShiftBaseColors(shift)
    expect(result.base).toBe(expected.bg)
    expect(result.text).toBe(expected.text)
  })

  it('generates css variables for shift style', () => {
    const style = buildShiftStyle({ bgColor: '#336699', color: '#ffffff' })
    expect(style['--shift-base-color']).toBe('#336699')
    expect(style['--shift-text-color']).toBe('#ffffff')
    expect(style['--shift-cell-bg-start']).toBe(lighten('#336699', 0.18))
    expect(style['--shift-border-color']).toBe(darken('#336699', 0.18))
  })

  it('returns empty object for missing shift info', () => {
    expect(buildShiftStyle(null)).toEqual({})
  })
})
