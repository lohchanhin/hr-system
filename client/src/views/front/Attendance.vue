<!-- src/views/front/Attendance.vue -->
<template>
  <div class="attendance-page">
    <PageHeader compact title="出勤打卡" :subtitle="currentDate">
      <template #stats>
        <span class="attendance-clock" data-test="attendance-clock">{{ currentTime }}</span>
      </template>
    </PageHeader>

    <!-- 今天的班別、打卡進度與四個打卡動作：手機第一屏就看得到全部 -->
    <section class="hr-section punch-section">
      <div class="shift-summary" data-test="shift-summary">
        <template v-if="shiftSummary">
          <span class="shift-summary__label">{{ shiftSummary.dayLabel }}</span>
          <strong class="shift-summary__name">{{ shiftSummary.name }}</strong>
          <span v-if="shiftSummary.time" class="shift-summary__time">{{ shiftSummary.time }}</span>
        </template>
        <span v-else class="shift-summary__label">{{ contextLoaded ? '今日未排班' : '載入班表中…' }}</span>
      </div>
      <p v-if="contextError" class="punch-status punch-status--error" data-test="context-error">
        班表載入失敗，無法判斷打卡時段。
        <el-button link type="primary" @click="loadScheduleContext">重新載入</el-button>
      </p>
      <p v-else-if="punchStatus" class="punch-status" data-test="punch-status">{{ punchStatus }}</p>
      <!-- 今天排的是休息日 / 例假 / 國定假日 / 請假時，明確告知不需打卡 -->
      <el-alert
        v-if="dayOffNotice"
        class="day-off-notice"
        type="info"
        show-icon
        :closable="false"
        :title="dayOffNotice"
      />
      <div class="punch-grid">
        <button
          v-for="card in punchCards"
          :key="card.key"
          type="button"
          class="punch-card"
          :class="{ disabled: card.disabled, 'is-next': card.next, 'is-done': card.done }"
          :aria-disabled="card.disabled ? 'true' : 'false'"
          :data-test="`punch-${card.key}`"
          @click="onPunch(card.key)"
        >
          <span class="punch-title">{{ card.label }}</span>
          <span class="punch-hint">{{ card.hint }}</span>
        </button>
      </div>
    </section>

    <section class="hr-section records-section">
      <h2 class="hr-section__title">今日打卡記錄</h2>
      <p v-if="recordsError" class="records-error" data-test="records-error">
        {{ recordsError }}
        <el-button link type="primary" @click="fetchRecords">重新載入</el-button>
      </p>
      <p v-if="!recordsLoaded && !recordsError" class="hr-empty">載入中…</p>
      <p v-else-if="recordsLoaded && !todayRecords.length" class="hr-empty" data-test="today-empty">
        今天還沒有打卡記錄
      </p>
      <ul v-else-if="recordsLoaded" class="record-list" data-test="today-records">
        <li v-for="row in todayRecords" :key="row.key" class="record-row">
          <span class="record-time">{{ row.dateKey === todayKey ? row.clock : `${row.shortDate} ${row.clock}` }}</span>
          <span class="record-action">{{ row.action }}</span>
          <el-tag v-if="row.showSource" size="small" disable-transitions :type="row.sourceTagType">{{ row.sourceLabel }}</el-tag>
          <span v-if="row.remark" class="record-remark">{{ row.remark }}</span>
        </li>
      </ul>
    </section>

    <!-- 之前幾天的記錄預設收合，不和今天的混在一起；展開時才向伺服器讀取 -->
    <section class="hr-section recent-section">
      <button
        type="button"
        class="recent-toggle"
        data-test="recent-toggle"
        :aria-expanded="recentOpen ? 'true' : 'false'"
        @click="toggleRecent"
      >
        <span class="hr-section__title recent-toggle__title">最近記錄</span>
        <span class="recent-toggle__meta">{{ recentMeta }}</span>
      </button>
      <div v-if="recentOpen" data-test="recent-records">
        <p v-if="recentError" class="records-error" data-test="recent-error">
          {{ recentError }}
          <el-button link type="primary" @click="fetchRecentRecords">重新載入</el-button>
        </p>
        <p v-if="!recentLoaded && !recentError" class="hr-empty">載入中…</p>
        <p v-else-if="recentLoaded && !recentGroups.length" class="hr-empty" data-test="recent-empty">
          近 {{ RECENT_DAYS }} 天沒有其他打卡記錄
        </p>
        <template v-if="recentLoaded">
          <div v-for="group in recentGroups" :key="group.dateKey" class="recent-group">
            <h3 class="recent-group__date">{{ group.label }}</h3>
            <ul class="record-list">
              <li v-for="row in group.rows" :key="row.key" class="record-row">
                <span class="record-time">{{ row.clock }}</span>
                <span class="record-action">{{ row.action }}</span>
                <el-tag v-if="row.showSource" size="small" disable-transitions :type="row.sourceTagType">{{ row.sourceLabel }}</el-tag>
                <span v-if="row.remark" class="record-remark">{{ row.remark }}</span>
              </li>
            </ul>
          </div>
        </template>
      </div>
    </section>

    <!-- 打卡前的確認（可順便寫備註）；送出中鎖住按鈕，連點不會打兩次 -->
    <el-dialog
      v-model="remarkDialogVisible"
      :title="pendingAction"
      width="400px"
      align-center
      :close-on-click-modal="!punchSubmitting"
      :close-on-press-escape="!punchSubmitting"
      :show-close="!punchSubmitting"
    >
      <p class="punch-confirm-time">{{ currentDate }} <strong>{{ currentTime }}</strong></p>
      <el-input
        v-model="remarkText"
        placeholder="備註（可留空）"
        maxlength="100"
        show-word-limit
      />
      <template #footer>
        <span class="dialog-footer">
          <el-button :disabled="punchSubmitting" @click="remarkDialogVisible = false">取消</el-button>
          <el-button
            type="primary"
            data-test="punch-confirm"
            :loading="punchSubmitting"
            @click="confirmRemark"
          >
            確認{{ pendingAction }}
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '../../components/PageHeader.vue'
import { apiFetch } from '../../api'
import { getToken } from '../../utils/tokenService'
import {
  computeActionWindow,
  computeShiftPunchRange,
  determineActionAvailability,
  formatWindow,
  getTimezone,
  resolveShiftPunches
} from '../../utils/timeWindow'
import {
  attendanceSourceLabel,
  attendanceSourceTagType,
  isAttendanceSourceNotable
} from '../../utils/attendanceSource'
import {
  formatTaiwanDateTime,
  formatTaiwanTime,
  getTaiwanParts,
  shiftDateKey,
  taiwanDateKey,
  weekdayOfDateKey
} from '../../utils/dateFormatter'

