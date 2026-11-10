<!-- src/components/backComponents/PayrollPolicySetting.vue
     計薪規則（請假加班設定 › 加班與計薪）：月中到職／離職的月薪比例、加班費倍率、新進員工是否自動計算加班費，
     以及把現有員工的「自動計算加班費」整批開啟或關閉。
     規則與 API 見 docs/payroll-policy.md（GET / PUT /api/payroll/policy、POST /api/employees/auto-overtime-calc）。
     改了設定之後的薪資計算立刻套用新規則；已儲存的薪資記錄不會重算。 -->
<template>
  <div class="payroll-policy" data-test="payroll-policy">
    <el-alert v-if="loadError" type="error" :closable="false" show-icon class="policy-alert" :title="loadError" data-test="payroll-policy-error">
      <el-button size="small" @click="loadPolicy">重新載入</el-button>
    </el-alert>

    <div v-loading="loading" class="payroll-policy__body">
      <template v-if="policy">
        <!-- 只有一顆「儲存」：三項設定一起存，捲到下面時仍然按得到 -->
        <div class="hr-toolbar hr-sticky-bar">
          <span class="hr-hint toolbar-note">改了之後的薪資計算立刻套用；已儲存的薪資記錄不會重算。</span>
          <div class="toolbar-actions">
            <span v-if="dirty" class="hr-hint hr-hint--warning unsaved-note" data-test="payroll-dirty">有未儲存的變更</span>
            <el-button :disabled="saving || isAllDefault" data-test="payroll-restore-all" @click="restoreAll">全部還原預設</el-button>
            <el-button type="primary" :loading="saving" :disabled="!dirty" data-test="payroll-save" @click="save">儲存</el-button>
          </div>
        </div>

        <section class="hr-section" data-test="proration-section">
          <h2 class="hr-section__title">月中到職、離職的月薪</h2>
          <el-radio-group v-model="form.method" class="method-list" data-test="proration-method">
            <el-radio v-for="option in prorationOptions" :key="option.value" :value="option.value" class="method-option">
              <span class="method-option__label">
                {{ option.label }}
                <el-tag v-if="option.value === defaults.proration.method" size="small" type="info" class="default-tag">預設</el-tag>
              </span>
              <span class="method-option__description">{{ option.description }}</span>
            </el-radio>
          </el-radio-group>
          <p class="hr-hint">日薪、時薪人員按出勤給薪，不受這個設定影響。</p>
        </section>

        <section class="hr-section" data-test="overtime-rates">
          <h2 class="hr-section__title">加班費倍率</h2>
          <p class="hr-hint rates-hint">加班費 = 時數 × 時薪 × 倍率；只計已核准的加班申請，而且員工開啟了「自動計算加班費」。倍率 1～5，可填 1.5 或 4/3。</p>
          <table class="rates-table" data-test="rates-table">
            <thead>
              <tr><th>情境</th><th>時段</th><th>倍率</th><th class="is-default">預設</th></tr>
            </thead>
            <tbody>
              <template v-for="group in rateGroups" :key="group.dayType">
                <tr v-for="(option, index) in group.options" :key="option.key" :data-test="`rate-row-${option.key}`">
                  <th v-if="index === 0" :rowspan="group.options.length" scope="rowgroup">{{ group.label }}</th>
                  <td>{{ bandLabel(option) }}</td>
                  <td class="rate-cell">
                    <el-input
                      v-model="form.rates[option.key]"
                      class="rate-input"
                      :class="{ 'is-error': rateErrors[option.key] }"
                      inputmode="decimal"
                      :aria-label="option.label"
                      :data-test="`rate-input-${option.key}`"
                    />
                    <div v-if="rateErrors[option.key]" class="rate-error" :data-test="`rate-error-${option.key}`">{{ rateErrors[option.key] }}</div>
                  </td>
                  <td class="is-default">
                    <span>{{ option.defaultText }}</span>
                    <el-button
                      v-if="!isDefaultRate(option)"
                      link
                      type="primary"
                      size="small"
                      :data-test="`rate-restore-${option.key}`"
                      @click="restoreRate(option)"
                    >還原預設</el-button>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </section>

        <section class="hr-section" data-test="auto-calc-section">
          <h2 class="hr-section__title">自動計算加班費</h2>
          <div class="auto-row">
            <div class="auto-row__text">
              <div>新進員工預設開啟</div>
              <div class="hr-hint">只影響之後新增（含批量匯入）的員工，不會改到現有員工。</div>
            </div>
            <el-switch v-model="form.newEmployeeAutoCalc" data-test="new-employee-auto-calc" />
          </div>
          <div class="auto-row">
            <div class="auto-row__text">
              <div>
                現有員工
                <span class="auto-stats" data-test="auto-calc-stats">開啟 {{ stats.autoOvertimeCalcOn }} 位／關閉 {{ stats.autoOvertimeCalcOff }} 位</span>
              </div>
              <div class="hr-hint">在職員工（含留職停薪）；個別員工在「員工管理」修改。</div>
            </div>
            <div class="auto-row__actions">
              <el-button :loading="bulk.running === true" :disabled="bulk.running !== null" data-test="bulk-enable" @click="runBulk(true)">全部開啟</el-button>
              <el-button :loading="bulk.running === false" :disabled="bulk.running !== null" data-test="bulk-disable" @click="runBulk(false)">全部關閉</el-button>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'

