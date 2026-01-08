/**
 * 日期格式化工具
 * 提供統一的日期格式化方法
 */

/**
 * 格式化日期為 YYYY-MM-DD 格式
 * @param {string|Date} dateString - 日期字串或日期物件
 * @returns {string} 格式化後的日期字串，格式為 YYYY-MM-DD，錯誤時返回 '-'
 */
export function formatDate(dateString) {
  if (!dateString) return '-'
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return '-'
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  } catch (error) {
    console.error('Error formatting date:', error)
    return '-'
  }
}

/**
 * 格式化時間為 HH:MM 格式
 * @param {string} isoString - ISO 格式的時間字串
 * @returns {string} 格式化後的時間字串，格式為 HH:MM，錯誤時返回 '-'
 */
export function formatTime(isoString) {
  if (!isoString) return '-'
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return '-'
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  } catch (error) {
    console.error('Error formatting time:', error)
    return '-'
  }
}

/**
 * 格式化日期時間為 YYYY-MM-DD HH:MM 格式
 * @param {string|Date} dateString - 日期字串或日期物件
 * @returns {string} 格式化後的日期時間字串，錯誤時返回 '-'
 */
export function formatDateTime(dateString) {
  if (!dateString) return '-'
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return '-'
    return `${formatDate(dateString)} ${formatTime(dateString)}`
  } catch (error) {
    console.error('Error formatting datetime:', error)
    return '-'
  }
}
