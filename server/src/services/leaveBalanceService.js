// 假別餘額：每位員工、每個假別的「額度 / 已使用 / 簽核中 / 剩餘」（單位是小時，天數是 時數 / 8 的換算）。
// - 特休：額度與已使用取自員工資料（系統在簽核核准時原子扣減的計數），簽核中的時數從單據算。
// - 調休：取自調休存摺（services/compensatoryLeaveService，不分年度），簽核中的時數從所有年度的調休單據算。
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
import { creditPolicyOf, loadEmployeeCredits, summarizeCredits } from './compensatoryLeaveService.js'
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

// 這張單落在指定年度（台灣曆年）的時數：有請假日期就逐日加總，沒有日期的舊資料用送簽日期歸屬年度（與薪資、報表相同）；
// year 是 null 時不分年度（調休存摺），回傳整張單的時數
function hoursInYear({ row, formData, ids, year, hoursPerDay }) {
  if (year === null) {
    return computeLeaveRequestHours({
      formData,
      leaveFields: { startId: ids.startIds[0], endId: ids.endIds[0], daysId: ids.daysIds[0], hoursId: ids.hoursIds[0] },
    }).hours
  }
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
 * 員工在 year 年（台灣曆年；null 表示不分年度）已核准與簽核中的請假時數，依假別規則分類。
 * statuses 預設是已核准與簽核中（只算簽核中時傳 ['pending']）。
 * 回傳 { byKey: Map(假別代號 -> { approved, pending }), unmatched: Map(假別名稱 -> { approved, pending }), dictionaryNames: [],
 *   pendingAnyYear: Map(假別代號 -> 不分年度的簽核中時數) }；
 * dictionaryNames 是所有請假表單的假別選項名稱（員工選得到的假別）；pendingAnyYear 給不分年度的調休存摺用（同一次查詢算出來，不另外查）。
 */
export async function computeLeaveUsage({ employeeId, policy, year, excludeRequestId = null, infos = null, statuses = COUNTED_STATUSES }) {
  const leaveInfos = infos || await leaveFieldService.getAllLeaveFieldInfos()
  const hoursPerDay = LEAVE_DAY_EQUIVALENT_HOURS
  const byKey = new Map()
  const unmatched = new Map()
  const pendingAnyYear = new Map()
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
      status: { $in: statuses },
    })
    if (query && typeof query.select === 'function') {
      query = query.select(['status', 'createdAt', 'form_data.days', 'form_data.duration', 'form_data.hours']
        .concat(candidateSelectKeys(ids.startIds, ids.endIds, ids.typeIds, ids.daysIds, ids.hoursIds).map(id => `form_data.${id}`))
        .join(' '))
    }
    const rows = (query && typeof query.lean === 'function' ? await query.lean() : await query) || []

    for (const row of rows) {
      if (exclude && normalizeId(row._id) === exclude) continue
      if (!statuses.includes(row.status)) continue
      const formData = row.form_data && typeof row.form_data === 'object' ? row.form_data : {}
      const names = collectLeaveTypeNames(pickFieldValue(formData, ids.typeIds), info.typeOptions)
      if (!names.length) continue
      const matched = matchLeaveType(names, policy.types)
      if (matched && row.status === 'pending') {
        const anyYear = year === null ? null : hoursInYear({ row, formData, ids, year: null, hoursPerDay })
        if (anyYear > 0) pendingAnyYear.set(matched.key, roundHours((pendingAnyYear.get(matched.key) || 0) + anyYear))
      }
      const hours = hoursInYear({ row, formData, ids, year, hoursPerDay })
      if (!(hours > 0)) continue
      if (year === null && matched && row.status === 'pending') {
        pendingAnyYear.set(matched.key, roundHours((pendingAnyYear.get(matched.key) || 0) + hours))
      }
      if (matched) addToBucket(byKey, matched.key, row.status, hours)
      else addToBucket(unmatched, names[names.length - 1], row.status, hours)
    }
  }
  return { byKey, unmatched, dictionaryNames: [...dictionaryNames], pendingAnyYear }
}

/** 調休假別（調休存摺）在假別規則裡的那一筆；沒有回傳 null */
export function findCompLeaveType(policy) {
  return (policy?.types || []).find(leaveType => leaveType.source === 'comp_bank' && leaveType.enabled !== false) || null
}

/**
 * 員工簽核中的調休申請時數（不分年度：調休存摺不是年度額度）。excludeRequestId：略過這張單（簽核畫面看「核准前」）。
 */
export async function computeCompLeavePendingHours({ employeeId, policy, excludeRequestId = null, infos = null }) {
  const compType = findCompLeaveType(policy)
  if (!compType) return 0
  const usage = await computeLeaveUsage({ employeeId, policy, year: null, excludeRequestId, infos, statuses: ['pending'] })
  return roundHours(usage.byKey.get(compType.key)?.pending || 0)
}

/**
 * 員工調休存摺的合計（不含每一筆的明細）：{ earnedHours, usedHours, balanceHours, expiredHours, credits, conflicts, pendingHours, availableHours, expiryMonths }。
 */
