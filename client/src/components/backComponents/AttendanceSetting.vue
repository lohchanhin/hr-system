<!-- 出勤設定：遲到早退的判定與扣款、打卡開放時段、排班檢核的勞動規則。全部在同一頁，一個「儲存」 -->
<template>
  <div v-loading="loading" class="attendance-setting">
    <!-- 設定很長、只有一個「儲存」：頁首固定在上方（sticky），捲到下面也按得到 -->
    <PageHeader sticky title="出勤設定" subtitle="遲到早退的判定與扣款、打卡開放時段，以及排班檢核使用的勞動規則">
      <template #actions>
        <span v-if="dirty" class="unsaved-mark" data-test="attendance-setting-dirty">有未儲存的變更</span>
        <el-button :disabled="!dirty || saving" data-test="attendance-setting-reset" @click="resetForm">還原</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!loaded"
          data-test="attendance-setting-save"
          @click="save"
        >
          儲存
        </el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="loadError"
      class="load-error"
      type="error"
      :closable="false"
      show-icon
      :title="loadError"
      data-test="attendance-setting-load-error"
    >
      <el-button size="small" @click="loadSettings">重新載入</el-button>
    </el-alert>

    <section class="hr-section">
      <h2 class="hr-section__title">遲到與早退</h2>
      <div class="setting-grid">
        <div class="setting-field" :class="{ 'has-error': errors.lateGrace }">
          <span class="setting-label">遲到容許</span>
          <div class="setting-control">
            <el-input-number v-model="abnormalForm.lateGrace" aria-label="遲到容許（分鐘）" :min="0" :max="GRACE_MAX" :step="1" data-test="late-grace" />
            <span class="setting-unit">分鐘</span>
          </div>
          <p class="hr-hint">上班時間後這段時間內簽到不算遲到；調大就更寬鬆，超過的分鐘數才計為遲到。</p>
          <p v-if="errors.lateGrace" class="setting-error">{{ errors.lateGrace }}</p>
        </div>
        <div class="setting-field" :class="{ 'has-error': errors.earlyLeaveGrace }">
          <span class="setting-label">早退容許</span>
          <div class="setting-control">
            <el-input-number v-model="abnormalForm.earlyLeaveGrace" aria-label="早退容許（分鐘）" :min="0" :max="GRACE_MAX" :step="1" data-test="early-leave-grace" />
            <span class="setting-unit">分鐘</span>
          </div>
          <p class="hr-hint">下班時間前這段時間內簽退不算早退；影響部門報表與薪資的遲到早退次數。</p>
          <p v-if="errors.earlyLeaveGrace" class="setting-error">{{ errors.earlyLeaveGrace }}</p>
        </div>
      </div>
    </section>

    <section class="hr-section" data-test="deduction-section">
      <h2 class="hr-section__title">遲到／早退扣款</h2>
      <div class="setting-grid">
        <template v-for="field in DEDUCTION_FIELDS" :key="field.key">
          <div class="setting-field">
            <span class="setting-label">啟用{{ field.name }}扣款</span>
            <div class="setting-control">
              <el-switch
                v-model="abnormalForm[field.enabledKey]"
                :aria-label="`啟用${field.name}扣款`"
                :data-test="`${field.key}-deduction-switch`"
              />
            </div>
          </div>
          <div class="setting-field" :class="{ 'has-error': errors[field.amountKey] }">
            <span class="setting-label">{{ field.name }}每次扣款金額</span>
            <div class="setting-control">
              <el-input-number
                v-model="abnormalForm[field.amountKey]"
                :aria-label="`${field.name}每次扣款金額（元）`"
                :min="0"
                :max="DEDUCTION_MAX"
                :step="50"
                :precision="0"
                :disabled="!abnormalForm[field.enabledKey]"
                :data-test="`${field.key}-deduction-amount`"
              />
              <span class="setting-unit">元</span>
            </div>
            <p class="hr-hint" :data-test="`${field.key}-deduction-hint`">{{ deductionHint(field) }}</p>
            <p v-if="errors[field.amountKey]" class="setting-error">{{ errors[field.amountKey] }}</p>
          </div>
        </template>
      </div>
    </section>

    <section class="hr-section">
      <h2 class="hr-section__title">打卡開放時段</h2>
      <div class="setting-grid">
        <div
          v-for="field in BUFFER_FIELDS"
          :key="field.key"
          class="setting-field"
          :class="{ 'has-error': errors[field.key] }"
        >
          <span class="setting-label">{{ field.label }}</span>
          <div class="setting-control">
            <el-input-number
              v-model="actionBufferForm[field.action][field.field]"
              :aria-label="`${field.label}（分鐘）`"
              :min="0"
              :max="MAX_BUFFER"
              :step="15"
              :data-test="`buffer-${field.key}`"
            />
            <span class="setting-unit">分鐘</span>
          </div>
          <p class="hr-hint">{{ field.hint }}</p>
          <p v-if="errors[field.key]" class="setting-error">{{ errors[field.key] }}</p>
        </div>
      </div>
      <div class="window-example" data-test="punch-window-example">
        <span class="window-example__title">以 {{ EXAMPLE_SHIFT.startTime }}–{{ EXAMPLE_SHIFT.endTime }} 的班為例</span>
        <span class="window-example__item">
          上班簽到 <strong data-test="example-clock-in">{{ exampleWindows.clockIn }}</strong>
        </span>
        <span class="window-example__item">
          下班簽退 <strong data-test="example-clock-out">{{ exampleWindows.clockOut }}</strong>
        </span>
        <span class="window-example__note">時段以外不能線上打卡；簽到最晚到下班時間、簽退最早從上班時間算起。</span>
      </div>
    </section>

    <section class="hr-section">
      <h2 class="hr-section__title">勞動規則（排班檢核）</h2>
      <div class="setting-grid">
        <div class="setting-field">
          <span class="setting-label">工時制度</span>
          <div class="setting-control">
            <el-select v-model="laborRuleForm.workTimeRegime" class="regime-select" data-test="work-time-regime">
              <el-option v-for="option in WORK_TIME_REGIMES" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
          </div>
          <p class="hr-hint">排班檢核依這個制度檢查每週工時、例假與休息日。</p>
        </div>
        <div
          v-if="laborRuleForm.workTimeRegime !== 'standard'"
          class="setting-field"
          :class="{ 'has-error': errors.workTimeRegimeApprovalReference }"
        >
          <span class="setting-label">變形工時核准文件編號<em class="required-mark">必填</em></span>
          <div class="setting-control">
            <el-input v-model="laborRuleForm.workTimeRegimeApprovalReference" maxlength="200" data-test="regime-reference" />
          </div>
          <p class="hr-hint">工會或勞資會議同意採用變形工時的文號。</p>
          <p v-if="errors.workTimeRegimeApprovalReference" class="setting-error">{{ errors.workTimeRegimeApprovalReference }}</p>
        </div>
      </div>

      <div class="setting-grid">
        <div class="setting-field" :class="{ 'has-error': errors.minShiftRestMinutes }">
          <span class="setting-label">班次間隔</span>
          <div class="setting-control">
            <el-input-number
              v-model="laborRuleForm.minShiftRestMinutes"
              aria-label="班次間隔（分鐘）"
              :min="REST_MIN"
              :max="REST_MAX"
              :step="30"
              :disabled="laborRuleForm.restIntervalExceptionEnabled"
              data-test="min-shift-rest"
            />
            <span class="setting-unit">分鐘（{{ minutesAsHours(laborRuleForm.minShiftRestMinutes) }} 小時）</span>
          </div>
          <p class="hr-hint">前一班下班到下一班上班至少要隔這麼久（法定 11 小時）；調大則排班檢核更嚴格。</p>
          <p v-if="errors.minShiftRestMinutes" class="setting-error">{{ errors.minShiftRestMinutes }}</p>
        </div>
        <div class="setting-field">
          <span class="setting-label">11 小時間隔例外</span>
          <div class="setting-control">
            <el-switch v-model="laborRuleForm.restIntervalExceptionEnabled" aria-label="11 小時間隔例外" data-test="rest-exception-switch" />
          </div>
          <p class="hr-hint">經主管機關公告並由工會或勞資會議同意時，可縮短為 8 小時以上。</p>
        </div>
        <template v-if="laborRuleForm.restIntervalExceptionEnabled">
          <div class="setting-field" :class="{ 'has-error': errors.restIntervalExceptionMinutes }">
            <span class="setting-label">例外時的班次間隔</span>
            <div class="setting-control">
              <el-input-number
                v-model="laborRuleForm.restIntervalExceptionMinutes"
                aria-label="例外時的班次間隔（分鐘）"
                :min="REST_EXCEPTION_MIN"
                :max="REST_MIN"
                :step="30"
                data-test="rest-exception-minutes"
              />
              <span class="setting-unit">分鐘（{{ minutesAsHours(laborRuleForm.restIntervalExceptionMinutes) }} 小時）</span>
            </div>
            <p class="hr-hint">啟用例外後，排班檢核改用這個間隔，上面的班次間隔不再使用。</p>
            <p v-if="errors.restIntervalExceptionMinutes" class="setting-error">{{ errors.restIntervalExceptionMinutes }}</p>
          </div>
          <div class="setting-field" :class="{ 'has-error': errors.restIntervalApprovalReference }">
            <span class="setting-label">例外核准文件編號<em class="required-mark">必填</em></span>
            <div class="setting-control">
              <el-input v-model="laborRuleForm.restIntervalApprovalReference" maxlength="200" data-test="rest-exception-reference" />
            </div>
            <p v-if="errors.restIntervalApprovalReference" class="setting-error">{{ errors.restIntervalApprovalReference }}</p>
          </div>
        </template>
      </div>

      <div class="setting-grid">
        <div class="setting-field" :class="{ 'has-error': errors.monthlyOvertimeHours }">
          <span class="setting-label">每月加班上限</span>
          <div class="setting-control">
            <el-input-number
              v-model="laborRuleForm.monthlyOvertimeHours"
              aria-label="每月加班上限（小時）"
              :min="1"
              :max="monthlyOvertimeMax"
              :step="1"
              data-test="monthly-overtime"
            />
            <span class="setting-unit">小時（最多 {{ monthlyOvertimeMax }}）</span>
          </div>
          <p class="hr-hint">加班申請與排班超過這個時數會被擋下或提醒；調小則更嚴格。</p>
          <p v-if="errors.monthlyOvertimeHours" class="setting-error">{{ errors.monthlyOvertimeHours }}</p>
        </div>
        <div class="setting-field">
          <span class="setting-label">延長每月加班上限</span>
          <div class="setting-control">
            <el-switch
              v-model="laborRuleForm.extendedOvertimeEnabled"
              aria-label="延長每月加班上限"
              data-test="extended-overtime-switch"
              @change="onExtendedOvertimeChange"
            />
          </div>
          <p class="hr-hint">經工會或勞資會議同意時，每月上限可到 54 小時、每 3 個月不超過 138 小時。</p>
        </div>
        <div
          v-if="laborRuleForm.extendedOvertimeEnabled"
          class="setting-field"
          :class="{ 'has-error': errors.overtimeApprovalReference }"
        >
          <span class="setting-label">延長工時核准文件編號<em class="required-mark">必填</em></span>
          <div class="setting-control">
            <el-input v-model="laborRuleForm.overtimeApprovalReference" maxlength="200" data-test="overtime-reference" />
          </div>
          <p v-if="errors.overtimeApprovalReference" class="setting-error">{{ errors.overtimeApprovalReference }}</p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'
