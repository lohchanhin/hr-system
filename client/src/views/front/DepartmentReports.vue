<template>
  <div class="department-reports-page">
    <header class="page-header">
      <h1 class="page-title">部門報表中心</h1>
      <p class="page-subtitle">彙整各部門出勤、請假、薪資與保險統計</p>
    </header>

    <el-card class="filters-card" shadow="never">
      <template #header>
        <div class="card-header">
          <h2>匯出條件</h2>
          <span class="card-tip">請先選擇月份、部門與報表種類</span>
        </div>
      </template>
      <div class="filters-grid">
        <div class="filter-item">
          <label class="filter-label">月份</label>
          <el-date-picker
            v-model="selectedMonth"
            type="month"
            placeholder="選擇月份"
            format="YYYY 年 MM 月"
            value-format="YYYY-MM"
            :disabled="loading.departments"
            class="w-full"
          />
        </div>
        <div class="filter-item">
          <label class="filter-label">部門</label>
          <el-select
            v-model="selectedDepartment"
            placeholder="選擇部門"
            filterable
            :loading="loading.departments"
            :disabled="loading.departments || departments.length === 0"
            class="w-full"
          >
            <el-option
              v-for="dept in departments"
              :key="dept._id"
              :label="dept.name"
              :value="dept._id"
            />
          </el-select>
        </div>
        <div class="filter-item">
          <label class="filter-label">報表種類</label>
          <el-select v-model="reportType" placeholder="選擇報表" class="w-full">
            <el-option
              v-for="type in reportTypes"
              :key="type.value"
              :label="type.label"
              :value="type.value"
            />
          </el-select>
        </div>
        <div class="filter-item">
          <label class="filter-label">匯出格式</label>
          <el-select v-model="exportFormat" placeholder="選擇格式" class="w-full">
            <el-option
              v-for="format in exportFormats"
              :key="format.value"
              :label="format.label"
              :value="format.value"
            />
          </el-select>
        </div>
      </div>
      <div class="actions">
        <el-button
          :disabled="!canPreview || preview.loading"
          :loading="preview.loading"
          @click="handlePreview"
        >
          預覽摘要
        </el-button>
        <el-button
          type="primary"
          :disabled="!canExport || exporting"
          :loading="exporting"
          @click="exportReport"
        >
          匯出報表
        </el-button>
      </div>
    </el-card>

    <el-alert
      v-if="preview.state === 'empty'"
      type="info"
      show-icon
      class="mt-4"
      title="目前條件下沒有可供預覽的資料"
    />

    <el-card v-if="preview.state === 'success'" class="preview-card" shadow="never">
      <template #header>
        <div class="card-header">
          <h2>報表摘要</h2>
          <span class="card-tip">以下內容來自後端 JSON 預覽</span>
        </div>
      </template>
      <div v-if="preview.summary" class="summary-grid">
        <div class="summary-item" v-for="item in summaryItems" :key="item.label">
          <span class="summary-label">{{ item.label }}</span>
          <span class="summary-value">{{ item.value }}</span>
        </div>
      </div>
      <el-table
        v-if="preview.records.length"
        :data="preview.records"
        border
        class="preview-table"
      >
        <el-table-column prop="name" label="員工" min-width="140" />
        <el-table-column
          v-for="column in dynamicColumns"
          :key="column.prop"
          :prop="column.prop"
          :label="column.label"
          :min-width="column.minWidth || 120"
        />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'
import { apiFetch } from '../../api'

