<!-- src/components/LeaveRequestHint.vue：填請假單時，即時提示「這次申請的假別還剩多少、會不會超額」。
     只是提示（超額是否能送出由伺服器依該假別的設定決定，特休超過剩餘時數一律無法送出），不會停用送出按鈕。
     只用在請假表單（Approval.vue 以表單性質判斷），加班、補休等表單即使有「假別」「時數」欄位也不顯示。
     有請假結束日（endDate）時，另外提醒請假期間涵蓋的年度公司行事曆是否尚未核定（國定假日可能調整）。 -->
<template>
  <div v-if="result || calendarNotice" class="leave-request-hint-group">
    <el-alert
      v-if="result"
      :type="alertType"
      :closable="false"
      show-icon
      class="leave-request-hint"
      data-test="leave-request-hint"
      :title="result.text"
    />
    <el-alert
      v-if="calendarNotice"
      type="info"
      :closable="false"
      show-icon
      class="leave-request-hint"
      data-test="leave-calendar-provisional"
      :title="calendarNotice"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { apiFetch } from '../api'
import { evaluateRequest, matchBalanceItem } from '../utils/leaveBalance'
import { toTaipeiDateKey } from '../utils/leaveHours'

const props = defineProps({
  // 餘額列表（GET /api/approvals/leave-balances 的 items）
  items: { type: Array, default: () => [] },
  // 申請人選的假別（名稱）
  typeText: { type: String, default: '' },
  // 申請的時數
  hours: { type: [Number, String], default: null },
  // 請假結束日（日期或日期時間）：用來檢查請假期間的年度公司行事曆是否已核定
  endDate: { type: [String, Date, Number], default: null },
})

// 年度行事曆狀態最多查 3 年（伺服器的上限）
const MAX_STATUS_YEARS = 3
const STATUS_DEBOUNCE_MS = 300

const result = computed(() => {
  const requested = Number(props.hours)
  if (!(requested > 0) || !props.typeText) return null
  const item = matchBalanceItem(props.items, props.typeText)
  if (!item) return null
  return evaluateRequest(item, props.items, requested)
})

const alertType = computed(() => {
  if (!result.value) return 'info'
  if (result.value.level === 'error') return 'error'
  if (result.value.level === 'warning') return 'warning'
  return 'info'
})

/* ---------- 年度公司行事曆是否已核定 ---------- */

// 年度 -> 是否尚未核定（同一張單改來改去不必重複查詢）
const yearStates = new Map()
const provisionalYears = ref([])
let timer = null
let requestSeq = 0

const calendarNotice = computed(() => (
  provisionalYears.value.length
    ? `請假期間涵蓋 ${provisionalYears.value.join('、')} 年，公司行事曆尚未核定，國定假日可能調整`
    : ''
))

function yearsBetween(fromKey, toKey) {
  const years = []
  for (let year = Number(fromKey.slice(0, 4)); year <= Number(toKey.slice(0, 4)); year += 1) years.push(year)
  return years
}

async function refreshCalendarStatus() {
  const seq = ++requestSeq
  const today = toTaipeiDateKey(new Date())
  const endKey = props.endDate ? toTaipeiDateKey(props.endDate) : null
  // 已經過去的請假不提醒；超過 3 年的範圍伺服器不受理，也不提醒
  if (!today || !endKey || endKey < today) {
    provisionalYears.value = []
    return
  }
  const years = yearsBetween(today, endKey)
  if (years.length > MAX_STATUS_YEARS) {
    provisionalYears.value = []
    return
  }
  if (years.some((year) => !yearStates.has(year))) {
    try {
      const res = await apiFetch(`/api/holiday-calendar/status?from=${today}&to=${endKey}`)
      if (seq !== requestSeq) return
      if (!res?.ok) {
        provisionalYears.value = []
        return
      }
      const body = await res.json()
      for (const entry of body?.years || []) yearStates.set(Number(entry.year), entry.state !== 'approved')
    } catch (error) {
      // 查不到行事曆狀態只是少一個提醒，不影響填單
      if (seq === requestSeq) provisionalYears.value = []
      return
    }
  }
  if (seq !== requestSeq) return
  provisionalYears.value = years.filter((year) => yearStates.get(year) === true)
}

watch(
  () => props.endDate,
  () => {
    clearTimeout(timer)
    timer = setTimeout(refreshCalendarStatus, STATUS_DEBOUNCE_MS)
  },
  { immediate: true },
)

onBeforeUnmount(() => clearTimeout(timer))
</script>

<style scoped>
.leave-request-hint {
  margin-top: 8px;
}
</style>
