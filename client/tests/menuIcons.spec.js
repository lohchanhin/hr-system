import { describe, it, expect } from 'vitest'
import { iconMap, resolveMenuIcon, DEFAULT_MENU_ICON } from '../src/constants/menuIcons'

describe('menu icon resolver', () => {
  it('returns mapped png for known element-plus icons', () => {
    expect(resolveMenuIcon('el-icon-postcard')).toBe(iconMap['el-icon-postcard'])
    expect(resolveMenuIcon({ icon: 'el-icon-s-operation' })).toBe('/簽核.png')
  })

  it('returns icon path when absolute url or root path is provided', () => {
    expect(resolveMenuIcon('/custom/icon.png')).toBe('/custom/icon.png')
    expect(resolveMenuIcon({ icon: 'https://cdn.test/icon.png' })).toBe('https://cdn.test/icon.png')
  })

  it('falls back to default when unknown icon is provided', () => {
    expect(resolveMenuIcon('el-icon-unknown')).toBe(DEFAULT_MENU_ICON)
    expect(resolveMenuIcon({ icon: '' })).toBe(DEFAULT_MENU_ICON)
    expect(resolveMenuIcon(undefined)).toBe(DEFAULT_MENU_ICON)
  })
})
