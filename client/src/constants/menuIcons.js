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