// 打卡動作：中文名稱與後端定義的值
const ACTIONS = [
  { key: 'clockIn', label: '上班簽到', verb: '簽到' },
  { key: 'clockOut', label: '下班簽退', verb: '簽退' },
  { key: 'outing', label: '外出登記' },
  { key: 'breakIn', label: '休息登記' }
]
const actionMap = Object.fromEntries(ACTIONS.map(item => [item.label, item.key]))
const reverseActionMap = Object.fromEntries(ACTIONS.map(item => [item.key, item.label]))

// 「最近記錄」顯示今天以前幾天的打卡
const RECENT_DAYS = 7
// 回到這一頁（手機從背景切回來）時，距離上次載入超過這個時間就重新讀取
const REFRESH_AFTER_MS = 30 * 1000
const CLOCK_SKEW_MS = 5 * 60 * 1000
const NO_SCHEDULE_REASON = '今日未設定班表，無法打卡'

// 伺服器的英文錯誤訊息改成員工看得懂的中文（中文訊息原樣顯示）
const PUNCH_ERROR_TEXT = {
  'Attendance action already recorded for this shift': label => `這一班已經有${label}記錄，不需重複打卡`,
  'Clock-in is required before clock-out': () => '尚未簽到，無法簽退',
  Forbidden: () => '無法替這個帳號打卡，請重新登入後再試',
  'Invalid user': () => '登入已失效，請重新登入',
  'Invalid schedule': () => '班表資料有誤，請聯絡管理員'
}

