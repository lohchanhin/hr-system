<template>
  <el-dialog
    :model-value="visible"
    title="考勤資料匯入"
    width="720px"
    @close="handleClose"
  >
    <div class="import-section">
      <el-alert type="info" show-icon class="import-hint">
        <template #title>上傳考勤檔案後可先預覽資料，確認欄位與員工對應再正式匯入。</template>
        系統預設欄位為考勤機匯出格式：「編號」、「姓名」、「日期時間」、「簽到/退」。如您的考勤機使用不同欄位名稱（如 USERID、NAME、CHECKTIME、CHECKTYPE），請在「欄位對應」中修改對應的欄位名稱。
      </el-alert>

      <el-form label-width="140px" class="import-form">
        <el-form-item label="檔案上傳">
          <el-upload
            action=""
            :auto-upload="false"
            :show-file-list="false"
            accept=".xlsx,.xls,.csv"
            @change="handleFileChange"
          >
            <el-button type="primary">選擇檔案</el-button>
            <template #tip>
              <div class="upload-tip">
                {{ selectedFile ? `已選擇：${selectedFile.name}` : '支援 Excel 或 CSV 檔案。預設使用考勤機格式（編號/姓名/日期時間/簽到退），如有不同可在下方調整欄位對應。' }}
              </div>
            </template>
          </el-upload>
        </el-form-item>

        <el-form-item label="時區">
          <el-select v-model="form.timezone" placeholder="選擇時區" filterable>
            <el-option
              v-for="item in timezoneOptions"
              :key="item"
              :label="item"
              :value="item"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="欄位對應">
          <div class="mapping-grid">
            <div class="mapping-item" v-for="(value, key) in form.mappings" :key="key">
              <label class="mapping-label">{{ mappingLabels[key] }}</label>
              <el-input v-model="form.mappings[key]" placeholder="輸入對應欄位名稱" />
            </div>
          </div>
          <div class="mapping-suggest">
            常見別名示例：USERID/EmpID/編號、CHECKTIME/DateTime/日期時間、CHECKTYPE/InOut/Direction/簽到退、NAME/姓名、REMARK/Memo
          </div>
        </el-form-item>
      </el-form>

      <div class="dialog-actions">
        <el-button @click="handleClose">取消</el-button>
        <el-button type="primary" :loading="loadingPreview" @click="submitPreview">預覽資料</el-button>
      </div>
    </div>

    <template v-if="previewState">
      <el-divider />
      <section class="preview-section">
        <h3>匯入預覽</h3>
        <p class="summary-text">
          共 {{ previewState.summary.totalRows }} 筆，
          已匹配 {{ previewState.summary.readyCount }} 筆，
          待處理 {{ previewState.summary.missingCount }} 筆，
          忽略 {{ previewState.summary.ignoredCount }} 筆，
          發生錯誤 {{ previewState.summary.errorCount }} 筆。
        </p>
        <el-table :data="previewRows" height="240" border>
          <el-table-column prop="rowNumber" label="列" width="60" />
          <el-table-column prop="userId" label="USERID" width="140" />
          <el-table-column label="時間" width="220">
            <template #default="{ row }">
              <span>{{ formatTimestamp(row.timestamp, form.timezone) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="action" label="動作" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.action === 'in' || row.action === 'clockIn'">I / 上班</el-tag>
              <el-tag
                v-else-if="row.action === 'out' || row.action === 'clockOut'"
                type="warning"
              >
                O / 下班
              </el-tag>
              <span v-else>{{ row.action }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="狀態" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.status === 'ready'" type="success">已就緒</el-tag>
              <el-tag v-else-if="row.status === 'missing'" type="info">未匹配</el-tag>
              <el-tag v-else-if="row.status === 'ignored'">忽略</el-tag>
              <el-tag v-else-if="row.status === 'error'" type="danger">錯誤</el-tag>
              <span v-else>{{ row.status }}</span>
            </template>
          </el-table-column>
          <el-table-column label="訊息">
            <template #default="{ row }">
              <span v-if="Array.isArray(row.errors) && row.errors.length">{{ row.errors.join('、') }}</span>
              <span v-else-if="row.status === 'missing'">尚未對應員工</span>
              <span v-else-if="row.status === 'ready'">{{ row.employee?.name || '' }}</span>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section v-if="missingUsers.length" class="mapping-section">
        <h3>員工對應</h3>
        <p class="section-hint">為下列識別值選擇對應的員工或設定忽略後即可重新送出匯入。</p>
        <el-table :data="missingUsers" height="240" border>
          <el-table-column prop="identifier" label="USERID" width="180" />
          <el-table-column prop="count" label="筆數" width="80" />
          <el-table-column label="對應員工">
            <template #default="{ row }">
              <el-select
                v-model="getResolution(row.identifier).employeeId"
                placeholder="選擇員工"
                :disabled="getResolution(row.identifier).ignore"
                filterable
                style="width: 100%;"
              >
                <el-option
                  v-for="emp in employeeOptions"
                  :key="emp.value"
                  :label="emp.label"
                  :value="emp.value"
                />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="忽略" width="120">
            <template #default="{ row }">
              <el-checkbox v-model="getResolution(row.identifier).ignore" @change="toggleIgnore(row.identifier)">
                忽略此次匯入
              </el-checkbox>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <div class="dialog-actions">
        <el-button @click="handleClose">取消</el-button>
        <el-button
          type="primary"
          :disabled="!canImport"
          :loading="importing"
          @click="submitImport"
        >
          開始匯入
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
/**
 * ✅ 考勤匯入彈窗（完整可用）
 * - 預覽（dryRun）→ 顯示未匹配 USERID → 手動對應/忽略 → 正式匯入
 * - 內建時區格式化、欄位對應、錯誤提示、狀態復原
 * - 預設時區：Asia/Kuala_Lumpur
 */

import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

// 你既有的 API helper，如無請在下方「API 小幫手」區塊一起帶走
import { apiFetch, importAttendanceRecords } from '../../api'

// ---- Props / Emits ----
const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'import-complete'])

// ---- States ----
const visible = ref(props.modelValue)
const selectedFile = ref(null)
const previewState = ref(null)
const loadingPreview = ref(false)
const importing = ref(false)
const employees = ref([])
const missingResolutions = reactive({})

// 預設欄位映射（可被使用者調整對應到來源欄位名）
const form = reactive({
  timezone: 'Asia/Kuala_Lumpur',
  mappings: {
    userId: '編號',
    timestamp: '日期時間',
    type: '簽到/退',
    remark: 'REMARK',
    name: '姓名',
  }
})

// 常見時區（可再加）
const timezoneOptions = [
  'Asia/Kuala_Lumpur',
  'Asia/Taipei',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'UTC',
  'America/Los_Angeles',
  'Europe/London'
]

// 顯示用標籤
const mappingLabels = {
  userId: 'USERID 欄位',
  timestamp: 'CHECKTIME 欄位',
  type: 'CHECKTYPE 欄位',
  remark: '備註欄位 (選填)',
  name: '姓名欄位 (選填)'
}

// 員工下拉
const employeeOptions = computed(() =>
  employees.value.map(emp => ({
    value: emp._id,
    label: `${emp.name || emp.email || emp.employeeId || emp._id}（${emp.employeeId || emp.email || emp._id}）`
  }))
)

const previewRows = computed(() => previewState.value?.preview ?? [])
const missingUsers = computed(() => previewState.value?.missingUsers ?? [])

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
  selectedFile.value = null
  previewState.value = null
  loadingPreview.value = false
  importing.value = false
  Object.keys(missingResolutions).forEach(key => delete missingResolutions[key])
  form.mappings.userId = '編號'
  form.mappings.timestamp = '日期時間'
  form.mappings.type = '簽到/退'
  form.mappings.remark = 'REMARK'
  form.mappings.name = '姓名'
  form.timezone = 'Asia/Kuala_Lumpur'
}