import PageHeader from '../PageHeader.vue'
import { computeActionWindow } from '../../utils/timeWindow'

const GRACE_MAX = 180
const MAX_BUFFER = 720
const REST_MIN = 660
const REST_MAX = 1440
const REST_EXCEPTION_MIN = 480
const OVERTIME_MAX = 46
const OVERTIME_MAX_EXTENDED = 54
const EXAMPLE_SHIFT = { startTime: '08:00', endTime: '17:00' }

const WORK_TIME_REGIMES = [
  { value: 'standard', label: '標準工時' },
  { value: 'two_week', label: '二週變形工時' },
  { value: 'four_week', label: '四週變形工時' },
  { value: 'eight_week', label: '八週變形工時' }
]

const BUFFER_FIELDS = [
  { key: 'clockInEarly', action: 'clockIn', field: 'earlyMinutes', label: '上班簽到：最早可提前', hint: '上班前多久開放簽到；調大就能更早打卡。' },
  { key: 'clockInLate', action: 'clockIn', field: 'lateMinutes', label: '上班簽到：最晚可延後', hint: '上班後超過這段時間就不能線上簽到（仍會記遲到）。' },
  { key: 'clockOutEarly', action: 'clockOut', field: 'earlyMinutes', label: '下班簽退：最早可提前', hint: '下班前多久開放簽退；早於早退容許仍會記早退。' },
  { key: 'clockOutLate', action: 'clockOut', field: 'lateMinutes', label: '下班簽退：最晚可延後', hint: '下班後多久內可以簽退；常加班超過時請調大。' }
]