// records：今天與昨天（跨日班）的打卡，開頁就讀；recentRecords：前 7 天的打卡，展開「最近記錄」才讀
const records = ref([])
const recordsLoaded = ref(false)
const recordsError = ref('')
const recentRecords = ref([])
const recentLoaded = ref(false)
const recentError = ref('')
const recentOpen = ref(false)
const currentTime = ref('')
const currentDate = ref('')
const todayKey = ref('')
const nowMs = ref(Date.now())
let timeInterval = null
let lastMinuteKey = ''
let lastLoadedAt = 0
let recordsRequestId = 0
let recentRequestId = 0
let contextRequestId = 0

const remarkDialogVisible = ref(false)
const remarkText = ref('')
const pendingAction = ref('')
const shiftDefinitions = ref([])
const monthlySchedules = ref([])
const actionBuffers = ref()
const actionAvailability = ref(determineActionAvailability())
const contextLoaded = ref(false)
const contextError = ref(false)
const punchSubmitting = ref(false)

const dayOffNotice = computed(() => actionAvailability.value.dayOff?.reason || '')

function updateAvailability(now = new Date()) {
  nowMs.value = now.getTime()
  todayKey.value = taiwanDateKey(now)
  actionAvailability.value = determineActionAvailability({
    now,
    schedules: monthlySchedules.value,
    shifts: shiftDefinitions.value,
    timeZone: getTimezone(),
    actionBuffers: actionBuffers.value
  })
}

// 給「這一班打過卡了沒」用的精簡記錄（action 是後端的值）。
// 時間在未來的記錄（日期匯入錯誤之類）不能當成已經打過卡；容許幾分鐘的裝置時鐘誤差
const punchList = computed(() => records.value
  .filter(row => new Date(row.timestamp).getTime() <= nowMs.value + CLOCK_SKEW_MS)
  .map(row => ({
    action: row.actionKey,
    timestamp: row.timestamp,
    source: row.source
  })))

function punchesOf(context) {
  return resolveShiftPunches(punchList.value, context, actionBuffers.value)
}

function baseActionState(action) {
  return actionAvailability.value.actions?.[action] || { disabled: true, reason: NO_SCHEDULE_REASON }
}

// 已經打過的動作不再開放（伺服器也會擋重複打卡），並說明是幾點打的
const clockInState = computed(() => {
  const base = baseActionState('clockIn')
  const done = recordsLoaded.value ? punchesOf(base.context).clockIn.blocking : null
  if (!done) return base
  const doneAt = formatTaiwanTime(done.timestamp)
  return { ...base, disabled: true, done: true, doneAt, reason: `已於 ${doneAt} 簽到，不需重複打卡` }
})

const clockOutState = computed(() => {
  const base = baseActionState('clockOut')
  if (!recordsLoaded.value) return base
  const punches = punchesOf(base.context)
  const done = punches.clockOut.blocking
  if (done) {
    const doneAt = formatTaiwanTime(done.timestamp)
    return { ...base, disabled: true, done: true, doneAt, reason: `已於 ${doneAt} 簽退，不需重複打卡` }
  }
  // 伺服器規定簽退前要有這一班的簽到
  if (!base.disabled && !punches.clockIn.record) {
    return { ...base, disabled: true, missingClockIn: true, reason: '尚未簽到，無法簽退' }
  }
  return base
})

// 畫面上說明的是哪一班：通常是今天的班；跨日班下班前是昨天那一班；明天 00:00 的班開放簽到後是明天那一班
const displayContext = computed(() => {
  const availability = actionAvailability.value
  const { clockIn, clockOut } = availability.actions || {}
  if (clockIn?.phase === 'open' && clockIn.context) return clockIn.context
  if (clockOut?.phase === 'open' && clockOut.context) return clockOut.context
  return availability.context || null
})

function scheduleKeyOf(context) {
  return context?.scheduleDate ? context.scheduleDate.toISOString().slice(0, 10) : ''
}

