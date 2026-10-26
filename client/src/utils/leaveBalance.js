// 假別餘額的顯示與試算（餘額由 GET /api/approvals/leave-balances 提供，單位是小時；1 天 = 8 小時只是換算顯示）。
// 這裡只做格式化與「這次申請會不會超額」的提示；真正的把關在伺服器（送出時再檢查一次）。

export const DAY_HOURS = 8

export const STATUS_LABELS = {
  ok: '',
  low: '即將用完',
  over: '已超出額度',
  unlimited: '不設上限',
  unconfigured: '尚未設定',
  manual: '人資維護',
  // 原民假：只有具原住民身分的員工有額度
  ineligible: '限具原住民身分者',
  // 調休：餘額來自調休存摺（國定假日適逢休息日／例假自動存入），不分年度
  bank: '調休存摺',
}

function trimNumber(value, digits = 2) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  return String(Number(number.toFixed(digits)))
}

/** 40 -> '40 小時'、7.5 -> '7.5 小時' */
export function formatHours(hours) {
  return `${trimNumber(hours)} 小時`
}

/** 40 -> '5 天'、44 -> '5.5 天' */
export function formatDays(hours) {
  return `${trimNumber(Number(hours) / DAY_HOURS)} 天`
}

/** 44 -> '5 天 4 小時'（不是整天時拆開寫，整天只寫天數） */
export function formatDaysAndHours(hours) {
  const number = Number(hours)
  if (!Number.isFinite(number)) return '0 天'
  const sign = number < 0 ? '-' : ''
  const abs = Math.abs(number)
  const days = Math.floor(abs / DAY_HOURS + 1e-9)
  const rest = Math.round((abs - days * DAY_HOURS) * 100) / 100
  if (!days) return `${sign}${trimNumber(rest)} 小時`
  if (!rest) return `${sign}${days} 天`
  return `${sign}${days} 天 ${trimNumber(rest)} 小時`
}

/** 40 -> '40 小時（5 天）'、44 -> '44 小時（5 天 4 小時）'；給表格與訊息用，時數永遠在前 */
export function formatHoursWithDays(hours) {
  if (hours === null || hours === undefined) return '—'
  return `${formatHours(hours)}（${formatDaysAndHours(hours)}）`
}

/**
 * 調休存摺（客戶稱為移休，以天計）的時數：天數用小數，半天也看得出來。
 * 8 -> '8 小時（1 天）'、4 -> '4 小時（0.5 天）'、12 -> '12 小時（1.5 天）'
 */
export function formatBankHours(hours) {
  if (hours === null || hours === undefined || hours === '') return '—'
  return `${formatHours(hours)}（${formatDays(hours)}）`
}

function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s()[\]【】]/g, '')
}

/**
 * 依申請人輸入或選擇的假別名稱，在餘額列表裡找出對應的假別（與伺服器相同的規則：完全相同的名稱或別名優先，
 * 其次取包含的最長別名；特休只認完全相同的名稱）。找不到回傳 undefined。
 */
export function matchBalanceItem(items, typedText) {
  const typed = normalizeName(typedText)
  if (!typed || !Array.isArray(items)) return undefined
  const keysOf = (item) => [item.name, ...(item.aliases || [])].map(normalizeName).filter(Boolean)
  const exact = items.find(item => keysOf(item).includes(typed))
  if (exact) return exact
  let best
  let bestLength = 0
  for (const item of items) {
    if (item.source === 'employee') continue
    for (const key of keysOf(item)) {
      if (key.length >= 2 && typed.includes(key) && key.length > bestLength) {
        best = item
        bestLength = key.length
      }
    }
  }
  return best
}

const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)

/**
 * 這次申請 requestedHours 小時會怎樣：回傳 { level, text, exceeded, blocking, remainingAfter }。
 * level：info（沒問題）、warning（超額但只是警告）、error（超額且設定為不能送出）。
 * 併入其他假別的子假別（家庭照顧假、生理假）會另外檢查被併入的假別（用 item.countsAgainst 與 items 裡的對象）。
 */
