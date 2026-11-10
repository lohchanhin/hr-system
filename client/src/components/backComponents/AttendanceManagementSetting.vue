<!-- 出勤管理：查詢打卡記錄（線上、指紋匯入）與匯入考勤機資料 -->
<template>
  <div class="attendance-management">
    <PageHeader title="出勤管理" subtitle="查詢打卡記錄，匯入考勤機（指紋）資料；時間一律以台灣時間顯示">
      <template #actions>
        <el-button
          type="primary"
          data-test="attendance-import-button"
          @click="attendanceImportVisible = true"
        >
          匯入考勤資料
        </el-button>
      </template>
    </PageHeader>

    <section class="hr-section">
      <div class="hr-toolbar">
        <el-select
          v-model="filters.employee"
          class="employee-filter"
          placeholder="全部員工"
          filterable
          clearable
          :loading="employeesLoading"
          data-test="record-employee-filter"
        >
          <el-option v-for="emp in employeeOptions" :key="emp.value" :label="emp.label" :value="emp.value" />
        </el-select>
        <el-date-picker
          v-model="filters.range"
          type="daterange"
          value-format="YYYY-MM-DD"
          format="YYYY/MM/DD"
          range-separator="至"
          start-placeholder="開始日期"
          end-placeholder="結束日期"
          :clearable="false"
          class="range-filter"
          data-test="record-range-filter"
        />
        <el-select v-model="filters.source" class="source-filter" placeholder="全部來源" clearable data-test="record-source-filter">
          <el-option v-for="option in SOURCE_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
        <el-button type="primary" plain :loading="loading" data-test="record-search" @click="fetchRecords">查詢</el-button>
        <span class="hr-toolbar__spacer" />
        <span class="record-count" data-test="record-count">{{ countText }}</span>
      </div>

      <el-alert
        v-if="loadError"
        class="record-alert"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
        data-test="record-error"
      />
      <el-alert
        v-else-if="truncated"
        class="record-alert"
        type="warning"
        :closable="false"
        show-icon
        :title="`這段期間的記錄超過 ${RECORD_LIMIT} 筆，只顯示最新的 ${RECORD_LIMIT} 筆；請縮短日期範圍或指定員工。`"
        data-test="record-truncated"
      />

      <el-table
        v-loading="loading"
        :data="pagedRecords"
        class="record-table"
        data-test="record-table"
        :empty-text="emptyText"
      >
        <el-table-column label="打卡時間" min-width="180">
          <template #default="{ row }">{{ formatTaiwanDateTime(row.timestamp, { seconds: true }) }}（{{ taiwanWeekday(row.timestamp) }}）</template>
        </el-table-column>
        <el-table-column label="員工" min-width="180">
          <template #default="{ row }">
            <span>{{ row.employee?.name || '（員工資料已刪除）' }}</span>
            <span v-if="row.employee?.employeeId" class="employee-no">{{ row.employee.employeeId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="動作" width="120">
          <template #default="{ row }">{{ ACTION_LABELS[row.action] || row.action }}</template>
        </el-table-column>
        <el-table-column label="來源" width="120">
          <template #default="{ row }">
            <el-tag :type="attendanceSourceTagType(row.source)" size="small" disable-transitions>
              {{ attendanceSourceLabel(row.source) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="備註" min-width="160" show-overflow-tooltip />
      </el-table>

      <el-pagination
        v-if="filteredRecords.length > PAGE_SIZE"
        v-model:current-page="page"
        class="record-pagination"
        layout="prev, pager, next"
        :page-size="PAGE_SIZE"
        :total="filteredRecords.length"
        data-test="record-pagination"
      />
    </section>

    <AttendanceImportDialog
      v-model="attendanceImportVisible"
      @import-complete="handleAttendanceImportComplete"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { apiFetch } from '../../api'
import PageHeader from '../PageHeader.vue'
import AttendanceImportDialog from './AttendanceImportDialog.vue'
import { attendanceSourceLabel, attendanceSourceTagType, resolveAttendanceSource } from '../../utils/attendanceSource'
import { formatTaiwanDateTime, shiftDateKey, taiwanDateKey, taiwanWeekday } from '../../utils/dateFormatter'

const RECORD_LIMIT = 2000
const PAGE_SIZE = 50
const DEFAULT_RANGE_DAYS = 7

const ACTION_LABELS = {
  clockIn: '上班簽到',
  clockOut: '下班簽退',
  outing: '外出登記',
  breakIn: '休息'
}

const SOURCE_OPTIONS = ['online', 'import', 'manual', 'legacy'].map((value) => ({ value, label: attendanceSourceLabel(value) }))

const attendanceImportVisible = ref(false)
const employees = ref([])
const employeesLoading = ref(false)
const records = ref([])
const loading = ref(false)
const loadError = ref('')
const truncated = ref(false)
const searched = ref(false)
const page = ref(1)
// 查詢中又按了一次（換條件、連點）：只採用最後一次的回應
let requestId = 0

// 預設查最近 7 天（台灣日期）
function defaultRange() {
  const today = taiwanDateKey(new Date())
  return [shiftDateKey(today, -(DEFAULT_RANGE_DAYS - 1)), today]
}

const filters = reactive({ employee: '', range: defaultRange(), source: '' })

const employeeOptions = computed(() => employees.value.map((emp) => ({
  value: emp._id,
  label: `${emp.name || emp.employeeId || emp._id}${emp.employeeId ? `（${emp.employeeId}）` : ''}`
})))

const filteredRecords = computed(() => (
  filters.source ? records.value.filter((record) => resolveAttendanceSource(record.source) === filters.source) : records.value
))
const pagedRecords = computed(() => filteredRecords.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
const countText = computed(() => (searched.value && !loading.value ? `共 ${filteredRecords.value.length} 筆` : ''))
const emptyText = computed(() => (
  loadError.value ? '讀取失敗' : '這段期間沒有打卡記錄；可以調整日期範圍，或按右上角「匯入考勤資料」'
))

// 清除下拉選單時 Element Plus 給的是 undefined／null，一律當成「全部」
watch(() => filters.source, (value) => {
  if (value === undefined || value === null) filters.source = ''
  page.value = 1
})

async function loadEmployees() {
  employeesLoading.value = true
  try {
    const res = await apiFetch('/api/employees/attendance-import-options')
    if (!res?.ok) return
    const data = await res.json().catch(() => [])
    employees.value = Array.isArray(data) ? data : []
  } catch {
    // 員工清單讀不到時仍可查全部員工的記錄
  } finally {
    employeesLoading.value = false
  }
}

async function fetchRecords() {
  const [start, end] = Array.isArray(filters.range) ? filters.range : []
  if (!start || !end) {
    loadError.value = '請選擇日期範圍'
    return
  }
  const current = ++requestId
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams({ start, end, limit: String(RECORD_LIMIT) })
    if (filters.employee) params.set('employee', filters.employee)
    const res = await apiFetch(`/api/attendance?${params.toString()}`)
    const data = await res.json().catch(() => null)
    if (current !== requestId) return
    if (!res.ok) {
      loadError.value = `讀取打卡記錄失敗${data?.error ? `：${data.error}` : ''}`
      records.value = []
      return
    }
    const list = Array.isArray(data) ? data : []
    // 伺服器依台灣日期篩選；這裡再用同樣的規則過濾一次，舊版伺服器不認得日期參數時也不會列出範圍以外的記錄
    const inRange = list.filter((record) => {
      const key = taiwanDateKey(record.timestamp)
      return key && key >= start && key <= end
    })
    truncated.value = list.length >= RECORD_LIMIT && inRange.length === list.length
    records.value = inRange
    page.value = 1
    searched.value = true
  } catch (error) {
    if (current !== requestId) return
    loadError.value = `讀取打卡記錄失敗（${error?.message || '連線失敗'}）`
    records.value = []
  } finally {
    if (current === requestId) loading.value = false
  }
}

// 匯入完成後重新查詢，剛匯入的記錄若在目前的日期範圍內會直接出現（結果訊息由匯入對話框顯示）
function handleAttendanceImportComplete() {
  fetchRecords()
}

onMounted(() => {
  loadEmployees()
  fetchRecords()
})

defineExpose({ filters, records, filteredRecords, fetchRecords, loadError, truncated })
</script>

<style scoped>
.employee-filter {
  width: 220px;
}

.source-filter {
  width: 140px;
}

/* 日期範圍選擇器預設固定 350px，窄螢幕不可超出畫面 */
.attendance-management :deep(.el-date-editor--daterange) {
  max-width: 100%;
  box-sizing: border-box;
}

.record-count {
  font-size: 13px;
  color: var(--hr-gray-600);
}

.record-alert {
  margin-bottom: var(--hr-space-sm);
}

.record-table {
  width: 100%;
}

.employee-no {
  margin-left: 8px;
  font-size: 12px;
  color: var(--hr-gray-500);
}

.record-pagination {
  justify-content: flex-end;
  margin-top: var(--hr-space-sm);
}

@media (max-width: 767px) {
  .employee-filter,
  .source-filter {
    width: 100%;
  }
}
</style>