function formatShiftTime(context) {
  const start = formatTaiwanTime(context.shiftStart)
  const end = formatTaiwanTime(context.shiftEnd)
  const crossDay = taiwanDateKey(context.shiftStart) !== taiwanDateKey(context.shiftEnd)
  return crossDay ? `${start}–翌日 ${end}` : `${start}–${end}`
}

const shiftSummary = computed(() => {
  const dayOff = actionAvailability.value.dayOff
  if (dayOff) {
    return { dayLabel: '今日班別', name: dayOff.shift?.name || dayOff.shift?.code || '休假', time: '' }
  }
  const context = displayContext.value
  if (!context) return null
  const key = scheduleKeyOf(context)
  let dayLabel = '班別'
  if (key === todayKey.value) dayLabel = '今日班別'
  else if (key === shiftDateKey(todayKey.value, -1)) dayLabel = '昨日班別'
  else if (key === shiftDateKey(todayKey.value, 1)) dayLabel = '明日班別'
  return {
    dayLabel,
    name: context.shift?.name || context.shift?.code || '',
    time: formatShiftTime(context)
  }
})

// 某個動作在這一班的允許時段，以及現在是開放前 / 開放中 / 已截止
function windowInfo(action, context) {
  const window = computeActionWindow(action, context.shiftStart, context.shiftEnd, actionBuffers.value)
  const formatted = formatWindow(window, getTimezone())
  if (!window || !formatted) return null
  const phase = nowMs.value < window.start.getTime()
    ? 'before'
    : nowMs.value > window.end.getTime()
      ? 'after'
      : 'open'
  return { phase, ...formatted }
}

// 一句話說明目前的打卡進度與下一步
const punchStatus = computed(() => {
  const context = displayContext.value
  if (!context || dayOffNotice.value || !recordsLoaded.value) return ''
  const punches = punchesOf(context)
  const inAt = punches.clockIn.record ? formatTaiwanTime(punches.clockIn.record.timestamp) : ''
  const outAt = punches.clockOut.record ? formatTaiwanTime(punches.clockOut.record.timestamp) : ''
  if (inAt && outAt) return `已簽到 ${inAt}、已簽退 ${outAt}`
  if (inAt) {
    const out = windowInfo('clockOut', context)
    if (!out) return `已簽到 ${inAt}`
    if (out.phase === 'open') return `已簽到 ${inAt}，現在可以簽退`
    if (out.phase === 'before') return `已簽到 ${inAt}，${out.start} 起可簽退`
    return `已簽到 ${inAt}，簽退時段已於 ${out.end} 結束`
  }
  const into = windowInfo('clockIn', context)
  if (!into) return '尚未簽到'
  if (into.phase === 'open') return `尚未簽到，請於 ${into.end} 前簽到`
  if (into.phase === 'before') return `尚未簽到，${into.start} 起可簽到`
  return `尚未簽到，簽到時段已於 ${into.end} 結束`
})

// 接下來該做的動作（按鈕會標成主要顏色）
const nextAction = computed(() => {
  if (!clockInState.value.disabled) return 'clockIn'
  if (!clockOutState.value.disabled) return 'clockOut'
  return ''
})

function clockHint(state, verb) {
  if (state.done) return `已${verb} ${state.doneAt}`
  if (!contextLoaded.value) return '載入中…'
  if (dayOffNotice.value) return '今日休假'
  if (!actionAvailability.value.context) return '未排班'
  if (state.missingClockIn) return '尚未簽到'
  if (!state.formatted) return '未設定時段'
  if (state.phase === 'before') return `${state.formatted.start} 開放`
  if (state.phase === 'after') return `${state.formatted.end} 已截止`
  return `${state.formatted.start}–${state.formatted.end}`
}

function todayCountOf(actionKey) {
  return records.value.filter(row => row.actionKey === actionKey && row.dateKey === todayKey.value).length
}

