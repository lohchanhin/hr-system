// 假別餘額：每位員工、每個假別的「額度 / 已使用 / 簽核中 / 剩餘」（單位是小時，天數是 時數 / 8 的換算）。
// - 特休：額度與已使用取自員工資料（系統在簽核核准時原子扣減的計數），簽核中的時數從單據算。
// - 其他假別：額度取自假別規則（services/leavePolicyService，預設是法定天數），已使用從「已核准」的單據即時加總，
//   簽核中從「簽核中」的單據加總；不另外存計數，所以撤回、退簽、否決後數字會自己回來。
// 所有請假表單（預設的「請假」與客戶自建的，包含已停用的表單與被換掉的欄位）都納入；日期一律以台灣時間判斷是哪一年。
import Employee from '../models/Employee.js'
import ApprovalRequest from '../models/approval_request.js'
// 用命名空間匯入：別的測試把 leaveFieldService 換成只有部分函式的替身時，這裡不會因為缺少匯出而載入失敗
import * as leaveFieldService from './leaveFieldService.js'
import { getLeavePolicy, matchLeaveType, normalizeLeaveName } from './leavePolicyService.js'
import { collectLeaveTypeNames, computeLeaveRequestHours } from './leaveRequestDays.js'
import { computeLeaveDuration, sumLeaveHoursInRange } from '../utils/leaveDuration.js'
import { candidateSelectKeys, pickFieldValue, resolveCandidateIds } from '../utils/fieldCandidates.js'
import { readAnnualLeaveHours } from '../utils/annualLeaveHours.js'
import { toTaipeiDateKey } from '../utils/taipeiTime.js'
import { LEAVE_DAY_EQUIVALENT_HOURS, formatHoursText, hoursToDays, roundHours } from '../utils/leaveHours.js'

const COUNTED_STATUSES = ['approved', 'pending']
// 剩餘時數低於這個值（或額度的 10%，取較大者）就標示「即將用完」
const LOW_BALANCE_MIN_HOURS = 8
const LOW_BALANCE_RATIO = 0.1

/** 現在是台灣的哪一年 */
export function currentTaipeiYear(now = new Date()) {
  return Number((toTaipeiDateKey(now) || '').slice(0, 4)) || now.getFullYear()
}

function normalizeId(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) return normalizeId(value._id)
  return typeof value.toString === 'function' ? value.toString() : String(value)
}

const toDays = (hours) => hoursToDays(hours, LEAVE_DAY_EQUIVALENT_HOURS, 2)

/* ---------------------------- 從單據統計使用量 ---------------------------- */

function emptyBucket() {
  return { approved: 0, pending: 0 }
}

function addToBucket(map, key, status, hours) {
  if (!map.has(key)) map.set(key, emptyBucket())
  map.get(key)[status] = roundHours((map.get(key)[status] || 0) + hours)
}

// 這張單落在指定年度（台灣曆年）的時數：有請假日期就逐日加總，沒有日期的舊資料用送簽日期歸屬年度（與薪資、報表相同）
function hoursInYear({ row, formData, ids, year, hoursPerDay }) {
  const duration = computeLeaveDuration({
    startValue: pickFieldValue(formData, ids.startIds),
    endValue: pickFieldValue(formData, ids.endIds),
    filledHours: pickFieldValue(formData, ids.hoursIds),
    filledDays: pickFieldValue(formData, ids.daysIds),
    literalDays: formData.days ?? formData.duration,
    literalHours: formData.hours,
    hoursPerDay,
  })
  if (duration.perDay.length) {
    return sumLeaveHoursInRange(duration.perDay, `${year}-01-01`, `${year + 1}-01-01`)
  }
  const createdYear = Number((toTaipeiDateKey(row.createdAt) || '').slice(0, 4))
  if (createdYear !== year) return 0
  const amount = computeLeaveRequestHours({
    formData,
    leaveFields: {
      startId: ids.startIds[0], endId: ids.endIds[0], daysId: ids.daysIds[0], hoursId: ids.hoursIds[0],
    },
  })
  return amount.hours
}

/**
 * 員工在 year 年（台灣曆年）已核准與簽核中的請假時數，依假別規則分類。
 * 回傳 { byKey: Map(假別代號 -> { approved, pending }), unmatched: Map(假別名稱 -> { approved, pending }), dictionaryNames: [] }；
 * dictionaryNames 是所有請假表單的假別選項名稱（員工選得到的假別）。
 */