const DAY_TYPE_LABELS = { workday: '平日', rest_day: '休息日', national_holiday: '國定假日' }
// 時段欄只寫「前 2 小時」這類文字，情境（平日、休息日、國定假日）在左邊那一欄
const BAND_PREFIX = /^(平日加班|休息日加班|國定假日出勤)\s*/

const policy = ref(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const form = reactive({ method: 'days30', rates: {}, newEmployeeAutoCalc: true })
// 最後一次讀取或儲存成功時的表單內容，用來判斷有沒有未儲存的變更
const savedSnapshot = ref('')
// 整批設定：null 沒有在跑；true / false 正在開啟 / 關閉
const bulk = reactive({ running: null })

const defaults = computed(() => policy.value?.defaults || { proration: { method: 'days30' }, overtime: { rates: {}, newEmployeeAutoCalc: true } })
const prorationOptions = computed(() => policy.value?.options?.prorationMethods || [])
const rateOptions = computed(() => policy.value?.options?.overtimeRates || [])
const stats = computed(() => policy.value?.stats || { autoOvertimeCalcOn: 0, autoOvertimeCalcOff: 0 })

const rateGroups = computed(() => {
  const groups = []
  for (const option of rateOptions.value) {
    let group = groups.find(item => item.dayType === option.dayType)
    if (!group) {
      group = { dayType: option.dayType, label: DAY_TYPE_LABELS[option.dayType] || option.dayType, options: [] }
      groups.push(group)
    }
    group.options.push(option)
  }
  return groups
})
const bandLabel = (option) => String(option.label || '').replace(BAND_PREFIX, '') || option.label

/* -------------------- 倍率的輸入與檢查（與伺服器 payrollPolicyService 的 parseOvertimeRate 相同） -------------------- */
const sameNumber = (a, b) => Math.abs(a - b) < 1e-9

/** '1.5'、'4/3'、1.3333333333333333 → 數字；不合格（超出 min～max、超過兩位小數又不是三分之一的倍數）回傳 null */
function parseRate(value, { min = 1, max = 5 } = {}) {
  let number = null
  if (typeof value === 'number') {
    number = value
  } else if (typeof value === 'string') {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?)\s*)?$/.exec(value)
    if (match) number = Number(match[1]) / (match[2] === undefined ? 1 : Number(match[2]))
  }
  if (!Number.isFinite(number) || number < min - 1e-9 || number > max + 1e-9) return null
  const hundredths = number * 100
  if (Math.abs(hundredths - Math.round(hundredths)) < 1e-6) return Math.round(hundredths) / 100
  const thirds = number * 3
  if (Math.abs(thirds - Math.round(thirds)) < 1e-6) return Math.round(thirds) / 3
  return null
}

/** 顯示用：兩位小數以內照寫（1.5），三分之一的倍數寫成分數（4/3） */
function formatRate(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  const hundredths = number * 100
  if (Math.abs(hundredths - Math.round(hundredths)) < 1e-6) return String(Math.round(hundredths) / 100)
  return `${Math.round(number * 3)}/3`
}

const rateErrors = computed(() => {
  const errors = {}
  for (const option of rateOptions.value) {
    const text = form.rates[option.key]
    if (parseRate(text, option) === null) {
      errors[option.key] = String(text ?? '').trim()
        ? `請填 ${option.min}～${option.max} 的數字（最多小數兩位，或 4/3 這類分數）`
        : '請填倍率'
    }
  }
  return errors
})
const hasRateErrors = computed(() => Object.keys(rateErrors.value).length > 0)

const isDefaultRate = (option) => {
  const parsed = parseRate(form.rates[option.key], option)
  return parsed !== null && sameNumber(parsed, Number(option.default))
}
const isAllDefault = computed(() => (
  form.method === defaults.value.proration.method
  && form.newEmployeeAutoCalc === defaults.value.overtime.newEmployeeAutoCalc
  && rateOptions.value.every(isDefaultRate)
))