const punchCards = computed(() => ACTIONS.map(item => {
  if (item.key === 'clockIn' || item.key === 'clockOut') {
    const state = item.key === 'clockIn' ? clockInState.value : clockOutState.value
    return {
      ...item,
      disabled: Boolean(state.disabled),
      done: Boolean(state.done),
      next: nextAction.value === item.key,
      reason: state.reason || '',
      hint: clockHint(state, item.verb)
    }
  }
  // 外出、休息登記不看班表，隨時可以登記，一天可以好幾次
  const count = todayCountOf(item.key)
  return { ...item, disabled: false, done: false, next: false, reason: '', hint: count ? `今日 ${count} 次` : '' }
}))

// 後端打卡記錄轉成畫面用的列（時間一律台灣時間）
function toRecordRow(record, index = 0) {
  const timestamp = record.timestamp
  const dateKey = taiwanDateKey(timestamp)
  return {
    key: record._id || `${record.action}-${timestamp}-${index}`,
    actionKey: record.action,
    action: reverseActionMap[record.action] || record.action,
    time: formatTaiwanDateTime(timestamp),
    clock: formatTaiwanTime(timestamp),
    dateKey,
    shortDate: dateKey ? dateKey.slice(5).replace('-', '/') : '',
    remark: record.remark || '',
    timestamp,
    source: record.source,
    sourceLabel: attendanceSourceLabel(record.source),
    sourceTagType: attendanceSourceTagType(record.source),
    showSource: isAttendanceSourceNotable(record.source)
  }
}

// 今天的記錄：台灣日期是今天的打卡，加上屬於目前這一班的打卡（跨日班前一晚的簽到、過了午夜的簽退）
const todayRecords = computed(() => {
  const range = computeShiftPunchRange(displayContext.value, actionBuffers.value)
  return records.value.filter(row => {
    if (row.dateKey && row.dateKey === todayKey.value) return true
    if (!range) return false
    const time = new Date(row.timestamp).getTime()
    return time >= range.start.getTime() && time <= range.end.getTime()
  })
})

// 最近記錄：今天以前 7 天，不含已經列在「今日打卡記錄」的（跨日班前一晚的簽到）。
// 伺服器不認得日期參數（舊版）時會回傳全部記錄，所以日期一律在這裡再篩一次
const recentGroups = computed(() => {
  if (!todayKey.value) return []
  const todayKeys = new Set(todayRecords.value.map(row => row.key))
  const earliest = shiftDateKey(todayKey.value, -RECENT_DAYS)
  const groups = new Map()
  const seen = new Set()
  ;[...recentRecords.value, ...records.value].forEach(row => {
    if (!row.dateKey || todayKeys.has(row.key) || seen.has(row.key)) return
    seen.add(row.key)
    if (row.dateKey >= todayKey.value || row.dateKey < earliest) return
    if (!groups.has(row.dateKey)) groups.set(row.dateKey, [])
    groups.get(row.dateKey).push(row)
  })
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([dateKey, rows]) => ({
      dateKey,
      label: `${dateKey.replace(/-/g, '/')}（${weekdayOfDateKey(dateKey)}）`,
      rows
    }))
})

const recentCount = computed(() => recentGroups.value.reduce((sum, group) => sum + group.rows.length, 0))

// 還沒讀過前 7 天的記錄時不顯示筆數（手上只有昨天的，數字會是錯的）
const recentMeta = computed(() => {
  const parts = [`近 ${RECENT_DAYS} 天`]
  if (recentLoaded.value) parts.push(`${recentCount.value} 筆`)
  parts.push(recentOpen.value ? '收合' : '展開')
  return parts.join(' · ')
})

// 只查自己的打卡（scope=self；舊版伺服器不認得 scope，所以同時帶 employee=自己：
// 不帶時管理員會拿到全公司、主管會拿到部屬的記錄，而且沒有自己的），並只要畫面用得到的日期（台灣日期，含頭尾）
function ownRecordsUrl(employeeId, startOffset, endOffset) {
  const today = todayKey.value || taiwanDateKey(new Date())
  const params = new URLSearchParams({ employee: employeeId, scope: 'self' })
  if (today) {
    params.set('start', shiftDateKey(today, startOffset))
    params.set('end', shiftDateKey(today, endOffset))
  }
  return `/api/attendance?${params.toString()}`
}