export function evaluateRequest(item, items, requestedHours) {
  const requested = toNumber(requestedHours)
  if (!item || !(requested > 0)) return null
  const name = item.name
  // 特休、調休超過可用時數一律無法送出（伺服器不看超額處理的設定），設定值是 warn 的舊資料也一樣顯示成無法送出
  const enforcement = item.source === 'employee' || item.source === 'bank' ? 'block' : (item.enforcement || 'none')
  const reasons = []
  let remainingAfter = null

  if (item.status === 'unconfigured') {
    return { level: 'info', exceeded: false, blocking: false, remainingAfter: null, text: `${name}：尚未設定特休時數，系統不會用餘額擋下，請洽人資` }
  }

  // 原民假只給具原住民身分的員工（伺服器以額度 0 檢查超額）
  if (item.status === 'ineligible') {
    const blocking = enforcement === 'block'
    return {
      level: blocking ? 'error' : 'warning',
      exceeded: true,
      blocking,
      remainingAfter: null,
      text: `${name}限具原住民身分者，員工資料沒有原住民身分${blocking ? '，無法送出' : '，仍可送出，簽核人會看到超額'}；如有疑問請洽人資`,
    }
  }

  if (item.source === 'bank') {
    // 調休：和存摺的可用時數（剩餘 - 簽核中）比，與伺服器送出時的檢查相同
    const basis = toNumber(item.availableHours)
    remainingAfter = Math.round((basis - requested) * 100) / 100
    if (requested > basis) {
      const pending = toNumber(item.pendingHours) > 0 ? `、簽核中 ${formatBankHours(item.pendingHours)}` : ''
      reasons.push(
        `${name}存摺剩餘 ${formatBankHours(item.remainingHours)}${pending}，可用 ${formatBankHours(Math.max(basis, 0))}，` +
        `本次申請 ${formatBankHours(requested)}，將超出 ${formatBankHours(requested - Math.max(basis, 0))}`
      )
    }
  } else if (item.period === 'event') {
    if (item.quotaHours != null) {
      const over = requested - toNumber(item.quotaHours)
      if (over > 0) reasons.push(`${name}每次最多 ${formatHours(item.quotaHours)}，本次申請 ${formatHours(requested)}，超出 ${formatHours(over)}`)
    }
  } else if (item.quotaHours != null && item.availableHours != null && item.status !== 'manual') {
    const basis = item.source === 'employee' ? toNumber(item.remainingHours) : toNumber(item.availableHours)
    remainingAfter = Math.round((basis - requested) * 100) / 100
    if (requested > basis) {
      const used = `已使用 ${formatHours(item.usedHours)}${toNumber(item.pendingHours) > 0 ? `、簽核中 ${formatHours(item.pendingHours)}` : ''}`
      reasons.push(
        `${name}${item.source === 'employee' ? '' : '今年'}額度 ${formatHours(item.quotaHours)}，${used}，` +
        `可請 ${formatHours(Math.max(basis, 0))}，本次申請 ${formatHours(requested)}，將超出 ${formatHours(requested - Math.max(basis, 0))}`
      )
    }
  }

  const parent = item.countsAgainst ? (items || []).find(entry => entry.key === item.countsAgainst.key) : null
  if (parent && parent.availableHours != null && parent.quotaHours != null) {
    const exempt = toNumber(item.countsAgainst.exemptHours)
    const before = toNumber(item.usedHours) + toNumber(item.pendingHours)
    const counted = Math.max(0, before + requested - exempt) - Math.max(0, before - exempt)
    if (counted > toNumber(parent.availableHours)) {
      reasons.push(
        `${name}會併入${parent.name}計算，${parent.name}今年額度 ${formatHours(parent.quotaHours)}，` +
        `可請 ${formatHours(Math.max(toNumber(parent.availableHours), 0))}，本次併入 ${formatHours(counted)}，` +
        `將超出 ${formatHours(counted - Math.max(toNumber(parent.availableHours), 0))}`
      )
    }
  }

  if (reasons.length) {
    const blocking = enforcement === 'block'
    return { level: blocking ? 'error' : 'warning', exceeded: true, blocking, remainingAfter, text: `${reasons.join('；')}${blocking ? '，無法送出' : '，仍可送出，簽核人會看到超額'}` }
  }

  if (remainingAfter !== null) {
    if (item.source === 'bank') {
      return {
        level: 'info',
        exceeded: false,
        blocking: false,
        remainingAfter,
        text: `${name}：目前可請 ${formatBankHours(item.availableHours)}；本次申請 ${formatBankHours(requested)}，核准後剩 ${formatBankHours(remainingAfter)}`,
      }
    }
    return {
      level: 'info',
      exceeded: false,
      blocking: false,
      remainingAfter,
      text: `${name}：目前可請 ${formatHoursWithDays(item.source === 'employee' ? item.remainingHours : item.availableHours)}；本次申請 ${formatHours(requested)}，核准後剩 ${formatHoursWithDays(remainingAfter)}`,
    }
  }
  return { level: 'info', exceeded: false, blocking: false, remainingAfter: null, text: `${name}：本次申請 ${formatHours(requested)}` }
}

