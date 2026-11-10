<template>
  <div class="my-schedule">
    <PageHeader title="我的排班">
      <template #actions>
        <div class="month-switch">
          <el-button :icon="ArrowLeft" aria-label="上個月" data-test="prev-month" @click="shiftMonth(-1)" />
          <el-date-picker
            v-model="selectedMonth"
            class="month-picker"
            type="month"
            value-format="YYYY-MM"
            format="YYYY/MM"
            :clearable="false"
            :editable="false"
          />
          <el-button :icon="ArrowRight" aria-label="下個月" data-test="next-month" @click="shiftMonth(1)" />
        </div>
      </template>
    </PageHeader>

    <p v-if="monthHint && hasPendingRows" class="month-hint" data-test="month-hint">{{ monthHint }}</p>

    <!-- 這個月班表的發布／確認進度，以及員工現在該做什麼 -->
    <section
      v-if="scheduleBanner"
      class="hr-section month-status"
      :class="`is-${scheduleBanner.type}`"
      data-test="month-status"
    >
      <div class="month-status__text">
        <strong class="month-status__title">{{ scheduleBanner.title }}</strong>
        <span v-if="scheduleBanner.message" class="month-status__message">{{ scheduleBanner.message }}</span>
        <span v-if="publishedAtText" class="month-status__meta">發布時間 {{ publishedAtText }}</span>
      </div>
      <el-button
        v-if="canRespond && confirmableRows.length"
        class="month-status__action"
        type="primary"
        data-test="confirm-all"
        :loading="bulkLoading"
        :disabled="Boolean(respondingId)"
        @click="handleBulkConfirm"
      >
        全部確認（{{ confirmableRows.length }} 天）
      </el-button>
    </section>

    <p v-if="loadError" class="hr-empty" data-test="load-error">
      班表載入失敗。
      <el-button link type="primary" @click="loadSchedules()">重新載入</el-button>
    </p>
    <p v-else-if="!loaded" class="hr-empty">載入中…</p>
    <p v-else-if="!schedules.length" class="hr-empty empty-text" data-test="empty">
      {{ monthLabel }} 還沒有班表，排班人員排好後會顯示在這裡
    </p>
    <ul v-else class="hr-section schedule-list" data-test="schedule-list">
      <li
        v-for="row in schedules"
        :key="row._id || row.date"
        class="schedule-row"
        :class="{
          'is-today': row.isToday,
          'is-off': row.isOff,
          'schedule-row--compact': canRespond && !canConfirm(row) && canDispute(row)
        }"
      >
        <div class="schedule-row__date">
          <span class="schedule-row__day">{{ row.dayText }}</span>
          <span class="schedule-row__weekday">（{{ row.weekday }}）</span>
          <span v-if="row.isToday" class="schedule-row__today">今天</span>
        </div>
        <div class="schedule-row__shift">
          <strong class="schedule-row__name">{{ row.shiftName || '未指定班別' }}</strong>
          <span v-if="row.shiftTime" class="schedule-row__time">{{ row.shiftTime }}</span>
          <span v-else-if="row.offLabel" class="schedule-row__time">{{ row.offLabel }}</span>
        </div>
        <el-tag
          class="schedule-row__status"
          disable-transitions
          :type="resolveStatus(row).type"
          :effect="resolveStatus(row).effect"
        >
          {{ resolveStatus(row).text }}
        </el-tag>
        <p v-if="row.responseNote" class="schedule-row__note">
          異議原因：{{ row.responseNote }}
          <span v-if="row.responseAt" class="note-time">（{{ row.responseAt }}）</span>
        </p>
        <!-- 只有現在能做的操作才顯示，不放按不了的按鈕 -->
        <div v-if="canRespond && (canConfirm(row) || canDispute(row))" class="schedule-row__actions">
          <el-button
            v-if="canConfirm(row)"
            type="primary"
            plain
            :loading="respondingId === row._id"
            :disabled="isBusy"
            @click="handleConfirm(row)"
          >
            確認
          </el-button>
          <!-- 已確認的日子仍可改提異議，但不是主要操作，用文字按鈕 -->
          <el-button
            v-if="canDispute(row)"
            :class="{ 'schedule-row__secondary': !canConfirm(row) }"
            :link="!canConfirm(row)"
            :disabled="isBusy"
            @click="openDispute(row)"
          >
            提出異議
          </el-button>
        </div>
      </li>
    </ul>

    <el-dialog
      v-model="disputeDialog.visible"
      title="提出異議"
      width="480px"
      align-center
      :close-on-click-modal="!respondingId"
      :close-on-press-escape="!respondingId"
      :show-close="!respondingId"
      @closed="resetDisputeDialog"
    >
      <p v-if="disputeDialog.schedule" class="dialog-target">
        {{ disputeDialog.schedule.date }}（{{ disputeDialog.schedule.weekday }}）
        <strong>{{ disputeDialog.schedule.shiftName || '未指定班別' }}</strong>
        {{ disputeDialog.schedule.shiftTime }}
      </p>
      <el-input
        v-model="disputeDialog.note"
        type="textarea"
        :rows="4"
        maxlength="500"
        show-word-limit
        placeholder="請說明這一天哪裡需要調整（必填）"
        @input="disputeDialog.error = ''"
      />
      <p v-if="disputeDialog.error" class="hr-hint dialog-error" data-test="dispute-error">{{ disputeDialog.error }}</p>
      <p v-else class="hr-hint">送出後這一天會標示為「已提出異議」，排班人員調整並重新發布後再請您確認。</p>
      <template #footer>
        <span class="dialog-footer">
          <el-button :disabled="Boolean(respondingId)" @click="disputeDialog.visible = false">取消</el-button>
          <el-button
            type="danger"
            data-test="dispute-submit"
            :loading="Boolean(respondingId) && respondingId === (disputeDialog.schedule?._id || '')"
            @click="submitDispute"
          >
            送出異議
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import PageHeader from '../../components/PageHeader.vue'
import { apiFetch } from '../../api'
import { getToken } from '../../utils/tokenService'
import { isNonWorkShift } from '../../utils/timeWindow'
import {
  formatScheduleDate,
  formatTaiwanDateTime,
  scheduleDateKey,
  taiwanDateKey,
  weekdayOfDateKey
} from '../../utils/dateFormatter'