// 開頁只讀昨天（跨日班前一晚的簽到）到明天（裝置與伺服器時鐘在午夜前後的誤差）；以前一次讀回整段歷史
async function fetchRecords() {
  const employeeId = getEmployeeId()
  if (!employeeId) {
    records.value = []
    recordsLoaded.value = true
    return
  }
  const requestId = ++recordsRequestId
  try {
    const res = await apiFetch(ownRecordsUrl(employeeId, -1, 1))
    if (!res?.ok) throw new Error('failed')
    const data = await res.json()
    // 較早送出的請求比較晚回來時，不覆蓋新的結果
    if (requestId !== recordsRequestId) return
    records.value = (Array.isArray(data) ? data : []).map(toRecordRow)
    recordsLoaded.value = true
    recordsError.value = ''
  } catch (err) {
    if (requestId !== recordsRequestId) return
    console.error(err)
    recordsError.value = '打卡記錄載入失敗'
  }
}

// 「最近記錄」展開時才讀前 7 天的打卡；重新讀取時先留著畫面上的清單
async function fetchRecentRecords() {
  const employeeId = getEmployeeId()
  if (!employeeId) {
    recentRecords.value = []
    recentLoaded.value = true
    return
  }
  const requestId = ++recentRequestId
  recentError.value = ''
  try {
    const res = await apiFetch(ownRecordsUrl(employeeId, -RECENT_DAYS, -1))
    if (!res?.ok) throw new Error('failed')
    const data = await res.json()
    if (requestId !== recentRequestId) return
    recentRecords.value = (Array.isArray(data) ? data : []).map(toRecordRow)
    recentLoaded.value = true
  } catch (err) {
    if (requestId !== recentRequestId) return
    console.error(err)
    recentError.value = '最近記錄載入失敗'
  }
}

function toggleRecent() {
  recentOpen.value = !recentOpen.value
  if (recentOpen.value && !recentLoaded.value) fetchRecentRecords()
}

async function fetchShifts() {
  const res = await apiFetch('/api/shifts')
  if (!res?.ok) throw new Error('failed')
  const data = await res.json().catch(() => [])
  return Array.isArray(data) ? data : []
}

// 打卡時段要看昨天（跨日班）、今天、明天（00:00 的班）的班表，月初月底會跨到相鄰的月份
function scheduleMonthsAround(now = new Date()) {
  const key = taiwanDateKey(now)
  return [...new Set([shiftDateKey(key, -1), key, shiftDateKey(key, 1)].map(item => item.slice(0, 7)))]
}

async function fetchMonthlySchedule() {
  const employeeId = getEmployeeId()
  if (!employeeId) return []
  const lists = await Promise.all(scheduleMonthsAround().map(async month => {
    const params = new URLSearchParams({ month, employee: employeeId })
    const res = await apiFetch(`/api/schedules/monthly?${params.toString()}`)
    if (!res?.ok) throw new Error('failed')
    const data = await res.json().catch(() => [])
    if (Array.isArray(data)) return data
    return Array.isArray(data?.schedules) ? data.schedules : []
  }))
  const seen = new Set()
  return lists.flat().filter(item => {
    if (!item?._id) return true
    if (seen.has(item._id)) return false
    seen.add(item._id)
    return true
  })
}

async function fetchAttendanceSettings() {
  try {
    const res = await apiFetch('/api/attendance/punch-window')
    if (!res?.ok) throw new Error('failed')
    const data = await res.json().catch(() => null)
    return data?.actionBuffers
  } catch (err) {
    // 讀不到設定時用預設的打卡時段，伺服器仍會以實際設定判斷
    console.error(err)
    return undefined
  }
}

async function loadScheduleContext() {
  const requestId = ++contextRequestId
  try {
    const [shifts, schedules, buffers] = await Promise.all([
      fetchShifts(),
      fetchMonthlySchedule(),
      fetchAttendanceSettings()
    ])
    if (requestId !== contextRequestId) return
    shiftDefinitions.value = shifts
    monthlySchedules.value = schedules
    actionBuffers.value = buffers
    contextError.value = false
  } catch (err) {
    if (requestId !== contextRequestId) return
    console.error(err)
    // 沒有成功載入過才清空；之前載入的班表繼續用
    if (!contextLoaded.value) {
      shiftDefinitions.value = []
      monthlySchedules.value = []
    }
    contextError.value = true
  }
  contextLoaded.value = true
  updateAvailability(new Date())
}

