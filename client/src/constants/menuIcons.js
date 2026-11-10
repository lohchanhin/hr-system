import {
  Calendar,
  Clock,
  Coin,
  DataAnalysis,
  FirstAidKit,
  Grid,
  Lock,
  Menu as MenuGlyph,
  OfficeBuilding,
  Setting,
  Stamp,
  Tickets,
  User
} from '@element-plus/icons-vue'

export const DEFAULT_MENU_ICON = '/HR.png'

export const iconMap = Object.freeze({
  'el-icon-postcard': '/出勤管理打卡.png',
  'el-icon-timer': '/排班.png',
  'el-icon-s-operation': '/簽核.png',
  'el-icon-setting': '/出勤設定.png',
  'el-icon-date': '/請假加班.png',
  'el-icon-money': '/薪資.png',
  'el-icon-s-check': '/社保.png',
  'el-icon-user-solid': '/人資管理.png',
  'el-icon-more': '/其他控制.png',
  'el-icon-s-grid': '/部門設定.png',
  'el-icon-s-data': '/報表.png',
  'el-icon-data-analysis': '/報表.png'
})

function isValidUrlPath(icon) {
  return icon.startsWith('/') || /^https?:\/\//i.test(icon)
}

export function resolveMenuIcon(target) {
  const icon = typeof target === 'string' ? target : target?.icon
  if (typeof icon === 'string') {
    const trimmed = icon.trim()
    if (!trimmed) {
      return DEFAULT_MENU_ICON
    }

    if (isValidUrlPath(trimmed)) {
      return trimmed
    }

    const fromMap = iconMap[trimmed]
    if (fromMap) {
      return fromMap
    }
  }

  return DEFAULT_MENU_ICON
}

// 向量圖示：手機底部分頁列（白底，淺色的 png 看不見）與沒有對應 png 的選單項目使用
export const glyphMap = Object.freeze({
  'el-icon-postcard': Clock,
  'el-icon-timer': Calendar,
  'el-icon-s-operation': Stamp,
  'el-icon-setting': Setting,
  'el-icon-date': Tickets,
  'el-icon-money': Coin,
  'el-icon-s-check': FirstAidKit,
  'el-icon-user-solid': User,
  'el-icon-more': Grid,
  'el-icon-s-grid': OfficeBuilding,
  'el-icon-s-data': DataAnalysis,
  'el-icon-data-analysis': DataAnalysis,
  'el-icon-lock': Lock
})

export const DEFAULT_MENU_GLYPH = MenuGlyph

/** 選單項目有沒有對應的 png 圖示（沒有時側欄改用向量圖示，不再一律顯示系統標誌） */
export function hasMenuIconImage(target) {
  const icon = typeof target === 'string' ? target : target?.icon
  if (typeof icon !== 'string') return false
  const trimmed = icon.trim()
  return Boolean(trimmed) && (isValidUrlPath(trimmed) || Boolean(iconMap[trimmed]))
}

export function resolveMenuGlyph(target) {
  const icon = typeof target === 'string' ? target : target?.icon
  return (typeof icon === 'string' && glyphMap[icon.trim()]) || DEFAULT_MENU_GLYPH
}