const PUBLISHED_MONTH_HINT_KEY = 'my-schedule:published-month-hint'
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

// 不用上班的班別性質要顯示的說明（班別名稱已經寫明時不重複）
const OFF_DAY_LABELS = {
  rest_day: '休息日',
  regular_rest: '例假',
  holiday: '國定假日',
  leave: '請假'
}

// 伺服器的英文錯誤訊息改成員工看得懂的中文（中文訊息原樣顯示）
const RESPOND_ERROR_TEXT = {
  'schedule finalized': '這一天的班表已定案，無法再回覆',
  'schedule not awaiting confirmation': '這一天的班表目前不在待確認狀態，請重新整理後再試',
  'objection note required': '請輸入異議原因',
  'schedule not found': '找不到這筆班表，請重新整理後再試',
  'Not found': '找不到這筆班表，請重新整理後再試',
  forbidden: '只能回覆自己的班表',
  Forbidden: '這個帳號無法回覆班表',
  unauthorized: '登入已失效，請重新登入'
}

const schedules = ref([])
const shiftMap = ref({})
const selectedMonth = ref(taiwanDateKey(new Date()).slice(0, 7))
const respondingId = ref('')
const bulkLoading = ref(false)
const disputeDialog = reactive({ visible: false, schedule: null, note: '', error: '' })
const monthHint = ref('')
const hasAutoSwitched = ref(false)
const loaded = ref(false)
const loadError = ref(false)
let loadSequence = 0

const isBusy = computed(() => Boolean(respondingId.value) || bulkLoading.value)

const monthLabel = computed(() => String(selectedMonth.value || '').replace('-', '/'))

