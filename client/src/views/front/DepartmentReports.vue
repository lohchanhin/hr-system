<template>
  <div class="department-reports-page">
    <header class="page-header">
      <h1 class="page-title">部門報表中心</h1>
      <p class="page-subtitle">彙整各部門出勤與請假統計</p>
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
          <el-select
            v-model="reportType"
            placeholder="選擇報表"
            class="w-full"
            :disabled="loading.templates || availableReportOptions.length === 0"
            :loading="loading.templates"
          >
            <el-option
              v-for="type in availableReportOptions"
              :key="type.value"
              :label="type.label"
              :value="type.value"
            />
          </el-select>
        </div>
        <div class="filter-item">
          <label class="filter-label">匯出格式</label>
          <el-select
            v-model="exportFormat"
            placeholder="選擇格式"
            class="w-full"
            :disabled="loading.templates || availableExportFormats.length === 0"
            :loading="loading.templates"
          >
            <el-option
              v-for="format in availableExportFormats"
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
import { ref, reactive, computed, onMounted, watch } from 'vue'
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'
import { apiFetch } from '../../api'

const departments = ref([])
const supervisorDepartmentId = ref('')
const supervisorDepartmentName = ref('')
const reportTemplates = ref([])
const userRole = ref(getStoredRole())

const isAdmin = computed(() => userRole.value === 'admin')
const isSupervisor = computed(() => userRole.value === 'supervisor')

const selectedMonth = ref(dayjs().format('YYYY-MM'))
const selectedDepartment = ref('')
const reportType = ref('')
const exportFormat = ref('')
const exporting = ref(false)

const preview = reactive({
  loading: false,
  state: 'idle',
  summary: null,
  records: [],
})

const loading = reactive({
  departments: false,
  templates: false,
})

const reportEndpointMap = {
  attendance: '/api/reports/department/attendance/export',
  leave: '/api/reports/department/leave/export',
  tardiness: '/api/reports/department/tardiness/export',
  earlyLeave: '/api/reports/department/early-leave/export',
  workHours: '/api/reports/department/work-hours/export',
  overtime: '/api/reports/department/overtime/export',
  compTime: '/api/reports/department/comp-time/export',
  makeUp: '/api/reports/department/make-up/export',
  specialLeave: '/api/reports/department/special-leave/export',
}

const formatLabelMap = {
  excel: 'Excel (.xlsx)',
  pdf: 'PDF (.pdf)',
}

const formatExtensionMap = {
  excel: 'xlsx',
  pdf: 'pdf',
}

const hasDepartmentAccess = computed(() =>
  Boolean(
    selectedDepartment.value &&
      departments.value.some((dept) => String(dept?._id) === String(selectedDepartment.value))
  )
)

const templateMap = computed(() => {
  const map = new Map()
  reportTemplates.value.forEach((template) => {
    if (template?.type && !map.has(template.type)) {
      map.set(template.type, template)
    }
  })
  return map
})

const availableReportOptions = computed(() => {
  const options = []
  const seen = new Set()
  reportTemplates.value.forEach((template) => {
    const value = template?.type
    if (!value || seen.has(value) || !reportEndpointMap[value]) return
    const label = template?.name?.trim?.() || value
    options.push({ value, label })
    seen.add(value)
  })
  return options
})

const selectedTemplate = computed(() => {
  if (!reportType.value) return null
  return templateMap.value.get(reportType.value) || null
})

const availableExportFormats = computed(() => {
  const template = selectedTemplate.value
  if (!template) return []
  const seen = new Set()
  const formats = Array.isArray(template.exportFormats) ? template.exportFormats : []
  return formats
    .map((format) => (typeof format === 'string' ? format.trim().toLowerCase() : ''))
    .filter((format) => {
      if (!format || !formatLabelMap[format] || seen.has(format)) return false
      seen.add(format)
      return true
    })
    .map((format) => ({ value: format, label: formatLabelMap[format] }))
})

const canExport = computed(() => {
  if (!selectedMonth.value || !hasDepartmentAccess.value) return false
  if (!reportType.value || !reportEndpointMap[reportType.value]) return false
  return availableExportFormats.value.some((item) => item.value === exportFormat.value)
})