export async function summarizeCompLeaveBank({ employeeId, policy, pendingHours = 0, now = new Date() }) {
  const { expiryMonths } = creditPolicyOf(policy)
  const credits = await loadEmployeeCredits(employeeId, { includeVoid: false })
  const summary = summarizeCredits(credits, { todayKey: toTaipeiDateKey(now), expiryMonths })
  const pending = roundHours(Math.max(Number(pendingHours) || 0, 0))
  return { ...summary, pendingHours: pending, availableHours: roundHours(summary.balanceHours - pending), expiryMonths }
}

/* ---------------------------- 組成餘額列表（純函式） ---------------------------- */

/**
 * 員工資料裡由人資維護的餘額（不是從單據算出來的）：目前只有積假（天數）。
 * 補休已改成調休存摺（系統累計，見 compensatoryLeaveService），員工資料的「補休時數」部署時轉入存摺，不再列在這裡。
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
 * bank：調休存摺的合計（summarizeCompLeaveBank）；沒有傳時調休顯示為 0。
 */
export function composeLeaveBalanceItems({ policy, usage, employee, focusKey = null, bank = null }) {
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
    } else if (leaveType.source === 'comp_bank') {
      // 調休存摺：累計取得、已使用（核准扣用、HR 指定、人資扣除）、剩餘都來自存摺，不分年度；簽核中的是所有年度的調休申請
      base.source = 'bank'
      base.enforcement = 'block'
      base.period = 'none'
      base.quotaHours = roundHours(bank?.earnedHours || 0)
      base.usedHours = roundHours(bank?.usedHours || 0)
      base.pendingHours = roundHours(bank?.pendingHours ?? own.pending)
      base.remainingHours = roundHours(bank?.balanceHours || 0)
      base.availableHours = roundHours(base.remainingHours - base.pendingHours)
      base.expiredHours = roundHours(bank?.expiredHours || 0)
      base.status = base.availableHours < 0 ? 'over' : 'bank'
      base.note = '調休存摺（不分年度）：國定假日適逢休息日／例假自動存入；超過可用時數不能送出'
    } else if (leaveType.eligibility === 'indigenous' && employee?.isIndigenous !== true) {
      // 原民假（原住民族歲時祭儀）限具原住民身分者：其他員工沒有額度，簽核中的時數照列，畫面標示「限具原住民身分者」
      base.quotaHours = 0
      base.remainingHours = 0
      base.availableHours = roundHours(-base.pendingHours)
      base.status = 'ineligible'
      base.note = '限具原住民身分者'
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
    // 存摺裡有任何額度（含已用完）就列出調休
    const heldAnnual = leaveType.source === 'comp_bank' && (base.quotaHours > 0 || base.remainingHours > 0)
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
 * - 調休：和存摺的可用時數（剩餘 - 簽核中）比（核准時扣用存摺再把關一次）。
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
  if (item.source === 'bank') {
    const basis = item.availableHours ?? 0
    if (requested > basis) {
      short = roundHours(requested - Math.max(basis, 0))
      reasons.push(sentence([
        `${item.name}存摺剩餘 ${formatHoursText(item.remainingHours ?? 0)}${item.pendingHours > 0 ? `、簽核中 ${formatHoursText(item.pendingHours)}` : ''}`,
        `可用 ${formatHoursText(Math.max(basis, 0))}`,
        `本次申請 ${formatHoursText(requested)}，將超出 ${formatHoursText(short)}`,
      ]))
    }
  } else if (item.period === 'event') {
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
  const person = employee || await Employee.findById(employeeId).select('name employeeId annualLeave isIndigenous').lean()
  if (!person) return null
  const activePolicy = policy || await getLeavePolicy()
  const personId = normalizeId(person._id ?? employeeId)
  const leaveInfos = infos || await leaveFieldService.getAllLeaveFieldInfos()
  const usage = await computeLeaveUsage({
    employeeId: personId,
    policy: activePolicy,
    year,
    excludeRequestId,
    infos: leaveInfos,
  })
  let bank = null
  const compType = findCompLeaveType(activePolicy)
  if (compType) {
    // 調休存摺不分年度：簽核中的時數用同一次查詢算出的「不分年度」時數
    const pendingHours = usage.pendingAnyYear?.get(compType.key) || 0
    try {
      bank = await summarizeCompLeaveBank({ employeeId: personId, policy: activePolicy, pendingHours })
    } catch (error) {
      // 餘額列表只是參考：存摺讀不到時調休先顯示 0（送出調休單時會另外讀存摺把關，讀不到就不放行）
      console.error(`[LeaveBalance] Compensatory leave bank skipped: ${error?.name || 'Error'}`)
      bank = { earnedHours: 0, usedHours: 0, balanceHours: 0, expiredHours: 0, pendingHours, availableHours: -pendingHours, unavailable: true }
    }
  }
  const { items, unmatched } = composeLeaveBalanceItems({ policy: activePolicy, usage, employee: person, focusKey, bank })
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
  // 簽核中的單：remainingBefore 是「這張單核准前」可用的時數（特休看剩餘、其他看可請時數）
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
  computeCompLeavePendingHours,
  summarizeCompLeaveBank,
  findCompLeaveType,
  collectEmployeeHeldBalances,
  composeLeaveBalanceItems,
  evaluateLeaveRequestAgainstBalance,
  buildLeaveBalances,
  describeRequestFocus,
}