function readTokenPayload(token) {
  if (!token) return null
  try {
    return JSON.parse(atob(token.split('.')[1]))
  } catch (err) {
    return null
  }
}

// 回覆班表的 API 只開放給員工與主管；管理員帳號不顯示確認／異議按鈕
const canRespond = computed(() => readTokenPayload(getToken())?.role !== 'admin')

function formatShiftLabel(shift) {
  if (!shift) return ''
  const name = (shift.name || '').trim()
  const code = (shift.code || '').trim()
  if (name && code) return `${name} (${code})`
  return name || code
}

function normalizeClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/)
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : ''
}

// 班別的上下班時間；結束時間不晚於開始時間就是跨到隔天
function formatShiftTime(shift) {
  if (!shift || isNonWorkShift(shift)) return ''
  const start = normalizeClock(shift.startTime)
  const end = normalizeClock(shift.endTime)
  if (!start || !end) return ''
  return end <= start ? `${start}–翌日 ${end}` : `${start}–${end}`
}

function resolveStatus(row) {
  if (!row) return { text: '未發布', type: 'info', effect: 'plain' }
  if (row.state === 'finalized') {
    return { text: '已定案', type: 'success', effect: 'light' }
  }
  if (row.state === 'changes_requested' || row.employeeResponse === 'disputed') {
    return { text: '已提出異議', type: 'danger', effect: 'dark' }
  }
  if (row.state === 'pending_confirmation') {
    if (row.employeeResponse === 'confirmed') {
      return { text: '已確認', type: 'success', effect: 'light' }
    }
    // 需要員工處理的狀態用實心標籤，一眼看得到
    return { text: '待確認', type: 'warning', effect: 'dark' }
  }
  return { text: '未發布', type: 'info', effect: 'plain' }
}

const isDisputed = item => item.state === 'changes_requested' || item.employeeResponse === 'disputed'

const scheduleBanner = computed(() => {
  const list = schedules.value
  if (!list.length) return null
  const total = list.length
  const finalized = list.filter(item => item.state === 'finalized').length
  const disputed = list.filter(item => item.state !== 'finalized' && isDisputed(item)).length
  const pending = list.filter(item => isPendingConfirmation(item)).length
  const drafts = list.filter(item => item.state === 'draft').length

  if (pending) {
    if (!canRespond.value) {
      return { type: 'info', title: `有 ${pending} 天待確認`, message: '管理員帳號不需在這裡確認班表。' }
    }
    return {
      type: 'warning',
      title: `有 ${pending} 天待您確認`,
      message: disputed
        ? `確認無誤請按「全部確認」，有問題的日子請提出異議。另有 ${disputed} 天已提出異議。`
        : '確認無誤請按「全部確認」，有問題的日子請提出異議。'
    }
  }
  if (disputed) {
    return {
      type: 'danger',
      title: `已對 ${disputed} 天提出異議`,
      message: '排班人員調整並重新發布後，會再請您確認。'
    }
  }
  if (finalized === total) {
    return { type: 'success', title: '本月班表已定案', message: '' }
  }
  if (drafts === total) {
    return { type: 'info', title: '班表尚未發布', message: '發布後會請您確認，在那之前內容可能調整。' }
  }
  if (drafts) {
    return { type: 'info', title: `有 ${drafts} 天調整中`, message: '排班人員重新發布後，會再請您確認。' }
  }
  return { type: 'success', title: '已全部確認', message: '等待排班人員完成發布。' }
})

// 這個月最近一次發布的時間（台灣時間）
const publishedAtText = computed(() => {
  const latest = schedules.value
    .map(item => (item.publishedAtRaw ? new Date(item.publishedAtRaw).getTime() : NaN))
    .filter(time => !Number.isNaN(time))
    .reduce((max, time) => Math.max(max, time), 0)
  return latest ? formatTaiwanDateTime(latest) : ''
})

const canConfirm = row =>
  row?.state === 'pending_confirmation' &&
  row?.employeeResponse !== 'confirmed' &&
  row?.state !== 'changes_requested' &&
  row?.state !== 'finalized' &&
  respondingId.value !== row?._id