export async function computeLeaveUsage({ employeeId, policy, year, excludeRequestId = null, infos = null }) {
  const leaveInfos = infos || await leaveFieldService.getAllLeaveFieldInfos()
  const hoursPerDay = LEAVE_DAY_EQUIVALENT_HOURS
  const byKey = new Map()
  const unmatched = new Map()
  const dictionaryNames = new Set()
  const exclude = normalizeId(excludeRequestId)

  for (const info of leaveInfos || []) {
    if (!info?.formId) continue
    for (const option of info.typeOptions || []) {
      const label = String(option?.label ?? option?.value ?? '').trim()
      if (label) dictionaryNames.add(label)
    }
    const ids = {
      startIds: resolveCandidateIds(info.startIds, info.startId),
      endIds: resolveCandidateIds(info.endIds, info.endId),
      typeIds: resolveCandidateIds(info.typeIds, info.typeId),
      daysIds: resolveCandidateIds(info.daysIds, info.daysId),
      hoursIds: resolveCandidateIds(info.hoursIds, info.hoursId),
    }
    if (!ids.typeIds.length) continue

    let query = ApprovalRequest.find({
      form: info.formId,
      applicant_employee: employeeId,
      status: { $in: COUNTED_STATUSES },
    })
    if (query && typeof query.select === 'function') {
      query = query.select(['status', 'createdAt', 'form_data.days', 'form_data.duration', 'form_data.hours']
        .concat(candidateSelectKeys(ids.startIds, ids.endIds, ids.typeIds, ids.daysIds, ids.hoursIds).map(id => `form_data.${id}`))
        .join(' '))
    }
    const rows = (query && typeof query.lean === 'function' ? await query.lean() : await query) || []

    for (const row of rows) {
      if (exclude && normalizeId(row._id) === exclude) continue
      if (!COUNTED_STATUSES.includes(row.status)) continue
      const formData = row.form_data && typeof row.form_data === 'object' ? row.form_data : {}
      const names = collectLeaveTypeNames(pickFieldValue(formData, ids.typeIds), info.typeOptions)
      if (!names.length) continue
      const hours = hoursInYear({ row, formData, ids, year, hoursPerDay })
      if (!(hours > 0)) continue
      const matched = matchLeaveType(names, policy.types)
      if (matched) addToBucket(byKey, matched.key, row.status, hours)
      else addToBucket(unmatched, names[names.length - 1], row.status, hours)
    }
  }
  return { byKey, unmatched, dictionaryNames: [...dictionaryNames] }
}

/* ---------------------------- 組成餘額列表（純函式） ---------------------------- */

/**
 * 員工資料裡由人資維護的餘額（不是從單據算出來的）：目前只有積假（天數）。
 * 假日補休、國定假日移休等日後的餘額來源也從這裡接進來。
 */
export function collectEmployeeHeldBalances(employee) {
  const held = []
  const accumulatedDays = Number(employee?.annualLeave?.accumulatedLeave)
  if (Number.isFinite(accumulatedDays) && accumulatedDays > 0) {
    held.push({
      key: 'accumulated',
      name: '積假',
      hours: roundHours(accumulatedDays * LEAVE_DAY_EQUIVALENT_HOURS),
      note: '人資維護，單位換算：1 天 = 8 小時',
    })
  }
  return held
}

function statusOf({ quotaHours, remainingHours }) {
  if (remainingHours < 0) return 'over'
  const lowLine = Math.max(LOW_BALANCE_MIN_HOURS, quotaHours * LOW_BALANCE_RATIO)
  return remainingHours <= lowLine ? 'low' : 'ok'
}

function withDays(item) {
  const next = { ...item }
  next.quotaDays = next.quotaHours == null ? null : toDays(next.quotaHours)
  next.usedDays = toDays(next.usedHours)
  next.pendingDays = toDays(next.pendingHours)
  next.remainingDays = next.remainingHours == null ? null : toDays(next.remainingHours)
  next.availableDays = next.availableHours == null ? null : toDays(next.availableHours)
  return next
}

/**
 * 把使用量與假別規則、員工資料組成餘額列表。
 * 併入計算（countsAgainst）：子假別超過免計時數的部分，算進它併入的假別（家庭照顧假全部併入事假；生理假超過 3 日的部分併入病假）。
 */