// 伺服器的檢查訊息是英文，換成畫面上的說法
const SERVER_ERROR_MESSAGES = {
  'rest interval exception requires an approval reference': '啟用 11 小時間隔例外必須填寫例外核准文件編號',
  'flexible work-time regime requires an approval reference': '採用變形工時必須填寫核准文件編號',
  'extended overtime requires an approval reference': '延長每月加班上限必須填寫核准文件編號',
  'company policy requires one regular rest day and one rest day every week': '公司規定每週一例一休，不能關閉'
}

// 伺服器擋下的欄位（code，扣款欄位另附 field: 'abnormalRules.<key>'）標在畫面上對應的欄位旁
const SERVER_ERROR_FIELDS = {
  REST_INTERVAL_APPROVAL_REQUIRED: 'restIntervalApprovalReference',
  WORK_TIME_REGIME_APPROVAL_REQUIRED: 'workTimeRegimeApprovalReference',
  EXTENDED_OVERTIME_APPROVAL_REQUIRED: 'overtimeApprovalReference'
}

function serverErrorField(data) {
  if (data?.code === 'INVALID_DEDUCTION_SETTING' && typeof data.field === 'string') {
    const key = data.field.replace(/^abnormalRules./, '')
    // 開關沒有放錯誤訊息的位置，標在同一列的金額欄位
    const field = DEDUCTION_FIELDS.find(item => item.amountKey === key || item.enabledKey === key)
    return field ? field.amountKey : ''
  }
  return SERVER_ERROR_FIELDS[data?.code] || ''
}

