// 假別額度規則（leavePolicy）：預設值在 config/leavePolicyConfig.js，管理員調整後存在其他控制設定的 leavePolicy 區塊。
// 這裡負責：合併預設值與已存的設定（依 key）、驗證管理員送來的設定、假別名稱比對、帶快取的讀取。
import {
  ANNUAL_LEAVE_TYPE_ALIASES,
  LEAVE_DISPLAYS,
  LEAVE_ENFORCEMENTS,
  LEAVE_PERIODS,
  LEAVE_POLICY_VERSION,
  MAX_HOURS_PER_DAY_RANGE,
  MIN_UNIT_HOUR_CHOICES,
  cloneDefaultLeavePolicy,
} from '../config/leavePolicyConfig.js'
// 用命名空間匯入：別的測試把設定存取層換成只有部分函式的替身時，這裡不會因為缺少匯出而載入失敗
import * as settingsStore from './otherControlSettingsStore.js'

const POLICY_CACHE_TTL_MS = 60 * 1000
const MAX_TYPES = 40
const MAX_ALIASES = 10
const MAX_NAME_LENGTH = 30
const MAX_NOTE_LENGTH = 200
const MAX_QUOTA_HOURS = 10000
const CUSTOM_KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/

// 管理員送來的設定有問題：訊息是繁體中文，由 controller 回 400
export class LeavePolicyValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LeavePolicyValidationError'
    this.status = 400
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 假別名稱比對用：全形轉半形、轉小寫、去掉空白與括號（「特休假（上午）」→「特休假上午」） */
export function normalizeLeaveName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s()[\]【】]/g, '')
}

function typeKeys(leaveType) {
  return [leaveType.name, ...(leaveType.aliases || [])].map(normalizeLeaveName).filter(Boolean)
}

/**
 * 把假別名稱（可能有好幾個，例如字典代碼與顯示名稱）對應到一個假別規則；對不到回傳 null。
 * 名稱或別名完全相同的優先，其次取「包含」的最長別名（「請事假」→ 事假、「公傷病假」→ 公傷病假而不是病假）。
 * 特休只認完全相同的名稱（「特休」「特休假」「特別休假」）：特休會從員工的特休時數扣減，名稱只是「包含」特休的不算，
 * 與扣減特休的判斷（services/leaveRequestDays.isAnnualLeaveType）、特休統計報表一致。
 * 停用的假別（enabled: false）不參與比對。
 */
export function matchLeaveType(names, types) {
  const candidates = (Array.isArray(names) ? names : [names]).map(normalizeLeaveName).filter(Boolean)
  const active = (types || []).filter(leaveType => leaveType && leaveType.enabled !== false)
  if (!candidates.length || !active.length) return null

  for (const candidate of candidates) {
    for (const leaveType of active) {
      if (typeKeys(leaveType).includes(candidate)) return leaveType
    }
  }

  let best = null
  for (const candidate of candidates) {
    for (const leaveType of active) {
      if (leaveType.source === 'employee_annual') continue
      for (const key of typeKeys(leaveType)) {
        if (key.length >= 2 && candidate.includes(key) && (!best || key.length > best.length)) {
          best = { length: key.length, leaveType }
        }
      }
    }
  }
  return best ? best.leaveType : null
}

/* ---------------------------- 讀取：合併預設值（寬鬆，壞資料退回預設） ---------------------------- */

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= maxLength ? text : null
}

function cleanAliases(value) {
  if (!Array.isArray(value)) return null
  const seen = new Set()
  const result = []
  for (const item of value) {
    const text = cleanText(item, MAX_NAME_LENGTH)
    const key = normalizeLeaveName(text)
    if (!text || !key || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= MAX_ALIASES) break
  }
  return result
}

function cleanCountsAgainst(value) {
  if (value === null) return null
  if (!isPlainObject(value) || typeof value.key !== 'string' || !value.key) return undefined
  const exemptHours = toFiniteNumber(value.exemptHours) ?? 0
  return { key: value.key, exemptHours: Math.min(Math.max(exemptHours, 0), MAX_QUOTA_HOURS) }
}

