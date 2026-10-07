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

  it('uses only configured colours when both are set and never the generated palette', () => {
    const style = buildShiftStyle({ _id: 'x', code: 'C1', bgColor: '#7c2d12', color: '#fef3c7' })
    expect(style['--shift-base-color']).toBe('#7c2d12')
    expect(style['--shift-text-color']).toBe('#fef3c7')
    expect(SHIFT_PALETTE.map(item => item.bg)).not.toContain(style['--shift-base-color'])
  })

  it('keeps the generated pastel for shifts without any configured colour', () => {
    const shift = { _id: 's9', code: 'Q', name: '無顏色' }
    const expected = SHIFT_PALETTE[hashKey(buildKey(shift)) % SHIFT_PALETTE.length]
    expect(resolveShiftBaseColors(shift)).toEqual({ base: expected.bg, text: expected.text })
    expect(resolveShiftBaseColors({ ...shift, bgColor: '', color: '' })).toEqual({ base: expected.bg, text: expected.text })
  })

  it('picks the automatic text colour against the lightened background that is actually displayed', () => {
    const { getContrastColor } = __testUtils()
    const light = resolveShiftBaseColors({ bgColor: '#ffd54f' })
    expect(light.text).toBe(getContrastColor(lighten('#ffd54f', 0.18)))
    expect(light.text).toBe('#1f2937')
    const dark = resolveShiftBaseColors({ bgColor: '#1e3a8a' })
    expect(dark.text).toBe('#f8fafc')
    // 文字色有設定時一律用設定值
    expect(resolveShiftBaseColors({ bgColor: '#ffd54f', color: '#000000' }).text).toBe('#000000')
  })

  it('returns empty object for missing shift info', () => {
    expect(buildShiftStyle(null)).toEqual({})
  })
})
