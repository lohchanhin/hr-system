// 提供證照到期提醒的共用工具，可供排程或背景工作使用
// 由於目前尚未串接通知機制，先以純函式計算到期資料，之後可由 cron job / queue 取用

export function collectExpiringLicenses(employees = [], { daysAhead = 30, referenceDate = new Date() } = {}) {
  const baseDate = referenceDate instanceof Date ? referenceDate : new Date(referenceDate)
  if (Number.isNaN(baseDate.getTime())) {
    throw new TypeError('referenceDate 必須為可轉換的日期物件或字串')
  }
  const now = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate())
  const threshold = new Date(now)
  threshold.setDate(threshold.getDate() + Number(daysAhead || 0))

  const results = []
  employees.forEach(employee => {
    const licenses = Array.isArray(employee?.licenses) ? employee.licenses : []
    licenses.forEach(license => {
      const endDate = license?.endDate || license?.expiryDate
      if (!endDate) return
      const expiry = new Date(endDate)
      if (Number.isNaN(expiry.getTime())) return
      const normalizedExpiry = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate())
      if (normalizedExpiry < now) return
      if (normalizedExpiry > threshold) return

      const msPerDay = 24 * 60 * 60 * 1000
      const daysRemaining = Math.ceil((normalizedExpiry - now) / msPerDay)
      results.push({
        employeeId: employee?._id?.toString?.() ?? employee?.id ?? null,
        employeeName: employee?.name ?? '',
        licenseName: license?.name ?? '',
        licenseNumber: license?.number ?? '',
        endDate: normalizedExpiry,
        daysRemaining
      })
    })
  })

  return results.sort((a, b) => a.endDate - b.endDate)
}
