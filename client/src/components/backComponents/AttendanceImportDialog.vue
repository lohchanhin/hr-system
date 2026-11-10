<!-- 考勤資料匯入：選擇檔案 → 預覽（可匯入／重複／需對應員工／錯誤）→ 匯入結果。只新增，不修改或刪除既有打卡 -->
<template>
  <el-dialog
    :model-value="visible"
    title="考勤資料匯入"
    :width="dialogWidth"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    :before-close="beforeClose"
    @close="handleClose"
  >
    <el-steps :active="stepIndex" finish-status="success" simple class="import-steps">
      <el-step title="選擇檔案" />
      <el-step title="預覽與對應" />
      <el-step title="匯入結果" />
    </el-steps>

    <!-- 第一步：選擇檔案 -->
    <div v-if="step === 'file'" class="import-section" data-test="import-step-file">
      <el-form label-width="96px" class="import-form" @submit.prevent>
        <el-form-item label="考勤檔案">
          <el-upload
            action=""
            :auto-upload="false"
            :show-file-list="false"
            accept=".xlsx,.csv"
            @change="handleFileChange"
          >
            <el-button>選擇檔案</el-button>
            <template #tip>
              <div class="upload-tip" data-test="import-file-tip">
                <template v-if="selectedFile">已選擇：{{ selectedFile.name }}（{{ formatFileSize(selectedFile.size) }}）</template>
                <template v-else>支援 .xlsx 或 .csv（UTF-8、Big5 都可以），最大 5MB；日期可用西元或民國年（例如 115/11/10 08:00）。考勤機匯出的檔案可以直接上傳。</template>
              </div>
            </template>
          </el-upload>
        </el-form-item>

        <el-form-item label="檔案的時區">
          <el-select v-model="form.timezone" placeholder="選擇時區" filterable class="timezone-select" data-test="import-timezone">
            <el-option
              v-for="item in timezoneOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
          <div class="hr-hint">檔案裡的打卡時間會當成這個時區的時間；考勤機在台灣請維持「台灣時間」。</div>
        </el-form-item>

        <el-form-item label="欄位對應">
          <div class="mapping-summary">
            <span data-test="import-mapping-summary">{{ mappingSummary }}</span>
            <el-button link type="primary" data-test="import-mapping-toggle" @click="showMappings = !showMappings">
              {{ showMappings ? '收合' : '檔案的欄位名稱不同？' }}
            </el-button>
          </div>
          <div v-show="showMappings" class="mapping-grid">
            <div v-for="(value, key) in form.mappings" :key="key" class="mapping-item">
              <label class="mapping-label">{{ mappingLabels[key] }}</label>
              <el-input v-model="form.mappings[key]" placeholder="檔案第一列的欄位名稱" />
            </div>
            <div class="hr-hint mapping-hint">填入檔案第一列的欄位名稱，例如 USERID、CHECKTIME、CHECKTYPE、NAME。</div>
          </div>
        </el-form-item>
      </el-form>
      <p class="hr-hint import-source-hint">
        匯入的打卡標示為「指紋匯入」，只會新增，不會修改或刪除線上打卡與先前匯入的記錄；同一位員工、同一動作、同一分鐘已有的打卡會自動略過，同一個檔案重複匯入不會多出記錄。
      </p>
    </div>

    <!-- 第二步：預覽與員工對應；第三步：匯入結果。兩步用同一份統計與明細 -->
    <div v-else-if="previewState" class="import-section" :data-test="step === 'result' ? 'import-step-result' : 'import-step-preview'">
      <p v-if="step === 'result'" class="result-headline" data-test="import-result-headline">{{ resultHeadline }}</p>
      <div class="summary-text" data-test="import-summary">
        <span class="hr-stat">共 <strong class="hr-stat__value">{{ summary.totalRows ?? 0 }}</strong> 筆</span>
        <span v-if="step === 'result' || importedCountKnown" class="hr-stat summary-stat--good" data-test="import-summary-imported">
          新增 <strong class="hr-stat__value">{{ summary.importedCount ?? 0 }}</strong> 筆
        </span>
        <span v-else class="hr-stat summary-stat--good" data-test="import-summary-new">
          可匯入 <strong class="hr-stat__value">{{ newCount }}</strong> 筆
        </span>
        <span class="hr-stat" data-test="import-summary-duplicate">重複略過 <strong class="hr-stat__value">{{ duplicateCount }}</strong> 筆</span>
        <span class="hr-stat" :class="{ 'summary-stat--warn': summary.missingCount }" data-test="import-summary-missing">
          {{ step === 'result' ? '缺少對應員工' : '需對應員工' }} <strong class="hr-stat__value">{{ summary.missingCount ?? 0 }}</strong> 筆
        </span>
        <span v-if="summary.ignoredCount" class="hr-stat" data-test="import-summary-ignored">不匯入 <strong class="hr-stat__value">{{ summary.ignoredCount }}</strong> 筆</span>
        <span class="hr-stat" :class="{ 'summary-stat--bad': summary.errorCount }" data-test="import-summary-error">
          錯誤 <strong class="hr-stat__value">{{ summary.errorCount ?? 0 }}</strong> 筆
        </span>
      </div>
      <p class="hr-hint">
        時間以{{ timezoneLabel(form.timezone) }}顯示。
        <template v-if="statusFilter === 'issues' && issuesTruncated">沒匯入的資料只列出前 {{ issueRows.length }} 筆（共 {{ issueCount }} 筆）。</template>
        <template v-else-if="statusFilter !== 'issues' && previewTruncated">明細只列出檔案的前 {{ previewRows.length }} 筆，統計數字是整個檔案。</template>
      </p>

      <section v-if="step === 'preview' && missingUsers.length" class="mapping-section" data-test="import-missing-users">
        <h3 class="section-title">需要指定員工的編號（{{ missingUsers.length }} 個）</h3>
        <p class="hr-hint">替每個編號選擇員工，或勾選「不匯入」；全部處理完才能開始匯入。</p>
        <el-table :data="missingUsers" max-height="220" border size="small">
          <el-table-column label="檔案中的編號" min-width="160">
            <template #default="{ row }">
              <span>{{ row.identifier }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="count" label="筆數" width="70" />
          <el-table-column label="對應員工" min-width="220">
            <template #default="{ row }">
              <el-select
                v-model="getResolution(row.identifier).employeeId"
                placeholder="選擇員工"
                :disabled="getResolution(row.identifier).ignore"
                filterable
                clearable
                style="width: 100%;"
              >
                <el-option
                  v-for="emp in employeeOptions"
                  :key="emp.value"
                  :label="emp.label"
                  :value="emp.value"
                />
              </el-select>
              <!-- 伺服器說明為什麼要指定（例如這個員工編號有多位員工使用）：放在選單旁邊，選的時候看得到 -->
              <div v-if="row.reason" class="row-note" data-test="import-missing-reason">{{ row.reason }}</div>
            </template>
          </el-table-column>
          <el-table-column label="不匯入" width="110">
            <template #default="{ row }">
              <el-checkbox v-model="getResolution(row.identifier).ignore" @change="toggleIgnore(row.identifier)">
                不匯入
              </el-checkbox>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section class="preview-section">
        <div class="hr-toolbar">
          <h3 class="section-title">{{ step === 'result' ? '明細' : '預覽明細' }}</h3>
          <el-radio-group v-model="statusFilter" size="small" data-test="import-status-filter">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="issues" data-test="import-filter-issues">只看沒匯入的（{{ issueCount }}）</el-radio-button>
          </el-radio-group>
          <span class="hr-toolbar__spacer" />
          <el-button v-if="issueRows.length" size="small" data-test="import-download-issues" @click="downloadIssues">
            下載未匯入明細（CSV）
          </el-button>
        </div>
        <el-table :data="filteredRows" max-height="260" border size="small" empty-text="沒有符合的資料">
          <el-table-column prop="rowNumber" label="列" width="60" />
          <el-table-column label="編號" min-width="110">
            <template #default="{ row }">{{ row.userId || row.rawUserId || '' }}</template>
          </el-table-column>
          <el-table-column label="時間" min-width="170">
            <template #default="{ row }">
              <span>{{ formatTimestamp(row.timestamp, form.timezone) || row.rawTimestamp || '' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="action" label="動作" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.action === 'in' || row.action === 'clockIn'" disable-transitions>上班簽到</el-tag>
              <el-tag
                v-else-if="row.action === 'out' || row.action === 'clockOut'"
                type="warning"
                disable-transitions
              >
                下班簽退
              </el-tag>
              <span v-else>{{ row.action || row.rawAction }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="狀態" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.status === 'ready'" type="success" disable-transitions>{{ step === 'result' ? '已新增' : '可匯入' }}</el-tag>
              <el-tag v-else-if="row.status === 'missing'" type="warning" disable-transitions>未對應員工</el-tag>
              <el-tag v-else-if="row.status === 'ignored'" type="info" disable-transitions>不匯入</el-tag>
              <el-tag v-else-if="row.status === 'error'" type="danger" disable-transitions>錯誤</el-tag>
              <el-tag v-else-if="row.status === 'duplicate'" type="info" disable-transitions>重複略過</el-tag>
              <span v-else>{{ row.status }}</span>
            </template>
          </el-table-column>
          <el-table-column label="說明" min-width="220">
            <template #default="{ row }">
              <span>{{ describeRow(row) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </div>

    <div v-if="busy" class="import-progress" data-test="import-progress">
      <el-progress :percentage="100" :indeterminate="true" :show-text="false" :stroke-width="4" />
      <span>{{ importing ? '匯入中' : '讀取檔案中' }}（{{ selectedFile ? formatFileSize(selectedFile.size) : '' }}），資料多時需要一點時間，請不要關閉視窗。</span>
    </div>

    <template #footer>
      <template v-if="step === 'file'">
        <el-button @click="requestClose">取消</el-button>
        <el-button type="primary" :loading="loadingPreview" data-test="import-preview" @click="submitPreview">預覽資料</el-button>
      </template>
      <template v-else-if="step === 'preview'">
        <span v-if="importBlockedReason" class="footer-note" data-test="import-blocked-reason">{{ importBlockedReason }}</span>
        <el-button :disabled="busy" data-test="import-back" @click="backToFile">上一步</el-button>
        <el-button
          type="primary"
          :disabled="Boolean(importBlockedReason)"
          :loading="importing"
          data-test="import-submit"
          @click="submitImport"
        >
          開始匯入
        </el-button>
      </template>
      <template v-else>
        <el-button data-test="import-another" @click="startOver">再匯入一個檔案</el-button>
        <el-button type="primary" data-test="import-done" @click="requestClose">完成</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup>
/**
 * 考勤匯入對話框
 * - 預覽（dryRun）→ 顯示找不到員工的編號 → 手動對應／不匯入 → 正式匯入 → 顯示結果
 * - 時區預設台灣時間（Asia/Taipei），與伺服器的預設相同
 */
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { apiFetch, importAttendanceRecords } from '../../api'

const IMPORT_MAX_FILE_SIZE = 5 * 1024 * 1024
const IMPORT_EXTENSIONS = new Set(['xlsx', 'csv'])
const DEFAULT_TIMEZONE = 'Asia/Taipei'
const DEFAULT_MAPPINGS = Object.freeze({
  userId: '編號',
  timestamp: '日期時間',
  type: '簽到/退',
  remark: 'REMARK',
  name: '姓名'
})

// ---- Props / Emits ----
const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'import-complete'])

// ---- States ----
const visible = ref(props.modelValue)
// file：選擇檔案；preview：預覽與員工對應；result：匯入結果
const step = ref('file')
const selectedFile = ref(null)
const previewState = ref(null)
const loadingPreview = ref(false)
const importing = ref(false)
const employees = ref([])
const missingResolutions = reactive({})
const showMappings = ref(false)
const statusFilter = ref('all')

// 預設欄位映射（可被使用者調整對應到來源欄位名）
const form = reactive({
  timezone: DEFAULT_TIMEZONE,
  mappings: { ...DEFAULT_MAPPINGS }
})

const timezoneOptions = [
  { value: 'Asia/Taipei', label: '台灣時間（Asia/Taipei）' },
  { value: 'Asia/Kuala_Lumpur', label: '馬來西亞時間（Asia/Kuala_Lumpur）' },
  { value: 'Asia/Shanghai', label: '中國標準時間（Asia/Shanghai）' },
  { value: 'Asia/Tokyo', label: '日本時間（Asia/Tokyo）' },
  { value: 'UTC', label: '世界協調時間（UTC）' },
  { value: 'America/Los_Angeles', label: '美國太平洋時間（America/Los_Angeles）' },
  { value: 'Europe/London', label: '英國時間（Europe/London）' }
]

function timezoneLabel(value) {
  return timezoneOptions.find(option => option.value === value)?.label || value || ''
}

// 顯示用標籤
const mappingLabels = {
  userId: '員工編號',
  timestamp: '打卡時間',
  type: '簽到／簽退',
  remark: '備註（選填）',
  name: '姓名（選填）'
}

const mappingSummary = computed(() => (
  `員工編號「${form.mappings.userId}」、打卡時間「${form.mappings.timestamp}」、簽到／簽退「${form.mappings.type}」`
))

// 手機寬度由共用樣式（page.css 的 .el-dialog 規則）限制，這裡只寫桌機寬度
const dialogWidth = '860px'
const busy = computed(() => loadingPreview.value || importing.value)
const stepIndex = computed(() => ({ file: 0, preview: 1, result: 3 }[step.value] ?? 0))

// 員工下拉
const employeeOptions = computed(() =>
  employees.value.map(emp => ({
    value: emp._id,
    label: `${emp.name || emp.email || emp.employeeId || emp._id}（${emp.employeeId || emp.email || emp._id}）`
  }))
)

const summary = computed(() => previewState.value?.summary ?? {})
const previewRows = computed(() => previewState.value?.preview ?? [])
const missingUsers = computed(() => previewState.value?.missingUsers ?? [])
// 與既有打卡（線上或先前匯入）或檔案內重複而略過的筆數
const duplicateCount = computed(() => Number(summary.value.duplicateCount ?? 0))
// 預覽時「會新增」的筆數：已對應到員工的筆數扣掉重複略過的
const newCount = computed(() => Math.max(Number(summary.value.readyCount ?? 0) - duplicateCount.value, 0))
// 正式匯入（不是預覽）回來的統計才有實際新增的筆數
const importedCountKnown = computed(() => (
  Boolean(previewState.value) && previewState.value.dryRun === false && summary.value.importedCount !== undefined
))
// 伺服器只回傳檔案前幾十筆的明細
const previewTruncated = computed(() => Number(summary.value.totalRows ?? 0) > previewRows.value.length && previewRows.value.length > 0)
// 沒匯入的列：伺服器回了 issues（整個檔案所有錯誤、未對應、重複的列，依列號排序，最多 5,000 筆）就用它，
// 舊版伺服器只有預覽的前 50 列，從預覽裡挑
const serverIssues = computed(() => (Array.isArray(previewState.value?.issues) ? previewState.value.issues : null))
// issues 不含設定為「不匯入」的列：預覽裡不匯入的列照舊列進來（依列號排）
const issueRows = computed(() => {
  const fromPreview = previewRows.value.filter(row => row.status && row.status !== 'ready')
  if (!serverIssues.value) return fromPreview
  const seen = new Set(serverIssues.value.map(row => row.rowNumber))
  const ignored = fromPreview.filter(row => row.status === 'ignored' && !seen.has(row.rowNumber))
  if (!ignored.length) return serverIssues.value
  return [...serverIssues.value, ...ignored].sort((x, y) => (Number(x.rowNumber) || 0) - (Number(y.rowNumber) || 0))
})
const issueCount = computed(() => {
  const count = Number(previewState.value?.issueCount)
  if (!serverIssues.value || !Number.isFinite(count) || count < 0) return issueRows.value.length
  // issueCount 不含不匯入的列
  return count + issueRows.value.filter(row => row.status === 'ignored').length
})
const issuesTruncated = computed(() => Boolean(serverIssues.value) && previewState.value?.issuesTruncated === true)
const filteredRows = computed(() => (statusFilter.value === 'issues' ? issueRows.value : previewRows.value))

// 匯入按鈕是否可用：所有缺失的 USERID 都被對應或忽略
const canImport = computed(() => {
  if (!previewState.value) return false
  if (missingUsers.value.length === 0) return true
  return missingUsers.value.every(item => {
    const resolution = missingResolutions[item.identifier]
    if (!resolution) return false
    if (resolution.ignore) return true
    return Boolean(resolution.employeeId)
  })
})

// 已指定員工的編號共有幾筆（匯入時會一起新增）
const mappedMissingCount = computed(() => missingUsers.value.reduce((sum, item) => {
  const resolution = missingResolutions[item.identifier]
  return resolution && !resolution.ignore && resolution.employeeId ? sum + Number(item.count || 0) : sum
}, 0))

const importBlockedReason = computed(() => {
  if (!previewState.value) return ''
  if (!canImport.value) return '還有編號沒有對應員工，請選擇員工或勾選「不匯入」'
  if (newCount.value + mappedMissingCount.value === 0) return '沒有新的打卡資料可以匯入'
  return ''
})

const resultHeadline = computed(() => {
  const imported = Number(summary.value.importedCount ?? 0)
  if (imported > 0) return `已新增 ${imported} 筆打卡記錄`
  return '沒有新增任何打卡記錄'
})

// ---- Watchers ----
watch(
  () => props.modelValue,
  value => {
    visible.value = value
    if (value) {
      initializeDialog()
    }
  }
)

watch(visible, value => {
  emit('update:modelValue', value)
  if (!value) resetState()
})

// ---- Methods ----
function resetState() {
  step.value = 'file'
  selectedFile.value = null
  previewState.value = null
  loadingPreview.value = false
  importing.value = false
  showMappings.value = false
  statusFilter.value = 'all'
  Object.keys(missingResolutions).forEach(key => delete missingResolutions[key])
  Object.assign(form.mappings, DEFAULT_MAPPINGS)
  form.timezone = DEFAULT_TIMEZONE
}

async function initializeDialog() {
  try {
    // 取得員工清單（後端回傳 _id / name / email / employeeId 等）
    const res = await apiFetch('/api/employees/attendance-import-options')
    if (res.ok) {
      employees.value = await res.json()
    } else {
      throw new Error('無法取得員工清單')
    }
  } catch (error) {
    console.warn('載入員工清單失敗', error)
    ElMessage.warning('載入員工清單失敗，稍後可再試')
  }
}

function handleClose() {
  visible.value = false
}

// 匯入或讀取檔案進行中不能關閉（關掉以後看不到結果，也容易再按一次）
function beforeClose(done) {
  if (busy.value) return
  done()
}

function requestClose() {
  if (busy.value) return
  handleClose()
}

function backToFile() {
  if (busy.value) return
  step.value = 'file'
}

function startOver() {
  resetState()
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(Math.round(size / 1024), 1)} KB`
}

// Element Plus @change 會給 (uploadFile, uploadFiles)
function handleFileChange(uploadFile /* , uploadFiles */) {
  const raw = uploadFile?.raw
  if (!raw) return

  const extension = String(raw.name || '').split('.').pop()?.toLowerCase()
  if (!IMPORT_EXTENSIONS.has(extension)) {
    ElMessage.warning('請上傳 .xlsx 或 .csv 檔案')
    return
  }
  if (Number(raw.size) > IMPORT_MAX_FILE_SIZE) {
    ElMessage.warning('匯入檔案不可超過 5MB')
    return
  }
  selectedFile.value = raw
  // 換了檔案：先前的預覽與員工對應都不適用了
  previewState.value = null
  Object.keys(missingResolutions).forEach(key => delete missingResolutions[key])
}

// 'YYYY/MM/DD HH:mm:ss'（依所選時區），不受瀏覽器語系影響
function formatTimestamp(value, tz) {
  if (!value) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(value)).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value
      return acc
    }, {})
    const hour = parts.hour === '24' ? '00' : parts.hour
    return `${parts.year}/${parts.month}/${parts.day} ${hour}:${parts.minute}:${parts.second}`
  } catch {
    return String(value)
  }
}

// 伺服器的錯誤說明用的是考勤機的欄位代號，換成畫面上的欄位名稱
function humanizeImportError(message) {
  return String(message || '')
    .replace(/無法解析 CHECKTIME：CHECKTIME /g, '打卡時間')
    .replace(/\s*CHECKTIME\s*/g, '打卡時間')
    .replace(/\s*USERID\s*/g, '員工編號')
    .replace(/\s*CHECKTYPE\s*/g, '簽到／簽退')
}

// 明細每一列的說明：錯誤原因、重複的原因、對應到的員工
function describeRow(row) {
  if (Array.isArray(row.errors) && row.errors.length) return row.errors.map(humanizeImportError).join('、')
  if (row.status === 'duplicate') {
    return `${row.employee?.name ? `${row.employee.name}：` : ''}${row.duplicateReason || '已有同一時間的打卡記錄'}`
  }
  if (row.status === 'missing') return '找不到對應的員工'
  if (row.status === 'ignored') return '已設定為不匯入'
  if (row.status === 'ready') return row.employee?.name || ''
  return ''
}

const STATUS_LABELS = { missing: '未對應員工', ignored: '不匯入', error: '錯誤', duplicate: '重複略過' }

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 沒有匯入的列（錯誤、重複、未對應、不匯入）轉成 CSV 文字 */
function buildIssueCsv() {
  const lines = [['列', '編號', '時間', '動作', '狀態', '說明']]
  issueRows.value.forEach(row => {
    lines.push([
      row.rowNumber,
      row.userId || row.rawUserId || '',
      formatTimestamp(row.timestamp, form.timezone) || row.rawTimestamp || '',
      row.rawAction || row.action || '',
      STATUS_LABELS[row.status] || row.status || '',
      describeRow(row)
    ])
  })
  return lines.map(line => line.map(csvCell).join(',')).join('\r\n')
}

function downloadIssues() {
  // 加上 BOM，Excel 直接開啟才不會亂碼
  const blob = new Blob([`﻿${buildIssueCsv()}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `考勤匯入未匯入明細_${String(selectedFile.value?.name || '').replace(/\.[^.]+$/, '') || '檔案'}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function getResolution(identifier) {
  // 表格元件計算欄位時會用空白的列呼叫一次樣板：沒有編號就不要記進對應表（以前會多出一筆 'undefined'）
  if (identifier === undefined || identifier === null || identifier === '') return { employeeId: '', ignore: false }
  if (!missingResolutions[identifier]) {
    missingResolutions[identifier] = { employeeId: '', ignore: false }
  }
  return missingResolutions[identifier]
}

function toggleIgnore(identifier) {
  const t = getResolution(identifier)
  if (t.ignore) t.employeeId = ''
}

function buildFailureMessage(payload, fallbackMessage) {
  const reasons = Array.isArray(payload?.failureReasons)
    ? payload.failureReasons.filter(Boolean)
    : []
  const reasonText = reasons.length ? reasons.join('、') : ''
  // 伺服器的訊息有時已經帶著原因（「所有資料均未匯入：1 筆資料缺少對應員工」），不要再接一次
  if (payload?.message && reasonText && !payload.message.includes(reasonText)) {
    return `${payload.message}：${reasonText}`
  }
  if (payload?.message) {
    return payload.message
  }
  if (reasonText) {
    return reasonText
  }
  // 檔案讀不到、缺少欄位時伺服器把細節放在 errors（例如「找不到欄位：編號」）
  return fallbackMessage
}

// 讀不到檔案、缺少欄位：「匯入檔案缺少必要欄位：找不到欄位：編號」
function buildRequestErrorMessage(payload, fallbackMessage) {
  const details = Array.isArray(payload?.errors) ? payload.errors.filter(Boolean).join('、') : ''
  const base = payload?.message || payload?.error || fallbackMessage
  return details ? `${base}：${details}` : base
}

// 打包上傳資料（dryRun 控制預覽）
function buildFormData({ dryRun }) {
  if (!selectedFile.value) return null
  const formData = new FormData()
  formData.append('file', selectedFile.value)
  formData.append('mappings', JSON.stringify(form.mappings))
  formData.append('options', JSON.stringify({ timezone: form.timezone, dryRun }))

  if (!dryRun && missingUsers.value.length) {
    const userMappings = {}
    const ignoreUsers = []
    missingUsers.value.forEach(item => {
      const res = missingResolutions[item.identifier]
      if (!res) return
      if (res.ignore) {
        ignoreUsers.push(item.identifier)
      } else if (res.employeeId) {
        userMappings[item.identifier] = { _id: res.employeeId }
      }
    })
    if (Object.keys(userMappings).length) {
      formData.append('userMappings', JSON.stringify(userMappings))
    }
    if (ignoreUsers.length) {
      formData.append('ignoreUsers', JSON.stringify(ignoreUsers))
    }
  }
  return formData
}

async function submitPreview() {
  if (busy.value) return
  if (!selectedFile.value) {
    ElMessage.warning('請先選擇要匯入的檔案')
    return
  }
  loadingPreview.value = true
  try {
    const formData = buildFormData({ dryRun: true })
    const res = await importAttendanceRecords(formData)
    const payload = await (async () => {
      try { return await res.json() } catch { return {} }
    })()

    if (!res.ok) {
      ElMessage.error(buildRequestErrorMessage(payload, '預覽失敗'))
      return
    }

    previewState.value = payload
    statusFilter.value = 'all'
    step.value = 'preview'
    // 清空舊 resolution，再初始化新缺失清單
    Object.keys(missingResolutions).forEach(key => delete missingResolutions[key])
    ;(payload.missingUsers || []).forEach(item => {
      missingResolutions[item.identifier] = getResolution(item.identifier)
    })

    const previewDuplicates = Number(payload.summary?.duplicateCount ?? 0)
    if ((payload.missingUsers || []).length === 0) {
      if (previewDuplicates && previewDuplicates >= Number(payload.summary?.readyCount ?? 0)) {
        ElMessage.warning(`預覽完成：${previewDuplicates} 筆與既有打卡記錄重複，匯入時會略過，沒有新的打卡資料`)
      } else {
        ElMessage.success('預覽完成，可直接匯入')
      }
    } else {
      ElMessage.warning('部分資料需要對應員工後才能匯入')
    }
  } catch (error) {
    console.error(error)
    ElMessage.error('預覽失敗，請稍後再試')
  } finally {
    loadingPreview.value = false
  }
}

async function submitImport() {
  // 匯入中再按一次（或連點兩下）不會送出第二次
  if (busy.value) return
  if (!canImport.value) return
  const formData = buildFormData({ dryRun: false })
  if (!formData) return

  importing.value = true
  try {
    const res = await importAttendanceRecords(formData)
    const result = await (async () => {
      try { return await res.json() } catch { return {} }
    })()

    if (!res.ok) {
      if (result && typeof result === 'object') {
        previewState.value = result.preview ? result : previewState.value
      }
      ElMessage.error(result?.failureReasons || result?.summary
        ? buildFailureMessage(result, '匯入失敗，請稍後再試')
        : buildRequestErrorMessage(result, '匯入失敗，請稍後再試'))
      return
    }

    previewState.value = result
    const importedCount = Number(result?.summary?.importedCount ?? 0)
    if (importedCount <= 0) {
      // 全部都是已經有的打卡（例如同一個檔案再匯入一次）：不是錯誤，只是沒有新資料，保留對話框顯示重複略過的筆數
      if (Number(result?.summary?.duplicateCount ?? 0) > 0 && !result?.failureReasons?.length) {
        step.value = 'result'
        ElMessage.warning(result.message || '沒有新的打卡記錄：資料與既有打卡記錄重複，已略過')
        return
      }
      ElMessage.error(buildFailureMessage(result, '所有資料均未匯入'))
      return
    }

    // 匯入完成後留在對話框顯示結果（新增、重複略過、沒匯入的明細），由管理者按「完成」關閉
    step.value = 'result'
    statusFilter.value = issueRows.value.length ? 'issues' : 'all'
    ElMessage.success(result.message || '考勤資料匯入完成')
    emit('import-complete', result)
  } catch (error) {
    console.error(error)
    ElMessage.error('匯入失敗，請稍後再試')
  } finally {
    importing.value = false
  }
}

defineExpose({
  step,
  form,
  visible,
  selectedFile,
  previewState,
  submitPreview,
  submitImport,
  missingResolutions,
  buildIssueCsv
})
</script>

<style scoped>
.import-steps {
  margin-bottom: var(--hr-space-md);
}

.import-section {
  display: flex;
  flex-direction: column;
  gap: var(--hr-space-sm);
}

.timezone-select {
  width: 320px;
  max-width: 100%;
}

.upload-tip {
  margin-top: 6px;
  font-size: 13px;
  color: var(--hr-gray-600);
}

.mapping-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hr-space-sm);
  font-size: 13px;
  color: var(--hr-gray-700);
}

.mapping-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
  margin-top: var(--hr-space-sm);
}

.mapping-label {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  color: var(--hr-gray-600);
}

.mapping-hint {
  grid-column: 1 / -1;
  margin-top: 0;
}

.import-source-hint {
  margin: 0;
}

.result-headline {
  margin: 0;
  font-size: var(--hr-font-size-lg);
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-900);
}

.summary-text {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hr-space-sm);
}

.summary-stat--good .hr-stat__value {
  color: var(--hr-secondary-dark);
}

.summary-stat--warn .hr-stat__value {
  color: #b45309;
}

.summary-stat--bad .hr-stat__value {
  color: var(--hr-error);
}

.section-title {
  margin: 0;
  font-size: var(--hr-font-size-sm);
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-900);
}

.mapping-section,
.preview-section {
  margin-top: var(--hr-space-sm);
}

.row-note {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.4;
  color: #b45309;
}

.import-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: var(--hr-space-md);
  font-size: 13px;
  color: var(--hr-gray-600);
}

.footer-note {
  margin-right: var(--hr-space-sm);
  font-size: 13px;
  color: #b45309;
}

@media (max-width: 767px) {
  .mapping-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