function onPunch(key) {
  const card = punchCards.value.find(item => item.key === key)
  if (!card) return
  if (card.disabled) {
    ElMessage({ type: 'warning', message: card.reason, grouping: true })
    return
  }
  openRemarkDialog(card.label)
}

function openRemarkDialog(action) {
  pendingAction.value = action
  remarkText.value = ''
  remarkDialogVisible.value = true
}

async function confirmRemark() {
  if (punchSubmitting.value) return
  await addRecord(pendingAction.value, remarkText.value.trim())
  remarkDialogVisible.value = false
}

// 以登入憑證裡的身分為準（伺服器只接受替自己打卡）
function getEmployeeId() {
  const token = getToken()
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      const id = payload.employeeId || payload.id
      if (id) return id
    } catch (e) {
      // 解析失敗時改用登入時記下的員工編號
    }
  }
  return localStorage.getItem('employeeId')
}

function describePunchError(error, label) {
  if (typeof error === 'string' && /[一-鿿]/.test(error)) return error
  const translate = typeof error === 'string' ? PUNCH_ERROR_TEXT[error] : null
  return translate ? translate(label) : `${label}失敗，請稍後再試`
}

async function addRecord(action, remark = '') {
  if (punchSubmitting.value) return false
  const employeeId = getEmployeeId()
  if (!employeeId) {
    ElMessage.warning('請重新登入')
    return false
  }
  punchSubmitting.value = true
  const actionKey = actionMap[action] || action
  const label = reverseActionMap[actionKey] || action
  const payload = {
    action: actionKey,
    remark,
    employee: employeeId
  }
  try {
    const res = await apiFetch('/api/attendance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    if (!res?.ok) {
      const result = res ? await res.json().catch(() => ({})) : {}
      ElMessage.error(describePunchError(result?.error, label))
      // 被擋下多半是畫面上的記錄過時了（例如在另一台裝置打過卡），重新讀取
      await fetchRecords()
      return false
    }
    const saved = await res.json()
    records.value.unshift(toRecordRow({ source: 'online', ...saved }))
    recordsLoaded.value = true
    ElMessage.success(`${label}成功 ${formatTaiwanTime(saved.timestamp)}`.trim())
    await fetchRecords()
    return true
  } catch (err) {
    console.error(err)
    ElMessage.error('連線失敗，請確認網路後再試一次')
    return false
  } finally {
    punchSubmitting.value = false
  }
}

function refreshAll() {
  lastLoadedAt = Date.now()
  fetchRecords()
  // 最近記錄：展開中就跟著更新；收合時等下次展開再讀（日期可能已經換了一天）
  if (recentOpen.value) fetchRecentRecords()
  else recentLoaded.value = false
  return loadScheduleContext()
}

function updateTime() {
  const now = new Date()
  const parts = getTaiwanParts(now)
  if (!parts) return
  currentTime.value = `${parts.hour}:${parts.minute}:${parts.second}`
  // 打卡時段以分鐘為單位，分鐘沒變就不用重算
  const minuteKey = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
  if (minuteKey === lastMinuteKey) return
  const dateChanged = Boolean(lastMinuteKey) && !lastMinuteKey.startsWith(`${parts.year}-${parts.month}-${parts.day} `)
  lastMinuteKey = minuteKey
  currentDate.value = `${parts.year}/${parts.month}/${parts.day}（${parts.weekday}）`
  updateAvailability(now)
  // 過了午夜：今天的班表、今天的記錄都換了一天（月底還會換月）
  if (dateChanged) refreshAll()
}

// 手機把頁面切到背景再回來時，時鐘與記錄可能已經過時
function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return
  updateTime()
  if (Date.now() - lastLoadedAt > REFRESH_AFTER_MS) refreshAll()
}