// 比較用的表單內容：倍率換成數字（打 1.50 和 1.5 是一樣的），格式不對的保留原字
const comparable = () => JSON.stringify({
  method: form.method,
  newEmployeeAutoCalc: form.newEmployeeAutoCalc,
  rates: Object.fromEntries(rateOptions.value.map(option => {
    const parsed = parseRate(form.rates[option.key], option)
    return [option.key, parsed === null ? `?${form.rates[option.key]}` : Math.round(parsed * 1e6)]
  })),
})
const dirty = computed(() => Boolean(policy.value) && comparable() !== savedSnapshot.value)

function applyPolicy(value) {
  policy.value = value
  form.method = value?.proration?.method || 'days30'
  form.newEmployeeAutoCalc = value?.overtime?.newEmployeeAutoCalc !== false
  const rates = value?.overtime?.rates || {}
  form.rates = Object.fromEntries((value?.options?.overtimeRates || []).map(option => [option.key, formatRate(rates[option.key] ?? option.default)]))
  savedSnapshot.value = comparable()
}

/* -------------------- 讀取與儲存 -------------------- */
// 只顯示中文訊息：網路中斷時瀏覽器丟出的是英文（Failed to fetch），換成看得懂的說法
const messageOf = (error, fallback) => (/[一-鿿]/.test(error?.message || '') ? error.message : fallback)

async function readError(res, fallback) {
  try {
    const body = await res.json()
    const message = body?.error || body?.message
    return /[一-鿿]/.test(message || '') ? message : fallback
  } catch {
    return fallback
  }
}

let loadGeneration = 0
async function loadPolicy() {
  const generation = ++loadGeneration
  loading.value = true
  loadError.value = ''
  try {
    const res = await apiFetch('/api/payroll/policy')
    if (!res.ok) throw new Error(await readError(res, '無法讀取計薪規則，請稍後再試'))
    const body = await res.json()
    if (generation !== loadGeneration) return
    applyPolicy(body)
  } catch (error) {
    if (generation !== loadGeneration) return
    loadError.value = messageOf(error, '無法讀取計薪規則，請確認網路連線後再試')
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

// 只送改過的欄位（伺服器各欄位各自寫入，兩個人同時改不同的設定不會互相蓋掉）；送預設值就是回到預設
function buildPatch() {
  const current = policy.value
  const patch = {}
  if (form.method !== current.proration?.method) patch.proration = { method: form.method }
  const overtime = {}
  const rates = {}
  for (const option of rateOptions.value) {
    const parsed = parseRate(form.rates[option.key], option)
    if (parsed !== null && !sameNumber(parsed, Number(current.overtime?.rates?.[option.key]))) rates[option.key] = parsed
  }
  if (Object.keys(rates).length) overtime.rates = rates
  if (form.newEmployeeAutoCalc !== current.overtime?.newEmployeeAutoCalc) overtime.newEmployeeAutoCalc = form.newEmployeeAutoCalc
  if (Object.keys(overtime).length) patch.overtime = overtime
  return patch
}

async function save() {
  if (!policy.value || saving.value) return
  if (hasRateErrors.value) {
    ElMessage.error('加班費倍率有格式不對的欄位，請修正後再儲存')
    return
  }
  const patch = buildPatch()
  if (!Object.keys(patch).length) {
    savedSnapshot.value = comparable()
    return
  }
  saving.value = true
  try {
    const res = await apiFetch('/api/payroll/policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error(await readError(res, '儲存失敗，請稍後再試'))
    applyPolicy(await res.json())
    ElMessage.success('已儲存計薪規則')
  } catch (error) {
    ElMessage.error(messageOf(error, '儲存失敗，請確認網路連線後再試'))
  } finally {
    saving.value = false
  }
}

function restoreRate(option) {
  form.rates[option.key] = formatRate(option.default)
}

function restoreAll() {
  form.method = defaults.value.proration.method
  form.newEmployeeAutoCalc = defaults.value.overtime.newEmployeeAutoCalc
  rateOptions.value.forEach(restoreRate)
  ElMessage.info('已還原成預設值，按「儲存」才會生效')
}

/* -------------------- 現有員工整批開啟／關閉 -------------------- */
async function postBulk(enabled, dryRun) {
  const res = await apiFetch('/api/employees/auto-overtime-calc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled, dryRun }),
  })
  if (!res.ok) throw new Error(await readError(res, '整批設定失敗，請稍後再試'))
  return res.json()
}

// 先試算（dryRun）讓人看到會影響幾位，確認後才真的改
async function runBulk(enabled) {
  if (bulk.running !== null) return
  const verb = enabled ? '開啟' : '關閉'
  bulk.running = enabled
  try {
    const preview = await postBulk(enabled, true)
    const willChange = Number(preview?.willChange) || 0
    const already = Math.max((Number(preview?.matched) || 0) - willChange, 0)
    if (!willChange) {
      ElMessage.info(`在職員工的自動計算加班費都已經${verb}`)
      return
    }
    try {
      await ElMessageBox.confirm(
        `將${verb} ${willChange} 位員工的自動計算加班費（已${verb} ${already} 位）。之後的薪資計算${enabled ? '會' : '不會'}計入這些員工已核准的加班；已儲存的薪資記錄不會重算。`,
        `全部${verb}`,
        { type: 'warning', confirmButtonText: `全部${verb}`, cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    const result = await postBulk(enabled, false)
    if (result?.stats && policy.value) policy.value = { ...policy.value, stats: result.stats }
    ElMessage.success(`已${verb} ${Number(result?.changed) || 0} 位員工的自動計算加班費`)
  } catch (error) {
    ElMessage.error(messageOf(error, '整批設定失敗，請確認網路連線後再試'))
  } finally {
    bulk.running = null
  }
}

/* -------------------- 離開前提醒未儲存的變更 -------------------- */
function handleBeforeUnload(event) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

// 沒有安裝路由的環境（個別元件測試）不註冊路由守衛
if (getCurrentInstance()?.appContext.config.globalProperties.$router) {
  onBeforeRouteLeave(async () => {
    if (!dirty.value) return true
    try {
      await ElMessageBox.confirm('計薪規則有未儲存的變更，確定要離開嗎？', '尚未儲存', {
        type: 'warning',
        confirmButtonText: '離開',
        cancelButtonText: '留在此頁',
      })
      return true
    } catch {
      return false
    }
  })
}

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  loadPolicy()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  loadGeneration += 1
})

defineExpose({ dirty, save, loadPolicy, runBulk, parseRate, formatRate })
</script>

<style scoped>
.policy-alert {
  margin-bottom: var(--hr-space-md);
}
.toolbar-note {
  margin: 0;
}
/* 工具列右側的動作：寬度不夠換行時仍然靠右 */
.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hr-space-sm);
  margin-left: auto;
}
.toolbar-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.unsaved-note {
  margin-top: 0;
}

.method-list {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--hr-space-sm);
}
.method-option {
  height: auto;
  margin-right: 0;
  align-items: flex-start;
  white-space: normal;
}
.method-option :deep(.el-radio__input) {
  margin-top: 3px;
}
.method-option__label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: var(--hr-font-weight-medium);
  color: var(--hr-gray-900);
}
.method-option__description {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--hr-gray-500);
}

