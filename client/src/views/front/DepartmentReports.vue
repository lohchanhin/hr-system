<!--
  部門報表（後台「報表查看」與前台「部門報表」共用）：選報表、月份、部門後直接顯示結果，可匯出 Excel / PDF。
  主管只能看自己的部門，管理員可以看所有部門；可用的報表與匯出格式由後端的報表模板決定。
-->
<template>
  <div class="department-reports-page">
    <PageHeader title="部門報表" />

    <div class="hr-toolbar">
      <el-select
        v-model="reportType"
        placeholder="選擇報表"
        class="filter-report"
        :disabled="loading.templates || availableReportOptions.length === 0"
        :loading="loading.templates"
        data-test="report-type"
      >
        <el-option
          v-for="type in availableReportOptions"
          :key="type.value"
          :label="type.label"
          :value="type.value"
        />
      </el-select>
      <el-date-picker
        v-model="selectedMonth"
        type="month"
        placeholder="選擇月份"
        format="YYYY/MM"
        value-format="YYYY-MM"
        :clearable="false"
        :editable="false"
        :disabled="loading.departments"
        class="filter-month"
        data-test="report-month"
      />
      <el-select
        v-model="selectedDepartment"
        placeholder="選擇部門"
        filterable
        class="filter-department"
        :loading="loading.departments"
        :disabled="loading.departments || departments.length <= 1"
        data-test="report-department"
      >
        <el-option
          v-for="dept in departments"
          :key="dept._id"
          :label="dept.name"
          :value="dept._id"
        />
      </el-select>
      <div v-if="availableExportFormats.length" class="toolbar-actions">
        <el-button
          v-for="(format, index) in availableExportFormats"
          :key="format.value"
          :type="index === 0 ? 'primary' : 'default'"
          :disabled="!hasDepartmentAccess || !selectedMonth || exporting"
          :loading="exporting && exportFormat === format.value"
          :data-test="`export-${format.value}`"
          @click="exportReport(format.value)"
        >
          匯出 {{ format.short }}
        </el-button>
      </div>
    </div>

    <section v-loading="preview.loading" class="hr-section report-result" data-test="report-result">
      <div v-if="preview.error" class="hr-empty" data-test="report-error">
        <p>{{ preview.error }}</p>
        <el-button size="small" @click="handlePreview({ force: true })">重新查詢</el-button>
      </div>

      <template v-else-if="preview.state === 'success'">
        <div v-if="summaryItems.length" class="summary-row" data-test="report-summary">
          <span v-for="item in summaryItems" :key="item.label" class="hr-stat">
            <span class="hr-stat__label">{{ item.label }}</span>
            <strong class="hr-stat__value">{{ formatSummaryValue(item.value) }}</strong>
          </span>
        </div>
        <p v-if="summaryNote" class="hr-hint summary-note" data-test="report-summary-note">{{ summaryNote }}</p>
        <el-table
          v-if="preview.records.length"
          :data="preview.records"
          border
          stripe
          class="preview-table"
          max-height="max(320px, calc(100vh - 280px))"
        >
          <el-table-column prop="name" label="員工" min-width="140" fixed>
            <template #default="{ row }">
              <div class="report-person">
                <EmployeeAvatar :employee="reportPerson(row)" :size="24" class="report-person-avatar" />
                <span>{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            v-for="column in dynamicColumns"
            :key="column.prop"
            :prop="column.prop"
            :label="column.label"
            :min-width="column.minWidth || 120"
            :align="column.kind === 'number' ? 'right' : 'left'"
          >
            <template #default="{ row }">
              <span>{{ formatCell(row[column.prop], column) }}</span>
              <!-- 遲到、早退的實際打卡旁標示打卡來源（線上／指紋匯入） -->
              <el-tag
                v-if="column.sourceProp && row[column.prop] && row[column.sourceProp]"
                size="small"
                :type="attendanceSourceTagType(row[column.sourceProp])"
                class="punch-source-tag"
              >
                {{ attendanceSourceLabel(row[column.sourceProp]) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
        <div v-else class="hr-empty" data-test="report-no-rows">這個月份沒有明細資料</div>
      </template>

      <!-- 還不能查詢：沒有可看的部門或沒有開放的報表 -->
      <div v-else-if="setupProblem" class="hr-empty" data-test="report-setup-problem">{{ setupProblem }}</div>

      <div v-else-if="preview.state === 'empty'" class="hr-empty" data-test="report-empty">
        {{ monthLabel }} {{ selectedDepartmentName }}沒有「{{ selectedReportName }}」的資料，可以換一個月份或報表
      </div>

      <div v-else class="hr-empty">{{ preview.loading || loading.departments || loading.templates ? '載入中…' : '請選擇報表、月份與部門' }}</div>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
// vLoading：這個畫面的測試不掛整套 Element Plus，v-loading 要自己引入
import { ElMessage, vLoading } from 'element-plus'
import { apiFetch } from '../../api'
import PageHeader from '../../components/PageHeader.vue'
import EmployeeAvatar from '../../components/EmployeeAvatar.vue'
import { attendanceSourceLabel, attendanceSourceTagType } from '../../utils/attendanceSource'
import { formatScheduleDate, taiwanDateKey } from '../../utils/dateFormatter'

const departments = ref([])
const supervisorDepartmentId = ref('')
const supervisorDepartmentName = ref('')
const reportTemplates = ref([])
const userRole = ref(getStoredRole())

const isAdmin = computed(() => userRole.value === 'admin')
const isSupervisor = computed(() => userRole.value === 'supervisor')

// 預設是台灣時間的這個月（不看裝置時區）
const selectedMonth = ref(taiwanDateKey(new Date()).slice(0, 7))
const selectedDepartment = ref('')
const reportType = ref('')
const exportFormat = ref('')
const exporting = ref(false)

const preview = reactive({
  loading: false,
  state: 'idle',
  summary: null,
  records: [],
  error: '',
})

// 報表每一列的員工：伺服器用 employee 放員工的 _id（沒有 _id 欄位）；照片路徑有帶才會顯示照片，否則是字母頭像
const reportPerson = row => ({
  _id: row?._id ?? (row?.employee && typeof row.employee === 'object' ? row.employee._id : row?.employee) ?? '',
  name: row?.name,
  photo: row?.photo,
  hasPhoto: row?.hasPhoto,
})

const loading = reactive({
  departments: false,
  templates: false,
})

// 報表在選單裡的順序：先出勤與工時，再異常，最後是各種申請
const reportEndpointMap = {
  attendance: '/api/reports/department/attendance/export',
  workHours: '/api/reports/department/work-hours/export',
  tardiness: '/api/reports/department/tardiness/export',
  earlyLeave: '/api/reports/department/early-leave/export',
  leave: '/api/reports/department/leave/export',
  specialLeave: '/api/reports/department/special-leave/export',
  overtime: '/api/reports/department/overtime/export',
  compTime: '/api/reports/department/comp-time/export',
  makeUp: '/api/reports/department/make-up/export',
}
const reportOrder = Object.keys(reportEndpointMap)

const formatLabelMap = {
  excel: 'Excel (.xlsx)',
  pdf: 'PDF (.pdf)',
}

const formatShortLabelMap = {
  excel: 'Excel',
  pdf: 'PDF',
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
  return options.sort((a, b) => reportOrder.indexOf(a.value) - reportOrder.indexOf(b.value))
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
    .map((format) => ({ value: format, label: formatLabelMap[format], short: formatShortLabelMap[format] }))
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

const monthLabel = computed(() => (selectedMonth.value || '').replace('-', '/'))
const selectedDepartmentName = computed(
  () => departments.value.find((dept) => dept._id === selectedDepartment.value)?.name || ''
)
const selectedReportName = computed(() => selectedTemplate.value?.name || reportType.value || '')

// 讀完部門與報表模板後還是不能查詢的原因（讀取中不顯示）
const setupProblem = computed(() => {
  if (loading.departments || loading.templates) return ''
  if (!departments.value.length) {
    return isAdmin.value ? '目前沒有部門資料，請先到「機構與部門設定」建立部門' : '尚未為您設定可管理的部門，請聯絡系統管理員'
  }
  if (!availableReportOptions.value.length) return '目前沒有開放的報表，請聯絡系統管理員'
  return ''
})

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

// 伺服器有沒有回傳某個欄位（舊版伺服器沒有請假天數等新欄位：沒有就不顯示那一欄，不顯示成 0）
const hasRecordField = (prop) => preview.records.some((record) => record?.[prop] !== undefined && record?.[prop] !== null)
const hasSummaryField = (prop) => preview.summary?.[prop] !== undefined && preview.summary?.[prop] !== null

// kind：date 顯示成 YYYY/MM/DD、number 靠右並去掉浮點數雜訊，其他照原樣；欄位與匯出檔（伺服器 reportController 的 DEPARTMENT_EXPORT_CONFIG）一致。
// optional：伺服器有回傳這個欄位才顯示
const reportColumns = computed(() => {
  if (reportType.value === 'attendance') {
    return [
      { prop: 'scheduled', label: '排班天數', minWidth: 120, kind: 'number' },
      { prop: 'attended', label: '出勤天數', minWidth: 120, kind: 'number' },
      // 請假：沒有簽到、但那一班在核准的請假中（不算缺勤）
      { prop: 'onLeave', label: '請假天數', minWidth: 120, kind: 'number', optional: true },
      { prop: 'absent', label: '缺勤天數', minWidth: 120, kind: 'number' },
    ]
  }
  if (reportType.value === 'leave') {
    return [
      { prop: 'leaveType', label: '假別', minWidth: 160 },
      { prop: 'startDate', label: '開始日期', minWidth: 140, kind: 'date' },
      { prop: 'endDate', label: '結束日期', minWidth: 140, kind: 'date' },
      { prop: 'hours', label: '時數', minWidth: 100, kind: 'number' },
      { prop: 'days', label: '天數', minWidth: 100, kind: 'number' },
    ]
  }
  if (reportType.value === 'tardiness') {
    return [
      { prop: 'date', label: '日期', minWidth: 140, kind: 'date' },
      { prop: 'scheduledStart', label: '排定上班', minWidth: 140 },
      { prop: 'actualClockIn', label: '實際打卡', minWidth: 160, sourceProp: 'clockInSource' },
      { prop: 'minutesLate', label: '遲到分鐘', minWidth: 120, kind: 'number' },
    ]
  }
  if (reportType.value === 'earlyLeave') {
    return [
      { prop: 'date', label: '日期', minWidth: 140, kind: 'date' },
      { prop: 'scheduledEnd', label: '排定下班', minWidth: 140 },
      { prop: 'actualClockOut', label: '實際打卡', minWidth: 160, sourceProp: 'clockOutSource' },
      { prop: 'minutesEarly', label: '早退分鐘', minWidth: 120, kind: 'number' },
    ]
  }
  if (reportType.value === 'workHours') {
    return [
      { prop: 'date', label: '日期', minWidth: 140, kind: 'date' },
      { prop: 'scheduledHours', label: '排定工時(小時)', minWidth: 160, kind: 'number' },
      { prop: 'workedHours', label: '實際工時(小時)', minWidth: 160, kind: 'number' },
      { prop: 'differenceHours', label: '差異(小時)', minWidth: 140, kind: 'number' },
    ]
  }
  if (reportType.value === 'overtime') {
    return [
      { prop: 'date', label: '日期', minWidth: 140, kind: 'date' },
      { prop: 'startTime', label: '開始時間', minWidth: 120 },
      { prop: 'endTime', label: '結束時間', minWidth: 120 },
      { prop: 'hours', label: '時數', minWidth: 100, kind: 'number' },
      { prop: 'reason', label: '原因', minWidth: 180 },
    ]
  }
  if (reportType.value === 'compTime') {
    return [
      { prop: 'date', label: '日期', minWidth: 140, kind: 'date' },
      { prop: 'endDate', label: '結束日期', minWidth: 140, kind: 'date', optional: true },
      { prop: 'leaveType', label: '假別', minWidth: 100, optional: true },
      { prop: 'hours', label: '補休時數', minWidth: 120, kind: 'number' },
      { prop: 'overtimeReference', label: '來源（調休額度／加班單）', minWidth: 220 },
    ]
  }
  if (reportType.value === 'makeUp') {
    return [
      { prop: 'date', label: '日期', minWidth: 140, kind: 'date' },
      { prop: 'category', label: '補卡類別', minWidth: 160 },
      { prop: 'note', label: '補卡說明', minWidth: 200 },
    ]
  }
  if (reportType.value === 'specialLeave') {
    return [
      { prop: 'startDate', label: '開始日期', minWidth: 140, kind: 'date' },
      { prop: 'endDate', label: '結束日期', minWidth: 140, kind: 'date' },
      { prop: 'hours', label: '時數', minWidth: 100, kind: 'number' },
      { prop: 'days', label: '天數', minWidth: 100, kind: 'number' },
    ]
  }
  return []
})

const dynamicColumns = computed(() => reportColumns.value.filter((column) => !column.optional || hasRecordField(column.prop)))

// 數字最多兩位小數（284.87000000000006 → 284.87）；不是數字的照原樣
function tidyNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value
  return Math.round(value * 100) / 100 || 0
}

function formatCell(value, column) {
  if (value === null || value === undefined) return ''
  if (column.kind === 'date') return formatScheduleDate(value, value)
  if (column.kind === 'number') return tidyNumber(value)
  return value
}

const formatSummaryValue = (value) => (value === null || value === undefined ? 0 : tidyNumber(value))

const summaryItems = computed(() => {
  if (!preview.summary) return []
  if (reportType.value === 'attendance') {
    return [
      { label: '排班總計', value: preview.summary.scheduled },
      { label: '出勤總計', value: preview.summary.attended },
      ...(hasSummaryField('onLeave') ? [{ label: '請假總計', value: preview.summary.onLeave }] : []),
      { label: '缺勤總計', value: preview.summary.absent },
    ]
  }
  if (reportType.value === 'leave') {
    const base = [
      { label: '總請假件數', value: preview.summary.totalLeaves },
      { label: '總請假時數', value: preview.summary.totalHours ?? 0 },
      { label: '總請假天數', value: preview.summary.totalDays },
    ]
    const byType = Array.isArray(preview.summary.byType)
      ? preview.summary.byType.map((item) => ({
          label: `${item.leaveType || item.leaveCode} 件數`,
          value: `${item.count ?? 0} 筆 / ${tidyNumber(item.hours ?? 0)} 小時（${tidyNumber(item.days ?? 0)} 天）`,
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
      ...(hasSummaryField('earnedCredits') ? [{ label: '本月存入調休筆數', value: preview.summary.earnedCredits }] : []),
      ...(hasSummaryField('earnedHours') ? [{ label: '本月存入調休時數', value: preview.summary.earnedHours }] : []),
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
      { label: '特休總時數', value: preview.summary.totalHours ?? 0 },
      { label: '特休總天數', value: preview.summary.totalDays ?? 0 },
    ]
  }
  return []
})

// 出勤統計：排班 − 出勤 − 請假 − 缺勤 還有剩，是這個月還沒開始的班（不算缺勤）
const summaryNote = computed(() => {
  if (reportType.value !== 'attendance' || !hasSummaryField('onLeave')) return ''
  const { scheduled, attended, onLeave, absent } = preview.summary
  const upcoming = Number(scheduled) - Number(attended) - Number(onLeave) - Number(absent)
  return Number.isFinite(upcoming) && upcoming > 0 ? `另有 ${tidyNumber(upcoming)} 天的班還沒開始，不計入缺勤` : ''
})

let unmounted = false

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
    ElMessage.error(messageOf(err, '載入報表設定失敗，請確認網路連線後重新整理'))
  } finally {
    loading.departments = false
    loading.templates = false
  }
  // 條件齊了就直接查，打開頁面就看得到這個月的報表（等預設的報表種類選好）
  await nextTick()
  if (!unmounted && canPreview.value) handlePreview({ silent: true })
})

onBeforeUnmount(() => {
  unmounted = true
  clearTimeout(autoPreviewTimer)
  // 離開頁面後才回來的查詢不再處理
  previewGeneration += 1
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

// 報表 API 的錯誤訊息有些是英文，換成看得懂的說法；本來就是中文的照原樣顯示
const SERVER_MESSAGES = [
  [/^forbidden$/i, '您沒有權限查看這個部門的報表'],
  [/invalid month/i, '月份格式不正確，請重新選擇月份'],
  [/invalid department|month and department required/i, '請重新選擇月份與部門'],
  [/unknown report type/i, '這個報表尚未開放'],
  [/^no data$/i, '這個部門沒有員工資料'],
]

function reportErrorMessage(message, fallback) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return fallback
  if (/[一-鿿]/.test(text)) return text
  const known = SERVER_MESSAGES.find(([pattern]) => pattern.test(text))
  return known ? known[1] : fallback
}

// 只顯示中文訊息：網路中斷時瀏覽器丟出的是英文（Failed to fetch），換成看得懂的說法
const messageOf = (error, fallback) => (/[一-鿿]/.test(error?.message || '') ? error.message : fallback)

async function readReportError(res, fallback) {
  const contentType = res.headers?.get?.('content-type') || ''
  let errorData = null
  if (contentType.includes('application/json')) {
    try {
      errorData = await res.json()
    } catch {
      errorData = null
    }
  }
  return reportErrorMessage(errorData?.error || errorData?.message, fallback)
}

/* -------------------- 查詢（畫面上的報表內容） -------------------- */
// 同一組條件（報表、月份、部門）只查一次；條件改了以後，比較晚回來的舊查詢不會蓋掉新的結果
let previewGeneration = 0
let previewKey = ''
let previewPromise = null
let previewInFlight = false
let autoPreviewTimer = null

const previewRequestKey = () => [reportType.value, selectedMonth.value, selectedDepartment.value].join('|')

function resetPreview() {
  previewGeneration += 1
  previewKey = ''
  previewPromise = null
  previewInFlight = false
  preview.loading = false
  preview.state = 'idle'
  preview.summary = null
  preview.records = []
  preview.error = ''
}

function handlePreview(options = {}) {
  const force = options?.force === true
  const silent = options?.silent === true
  if (!canPreview.value) {
    if (!silent) ensureDepartmentAccess()
    return Promise.resolve()
  }
  const endpoint = reportEndpointMap[reportType.value]
  if (!endpoint) {
    if (!silent) ElMessage.warning('此報表尚未開放預覽')
    return Promise.resolve()
  }
  const key = previewRequestKey()
  if (!force && key === previewKey && previewPromise) return previewPromise
  clearTimeout(autoPreviewTimer)
  previewKey = key
  previewPromise = loadPreview(endpoint)
  return previewPromise
}

async function loadPreview(endpoint) {
  const generation = ++previewGeneration
  previewInFlight = true
  preview.loading = true
  preview.state = 'loading'
  preview.error = ''
  try {
    const query = buildQuery({
      month: selectedMonth.value,
      department: selectedDepartment.value,
      format: 'json',
    })
    const res = await apiFetch(`${endpoint}${query}`, {
      headers: { Accept: 'application/json' },
    })
    if (generation !== previewGeneration) return
    const contentType = res.headers?.get?.('content-type') || ''
    if (!res.ok) {
      const message = await readReportError(res, '查詢失敗，請稍後再試')
      if (generation !== previewGeneration) return
      // 部門沒有員工時伺服器回 404：不是錯誤，是沒有資料
      if (res.status === 404) {
        preview.summary = null
        preview.records = []
        preview.state = 'empty'
        return
      }
      throw new Error(message)
    }
    if (!contentType.includes('application/json')) {
      preview.state = 'idle'
      preview.summary = null
      preview.records = []
      ElMessage.info('此報表不提供預覽，請直接匯出')
      return
    }
    const data = await res.json()
    if (generation !== previewGeneration) return
    preview.summary = data?.summary ?? null
    preview.records = Array.isArray(data?.records) ? data.records : []
    if (!preview.records.length && !preview.summary) {
      preview.state = 'empty'
    } else {
      preview.state = 'success'
    }
  } catch (err) {
    if (generation !== previewGeneration) return
    preview.state = 'idle'
    preview.summary = null
    preview.records = []
    preview.error = messageOf(err, '查詢失敗，請確認網路連線後再試')
    ElMessage.error(preview.error)
  } finally {
    if (generation === previewGeneration) {
      previewInFlight = false
      preview.loading = false
    }
  }
}

// 條件一改就重新查（稍等一下，連續改兩個條件只查一次）
watch([reportType, selectedMonth, selectedDepartment], () => {
  clearTimeout(autoPreviewTimer)
  if (loading.departments || loading.templates) return
  if (!canPreview.value) {
    if (previewKey) resetPreview()
    else if (!previewInFlight) preview.loading = false
    return
  }
  if (previewRequestKey() === previewKey) {
    // 條件又改回畫面上這一組：不用重查，沒有查詢在跑就把「載入中」收掉
    if (!previewInFlight) preview.loading = false
    return
  }
  preview.loading = true
  autoPreviewTimer = setTimeout(() => handlePreview({ silent: true }), 250)
})

/* -------------------- 匯出 -------------------- */
// 目前畫面上的結果是不是這組條件、而且確定沒有資料
const knownEmpty = computed(() => preview.state === 'empty' && !preview.loading)

async function exportReport(format) {
  if (exporting.value) return
  if (typeof format === 'string' && format) exportFormat.value = format
  if (!canExport.value && !ensureDepartmentAccess()) return
  if (!canExport.value) return
  const endpoint = reportEndpointMap[reportType.value]
  if (!endpoint) {
    ElMessage.error('尚未提供此報表的匯出服務')
    return
  }
  if (knownEmpty.value && previewRequestKey() === previewKey) {
    ElMessage.warning(`${monthLabel.value} ${selectedDepartmentName.value}沒有「${selectedReportName.value}」的資料，沒有內容可以匯出`)
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
    // 伺服器回錯誤（JSON）時顯示原因，不要存成一個打不開的檔案
    if (!res.ok || contentType.includes('application/json')) {
      throw new Error(await readReportError(res, '匯出失敗，請稍後再試'))
    }
    const blob = await res.blob()
    if (!blob || blob.size === 0) throw new Error('伺服器回傳空白檔案，請稍後再試')
    const extension = formatExtensionMap[exportFormat.value] || 'dat'
    const monthText = selectedMonth.value?.replace('-', '') || taiwanDateKey(new Date()).slice(0, 7).replace('-', '')
    const deptName = selectedDepartmentName.value || 'department'
    const template = selectedTemplate.value
    const typeKey = template?.type || reportType.value || 'report'
    const templateName = template?.name || typeKey
    const sanitize = (text) =>
      String(text)
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w一-龥-]+/gi, '')
    const fileName = `${monthText}-${sanitize(deptName)}-${sanitize(templateName)}.${extension}`

    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    // 立刻釋放有些瀏覽器會來不及開始下載
    setTimeout(() => window.URL.revokeObjectURL?.(url), 1000)
    ElMessage.success('匯出成功')
  } catch (err) {
    ElMessage.error(messageOf(err, '匯出失敗，請確認網路連線後再試'))
  } finally {
    exporting.value = false
  }
}

</script>

<style scoped>
.filter-report {
  width: 200px;
}

/* 日期欄位的外框是 Element Plus 內層的元素（而且自己有固定寬度），要用 :deep 才設得到 */
.hr-toolbar :deep(.filter-month) {
  width: 140px;
}

.filter-department {
  width: 200px;
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

.report-result {
  min-height: 160px;
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hr-space-sm);
  margin-bottom: var(--hr-space-sm);
}

.summary-note {
  margin: 0 0 var(--hr-space-sm);
}

.report-person {
  display: flex;
  align-items: center;
  gap: 8px;
}

.report-person-avatar {
  flex: 0 0 auto;
}

.preview-table {
  width: 100%;
}

.punch-source-tag {
  margin-left: 6px;
}

@media (max-width: 767px) {
  .filter-report,
  .filter-department {
    flex: 1 1 160px;
    width: auto;
  }

  .hr-toolbar :deep(.filter-month) {
    flex: 1 1 130px;
  }
}
</style>