// 遲到／早退扣款（薪資計算依「次數 × 每次金額」扣款，見伺服器 attendanceDeductionService）
const DEDUCTION_MAX = 100000
const DEDUCTION_FIELDS = [
  { key: 'late', name: '遲到', enabledKey: 'lateDeductionEnabled', amountKey: 'lateDeductionAmount' },
  { key: 'early-leave', name: '早退', enabledKey: 'earlyLeaveDeductionEnabled', amountKey: 'earlyLeaveDeductionAmount' }
]

const defaultAbnormalRules = {
  lateGrace: 5,
  earlyLeaveGrace: 5,
  lateDeductionEnabled: false,
  lateDeductionAmount: 0,
  earlyLeaveDeductionEnabled: false,
  earlyLeaveDeductionAmount: 0
}

// 伺服器的值整理成開關（布林）與金額（0 以上的整數）
function normalizeAbnormalRules(rules) {
  const merged = { ...defaultAbnormalRules, ...(rules || {}) }
  DEDUCTION_FIELDS.forEach((field) => {
    merged[field.enabledKey] = merged[field.enabledKey] === true
    const amount = Number(merged[field.amountKey])
    merged[field.amountKey] = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0
  })
  return merged
}
const defaultActionBuffers = {
  clockIn: { earlyMinutes: 60, lateMinutes: 240 },
  clockOut: { earlyMinutes: 240, lateMinutes: 120 }
}
const defaultLaborRules = {
  workTimeRegime: 'standard',
  workTimeRegimeApprovalReference: '',
  minShiftRestMinutes: 660,
  restIntervalExceptionEnabled: false,
  restIntervalExceptionMinutes: 480,
  restIntervalApprovalReference: '',
  extendedOvertimeEnabled: false,
  monthlyOvertimeHours: 46,
  threeMonthOvertimeHours: 138,
  overtimeApprovalReference: '',
  strictCompanyWeeklyRest: true
}