const canPreview = computed(
  () =>
    Boolean(
      selectedMonth.value &&
        hasDepartmentAccess.value &&
        reportType.value &&
        reportEndpointMap[reportType.value] &&
        selectedTemplate.value
    )
)

watch(
  availableReportOptions,
  (options) => {
    if (!Array.isArray(options) || options.length === 0) {
      reportType.value = ''
      return
    }
    const exists = options.some((option) => option.value === reportType.value)
    if (!exists) {
      reportType.value = options[0].value
    }
  },
  { immediate: true }
)

watch(
  availableExportFormats,
  (formats) => {
    if (!Array.isArray(formats) || formats.length === 0) {
      exportFormat.value = ''
      return
    }
    const exists = formats.some((format) => format.value === exportFormat.value)
    if (!exists) {
      exportFormat.value = formats[0].value
    }
  },
  { immediate: true }
)

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
  if (reportType.value === 'tardiness') {
    return [
      { prop: 'date', label: '日期', minWidth: 140 },
      { prop: 'scheduledStart', label: '排定上班', minWidth: 140 },
      { prop: 'actualClockIn', label: '實際打卡', minWidth: 140 },
      { prop: 'minutesLate', label: '遲到分鐘', minWidth: 120 },
    ]
  }
  if (reportType.value === 'earlyLeave') {
    return [
      { prop: 'date', label: '日期', minWidth: 140 },
      { prop: 'scheduledEnd', label: '排定下班', minWidth: 140 },
      { prop: 'actualClockOut', label: '實際打卡', minWidth: 140 },
      { prop: 'minutesEarly', label: '早退分鐘', minWidth: 120 },
    ]
  }
  if (reportType.value === 'workHours') {
    return [
      { prop: 'date', label: '日期', minWidth: 140 },
      { prop: 'scheduledHours', label: '排定工時(小時)', minWidth: 160 },
      { prop: 'workedHours', label: '實際工時(小時)', minWidth: 160 },
      { prop: 'differenceHours', label: '差異(小時)', minWidth: 140 },
    ]
  }
  if (reportType.value === 'overtime') {
    return [
      { prop: 'date', label: '日期', minWidth: 140 },
      { prop: 'startTime', label: '開始時間', minWidth: 120 },
      { prop: 'endTime', label: '結束時間', minWidth: 120 },
      { prop: 'hours', label: '時數', minWidth: 100 },
      { prop: 'reason', label: '原因', minWidth: 180 },
    ]
  }
  if (reportType.value === 'compTime') {
    return [
      { prop: 'date', label: '日期', minWidth: 140 },
      { prop: 'hours', label: '補休時數', minWidth: 120 },
      { prop: 'overtimeReference', label: '來源加班單', minWidth: 180 },
    ]
  }
  if (reportType.value === 'makeUp') {
    return [
      { prop: 'date', label: '日期', minWidth: 140 },
      { prop: 'category', label: '補卡類別', minWidth: 160 },
      { prop: 'note', label: '補卡說明', minWidth: 200 },
    ]
  }
  if (reportType.value === 'specialLeave') {
    return [
      { prop: 'startDate', label: '開始日期', minWidth: 140 },
      { prop: 'endDate', label: '結束日期', minWidth: 140 },
      { prop: 'days', label: '天數', minWidth: 100 },
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
  if (reportType.value === 'tardiness') {
    return [
      { label: '遲到件數', value: preview.summary.totalLateCount ?? 0 },
      { label: '遲到總分鐘', value: preview.summary.totalLateMinutes ?? 0 },
      { label: '平均遲到分鐘', value: preview.summary.averageLateMinutes ?? 0 },
    ]
  }
  if (reportType.value === 'earlyLeave') {
    return [
      { label: '早退件數', value: preview.summary.totalEarlyLeaveCount ?? 0 },
      { label: '早退總分鐘', value: preview.summary.totalEarlyMinutes ?? 0 },
      { label: '平均早退分鐘', value: preview.summary.averageEarlyMinutes ?? 0 },
    ]
  }
  if (reportType.value === 'workHours') {
    return [
      { label: '排定總工時', value: preview.summary.totalScheduledHours ?? 0 },
      { label: '實際總工時', value: preview.summary.totalWorkedHours ?? 0 },
      { label: '工時差異', value: preview.summary.differenceHours ?? 0 },
    ]
  }
  if (reportType.value === 'overtime') {
    return [
      { label: '加班申請數', value: preview.summary.totalRequests ?? 0 },
      { label: '加班總時數', value: preview.summary.totalHours ?? 0 },
    ]
  }
  if (reportType.value === 'compTime') {
    return [
      { label: '補休申請數', value: preview.summary.totalRequests ?? 0 },
      { label: '補休總時數', value: preview.summary.totalHours ?? 0 },
    ]
  }
  if (reportType.value === 'makeUp') {
    const base = [{ label: '補卡申請數', value: preview.summary.totalRequests ?? 0 }]
    const categories = Array.isArray(preview.summary.byCategory)
      ? preview.summary.byCategory.map((item) => ({
          label: `${item.label ?? '未分類'} 件數`,
          value: `${item.count ?? 0} 筆`,
        }))
      : []
    return [...base, ...categories]
  }
  if (reportType.value === 'specialLeave') {
    return [
      { label: '特休申請數', value: preview.summary.totalRequests ?? 0 },
      { label: '特休總天數', value: preview.summary.totalDays ?? 0 },
    ]
  }
  return []
})