// 已存的設定疊在假別的預設值上；欄位不合法時保留預設值。builtin / key / source 不能被改（特休、補休的額度來源固定）
function mergeType(base, stored) {
  if (!isPlainObject(stored)) return base
  const merged = { ...base }
  const name = cleanText(stored.name, MAX_NAME_LENGTH)
  if (name && base.key !== 'annual') merged.name = name
  const aliases = cleanAliases(stored.aliases)
  if (aliases && base.key !== 'annual') merged.aliases = aliases
  if (stored.quotaHours === null) merged.quotaHours = null
  else {
    const quota = toFiniteNumber(stored.quotaHours)
    if (quota !== null && quota >= 0 && quota <= MAX_QUOTA_HOURS) merged.quotaHours = quota
  }
  if (LEAVE_PERIODS.includes(stored.period)) merged.period = stored.period
  if (LEAVE_ENFORCEMENTS.includes(stored.enforcement)) merged.enforcement = stored.enforcement
  if (LEAVE_DISPLAYS.includes(stored.display)) merged.display = stored.display
  const countsAgainst = cleanCountsAgainst(stored.countsAgainst)
  if (countsAgainst !== undefined) merged.countsAgainst = countsAgainst
  if (typeof stored.enabled === 'boolean') merged.enabled = stored.enabled
  if (typeof stored.note === 'string') merged.note = stored.note.slice(0, MAX_NOTE_LENGTH)
  return merged
}

function customTypeBase(key) {
  return {
    key,
    name: key,
    aliases: [],
    quotaHours: null,
    period: 'year',
    source: 'policy',
    enforcement: 'warn',
    display: 'always',
    countsAgainst: null,
    builtin: false,
    enabled: true,
    note: '',
  }
}

/**
 * 把資料庫內的 leavePolicy 疊在預設值之上，回傳完整的規則：
 * 內建假別依 key 合併（日後版本新增的內建假別會自動出現），自訂假別接在後面；已存的資料損毀時退回預設值，不讓畫面壞掉。
 */
export function normalizeLeavePolicy(stored) {
  const policy = cloneDefaultLeavePolicy()
  const source = isPlainObject(stored) ? stored : {}

  const maxHoursPerDay = toFiniteNumber(source.maxHoursPerDay)
  if (maxHoursPerDay !== null && maxHoursPerDay >= MAX_HOURS_PER_DAY_RANGE.min && maxHoursPerDay <= MAX_HOURS_PER_DAY_RANGE.max) {
    policy.maxHoursPerDay = maxHoursPerDay
  }
  const minUnitHours = toFiniteNumber(source.minUnitHours)
  if (minUnitHours !== null && MIN_UNIT_HOUR_CHOICES.includes(minUnitHours)) policy.minUnitHours = minUnitHours

  const storedTypes = Array.isArray(source.types) ? source.types.filter(item => isPlainObject(item) && typeof item.key === 'string') : []
  const byKey = new Map()
  for (const item of storedTypes) if (!byKey.has(item.key)) byKey.set(item.key, item)

  const builtinKeys = new Set(policy.types.map(item => item.key))
  const types = policy.types.map(base => mergeType(base, byKey.get(base.key)))
  for (const item of storedTypes) {
    if (builtinKeys.has(item.key) || !CUSTOM_KEY_PATTERN.test(item.key)) continue
    if (types.some(existing => existing.key === item.key)) continue
    types.push(mergeType(customTypeBase(item.key), item))
  }
  // countsAgainst 指向不存在的假別（被刪除）就拿掉，避免餘額計算找不到對象
  const keys = new Set(types.map(item => item.key))
  policy.types = types.map(item => (
    item.countsAgainst && (!keys.has(item.countsAgainst.key) || item.countsAgainst.key === item.key)
      ? { ...item, countsAgainst: null }
      : item
  ))
  policy.version = LEAVE_POLICY_VERSION
  return policy
}

/* ---------------------------- 寫入：驗證管理員送來的設定（嚴格，中文訊息） ---------------------------- */

function fail(message) {
  throw new LeavePolicyValidationError(message)
}

function requireText(value, label, maxLength) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) fail(`${label}不可空白`)
  if (text.length > maxLength) fail(`${label}不可超過 ${maxLength} 個字`)
  return text
}

/**
 * 驗證並整理管理員送來的假別規則，回傳完整的規則（內建假別沒送的欄位維持預設值）。
 * 有問題時丟出 LeavePolicyValidationError（繁體中文訊息）。
 */