const canDispute = row =>
  row?.state === 'pending_confirmation' &&
  row?.employeeResponse !== 'disputed' &&
  row?.state !== 'finalized' &&
  respondingId.value !== row?._id

const confirmableRows = computed(() => schedules.value.filter(item => canConfirm(item)))

const hasPendingRows = computed(() => schedules.value.some(isPendingConfirmation))

// 確認框開著的時候再點一次（手機連點）不再開第二個
let confirmPromptOpen = false

async function askConfirmation(message, title) {
  if (confirmPromptOpen) return false
  confirmPromptOpen = true
  try {
    await ElMessageBox.confirm(message, title, {
      type: 'success',
      confirmButtonText: '確認',
      cancelButtonText: '取消'
    })
    return true
  } catch (err) {
    return false
  } finally {
    confirmPromptOpen = false
  }
}

function describeRespondError(error, fallback) {
  if (typeof error === 'string' && /[一-鿿]/.test(error)) return error
  return (typeof error === 'string' && RESPOND_ERROR_TEXT[error]) || fallback
}

async function respondToSchedulesBulkRequest(scheduleIds, action, note = '') {
  if (!Array.isArray(scheduleIds) || !scheduleIds.length) return
  bulkLoading.value = true
  try {
    const res = await apiFetch('/api/schedules/respond/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleIds, response: action, note })
    })
    const payload = res ? await res.json().catch(() => null) : null
    if (!res?.ok) {
      throw new Error(describeRespondError(payload?.error, '批次操作失敗'))
    }
    const count = typeof payload?.count === 'number'
      ? payload.count
      : scheduleIds.length
    ElMessage.success(`已批次確認 ${count} 筆班表`)
    await loadSchedules()
  } catch (err) {
    ElMessage.error(err?.message || '批次操作失敗')
    // 失敗多半是畫面上的狀態過時了（例如班表剛被重新發布），重新讀取
    await loadSchedules()
    throw err
  } finally {
    bulkLoading.value = false
  }
}

// 一次確認這個月所有待確認的班表
async function handleBulkConfirm() {
  if (isBusy.value) return
  const ids = confirmableRows.value.map(item => item?._id).filter(Boolean)
  if (!ids.length) return
  const confirmed = await askConfirmation(
    `確認 ${monthLabel.value} 待確認的 ${ids.length} 天班表嗎？`,
    '全部確認'
  )
  if (!confirmed || isBusy.value) return

  try {
    await respondToSchedulesBulkRequest(ids, 'confirm')
  } catch (err) {
    // 已顯示錯誤訊息
  }
}

async function fetchShifts() {
  try {
    const res = await apiFetch('/api/shifts')
    const data = await res.json().catch(() => null)
    if (!res.ok) return
    const list = Array.isArray(data) ? data : []
    shiftMap.value = Object.fromEntries(
      list.map(s => [
        s._id,
        {
          name: s.name || '',
          code: s.code || '',
          startTime: s.startTime || '',
          endTime: s.endTime || '',
          crossDay: Boolean(s.crossDay),
          semanticType: s.semanticType || ''
        }
      ])
    )
  } catch (err) {
    console.error(err)
  }
}

function getUserIdFromToken(token) {
  const payload = readTokenPayload(token)
  if (!payload) return ''
  return payload.employeeId || payload.id || payload._id || payload.sub || ''
}

function isPendingConfirmation(item) {
  return item?.state === 'pending_confirmation' && item?.employeeResponse === 'pending'
}