onMounted(async () => {
  userRole.value = getStoredRole()
  loading.departments = true
  loading.templates = true
  try {
    if (isSupervisor.value) {
      await fetchSupervisorDepartment()
    } else {
      supervisorDepartmentId.value = ''
      supervisorDepartmentName.value = ''
    }
    await fetchAllowedDepartments()
    await fetchSupervisorReportTemplates()
  } catch (err) {
    ElMessage.error(err.message || '載入主管報表資訊失敗')
  } finally {
    loading.departments = false
    loading.templates = false
  }
})

const getStoredEmployeeId = () => {
  if (typeof window === 'undefined') return ''
  const sessionId = window.sessionStorage?.getItem('employeeId')
  if (sessionId && sessionId !== 'undefined') return sessionId
  const localId = window.localStorage?.getItem('employeeId')
  if (localId && localId !== 'undefined') return localId
  return ''
}

function getStoredRole() {
  if (typeof window === 'undefined') return ''
  const sessionRole = window.sessionStorage?.getItem('role')
  if (sessionRole && sessionRole !== 'undefined') return sessionRole
  const localRole = window.localStorage?.getItem('role')
  if (localRole && localRole !== 'undefined') return localRole
  return ''
}

async function fetchSupervisorDepartment() {
  if (!isSupervisor.value) {
    supervisorDepartmentId.value = ''
    supervisorDepartmentName.value = ''
    return
  }
  const employeeId = getStoredEmployeeId()
  if (!employeeId) {
    supervisorDepartmentId.value = ''
    supervisorDepartmentName.value = ''
    ElMessage.warning('尚未取得登入者資料，請重新登入後再試')
    return
  }
  const res = await apiFetch(`/api/employees/${employeeId}`)
  if (!res.ok) {
    throw new Error('無法取得主管資訊')
  }
  const data = await res.json()
  const deptInfo = data?.department
  const deptId =
    typeof deptInfo === 'object'
      ? deptInfo?._id || deptInfo?.id || deptInfo?.value
      : deptInfo
  const deptName =
    typeof deptInfo === 'object'
      ? deptInfo?.name || ''
      : data?.departmentName || ''
  supervisorDepartmentId.value = deptId ? String(deptId) : ''
  supervisorDepartmentName.value = deptName ? String(deptName) : ''
}

