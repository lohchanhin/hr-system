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
        系統預設欄位為 USERID、CHECKTIME、CHECKTYPE，若來源檔案不同可於下方調整欄位名稱。
      </el-alert>

      <el-form label-width="140px" class="import-form">
        <el-form-item label="檔案上傳">
          <el-upload
            action=""
            :auto-upload="false"
            :show-file-list="false"
            accept=".xlsx,.csv"
            @change="handleFileChange"
          >
            <el-button type="primary">選擇檔案</el-button>
            <template #tip>
              <div class="upload-tip">
                {{ selectedFile ? `已選擇：${selectedFile.name}` : '支援 Excel 或 CSV 檔案，欄位需包含 USERID、CHECKTIME、CHECKTYPE。' }}
              </div>
            </template>
          </el-upload>
        </el-form-item>

        <el-form-item label="時區">
          <el-select v-model="form.timezone" placeholder="選擇時區">
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
              <label>{{ mappingLabels[key] }}</label>
              <el-input v-model="form.mappings[key]" placeholder="輸入對應欄位名稱" />
            </div>
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
        <el-table :data="previewRows" height="220">
          <el-table-column prop="rowNumber" label="列" width="60" />
          <el-table-column prop="userId" label="USERID" width="140" />
          <el-table-column label="時間" width="200">
            <template #default="{ row }">
              <span>{{ formatTimestamp(row.timestamp) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="action" label="動作" width="120" />
          <el-table-column prop="status" label="狀態" width="100" />
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
        <el-table :data="missingUsers" height="200">
          <el-table-column prop="identifier" label="USERID" width="140" />
          <el-table-column prop="count" label="筆數" width="80" />
          <el-table-column label="對應員工">
            <template #default="{ row }">
              <el-select
                v-model="getResolution(row.identifier).employeeId"
                placeholder="選擇員工"
                :disabled="getResolution(row.identifier).ignore"
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
          <el-table-column label="忽略">
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
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { apiFetch, importAttendanceRecords } from '../../api'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'import-complete'])

const visible = ref(props.modelValue)
const selectedFile = ref(null)
const previewState = ref(null)
const loadingPreview = ref(false)
const importing = ref(false)
const employees = ref([])
const missingResolutions = reactive({})

const form = reactive({
  timezone: 'Asia/Taipei',
  mappings: {
    userId: 'USERID',
    timestamp: 'CHECKTIME',
    type: 'CHECKTYPE',
    remark: 'REMARK'
  }
})

const timezoneOptions = [
  'Asia/Taipei',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'UTC',
  'America/Los_Angeles',
  'Europe/London'
]

const mappingLabels = {
  userId: 'USERID 欄位',
  timestamp: 'CHECKTIME 欄位',
  type: 'CHECKTYPE 欄位',
  remark: '備註欄位 (選填)'
}

const employeeOptions = computed(() =>
  employees.value.map(emp => ({
    value: emp._id,
    label: `${emp.name || emp.email} (${emp.employeeId || emp.email || emp._id})`
  }))
)

const previewRows = computed(() => previewState.value?.preview ?? [])
const missingUsers = computed(() => previewState.value?.missingUsers ?? [])

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
  if (!value) {
    resetState()
  }
})

function resetState() {
  selectedFile.value = null
  previewState.value = null
  loadingPreview.value = false
  importing.value = false
  Object.keys(missingResolutions).forEach(key => delete missingResolutions[key])
  form.mappings.userId = 'USERID'
  form.mappings.timestamp = 'CHECKTIME'
  form.mappings.type = 'CHECKTYPE'
  form.mappings.remark = 'REMARK'
  form.timezone = 'Asia/Taipei'
}

async function initializeDialog() {
  try {
    const res = await apiFetch('/api/employees')
    if (res.ok) {
      employees.value = await res.json()
    }
  } catch (error) {
    console.warn('載入員工清單失敗', error)
  }
}

function handleClose() {
  visible.value = false
}

function handleFileChange(file) {
  if (file?.raw) {
    selectedFile.value = file.raw
  }
}

function formatTimestamp(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString()
  } catch (error) {
    return value
  }
}

function getResolution(identifier) {
  if (!missingResolutions[identifier]) {
    missingResolutions[identifier] = {
      employeeId: '',
      ignore: false
    }
  }
  return missingResolutions[identifier]
}

function toggleIgnore(identifier) {
  const target = getResolution(identifier)
  if (target.ignore) {
    target.employeeId = ''
  }
}

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
      const resolution = missingResolutions[item.identifier]
      if (!resolution) return
      if (resolution.ignore) {
        ignoreUsers.push(item.identifier)
        return
      }
      if (resolution.employeeId) {
        userMappings[item.identifier] = { _id: resolution.employeeId }
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
    if (!res.ok) {
      const message = (await res.json().catch(() => ({}))).message || '預覽失敗'
      ElMessage.error(message)
      return
    }
    const result = await res.json()
    previewState.value = result
    Object.keys(missingResolutions).forEach(key => delete missingResolutions[key])
    result.missingUsers.forEach(item => {
      missingResolutions[item.identifier] = getResolution(item.identifier)
    })
    if (result.missingUsers.length === 0) {
      ElMessage.success('預覽完成，可直接匯入')
    } else {
      ElMessage.warning('部分資料需要對應員工後才能匯入')
    }
  } catch (error) {
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
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      ElMessage.error(payload.message || '匯入失敗，請稍後再試')
      return
    }
    const result = await res.json()
    previewState.value = result
    ElMessage.success(result.message || '考勤資料匯入完成')
    emit('import-complete', result)
    handleClose()
  } catch (error) {
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