const departments = ref([])
const reportTypes = [
  { value: 'attendance', label: '出勤統計' },
  { value: 'leave', label: '請假統計' },
  { value: 'salary', label: '薪資試算' },
  { value: 'insurance', label: '保險申報' },
]
const exportFormats = [
  { value: 'excel', label: 'Excel (.xlsx)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
]

const selectedMonth = ref(dayjs().format('YYYY-MM'))
const selectedDepartment = ref('')
const reportType = ref('attendance')
const exportFormat = ref('excel')
const exporting = ref(false)

const preview = reactive({
  loading: false,
  state: 'idle',
  summary: null,
  records: [],
})

const loading = reactive({
  departments: false,
})

const reportEndpointMap = {
  attendance: '/api/reports/department/attendance/export',
  leave: '/api/reports/department/leave/export',
  salary: '/api/reports/department/salary/export',
  insurance: '/api/reports/department/insurance/export',
}

const formatExtensionMap = {
  excel: 'xlsx',
  pdf: 'pdf',
}

const canExport = computed(
  () => Boolean(selectedMonth.value && selectedDepartment.value && reportEndpointMap[reportType.value])
)

const canPreview = computed(() => canExport.value)

const dynamicColumns = computed(() => {
  if (reportType.value === 'attendance') {
    return [
      { prop: 'scheduled', label: '排班天數', minWidth: 120 },
      { prop: 'attended', label: '出勤天數', minWidth: 120 },
      { prop: 'absent', label: '缺勤天數', minWidth: 120 },
    ]
  }
  if (reportType.value === 'leave') {
    return [
      { prop: 'leaveType', label: '假別', minWidth: 160 },
      { prop: 'startDate', label: '開始日期', minWidth: 140 },
      { prop: 'endDate', label: '結束日期', minWidth: 140 },
      { prop: 'days', label: '天數', minWidth: 100 },
    ]
  }
  if (reportType.value === 'salary') {
    return [
      { prop: 'baseSalary', label: '基本薪資', minWidth: 140 },
      { prop: 'allowance', label: '津貼', minWidth: 120 },
      { prop: 'deduction', label: '扣款', minWidth: 120 },
      { prop: 'payable', label: '應發金額', minWidth: 140 },
    ]
  }
  if (reportType.value === 'insurance') {
    return [
      { prop: 'insuranceType', label: '保險別', minWidth: 140 },
      { prop: 'employeeShare', label: '員工自付', minWidth: 140 },
      { prop: 'employerShare', label: '公司負擔', minWidth: 140 },
      { prop: 'total', label: '總計', minWidth: 120 },
    ]
  }
  return []
})

const summaryItems = computed(() => {
  if (!preview.summary) return []
  if (reportType.value === 'attendance') {
    return [
      { label: '排班總計', value: preview.summary.scheduled },
      { label: '出勤總計', value: preview.summary.attended },
      { label: '缺勤總計', value: preview.summary.absent },
    ]
  }
  if (reportType.value === 'leave') {
    const base = [
      { label: '總請假件數', value: preview.summary.totalLeaves },
      { label: '總請假天數', value: preview.summary.totalDays },
    ]
    const byType = Array.isArray(preview.summary.byType)
      ? preview.summary.byType.map((item) => ({
          label: `${item.leaveType || item.leaveCode} 件數`,
          value: `${item.count ?? 0} 筆 / ${item.days ?? 0} 天`,
        }))
      : []
    return [...base, ...byType]
  }
  if (reportType.value === 'salary') {
    return [
      { label: '總人數', value: preview.summary.totalEmployees ?? preview.records.length },
      { label: '應發總額', value: preview.summary.totalPayable ?? preview.summary.total ?? 0 },
      { label: '實發總額', value: preview.summary.totalActual ?? preview.summary.actual ?? 0 },
    ]
  }
  if (reportType.value === 'insurance') {
    return [
      { label: '投保人數', value: preview.summary.totalEmployees ?? preview.records.length },
      { label: '員工自付總額', value: preview.summary.employeeShare ?? 0 },
      { label: '公司負擔總額', value: preview.summary.employerShare ?? 0 },
    ]
  }
  return []
})

onMounted(async () => {
  loading.departments = true
  try {
    const res = await apiFetch('/api/departments')
    if (!res.ok) {
      throw new Error('無法取得部門清單')
    }
    const data = await res.json()
    departments.value = Array.isArray(data) ? data : []
    if (!selectedDepartment.value && departments.value.length) {
      selectedDepartment.value = departments.value[0]._id
    }
  } catch (err) {
    ElMessage.error(err.message || '取得部門資料失敗')
  } finally {
    loading.departments = false
  }
})

function buildQuery(params) {
  const usp = new URLSearchParams(params)
  return `?${usp.toString()}`
}

async function handlePreview() {
  if (!canPreview.value) return
  const endpoint = reportEndpointMap[reportType.value]
  if (!endpoint) {
    ElMessage.warning('此報表尚未開放預覽')
    return
  }
  preview.loading = true
  preview.state = 'loading'
  try {
    const query = buildQuery({
      month: selectedMonth.value,
      department: selectedDepartment.value,
      format: 'json',
    })
    const res = await apiFetch(`${endpoint}${query}`, {
      headers: { Accept: 'application/json' },
    })
    const contentType = res.headers?.get?.('content-type') || ''
    if (!res.ok) {
      const errorData = contentType.includes('application/json') ? await res.json() : null
      throw new Error(errorData?.error || errorData?.message || '預覽失敗')
    }
    if (!contentType.includes('application/json')) {
      preview.state = 'idle'
      preview.summary = null
      preview.records = []
      ElMessage.info('此報表不提供預覽，請直接匯出')
      return
    }
    const data = await res.json()
    preview.summary = data?.summary ?? null
    preview.records = Array.isArray(data?.records) ? data.records : []
    if (!preview.records.length && !preview.summary) {
      preview.state = 'empty'
    } else {
      preview.state = 'success'
    }
  } catch (err) {
    preview.state = 'idle'
    preview.summary = null
    preview.records = []
    ElMessage.error(err.message || '預覽失敗')
  } finally {
    preview.loading = false
  }
}

async function exportReport() {
  if (!canExport.value || exporting.value) return
  const endpoint = reportEndpointMap[reportType.value]
  if (!endpoint) {
    ElMessage.error('尚未提供此報表的匯出服務')
    return
  }
  exporting.value = true
  try {
    const query = buildQuery({
      month: selectedMonth.value,
      department: selectedDepartment.value,
      format: exportFormat.value,
    })
    const res = await apiFetch(`${endpoint}${query}`, {
      headers: { Accept: 'application/octet-stream' },
    })
    const contentType = res.headers?.get?.('content-type') || ''
    if (!res.ok) {
      const errorData = contentType.includes('application/json') ? await res.json() : null
      throw new Error(errorData?.error || errorData?.message || '匯出失敗')
    }
    const blob = await res.blob()
    const extension = formatExtensionMap[exportFormat.value] || 'dat'
    const monthText = selectedMonth.value?.replace('-', '') || dayjs().format('YYYYMM')
    const deptName =
      departments.value.find((dept) => dept._id === selectedDepartment.value)?.name || 'department'
    const typeKey = reportTypes.find((type) => type.value === reportType.value)?.value || 'report'
    const sanitize = (text) =>
      String(text)
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\u4e00-\u9fa5-]+/gi, '')
    const fileName = `${monthText}-${sanitize(deptName)}-${sanitize(typeKey)}.${extension}`

    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    ElMessage.success('匯出成功')
  } catch (err) {
    ElMessage.error(err.message || '匯出失敗')
  } finally {
    exporting.value = false
  }
}

</script>

<style scoped>
.department-reports-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: #f8fafc;
  min-height: 100vh;
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.page-title {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: #0f172a;
}

.page-subtitle {
  margin: 0;
  font-size: 16px;
  color: #475569;
}

.filters-card {
  border-radius: 12px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
}

.card-header h2 {
  margin: 0;
  font-size: 18px;
  color: #0f172a;
}

.card-tip {
  font-size: 14px;
  color: #64748b;
}

.filters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-label {
  font-weight: 500;
  color: #1e293b;
}

.w-full {
  width: 100%;
}

.actions {
  margin-top: 20px;
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.preview-card {
  border-radius: 12px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.summary-item {
  background: #f1f5f9;
  border-radius: 10px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-label {
  font-size: 14px;
  color: #475569;
}

.summary-value {
  font-size: 18px;
  font-weight: 600;
  color: #0f172a;
}

.preview-table {
  width: 100%;
}
</style>