async function fetchAllowedDepartments() {
  const res = await apiFetch('/api/departments')
  if (!res.ok) {
    throw new Error('無法取得部門清單')
  }
  const data = await res.json()
  const normalized = Array.isArray(data)
    ? data.map((dept) => {
        const idValue =
          dept?._id ?? dept?.id ?? dept?.value ?? (typeof dept === 'string' ? dept : '')
        const nameValue = dept?.name ?? dept?.label ?? dept?.departmentName ?? ''
        return {
          ...dept,
          _id: idValue ? String(idValue) : '',
          name: String(nameValue || dept?.name || ''),
        }
      })
    : []
  if (isAdmin.value) {
    const available = normalized.filter((dept) => dept?._id)
    departments.value = available
    if (!departments.value.length) {
      selectedDepartment.value = ''
      ElMessage.warning('目前沒有可供查詢的部門資料，請先建立部門資訊')
      return
    }
    const preferredId = selectedDepartment.value
    const preferred = preferredId
      ? departments.value.find((dept) => dept._id === preferredId)
      : null
    selectedDepartment.value = preferred?._id || departments.value[0]._id || ''
    return
  }
  if (!supervisorDepartmentId.value && !supervisorDepartmentName.value) {
    departments.value = []
    selectedDepartment.value = ''
    ElMessage.warning('尚未為您設定可管理的部門，請聯絡系統管理員')
    return
  }
  const targetId = supervisorDepartmentId.value
  const targetName = supervisorDepartmentName.value.trim().toLowerCase()
  let allowed = normalized.filter((dept) => {
    const deptId = String(dept?._id || '')
    const deptName = String(dept?.name || '').trim().toLowerCase()
    return (
      (targetId && deptId === targetId) ||
      (targetName && deptName && deptName === targetName)
    )
  })
  if (!allowed.length && targetId) {
    allowed = [
      {
        _id: targetId,
        name: supervisorDepartmentName.value || '主管部門',
      },
    ]
  }
  allowed = allowed.filter((dept) => dept?._id)
  departments.value = allowed
  if (!departments.value.length) {
    selectedDepartment.value = ''
    ElMessage.warning('未找到與您相符的部門，請聯絡系統管理員')
    return
  }
  const preferred = departments.value.find((dept) => dept._id === targetId)
  selectedDepartment.value = preferred?._id || departments.value[0]._id || ''
}

async function fetchSupervisorReportTemplates() {
  const res = await apiFetch('/api/reports/department/templates')
  if (!res.ok) {
    throw new Error('無法取得主管報表設定')
  }
  const data = await res.json()
  const normalized = Array.isArray(data)
    ? data
        .map((item) => {
          const idValue = item?.id ?? item?._id ?? ''
          const type = typeof item?.type === 'string' ? item.type.trim() : ''
          const name = typeof item?.name === 'string' ? item.name.trim() : ''
          const rawFormats = Array.isArray(item?.exportSettings?.formats)
            ? item.exportSettings.formats
            : Array.isArray(item?.exportFormats)
              ? item.exportFormats
              : []
          const exportFormats = rawFormats
            .map((format) => (typeof format === 'string' ? format.trim().toLowerCase() : ''))
            .filter(Boolean)
          const permissionSettings =
            item?.permissionSettings && typeof item.permissionSettings === 'object'
              ? { ...item.permissionSettings }
              : {}
          const exportSettings =
            item?.exportSettings && typeof item.exportSettings === 'object'
              ? { ...item.exportSettings }
              : { formats: [] }
          return {
            id: idValue ? String(idValue) : '',
            type,
            name: name || type,
            exportFormats,
            permissionSettings,
            exportSettings,
          }
        })
        .filter((item) => item.type)
    : []

  reportTemplates.value = normalized

  if (!normalized.length) {
    reportType.value = ''
    exportFormat.value = ''
    ElMessage.warning('目前沒有開放的主管報表模板')
  }
}

function ensureDepartmentAccess() {
  if (hasDepartmentAccess.value) return true
  ElMessage.warning('目前無可操作的部門，請確認您的部門權限設定')
  return false
}

function buildQuery(params) {
  const usp = new URLSearchParams(params)
  return `?${usp.toString()}`
}

async function handlePreview() {
  if (!canPreview.value && !ensureDepartmentAccess()) return
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
  if (exporting.value) return
  if (!canExport.value && !ensureDepartmentAccess()) return
  if (!canExport.value) return
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
    const template = selectedTemplate.value
    const typeKey = template?.type || reportType.value || 'report'
    const templateName = template?.name || typeKey
    const sanitize = (text) =>
      String(text)
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\u4e00-\u9fa5-]+/gi, '')
    const fileName = `${monthText}-${sanitize(deptName)}-${sanitize(templateName)}.${extension}`

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
