// 請假單的「時數」欄位自動帶入：開始或結束時間改變時，依起訖時間算出可請的時數放進時數欄位。
// - 時數欄位是空的，或還是上一次自動帶入的值，才會被覆蓋；申請人自己改過的時數不會被蓋掉。
// - 起訖時間不完整或結束早於開始時，自動帶入的值會清掉（手動輸入的不動）。
// - 先用本機的估算馬上帶入（日曆日、每天最多 maxHoursPerDay 小時）；有提供 fetchHint 時，再向伺服器取依班表算出的結果
//   （排 12 小時班的日子算 12 小時、休息日算 0）並更新上限與建議值。伺服器取不到就維持本機的估算。
// 申請頁與「修改並重新送出」視窗共用。
import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import {
  DEFAULT_MAX_HOURS_PER_DAY,
  DEFAULT_MIN_UNIT_HOURS,
  estimateLeaveHours,
  pickLeaveFormFields,
} from './leaveHours'

const isBlank = (value) => value === undefined || value === null || value === ''

/**
 * @param {object} options
 * @param {import('vue').Ref<Array>|Array} options.fields 表單欄位（含 is_active、type_1、label）
 * @param {() => object} options.getFormData 目前填寫的內容（欄位 id -> 值）
 * @param {(fieldId: string, value: any) => void} options.setValue 把值寫回表單
 * @param {() => ({ maxHoursPerDay?: number, minUnitHours?: number })} [options.getPolicy] 每日上限與最小單位（取自餘額回應）
 * @param {(start: any, end: any, types: { startType?: string, endType?: string }) => Promise<object|null>} [options.fetchHint]
 *   向伺服器取依班表算出的 { valid, maxHours, suggestedHours }
 * @param {number} [options.hintDelayMs] 起訖時間停止變動多久之後才向伺服器取
 */
export function useLeaveHoursAutofill({
  fields,
  getFormData,
  setValue,
  getPolicy = () => ({}),
  fetchHint = null,
  hintDelayMs = 250,
}) {
  let lastAuto = null
  let hintTimer = null
  let hintSeq = 0
  const hint = ref(null)

  const picked = computed(() => pickLeaveFormFields(unref(fields)))
  // 同時有開始、結束與時數欄位才算請假表單的時數帶入
  const enabled = computed(() => {
    const { startField, endField, hoursField } = picked.value
    return Boolean(startField && endField && hoursField && hoursField.is_active !== false)
  })

  const rangeValues = computed(() => {
    if (!enabled.value) return null
    const { startField, endField } = picked.value
    const data = getFormData() || {}
    return { start: data[startField._id], end: data[endField._id], startType: startField.type_1, endType: endField.type_1 }
  })

  const localEstimate = computed(() => {
    const range = rangeValues.value
    if (!range) return null
    const policy = getPolicy() || {}
    return estimateLeaveHours(range.start, range.end, {
      startType: range.startType,
      endType: range.endType,
      maxHoursPerDay: Number(policy.maxHoursPerDay) > 0 ? Number(policy.maxHoursPerDay) : DEFAULT_MAX_HOURS_PER_DAY,
      minUnitHours: Number(policy.minUnitHours) > 0 ? Number(policy.minUnitHours) : DEFAULT_MIN_UNIT_HOURS,
    })
  })

  // 伺服器依班表算出來的結果優先（只在起訖時間沒變的情況下才沿用）
  const estimate = computed(() => {
    const local = localEstimate.value
    if (!local) return null
    if (local.valid && hint.value) {
      return { ...local, maxHours: hint.value.maxHours, suggestedHours: hint.value.suggestedHours, fromSchedule: true }
    }
    return local
  })

  // 時數輸入框的上限（起訖時間讀得懂才有）
  const maxHours = computed(() => (estimate.value?.valid ? estimate.value.maxHours : undefined))

  function apply() {
    if (!enabled.value || !estimate.value) return
    const hoursField = picked.value.hoursField
    const current = (getFormData() || {})[hoursField._id]
    const untouched = isBlank(current) || (lastAuto !== null && Number(current) === lastAuto)
    if (!untouched) return
    if (estimate.value.valid && estimate.value.suggestedHours > 0) {
      lastAuto = estimate.value.suggestedHours
      if (Number(current) !== lastAuto) setValue(hoursField._id, lastAuto)
    } else if (lastAuto !== null) {
      lastAuto = null
      if (!isBlank(current)) setValue(hoursField._id, null)
    }
  }

  const signature = computed(() => {
    const info = estimate.value
    return info ? `${info.valid}|${info.suggestedHours}|${info.maxHours}` : ''
  })
  watch(signature, apply, { immediate: true })

  function cancelHint() {
    hintSeq += 1
    if (hintTimer) clearTimeout(hintTimer)
    hintTimer = null
  }

  // 起訖時間變了：舊的班表結果作廢，等停下來再向伺服器取一次
  const rangeKey = computed(() => {
    const range = rangeValues.value
    if (!range || !localEstimate.value?.valid) return ''
    const text = (value) => (value instanceof Date ? value.toISOString() : String(value ?? ''))
    return `${text(range.start)}|${text(range.end)}|${range.startType || ''}|${range.endType || ''}`
  })
  watch(rangeKey, (key) => {
    cancelHint()
    hint.value = null
    if (!key || typeof fetchHint !== 'function') return
    const seq = hintSeq
    const range = rangeValues.value
    hintTimer = setTimeout(async () => {
      try {
        const result = await fetchHint(range.start, range.end, { startType: range.startType, endType: range.endType })
        if (seq !== hintSeq) return
        if (result && result.valid) {
          hint.value = { maxHours: Number(result.maxHours) || 0, suggestedHours: Number(result.suggestedHours) || 0 }
        }
      } catch {
        // 取不到班表就維持本機的估算，不影響填單
      }
    }, hintDelayMs)
  }, { immediate: true })

  // 換了一張表單：上一張自動帶入的記錄不再有意義
  watch(() => picked.value.hoursField?._id, () => { lastAuto = null })

  if (getCurrentInstance()) onBeforeUnmount(cancelHint)

  return {
    estimate,
    maxHours,
    fields: picked,
    enabled,
    reset() { lastAuto = null },
  }
}

export default useLeaveHoursAutofill