/** 一列餘額的「已超出 N 小時」說明（remaining 為負數時） */
export function describeOver(item) {
  const remaining = Number(item?.remainingHours)
  if (!Number.isFinite(remaining) || remaining >= 0) return ''
  return `已超出 ${formatHours(-remaining)}`
}

// 舊資料「年度特休總天數」的數字大於這個值就不可能是天數（法定上限 30 天），視為已經是小時（與伺服器相同）
export const LEGACY_ANNUAL_LEAVE_DAYS_MAX = 40

const nonNegative = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}
const round4 = (value) => Math.round(value * 10000) / 10000

/**
 * 員工特休的時數（與伺服器 utils/annualLeaveHours 相同的規則）：有 totalHours 就用時數欄位；
 * 沒有（還沒搬移的舊資料）就由 totalDays / usedDays 解讀：任何一個數字大於 40 視為已經是小時，否則乘 8。
 */
export function readAnnualLeaveHours(annualLeave) {
  if (!annualLeave || typeof annualLeave !== 'object') {
    return { totalHours: 0, usedHours: 0, remainingHours: 0, unitSource: null, legacy: false }
  }
  const hasHours = annualLeave.totalHours !== undefined && annualLeave.totalHours !== null
    && annualLeave.totalHours !== '' && Number.isFinite(Number(annualLeave.totalHours))
  let totalHours
  let usedHours
  let unitSource = annualLeave.unitSource || null
  if (hasHours) {
    totalHours = nonNegative(annualLeave.totalHours)
    usedHours = nonNegative(annualLeave.usedHours)
  } else {
    const totalDays = nonNegative(annualLeave.totalDays)
    const usedDays = nonNegative(annualLeave.usedDays)
    const alreadyHours = Math.max(totalDays, usedDays) > LEGACY_ANNUAL_LEAVE_DAYS_MAX
    totalHours = alreadyHours ? totalDays : totalDays * DAY_HOURS
    usedHours = alreadyHours ? usedDays : usedDays * DAY_HOURS
    unitSource = unitSource || (alreadyHours ? 'migrated-hours' : 'migrated-days')
  }
  return {
    totalHours: round4(totalHours),
    usedHours: round4(usedHours),
    remainingHours: round4(totalHours - usedHours),
    unitSource,
    legacy: !hasHours,
  }
}

export default {
  DAY_HOURS,
  STATUS_LABELS,
  formatHours,
  formatDays,
  formatDaysAndHours,
  formatHoursWithDays,
  formatBankHours,
  matchBalanceItem,
  evaluateRequest,
  describeOver,
  readAnnualLeaveHours,
}