.rates-hint {
  margin: 0 0 var(--hr-space-sm);
}
.rates-table {
  width: 100%;
  max-width: 640px;
  border-collapse: collapse;
  font-size: var(--hr-font-size-sm);
}
.rates-table th,
.rates-table td {
  padding: 6px 10px;
  border: 1px solid var(--hr-gray-200);
  text-align: left;
  vertical-align: middle;
}
.rates-table thead th {
  font-weight: var(--hr-font-weight-medium);
  color: var(--hr-gray-500);
  background: var(--hr-gray-50);
}
.rates-table tbody th {
  font-weight: var(--hr-font-weight-medium);
  color: var(--hr-gray-900);
  white-space: nowrap;
}
.rates-table .is-default {
  white-space: nowrap;
  color: var(--hr-gray-500);
}
.rates-table .is-default .el-button {
  margin-left: 6px;
}
.rate-input {
  width: 96px;
}
.rate-input.is-error :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}
.rate-error {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-color-danger);
}

.auto-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hr-space-sm) var(--hr-space-md);
  padding: var(--hr-space-sm) 0;
}
.auto-row + .auto-row {
  border-top: 1px solid var(--hr-gray-100);
}
.auto-row__text {
  min-width: 0;
  flex: 1 1 260px;
}
.auto-row__text .hr-hint {
  margin: 2px 0 0;
}
.auto-stats {
  margin-left: 8px;
  color: var(--hr-gray-600);
}
.auto-row__actions {
  display: flex;
  gap: var(--hr-space-sm);
}
.auto-row__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

@media (max-width: 767px) {
  .rates-table th,
  .rates-table td {
    padding: 6px;
  }
  .rate-input {
    width: 72px;
  }
  .rates-table .is-default .el-button {
    display: block;
    margin: 2px 0 0;
  }
}
</style>