export function composeLeaveBalanceItems({ policy, usage, employee, focusKey = null }) {
  const types = (policy.types || []).filter(leaveType => leaveType.enabled !== false)
  const bucketOf = (key) => usage.byKey.get(key) || emptyBucket()
  const dictionary = new Set((usage.dictionaryNames || []).map(normalizeLeaveName))
  const items = []

  for (const leaveType of types) {
    const own = bucketOf(leaveType.key)
    const children = types.filter(child => child.countsAgainst?.key === leaveType.key)
    // 子假別併入這個假別的時數：已核准與簽核中各自 max(0, 子假別時數 - 免計時數)
    const includes = []
    let childApproved = 0
    let childPending = 0
    for (const child of children) {
      const bucket = bucketOf(child.key)
      const exempt = child.countsAgainst.exemptHours || 0
      const countedApproved = Math.max(0, bucket.approved - exempt)
      const countedTotal = Math.max(0, bucket.approved + bucket.pending - exempt)
      const countedPending = countedTotal - countedApproved
      childApproved += countedApproved
      childPending += countedPending
      if (countedApproved > 0 || countedPending > 0) {
        // 已核准與簽核中分開帶：畫面只把已核准的放在「已使用」，簽核中的放在「簽核中」；hours 是兩者合計（舊畫面相容）
        includes.push({
          key: child.key,
          name: child.name,
          approvedHours: roundHours(countedApproved),
          pendingHours: roundHours(countedPending),
          hours: roundHours(countedApproved + countedPending),
        })
      }
    }

    const base = {
      key: leaveType.key,
      name: leaveType.name,
      aliases: leaveType.aliases || [],
      period: leaveType.period,
      enforcement: leaveType.enforcement,
      builtin: Boolean(leaveType.builtin),
      note: leaveType.note || '',
      includes,
      usedHours: roundHours(own.approved + childApproved),
      pendingHours: roundHours(own.pending + childPending),
      quotaHours: null,
      remainingHours: null,
      availableHours: null,
      source: 'policy',
      status: 'unlimited',
      // 併入其他假別的設定（家庭照顧假併入事假…）：畫面用它試算「這次申請會不會讓被併入的假別超額」
      countsAgainst: leaveType.countsAgainst || null,
    }

    if (leaveType.source === 'employee_annual') {
      const annual = readAnnualLeaveHours(employee?.annualLeave)
      // 特休的已使用是系統核准時扣減的計數（人資也可以在員工管理調整），不是從單據加總
      base.source = 'employee'
      // 特休超過剩餘時數一律擋下（不看設定的超額處理），餘額列表也如實回報，畫面才不會顯示「仍可送出」
      base.enforcement = 'block'
      base.quotaHours = annual.totalHours
      base.usedHours = annual.usedHours
      base.pendingHours = roundHours(own.pending)
      base.remainingHours = annual.remainingHours
      base.availableHours = roundHours(annual.remainingHours - base.pendingHours)
      base.annualYear = employee?.annualLeave?.year ?? null
      base.expiryDate = employee?.annualLeave?.expiryDate ?? null
      base.status = !annual.configured && !(base.pendingHours > 0)
        ? 'unconfigured'
        : statusOf({ quotaHours: annual.totalHours, remainingHours: annual.remainingHours })
      if (!annual.configured) base.note = '尚未設定特休時數，請洽人資'
    } else if (leaveType.source === 'employee_comp') {
      // 補休沒有加班累計的模組，餘額由人資在員工管理維護；單據只當作參考的已使用／簽核中
      const held = Number(employee?.annualLeave?.compensatoryHours)
      base.source = 'employee-manual'
      base.quotaHours = Number.isFinite(held) && held > 0 ? roundHours(held) : 0
      base.remainingHours = base.quotaHours
      base.availableHours = roundHours(base.quotaHours - base.pendingHours)
      base.status = 'manual'
      base.note = base.note || '人資維護'
    } else if (leaveType.period === 'event') {
      // 每次事件的上限（婚假、喪假…）：不是年度餘額，沒有「剩餘」，列出今年已使用的時數
      base.quotaHours = leaveType.quotaHours
      base.status = 'ok'
    } else if (leaveType.quotaHours != null && leaveType.period !== 'none') {
      base.quotaHours = leaveType.quotaHours
      base.remainingHours = roundHours(leaveType.quotaHours - base.usedHours)
      base.availableHours = roundHours(base.remainingHours - base.pendingHours)
      base.status = statusOf({ quotaHours: leaveType.quotaHours, remainingHours: base.remainingHours })
    }

    const named = [leaveType.name, ...(leaveType.aliases || [])].map(normalizeLeaveName)
    const inDictionary = named.some(name => dictionary.has(name))
    const heldAnnual = leaveType.source === 'employee_comp' && base.quotaHours > 0
    const visible = leaveType.display !== 'hidden' && (
      leaveType.display === 'always'
      || base.usedHours > 0 || base.pendingHours > 0
      || inDictionary || heldAnnual
      || leaveType.key === focusKey
    )
    if (visible) items.push(withDays(base))
  }

  // 假別字典（員工選得到）裡有、卻對不到任何假別規則的名稱：列成沒有額度的假別，使用量照列
  const unmatchedRows = []
  const unmatchedUsage = usage.unmatched || new Map()
  for (const name of usage.dictionaryNames || []) {
    if (!normalizeLeaveName(name) || matchLeaveType([name], types)) continue
    const bucket = unmatchedUsage.get(name) || emptyBucket()
    items.push(withDays({
      key: `dict:${name}`,
      name,
      aliases: [],
      period: 'none',
      enforcement: 'none',
      builtin: false,
      note: '',
      includes: [],
      usedHours: bucket.approved,
      pendingHours: bucket.pending,
      quotaHours: null,
      remainingHours: null,
      availableHours: null,
      source: 'policy',
      status: 'unlimited',
    }))
  }
  for (const [name, bucket] of unmatchedUsage) {
    if (items.some(item => item.name === name)) continue
    unmatchedRows.push({ name, usedHours: bucket.approved, pendingHours: bucket.pending })
  }

  for (const held of collectEmployeeHeldBalances(employee)) {
    items.push(withDays({
      key: held.key,
      name: held.name,
      aliases: [],
      period: 'none',
      enforcement: 'none',
      builtin: true,
      note: held.note,
      includes: [],
      usedHours: 0,
      pendingHours: 0,
      quotaHours: held.hours,
      remainingHours: held.hours,
      availableHours: held.hours,
      source: 'employee-manual',
      status: 'manual',
    }))
  }

  return { items, unmatched: unmatchedRows }
}