function cloneActionBuffers(source = defaultActionBuffers) {
  return { clockIn: { ...source.clockIn }, clockOut: { ...source.clockOut } }
}

function clampBuffer(value) {
  const num = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(num)) return null
  return Math.min(Math.max(num, 0), MAX_BUFFER)
}

function normalizeActionBuffersInput(buffers) {
  const normalized = cloneActionBuffers()
  const incoming = buffers && typeof buffers === 'object' ? buffers : {}
  ;['clockIn', 'clockOut'].forEach((action) => {
    const source = incoming[action] || {}
    ;['earlyMinutes', 'lateMinutes'].forEach((field) => {
      const clamped = clampBuffer(source[field])
      if (clamped !== null) normalized[action][field] = clamped
    })
  })
  return normalized
}

const loading = ref(false)
const loaded = ref(false)
const loadError = ref('')
const saving = ref(false)
const abnormalForm = ref({ ...defaultAbnormalRules })
const actionBufferForm = ref(cloneActionBuffers())
const laborRuleForm = ref({ ...defaultLaborRules })
const errors = reactive({})
// 上次讀到（或存好）的內容，用來判斷有沒有未儲存的變更
const savedSnapshot = ref('')

const monthlyOvertimeMax = computed(() => (
  laborRuleForm.value.extendedOvertimeEnabled ? OVERTIME_MAX_EXTENDED : OVERTIME_MAX
))

// 一句話說明扣款的結果
function deductionHint(field) {
  if (!abnormalForm.value[field.enabledKey]) return `未啟用，${field.name}不扣薪資`
  const amount = Number(abnormalForm.value[field.amountKey])
  return `每${field.name}一次，從當月薪資扣 ${Number.isFinite(amount) ? amount : 0} 元`
}

function buildPayload() {
  const abnormalRules = { ...abnormalForm.value }
  // 金額清空時當成 0（開關關著時不檢查金額，也不能送出 null）
  DEDUCTION_FIELDS.forEach((field) => {
    if (abnormalRules[field.amountKey] === null || abnormalRules[field.amountKey] === undefined || abnormalRules[field.amountKey] === '') {
      abnormalRules[field.amountKey] = 0
    }
  })
  return {
    abnormalRules,
    actionBuffers: normalizeActionBuffersInput(actionBufferForm.value),
    laborRules: { ...laborRuleForm.value, strictCompanyWeeklyRest: true }
  }
}

const dirty = computed(() => loaded.value && JSON.stringify(buildPayload()) !== savedSnapshot.value)

function minutesAsHours(minutes) {
  const value = Number(minutes)
  return Number.isFinite(value) ? Math.round((value / 60) * 100) / 100 : '—'
}

// 範例班別的打卡時段：直接用和打卡頁、伺服器相同的 computeActionWindow 計算
const exampleWindows = computed(() => {
  const toDate = (time) => {
    const [hour, minute] = time.split(':').map(Number)
    return new Date(Date.UTC(2026, 0, 5, hour, minute))
  }
  const start = toDate(EXAMPLE_SHIFT.startTime)
  const end = toDate(EXAMPLE_SHIFT.endTime)
  const buffers = normalizeActionBuffersInput(actionBufferForm.value)
  const label = (date) => {
    const time = date.toISOString().slice(11, 16)
    const dayDiff = Math.round((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(2026, 0, 5)) / 86400000)
    if (dayDiff < 0) return `前一日 ${time}`
    if (dayDiff > 0) return `翌日 ${time}`
    return time
  }
  const describe = (action) => {
    const window = computeActionWindow(action, start, end, buffers)
    return window ? `${label(window.start)}–${label(window.end)}` : '—'
  }
  return { clockIn: describe('clockIn'), clockOut: describe('clockOut') }
})