async function initializeDialog() {
  try {
    // 取得員工清單（後端回傳 _id / name / email / employeeId 等）
    const res = await apiFetch('/api/employees')
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

// Element Plus @change 會給 (uploadFile, uploadFiles)
function handleFileChange(uploadFile /* , uploadFiles */) {
  if (uploadFile?.raw) {
    selectedFile.value = uploadFile.raw
  }
}

function formatTimestamp(value, tz) {
  if (!value) return ''
  try {
    // 交給 Intl 依所選時區顯示
    const dt = new Date(value)
    const fmt = new Intl.DateTimeFormat(undefined, {
      timeZone: tz || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    return fmt.format(dt)
  } catch {
    return String(value)
  }
}

function getResolution(identifier) {
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
  if (payload?.message && reasonText) {
    return `${payload.message}：${reasonText}`
  }
  if (payload?.message) {
    return payload.message
  }
  if (reasonText) {
    return reasonText
  }
  return fallbackMessage
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
      ElMessage.error(payload.message || '預覽失敗')
      return
    }

    previewState.value = payload
    // 清空舊 resolution，再初始化新缺失清單
    Object.keys(missingResolutions).forEach(key => delete missingResolutions[key])
    ;(payload.missingUsers || []).forEach(item => {
      missingResolutions[item.identifier] = getResolution(item.identifier)
    })

    if ((payload.missingUsers || []).length === 0) {
      ElMessage.success('預覽完成，可直接匯入')
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
        previewState.value = result.summary ? result : previewState.value
      }
      ElMessage.error(buildFailureMessage(result, '匯入失敗，請稍後再試'))
      return
    }

    previewState.value = result
    const importedCount = Number(result?.summary?.importedCount ?? 0)
    if (importedCount <= 0) {
      ElMessage.error(buildFailureMessage(result, '所有資料均未匯入'))
      return
    }

    ElMessage.success(result.message || '考勤資料匯入完成')
    emit('import-complete', result)
    handleClose()
  } catch (error) {
    console.error(error)
    ElMessage.error('匯入失敗，請稍後再試')
  } finally {
    importing.value = false
  }
}

defineExpose({
  selectedFile,
  submitPreview,
  submitImport,
  missingResolutions
})
</script>




<style scoped>
.import-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.import-hint {
  margin-bottom: 8px;
}

.import-form {
  margin-top: 8px;
}

.mapping-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.mapping-item label {
  font-size: 13px;
  color: #666;
  display: block;
  margin-bottom: 4px;
}

.upload-tip {
  margin-top: 6px;
  color: #666;
}

.preview-section {
  margin-bottom: 16px;
}

.summary-text {
  margin-bottom: 8px;
  color: #555;
}

.mapping-section {
  margin-top: 12px;
}

.section-hint {
  margin-bottom: 8px;
  color: #666;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