/* ---------------------------- 超額判斷（純函式） ---------------------------- */

function sentence(parts) {
  return parts.filter(Boolean).join('，')
}

/**
 * 這次申請 requestedHours 小時，對這個假別的餘額是否超額。
 * - 一般年度假別（事假、病假…）：和「可請時數」(額度 - 已使用 - 簽核中) 比。
 * - 特休：和剩餘時數比（核准時系統另外用原子操作再把關一次）。
 * - 每次事件的上限（婚假、喪假…）：和每次上限比。
 * - 併入其他假別的子假別：另外檢查併入的那一個（家庭照顧假併入事假、生理假超過免計時數的部分併入病假）。
 * 不檢查（enforcement 為 none、尚未設定特休、沒有額度）時 exceeded 為 false。
 */
export function evaluateLeaveRequestAgainstBalance(item, requestedHours, parentItem = null, childContext = null) {
  const requested = Number(requestedHours)
  const result = { exceeded: false, shortByHours: 0, enforcement: item?.enforcement || 'none', message: '', typeKey: item?.key || null }
  if (!item || !(requested > 0) || item.enforcement === 'none' || item.status === 'unconfigured' || item.status === 'manual') {
    return result
  }

  const reasons = []
  let short = 0
  if (item.period === 'event') {
    if (item.quotaHours != null && requested > item.quotaHours) {
      short = roundHours(requested - item.quotaHours)
      reasons.push(`${item.name}每次最多 ${formatHoursText(item.quotaHours)}，本次申請 ${formatHoursText(requested)}，超出 ${formatHoursText(short)}`)
    }
  } else if (item.quotaHours != null && item.availableHours != null) {
    const basis = item.source === 'employee' ? item.remainingHours : item.availableHours
    if (requested > basis) {
      short = roundHours(requested - Math.max(basis, 0))
      const usedText = `已使用 ${formatHoursText(item.usedHours)}${item.pendingHours > 0 ? `、簽核中 ${formatHoursText(item.pendingHours)}` : ''}`
      reasons.push(sentence([
        `${item.name}${item.source === 'employee' ? '' : '今年'}額度 ${formatHoursText(item.quotaHours)}`,
        usedText,
        `可請 ${formatHoursText(Math.max(basis, 0))}`,
        `本次申請 ${formatHoursText(requested)}，將超出 ${formatHoursText(short)}`,
      ]))
    }
  }

  // 併入其他假別：子假別本身已用的（含簽核中）加上這次，超過免計時數的部分才算進被併入的假別
  if (parentItem && childContext && parentItem.availableHours != null && parentItem.quotaHours != null) {
    const exempt = childContext.exemptHours || 0
    const before = (item.usedHours || 0) + (item.pendingHours || 0)
    const counted = Math.max(0, before + requested - exempt) - Math.max(0, before - exempt)
    if (counted > parentItem.availableHours) {
      const parentShort = roundHours(counted - Math.max(parentItem.availableHours, 0))
      short = Math.max(short, parentShort)
      reasons.push(sentence([
        `${item.name}會併入${parentItem.name}計算`,
        `${parentItem.name}今年額度 ${formatHoursText(parentItem.quotaHours)}，可請 ${formatHoursText(Math.max(parentItem.availableHours, 0))}`,
        `本次併入 ${formatHoursText(counted)}，將超出 ${formatHoursText(parentShort)}`,
      ]))
    }
  }

  if (reasons.length) {
    result.exceeded = true
    result.shortByHours = short
    result.message = reasons.join('；')
  }
  return result
}