onMounted(() => {
  lastLoadedAt = Date.now()
  fetchRecords()
  loadScheduleContext()
  updateTime()
  timeInterval = setInterval(updateTime, 1000)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  if (timeInterval) {
    clearInterval(timeInterval)
  }
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<style scoped>
.attendance-page {
  max-width: 960px;
  margin: 0 auto;
}


.attendance-clock {
  font-size: var(--hr-font-size-2xl);
  font-weight: var(--hr-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: var(--hr-gray-900);
}

/* 今天的班別與打卡進度 */
.shift-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  font-size: var(--hr-font-size-sm);
  color: var(--hr-gray-600);
}

.shift-summary__name {
  font-size: var(--hr-font-size-base);
  color: var(--hr-gray-900);
}

.shift-summary__time {
  font-variant-numeric: tabular-nums;
  color: var(--hr-gray-800);
}

.punch-status {
  margin: 4px 0 0;
  font-size: var(--hr-font-size-sm);
  color: var(--hr-gray-700);
}

.punch-status--error {
  color: var(--hr-error);
}

.day-off-notice {
  margin-top: var(--hr-space-sm);
}

/* 打卡按鈕：手機 2x2、桌機一列四個 */
.punch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.punch-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 88px;
  padding: 12px 8px;
  border: 1px solid var(--hr-gray-300);
  border-radius: var(--hr-radius-md);
  background: var(--hr-white);
  color: var(--hr-gray-900);
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: border-color var(--hr-transition-fast), background-color var(--hr-transition-fast);
}

.punch-card:not(.disabled):hover {
  border-color: var(--hr-primary-light);
}

.punch-card:focus-visible {
  outline: 2px solid var(--hr-primary-light);
  outline-offset: 2px;
}

.punch-card.is-next {
  border-color: var(--hr-primary);
  background: var(--hr-primary);
  color: var(--hr-white);
}

.punch-card.disabled {
  border-color: var(--hr-gray-200);
  background: var(--hr-gray-50);
  color: var(--hr-gray-500);
  cursor: not-allowed;
}

.punch-title {
  font-size: var(--hr-font-size-base);
  font-weight: var(--hr-font-weight-semibold);
}

.punch-hint {
  min-height: 18px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.punch-card.is-done .punch-hint {
  color: var(--hr-secondary-dark);
  font-weight: var(--hr-font-weight-medium);
}

/* 打卡記錄 */
.records-error {
  margin: 0 0 var(--hr-space-sm);
  font-size: var(--hr-font-size-sm);
  color: var(--hr-error);
}

.record-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.record-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 10px 0;
  border-top: 1px solid var(--hr-gray-100);
  font-size: var(--hr-font-size-sm);
  color: var(--hr-gray-800);
}

.record-row:first-child {
  border-top: 0;
}

.record-time {
  min-width: 48px;
  font-weight: var(--hr-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--hr-gray-900);
}

.record-action {
  min-width: 72px;
}

.record-remark {
  flex: 1 1 160px;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--hr-gray-500);
}

.recent-toggle {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
  width: 100%;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.recent-toggle__title {
  margin: 0;
}

.recent-toggle__meta {
  font-size: 13px;
  color: var(--hr-gray-500);
}

.recent-group__date {
  margin: var(--hr-space-sm) 0 0;
  padding-top: var(--hr-space-sm);
  border-top: 1px solid var(--hr-gray-200);
  font-size: 13px;
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-600);
}

.punch-confirm-time {
  margin: 0 0 12px;
  font-size: var(--hr-font-size-sm);
  font-variant-numeric: tabular-nums;
  color: var(--hr-gray-600);
}

.punch-confirm-time strong {
  margin-left: 4px;
  font-size: var(--hr-font-size-lg);
  color: var(--hr-gray-900);
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

@media (min-width: 768px) {
  .punch-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 767px) {
  /* 手機上對話框的兩個按鈕各佔一半，好按 */
  .dialog-footer :deep(.el-button) {
    flex: 1 1 0;
    min-height: 44px;
  }
}
</style>