function normalizeSchedules(rawList) {
  const source = Array.isArray(rawList) ? rawList : rawList?.schedules
  const list = Array.isArray(source) ? source : []
  const todayKey = taiwanDateKey(new Date())
  return list
    .map(s => {
      const shift = shiftMap.value[s.shiftId]
      const state = s.state || 'draft'
      const employeeResponse = s.employeeResponse || 'pending'
      const responseNote = s.responseNote || ''
      const responseAtRaw = s.responseAt || ''
      const dateKey = scheduleDateKey(s.date)
      const isOff = Boolean(shift) && isNonWorkShift(shift)
      const shiftName = formatShiftLabel(shift) || s.shiftName || ''
      const offLabel = isOff ? OFF_DAY_LABELS[String(shift.semanticType || '').toLowerCase()] || '' : ''
      return {
        ...s,
        // 班表日期是「哪一天」，不做時區換算；回覆與發布時間是時間點，一律顯示台灣時間
        date: formatScheduleDate(s.date),
        dateKey,
        dayText: dateKey ? dateKey.slice(5).replace('-', '/') : '',
        weekday: weekdayOfDateKey(dateKey),
        isToday: Boolean(dateKey) && dateKey === todayKey,
        shiftName,
        shiftTime: formatShiftTime(shift),
        isOff,
        offLabel: offLabel && !shiftName.includes(offLabel) ? offLabel : '',
        state,
        employeeResponse,
        responseNote,
        responseAt: responseAtRaw ? formatTaiwanDateTime(responseAtRaw) : '',
        responseAtRaw,
        publishedAt: s.publishedAt ? formatTaiwanDateTime(s.publishedAt) : '',
        publishedAtRaw: s.publishedAt || ''
      }
    })
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0))
}

function consumePublishedMonthHint() {
  const urlHint = new URLSearchParams(window.location.search).get('publishedMonth')
  if (urlHint && MONTH_PATTERN.test(urlHint)) {
    return urlHint
  }
  const saved = localStorage.getItem(PUBLISHED_MONTH_HINT_KEY)
  if (!saved) return ''
  localStorage.removeItem(PUBLISHED_MONTH_HINT_KEY)
  return MONTH_PATTERN.test(saved) ? saved : ''
}

async function fetchSchedulesByMonth(userId, month) {
  const params = new URLSearchParams({ month })
  params.set('employee', userId)
  const res = await apiFetch(`/api/schedules/monthly?${params.toString()}`)
  if (!res?.ok) throw new Error('failed to load schedules')
  const data = await res.json().catch(() => [])
  return normalizeSchedules(data)
}

function addMonths(month, delta) {
  const [year, monthIndex] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}

function shiftMonth(delta) {
  if (!MONTH_PATTERN.test(selectedMonth.value || '')) return
  selectedMonth.value = addMonths(selectedMonth.value, delta)
}