/* ---------------------------- 對外：整份餘額 ---------------------------- */

/**
 * 員工 year 年的假別餘額。
 * @param {object} options
 * @param {string} options.employeeId
 * @param {number} [options.year] 台灣曆年，預設今年
 * @param {string} [options.excludeRequestId] 計算時略過這張單（簽核畫面要顯示「這張單之前」的餘額）
 * @param {string} [options.focusKey] 一定要列出的假別代號（這張單的假別）
 * @returns {Promise<object|null>} 找不到員工回傳 null
 */
export async function buildLeaveBalances({
  employeeId,
  year = currentTaipeiYear(),
  excludeRequestId = null,
  focusKey = null,
  employee = null,
  policy = null,
  infos = null,
} = {}) {
  const person = employee || await Employee.findById(employeeId).select('name employeeId annualLeave').lean()
  if (!person) return null
  const activePolicy = policy || await getLeavePolicy()
  const usage = await computeLeaveUsage({
    employeeId: normalizeId(person._id ?? employeeId),
    policy: activePolicy,
    year,
    excludeRequestId,
    infos,
  })
  const { items, unmatched } = composeLeaveBalanceItems({ policy: activePolicy, usage, employee: person, focusKey })
  return {
    employee: { _id: normalizeId(person._id ?? employeeId), name: person.name ?? '', employeeId: person.employeeId ?? '' },
    year,
    range: { start: `${year}-01-01`, end: `${year}-12-31` },
    maxHoursPerDay: activePolicy.maxHoursPerDay,
    minUnitHours: activePolicy.minUnitHours,
    dayHours: LEAVE_DAY_EQUIVALENT_HOURS,
    generatedAt: new Date().toISOString(),
    items,
    unmatched,
  }
}

/**
 * 某一張請假單對餘額的影響（簽核畫面用）：這張單的假別、時數，以及核准前後的剩餘。
 * balances 必須是略過這張單算出來的（excludeRequestId），這樣「核准前」才不含它自己。
 */
export function describeRequestFocus({ balances, policy, names, requestedHours }) {
  const matched = matchLeaveType(names, policy?.types || [])
  if (!matched) return { typeKey: null, typeName: names?.[names.length - 1] || '', requestedHours, exceeded: false, enforcement: 'none' }
  const item = (balances?.items || []).find(entry => entry.key === matched.key)
  const parent = matched.countsAgainst ? (balances?.items || []).find(entry => entry.key === matched.countsAgainst.key) : null
  const verdict = evaluateLeaveRequestAgainstBalance(item, requestedHours, parent, matched.countsAgainst)
  const before = item ? (item.source === 'employee' ? item.remainingHours : item.availableHours) : null
  return {
    typeKey: matched.key,
    typeName: matched.name,
    requestedHours,
    remainingBefore: before,
    remainingAfter: before == null ? null : roundHours(before - requestedHours),
    exceeded: verdict.exceeded,
    shortByHours: verdict.shortByHours,
    enforcement: item?.enforcement || 'none',
    message: verdict.message,
  }
}

export default {
  currentTaipeiYear,
  computeLeaveUsage,
  collectEmployeeHeldBalances,
  composeLeaveBalanceItems,
  evaluateLeaveRequestAgainstBalance,
  buildLeaveBalances,
  describeRequestFocus,
}
