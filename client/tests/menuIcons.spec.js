import { describe, it, expect } from 'vitest'
import {
  iconMap,
  glyphMap,
  resolveMenuIcon,
  resolveMenuGlyph,
  hasMenuIconImage,
  DEFAULT_MENU_ICON,
  DEFAULT_MENU_GLYPH
} from '../src/constants/menuIcons'

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

  it('tells whether a menu item has its own png', () => {
    expect(hasMenuIconImage({ icon: 'el-icon-postcard' })).toBe(true)
    expect(hasMenuIconImage('/custom/icon.png')).toBe(true)
    // 變更密碼（el-icon-lock）沒有 png：側欄改用向量圖示，不再顯示系統標誌
    expect(hasMenuIconImage({ icon: 'el-icon-lock' })).toBe(false)
    expect(hasMenuIconImage({ icon: '' })).toBe(false)
    expect(hasMenuIconImage(undefined)).toBe(false)
  })

  it('resolves a vector glyph for every icon key the server menu uses', () => {
    const serverIcons = [
      'el-icon-postcard', 'el-icon-timer', 'el-icon-s-operation', 'el-icon-lock', 'el-icon-data-analysis',
      'el-icon-setting', 'el-icon-date', 'el-icon-money', 'el-icon-s-check', 'el-icon-user-solid',
      'el-icon-more', 'el-icon-s-grid', 'el-icon-s-data'
    ]
    serverIcons.forEach(icon => {
      expect(glyphMap[icon], icon).toBeTruthy()
      expect(resolveMenuGlyph({ icon })).toBe(glyphMap[icon])
    })
    Object.keys(iconMap).forEach(icon => expect(glyphMap[icon], icon).toBeTruthy())
    expect(resolveMenuGlyph('el-icon-unknown')).toBe(DEFAULT_MENU_GLYPH)
    expect(resolveMenuGlyph(undefined)).toBe(DEFAULT_MENU_GLYPH)
  })
})