export function validateLeavePolicyInput(input) {
  if (!isPlainObject(input)) fail('請提供假別規則內容')
  const policy = cloneDefaultLeavePolicy()

  if (input.maxHoursPerDay !== undefined) {
    const value = toFiniteNumber(input.maxHoursPerDay)
    if (value === null || value < MAX_HOURS_PER_DAY_RANGE.min || value > MAX_HOURS_PER_DAY_RANGE.max) {
      fail(`每日最多可請時數必須介於 ${MAX_HOURS_PER_DAY_RANGE.min} 至 ${MAX_HOURS_PER_DAY_RANGE.max} 小時`)
    }
    policy.maxHoursPerDay = value
  }
  if (input.minUnitHours !== undefined) {
    const value = toFiniteNumber(input.minUnitHours)
    if (value === null || !MIN_UNIT_HOUR_CHOICES.includes(value)) {
      fail(`請假最小單位只能是 ${MIN_UNIT_HOUR_CHOICES.join('、')} 小時`)
    }
    policy.minUnitHours = value
  }

  if (input.types !== undefined) {
    if (!Array.isArray(input.types)) fail('假別清單格式不正確')
    if (input.types.length > MAX_TYPES) fail(`假別最多 ${MAX_TYPES} 種`)

    const builtinByKey = new Map(policy.types.map(item => [item.key, item]))
    const seenKeys = new Set()
    const submitted = []
    for (const raw of input.types) {
      if (!isPlainObject(raw)) fail('假別清單格式不正確')
      const key = typeof raw.key === 'string' ? raw.key.trim() : ''
      if (!key) fail('假別缺少代號')
      if (seenKeys.has(key)) fail(`假別代號重複：${key}`)
      seenKeys.add(key)
      const builtin = builtinByKey.get(key)
      if (!builtin && !CUSTOM_KEY_PATTERN.test(key)) fail(`自訂假別的代號格式不正確：${key}`)

      const base = builtin ? { ...builtin } : customTypeBase(key)
      const item = { ...base }
      const isAnnual = key === 'annual'
      if (raw.name !== undefined && !isAnnual) item.name = requireText(raw.name, '假別名稱', MAX_NAME_LENGTH)
      if (!builtin && raw.name === undefined) fail('自訂假別需要名稱')
      if (raw.aliases !== undefined && !isAnnual) {
        if (!Array.isArray(raw.aliases)) fail(`「${item.name}」的別名格式不正確`)
        if (raw.aliases.length > MAX_ALIASES) fail(`「${item.name}」的別名最多 ${MAX_ALIASES} 個`)
        item.aliases = raw.aliases.map(alias => requireText(alias, `「${item.name}」的別名`, MAX_NAME_LENGTH))
      }
      if (raw.quotaHours !== undefined) {
        if (raw.quotaHours === null) item.quotaHours = null
        else {
          const quota = toFiniteNumber(raw.quotaHours)
          if (quota === null || quota < 0 || quota > MAX_QUOTA_HOURS) fail(`「${item.name}」的額度必須是 0 至 ${MAX_QUOTA_HOURS} 小時，或留空表示不設上限`)
          item.quotaHours = quota
        }
      }
      for (const [field, allowed, label] of [
        ['period', LEAVE_PERIODS, '計算期間'],
        ['enforcement', LEAVE_ENFORCEMENTS, '超額處理'],
        ['display', LEAVE_DISPLAYS, '顯示方式'],
      ]) {
        if (raw[field] === undefined) continue
        if (!allowed.includes(raw[field])) fail(`「${item.name}」的${label}不正確`)
        item[field] = raw[field]
      }
      if (raw.enabled !== undefined) {
        if (typeof raw.enabled !== 'boolean') fail(`「${item.name}」的啟用設定不正確`)
        if (isAnnual && raw.enabled === false) fail('特休不能停用')
        item.enabled = raw.enabled
      }
      if (raw.note !== undefined) {
        if (typeof raw.note !== 'string') fail(`「${item.name}」的備註格式不正確`)
        if (raw.note.length > MAX_NOTE_LENGTH) fail(`「${item.name}」的備註不可超過 ${MAX_NOTE_LENGTH} 個字`)
        item.note = raw.note
      }
      if (raw.countsAgainst !== undefined) {
        if (raw.countsAgainst === null) item.countsAgainst = null
        else {
          if (!isPlainObject(raw.countsAgainst) || typeof raw.countsAgainst.key !== 'string') fail(`「${item.name}」併入計算的設定不正確`)
          const exempt = toFiniteNumber(raw.countsAgainst.exemptHours ?? 0)
          if (exempt === null || exempt < 0 || exempt > MAX_QUOTA_HOURS) fail(`「${item.name}」併入計算的免計時數必須是 0 至 ${MAX_QUOTA_HOURS} 小時`)
          item.countsAgainst = { key: raw.countsAgainst.key, exemptHours: exempt }
        }
      }
      // 自訂假別的額度來源固定是 policy；沒有額度的假別（不設上限）不需要檢查超額
      submitted.push(item)
    }

    // 內建假別沒送的維持預設；自訂假別接在後面（依送來的順序）
    const submittedByKey = new Map(submitted.map(item => [item.key, item]))
    const merged = policy.types.map(base => submittedByKey.get(base.key) || base)
    for (const item of submitted) if (!item.builtin) merged.push(item)
    policy.types = merged

    // 名稱與別名在所有假別之間不能重複（比對時才分得出是哪一種假別）
    const owners = new Map()
    for (const item of policy.types) {
      const seenInType = new Set()
      for (const key of typeKeys(item)) {
        if (seenInType.has(key)) continue
        seenInType.add(key)
        const owner = owners.get(key)
        if (owner && owner.key !== item.key) fail(`假別名稱或別名重複：「${owner.name}」與「${item.name}」`)
        owners.set(key, item)
      }
    }
    const keys = new Set(policy.types.map(item => item.key))
    for (const item of policy.types) {
      if (!item.countsAgainst) continue
      if (!keys.has(item.countsAgainst.key)) fail(`「${item.name}」併入計算的假別不存在`)
      if (item.countsAgainst.key === item.key) fail(`「${item.name}」不能併入自己`)
    }
    // 併入計算不可繞圈（A 併入 B、B 又併入 A）
    const byKey = new Map(policy.types.map(item => [item.key, item]))
    for (const item of policy.types) {
      const visited = new Set([item.key])
      let current = item.countsAgainst ? byKey.get(item.countsAgainst.key) : null
      while (current) {
        if (visited.has(current.key)) fail(`「${item.name}」的併入計算形成循環`)
        visited.add(current.key)
        current = current.countsAgainst ? byKey.get(current.countsAgainst.key) : null
      }
    }
  }

  policy.version = LEAVE_POLICY_VERSION
  return policy
}