function applySetting(data) {
  if (!data || typeof data !== 'object') return
  if (data.abnormalRules) abnormalForm.value = normalizeAbnormalRules(data.abnormalRules)
  if (data.actionBuffers) actionBufferForm.value = normalizeActionBuffersInput(data.actionBuffers)
  if (data.laborRules) {
    laborRuleForm.value = { ...defaultLaborRules, ...data.laborRules, strictCompanyWeeklyRest: true }
  }
  clearErrors()
  savedSnapshot.value = JSON.stringify(buildPayload())
}

function clearErrors() {
  Object.keys(errors).forEach((key) => { delete errors[key] })
}

async function loadSettings() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await apiFetch('/api/attendance-settings')
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      // 讀不到就不讓人按儲存：用預設值蓋掉伺服器上的設定比顯示錯誤更糟
      loadError.value = `讀取出勤設定失敗${data?.error ? `：${data.error}` : ''}，目前顯示的是預設值，無法儲存`
      return
    }
    applySetting(data)
    loaded.value = true
  } catch (error) {
    loadError.value = `讀取出勤設定失敗（${error?.message || '連線失敗'}），目前顯示的是預設值，無法儲存`
  } finally {
    loading.value = false
  }
}

function resetForm() {
  if (!savedSnapshot.value) return
  applySetting(JSON.parse(savedSnapshot.value))
}

// 關掉「延長每月加班上限」時，把超過 46 的上限拉回 46（伺服器的上限也是 46）
function onExtendedOvertimeChange(enabled) {
  if (!enabled && Number(laborRuleForm.value.monthlyOvertimeHours) > OVERTIME_MAX) {
    laborRuleForm.value.monthlyOvertimeHours = OVERTIME_MAX
  }
}

function checkNumber(key, value, { min, max, label, unit }) {
  const num = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(num)) {
    errors[key] = `請填寫${label}`
  } else if (num < min || num > max) {
    errors[key] = `${label}需介於 ${min} 到 ${max} ${unit}`
  }
}

function validate() {
  clearErrors()
  checkNumber('lateGrace', abnormalForm.value.lateGrace, { min: 0, max: GRACE_MAX, label: '遲到容許', unit: '分鐘' })
  checkNumber('earlyLeaveGrace', abnormalForm.value.earlyLeaveGrace, { min: 0, max: GRACE_MAX, label: '早退容許', unit: '分鐘' })
  // 扣款金額：啟用時才檢查，必須是 0 以上的整數
  DEDUCTION_FIELDS.forEach((field) => {
    if (!abnormalForm.value[field.enabledKey]) return
    const label = `${field.name}每次扣款金額`
    checkNumber(field.amountKey, abnormalForm.value[field.amountKey], { min: 0, max: DEDUCTION_MAX, label, unit: '元' })
    if (!errors[field.amountKey] && !Number.isInteger(Number(abnormalForm.value[field.amountKey]))) {
      errors[field.amountKey] = `${label}必須是整數`
    }
  })
  BUFFER_FIELDS.forEach((field) => {
    checkNumber(field.key, actionBufferForm.value[field.action][field.field], { min: 0, max: MAX_BUFFER, label: field.label, unit: '分鐘' })
  })
  const labor = laborRuleForm.value
  if (labor.restIntervalExceptionEnabled) {
    checkNumber('restIntervalExceptionMinutes', labor.restIntervalExceptionMinutes, { min: REST_EXCEPTION_MIN, max: REST_MIN, label: '例外時的班次間隔', unit: '分鐘' })
    if (!String(labor.restIntervalApprovalReference || '').trim()) {
      errors.restIntervalApprovalReference = '啟用 11 小時間隔例外必須填寫例外核准文件編號'
    }
  } else {
    checkNumber('minShiftRestMinutes', labor.minShiftRestMinutes, { min: REST_MIN, max: REST_MAX, label: '班次間隔', unit: '分鐘' })
  }
  checkNumber('monthlyOvertimeHours', labor.monthlyOvertimeHours, { min: 1, max: monthlyOvertimeMax.value, label: '每月加班上限', unit: '小時' })
  if (labor.workTimeRegime !== 'standard' && !String(labor.workTimeRegimeApprovalReference || '').trim()) {
    errors.workTimeRegimeApprovalReference = '採用變形工時必須填寫核准文件編號'
  }
  if (labor.extendedOvertimeEnabled && !String(labor.overtimeApprovalReference || '').trim()) {
    errors.overtimeApprovalReference = '延長每月加班上限必須填寫核准文件編號'
  }
  return Object.values(errors)
}