async function respondToSchedule(scheduleId, action, note = '') {
  if (!scheduleId) return
  respondingId.value = scheduleId
  try {
    const res = await apiFetch(`/api/schedules/${scheduleId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: action, note })
    })
    const payload = res ? await res.json().catch(() => null) : null
    if (!res?.ok) {
      throw new Error(describeRespondError(payload?.error, '回覆失敗'))
    }
    ElMessage.success(action === 'confirm' ? '已確認班表' : '異議已送出')
    await loadSchedules()
  } catch (err) {
    ElMessage.error(err?.message || '回覆失敗')
    // 失敗多半是畫面上的狀態過時了，重新讀取
    await loadSchedules()
    throw err
  } finally {
    respondingId.value = ''
  }
}

async function handleConfirm(row) {
  if (!row?._id || isBusy.value) return
  const confirmed = await askConfirmation(`確認 ${row.date} 的班表安排嗎？`, '確認排班')
  // 確認框開著的時候可能已經送出別的回覆
  if (!confirmed || isBusy.value) return
  try {
    await respondToSchedule(row._id, 'confirm')
  } catch (err) {
    // 已顯示錯誤訊息
  }
}

function openDispute(row) {
  if (!row?._id || isBusy.value) return
  disputeDialog.schedule = row
  disputeDialog.note = row.responseNote || ''
  disputeDialog.error = ''
  disputeDialog.visible = true
}

function resetDisputeDialog() {
  disputeDialog.schedule = null
  disputeDialog.note = ''
  disputeDialog.error = ''
}

async function submitDispute() {
  if (isBusy.value) return
  const scheduleId = disputeDialog.schedule?._id
  if (!scheduleId) {
    disputeDialog.visible = false
    disputeDialog.note = ''
    return
  }
  const trimmed = (disputeDialog.note || '').trim()
  if (!trimmed) {
    disputeDialog.error = '請輸入異議原因'
    return
  }
  try {
    await respondToSchedule(scheduleId, 'dispute', trimmed)
    disputeDialog.visible = false
    disputeDialog.note = ''
    disputeDialog.schedule = null
  } catch (err) {
    // 錯誤已提示
  }
}

async function loadSchedules({ allowAutoSwitch = false } = {}) {
  const token = getToken()
  if (!token) return
  const month = selectedMonth.value
  if (!MONTH_PATTERN.test(month || '')) return
  // 快速切換月份時，較早送出的請求比較晚回來不能蓋掉新的月份
  const sequence = ++loadSequence
  try {
    await fetchShifts()
    const userId = getUserIdFromToken(token)
    if (!userId) {
      loaded.value = true
      return
    }
    const currentMonthSchedules = await fetchSchedulesByMonth(userId, month)
    if (sequence !== loadSequence) return
    schedules.value = currentMonthSchedules
    loaded.value = true
    loadError.value = false

    if (!allowAutoSwitch || hasAutoSwitched.value) return
    const hasPending = currentMonthSchedules.some(isPendingConfirmation)
    if (hasPending) return

    const nextMonth = addMonths(month, 1)
    let nextMonthSchedules = []
    try {
      nextMonthSchedules = await fetchSchedulesByMonth(userId, nextMonth)
    } catch (err) {
      // 只是順便看下個月有沒有待確認，讀不到就留在本月
      return
    }
    if (sequence !== loadSequence) return
    const nextMonthHasPending = nextMonthSchedules.some(isPendingConfirmation)
    if (nextMonthHasPending) {
      hasAutoSwitched.value = true
      monthHint.value = `${nextMonth.replace('-', '/')} 有待確認的班表，已為您切換到該月。`
      selectedMonth.value = nextMonth
    }
  } catch (err) {
    console.error(err)
    if (sequence !== loadSequence) return
    schedules.value = []
    loaded.value = true
    loadError.value = true
  }
}

onMounted(async () => {
  const hintMonth = consumePublishedMonthHint()
  if (hintMonth && hintMonth !== selectedMonth.value) {
    monthHint.value = `${hintMonth.replace('-', '/')} 有待確認的班表，已為您切換到該月。`
    selectedMonth.value = hintMonth
    hasAutoSwitched.value = true
    return
  }
  await loadSchedules({ allowAutoSwitch: true })
})

watch(selectedMonth, () => loadSchedules())
</script>

<style scoped>
.my-schedule {
  max-width: 960px;
  margin: 0 auto;
}

.month-switch {
  display: flex;
  align-items: center;
  gap: var(--hr-space-sm);
  width: 100%;
}

.month-switch :deep(.month-picker) {
  flex: 1 1 140px;
  width: 140px;
  min-width: 0;
}

.month-switch :deep(.el-button) {
  margin-left: 0;
}

.month-hint {
  margin: 0 0 var(--hr-space-sm);
  font-size: 13px;
  color: var(--hr-gray-600);
}

/* 發布／確認進度 */
.month-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hr-space-sm) var(--hr-space-md);
  margin-bottom: var(--hr-space-md);
  border-left-width: 4px;
}

.month-status.is-warning {
  border-left-color: var(--hr-warning);
}

.month-status.is-danger {
  border-left-color: var(--hr-error);
}

.month-status.is-success {
  border-left-color: var(--hr-success);
}

/* 一般資訊用中性的灰色（和「未發布」等資訊標籤一致；以前是藍色，全站沒有別的地方用藍色） */
.month-status.is-info {
  border-left-color: var(--hr-gray-400);
}

.month-status__text {
  display: flex;
  flex: 1 1 240px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.month-status__title {
  font-size: var(--hr-font-size-base);
  color: var(--hr-gray-900);
}

.month-status__message {
  font-size: var(--hr-font-size-sm);
  color: var(--hr-gray-600);
}

.month-status__meta {
  font-size: 12px;
  color: var(--hr-gray-500);
}

.month-status__action {
  min-height: 40px;
}

/* 每一天一列；手機改成上下排的卡片 */
.schedule-list {
  margin: 0;
  padding: 0 var(--hr-space-md);
  list-style: none;
}

.schedule-row {
  display: grid;
  /* 狀態、操作欄固定寬度，每一列的狀態標籤才會對齊 */
  grid-template-columns: 130px minmax(0, 1fr) 96px 170px;
  grid-template-areas:
    'date shift status actions'
    'note note note note';
  align-items: center;
  gap: 4px var(--hr-space-md);
  padding: 12px 0;
  border-top: 1px solid var(--hr-gray-100);
  font-size: var(--hr-font-size-sm);
  color: var(--hr-gray-800);
}

.schedule-row:first-child {
  border-top: 0;
}

.schedule-row__date {
  grid-area: date;
  font-variant-numeric: tabular-nums;
}

.schedule-row__day {
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-900);
}

.schedule-row__weekday {
  color: var(--hr-gray-500);
}

.schedule-row__today {
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: var(--hr-radius-sm);
  background: var(--hr-primary);
  font-size: 12px;
  color: var(--hr-white);
}

.schedule-row__shift {
  display: flex;
  flex-wrap: wrap;
  grid-area: shift;
  align-items: baseline;
  gap: 2px 8px;
  min-width: 0;
}

.schedule-row__name {
  color: var(--hr-gray-900);
}

.schedule-row__time {
  font-variant-numeric: tabular-nums;
  color: var(--hr-gray-600);
}

.schedule-row.is-off .schedule-row__name {
  font-weight: var(--hr-font-weight-normal);
  color: var(--hr-gray-500);
}

.schedule-row__status {
  grid-area: status;
  justify-self: start;
}

/* Element Plus 預設的灰色標籤字太淡，看起來像空白 */
.schedule-row__status.el-tag--info {
  border-color: var(--hr-gray-300);
  color: var(--hr-gray-600);
}

.schedule-row__note {
  grid-area: note;
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: var(--hr-gray-700);
}

.note-time {
  font-size: 12px;
  color: var(--hr-gray-500);
}

.schedule-row__actions {
  display: flex;
  grid-area: actions;
  gap: var(--hr-space-sm);
  justify-content: flex-end;
}

.schedule-row__actions :deep(.el-button) {
  margin-left: 0;
}

.dialog-target {
  margin: 0 0 12px;
  font-size: var(--hr-font-size-sm);
  color: var(--hr-gray-700);
}

.dialog-error {
  color: var(--hr-error);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--hr-space-sm);
}

.dialog-footer :deep(.el-button) {
  min-height: 40px;
  margin-left: 0;
}

@media (max-width: 767px) {
  .month-status__action {
    width: 100%;
    min-height: 44px;
  }

  .schedule-list {
    padding: 0 12px;
  }

  .schedule-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'date status'
      'shift shift'
      'note note'
      'actions actions';
  }

  .schedule-row__status {
    justify-self: end;
  }

  /* 手機上操作按鈕各佔一半、高度 44px，單手好按 */
  .schedule-row__actions {
    margin-top: 4px;
  }

  .schedule-row__actions :deep(.el-button) {
    flex: 1 1 0;
    min-height: 44px;
  }

  /* 已確認的日子只剩「提出異議」文字按鈕：放在班別那一列的右邊，不另外佔一列 */
  .schedule-row--compact {
    grid-template-areas:
      'date status'
      'shift actions'
      'note note';
  }

  .schedule-row--compact .schedule-row__actions {
    margin-top: 0;
  }

  .schedule-row__actions :deep(.schedule-row__secondary) {
    flex: 0 0 auto;
    padding: 0 4px;
  }

  .dialog-footer :deep(.el-button) {
    flex: 1 1 0;
    min-height: 44px;
  }
}
</style>