/* ---------------------------- 帶快取的讀取與儲存 ---------------------------- */

let policyCache = null
let policyCacheGeneration = 0

export function resetLeavePolicyCache() {
  policyCache = null
  policyCacheGeneration += 1
}

/**
 * 目前生效的假別規則（預設值 + 管理員的調整）。60 秒快取，儲存時立即清除；
 * 讀取設定失敗（例如資料庫暫時有問題）時退回預設值，不讓請假流程跟著失敗。
 */
export async function getLeavePolicy({ fresh = false } = {}) {
  if (!fresh && policyCache && policyCache.expiresAt > Date.now()) return policyCache.policy
  const generation = policyCacheGeneration
  let policy
  try {
    const settings = typeof settingsStore.getSettings === 'function' ? await settingsStore.getSettings() : null
    policy = normalizeLeavePolicy(settings?.leavePolicy)
  } catch {
    policy = normalizeLeavePolicy(null)
  }
  if (generation === policyCacheGeneration) {
    policyCache = { policy, expiresAt: Date.now() + POLICY_CACHE_TTL_MS }
  }
  return policy
}

/** 驗證後存進其他控制設定的 leavePolicy 區塊，回傳完整的規則 */
export async function saveLeavePolicy(input) {
  const policy = validateLeavePolicyInput(input)
  await settingsStore.updateSettings((current) => {
    current.leavePolicy = policy
  })
  resetLeavePolicyCache()
  return normalizeLeavePolicy(policy)
}

export function getDefaultLeavePolicy() {
  return cloneDefaultLeavePolicy()
}

export { ANNUAL_LEAVE_TYPE_ALIASES }

export default {
  LeavePolicyValidationError,
  normalizeLeaveName,
  matchLeaveType,
  normalizeLeavePolicy,
  validateLeavePolicyInput,
  getLeavePolicy,
  saveLeavePolicy,
  resetLeavePolicyCache,
  getDefaultLeavePolicy,
}