function scrollToFirstError() {
  const el = typeof document !== 'undefined' ? document.querySelector('.attendance-setting .has-error') : null
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

async function save() {
  if (saving.value || !loaded.value) return
  const problems = validate()
  if (problems.length) {
    ElMessage.error(problems[0])
    setTimeout(scrollToFirstError)
    return
  }
  saving.value = true
  try {
    const res = await apiFetch('/api/attendance-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload())
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const serverMessage = data?.error || ''
      const message = SERVER_ERROR_MESSAGES[serverMessage] || serverMessage
      ElMessage.error(SERVER_ERROR_MESSAGES[serverMessage] || (serverMessage ? `儲存失敗：${serverMessage}` : '儲存失敗，請稍後再試'))
      const field = serverErrorField(data)
      if (field && message) {
        errors[field] = message
        setTimeout(scrollToFirstError)
      }
      return
    }
    applySetting(data)
    ElMessage.success('出勤設定已儲存')
  } catch (error) {
    ElMessage.error(`儲存失敗（${error?.message || '連線失敗'}）`)
  } finally {
    saving.value = false
  }
}

// 離開有未儲存變更的頁面前提醒
function onBeforeUnload(event) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

// 沒有掛路由時（單元測試、嵌在別的畫面）不註冊離開守衛
if (getCurrentInstance()?.appContext.config.globalProperties.$router) {
  onBeforeRouteLeave(async () => {
    if (!dirty.value) return true
    try {
      await ElMessageBox.confirm('出勤設定有尚未儲存的變更，確定要離開嗎？', '尚未儲存', {
        confirmButtonText: '離開',
        cancelButtonText: '留在這一頁',
        type: 'warning'
      })
      return true
    } catch {
      return false
    }
  })
}

onMounted(() => {
  loadSettings()
  window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})

defineExpose({ abnormalForm, actionBufferForm, laborRuleForm, errors, dirty, loaded, exampleWindows, save, resetForm, loadSettings })
</script>

<style scoped>
.attendance-setting {
  max-width: 1100px;
}


.load-error {
  margin-bottom: var(--hr-space-md);
}

.unsaved-mark {
  font-size: 13px;
  color: #b45309;
}

.setting-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hr-space-md) var(--hr-space-lg);
}

.setting-grid + .setting-grid {
  margin-top: var(--hr-space-md);
  padding-top: var(--hr-space-md);
  border-top: 1px solid var(--hr-gray-200);
}

.setting-label {
  display: block;
  margin-bottom: 6px;
  font-size: var(--hr-font-size-sm);
  font-weight: var(--hr-font-weight-medium);
  color: var(--hr-gray-800);
}

.required-mark {
  margin-left: 6px;
  font-size: 12px;
  font-style: normal;
  font-weight: var(--hr-font-weight-normal);
  color: var(--hr-error);
}

.setting-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hr-space-sm);
}

.setting-control :deep(.el-input) {
  max-width: 360px;
}

.regime-select {
  width: 240px;
}

.setting-unit {
  font-size: 13px;
  color: var(--hr-gray-600);
}

.setting-field .hr-hint {
  margin-bottom: 0;
}

.setting-error {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--hr-error);
}

.window-example {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px var(--hr-space-lg);
  margin-top: var(--hr-space-md);
  padding: 10px 12px;
  border-radius: var(--hr-radius-md);
  background: var(--hr-gray-50);
  font-size: var(--hr-font-size-sm);
  color: var(--hr-gray-700);
}

.window-example__title {
  font-weight: var(--hr-font-weight-medium);
  color: var(--hr-gray-800);
}

.window-example__item strong {
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
  color: var(--hr-gray-900);
}

.window-example__note {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--hr-gray-500);
}

@media (max-width: 767px) {
  .setting-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
