<template>
  <div class="schedule-overview-page">
    <div class="page-header">
      <h1 class="page-title">班表總覽</h1>
      <p class="page-subtitle">依照機構、部門與小單位快速檢視每月排班狀態</p>
    </div>

    <el-card class="filters-card" shadow="never">
      <template #header>
        <div class="filters-header">
          <div class="filters-title">篩選條件</div>
          <div class="export-actions">
            <el-button-group>
              <el-button
                type="primary"
                plain
                data-test="export-excel"
                :loading="exportLoading && exportFormat === 'excel'"
                :disabled="isExportDisabled"
                @click="handleExport('excel')"
              >
                匯出 Excel
              </el-button>
              <el-button
                type="primary"
                plain
                data-test="export-pdf"
                :loading="exportLoading && exportFormat === 'pdf'"
                :disabled="isExportDisabled"
                @click="handleExport('pdf')"
              >
                匯出 PDF
              </el-button>
            </el-button-group>
          </div>
        </div>
      </template>
      <div class="filters-grid">
        <div class="filter-item">
          <label class="filter-label">月份</label>
          <el-date-picker
            v-model="selectedMonth"
            type="month"
            value-format="YYYY-MM"
            placeholder="選擇月份"
            class="filter-control"
            @change="triggerOverviewReload"
          />
        </div>
        <div class="filter-item">
          <label class="filter-label">機構</label>
          <el-select
            v-model="selectedOrganization"
            placeholder="全部機構"
            clearable
            class="filter-control"
            @change="onOrganizationChange"
          >
            <el-option
              v-for="org in organizations"
              :key="org._id || org.id"
              :label="org.name"
              :value="toId(org._id || org.id)"
            />
          </el-select>
        </div>
        <div class="filter-item">
          <label class="filter-label">部門</label>
          <el-select
            v-model="selectedDepartment"
            placeholder="全部部門"
            clearable
            class="filter-control"
            @change="onDepartmentChange"
          >
            <el-option
              v-for="dept in filteredDepartments"
              :key="dept._id"
              :label="dept.name"
              :value="toId(dept._id)"
            />
          </el-select>
        </div>
        <div class="filter-item">
          <label class="filter-label">小單位</label>
          <el-select
            v-model="selectedSubDepartment"
            placeholder="全部小單位"
            clearable
            class="filter-control"
            @change="triggerOverviewReload"
          >
            <el-option
              v-for="unit in filteredSubDepartments"
              :key="unit._id"
              :label="unit.name"
              :value="toId(unit._id)"
            />
          </el-select>
        </div>
      </div>
    </el-card>

    <el-alert
      v-if="errorMessage"
      type="error"
      :closable="false"
      show-icon
      class="message-block"
    >
      {{ errorMessage }}
    </el-alert>

    <el-skeleton v-if="loading" animated :rows="4" class="overview-skeleton" />

    <el-empty
      v-else-if="!hasOverviewData"
      description="目前沒有符合條件的班表資料"
      class="empty-state"
    />

    <div v-else class="overview-results">
      <section
        v-for="org in overviewData"
        :key="org.id"
        class="organization-block"
        data-test="organization-block"
      >
        <header class="organization-header">
          <h2 class="organization-title">{{ org.name }}</h2>
          <span class="organization-meta">{{ org.departments.length }} 個部門</span>
        </header>

        <article
          v-for="dept in org.departments"
          :key="dept.id"
          class="department-block"
          data-test="department-block"
        >
          <header class="department-header">
            <h3 class="department-title">{{ dept.name }}</h3>
            <span class="department-meta">{{ dept.subDepartments.length }} 個小單位</span>
          </header>

          <div
            v-for="unit in dept.subDepartments"
            :key="unit.id"
            class="unit-card"
            data-test="subdepartment-block"
          >
            <div class="unit-header">
              <h4 class="unit-title">{{ unit.name }}</h4>
              <span class="unit-meta">{{ unit.employees.length }} 位人員</span>
            </div>
            <div class="unit-table-wrapper">
              <el-table
                :data="buildTableRows(unit)"
                border
                stripe
                class="overview-table"
                :key="`${unit.id}-table`"
              >
                <el-table-column prop="name" label="姓名" fixed="left" min-width="140" />
                <el-table-column prop="title" label="職稱" min-width="140" />
                <el-table-column
                  v-for="day in days"
                  :key="`${unit.id}-${day}`"
                  :label="formatDayLabel(day)"
                  :min-width="110"
                >
                  <template #default="{ row }">
                    <span class="shift-label" :class="{ empty: !row.entries[day] }">
                      {{ row.entries[day] || '—' }}
                    </span>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </article>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'
import { apiFetch } from '@/api'

const selectedMonth = ref(dayjs().format('YYYY-MM'))
const selectedOrganization = ref('')
const selectedDepartment = ref('')
const selectedSubDepartment = ref('')

const organizations = ref([])
const departments = ref([])
const subDepartments = ref([])

const loading = ref(false)
const errorMessage = ref('')
const days = ref([])
const overviewData = ref([])
const referenceLoaded = ref(false)
const exportLoading = ref(false)
const exportFormat = ref('')
let requestSequence = 0

const toId = value => {
  if (!value && value !== 0) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    if (value?._id) return String(value._id)
    if (value?.id) return String(value.id)
  }
  return String(value)
}

const filteredDepartments = computed(() => {
  const targetOrg = selectedOrganization.value
  if (!targetOrg) return departments.value
  return departments.value.filter(dept => toId(dept.organization) === targetOrg)
})

const filteredSubDepartments = computed(() => {
  const targetDept = selectedDepartment.value
  const targetOrg = selectedOrganization.value
  return subDepartments.value.filter(sub => {
    const parentId = toId(sub.department)
    if (targetDept) {
      return parentId === targetDept
    }
    if (!targetOrg) return true
    const dept = departments.value.find(item => toId(item._id) === parentId)
    return dept ? toId(dept.organization) === targetOrg : false
  })
})

const hasOverviewData = computed(() => {
  return overviewData.value.some(org =>
    org.departments.some(dept => dept.subDepartments.some(unit => unit.employees.length))
  )
})

const isExportDisabled = computed(() => {
  return !selectedMonth.value || loading.value || exportLoading.value || !referenceLoaded.value
})

const formatDayLabel = day => {
  const date = dayjs(day)
  if (!date.isValid()) return day
  return date.format('MM/DD')
}

const buildTableRows = unit => {
  return unit.employees
    .map(emp => {
      const entries = {}
      days.value.forEach(day => {
        entries[day] = ''
      })
      emp.schedules.forEach(item => {
        const key = item.date
        if (!entries[key]) {
          entries[key] = item.shiftName || ''
        }
      })
      return {
        id: emp.id,
        name: emp.name,
        title: emp.title || '',
        entries
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' }))
}

async function parseResponse(res, fallbackMessage) {
  if (!res.ok) {
    let message = fallbackMessage
    try {
      const payload = await res.json()
      message = payload?.error || payload?.message || message
    } catch (error) {
      // ignore json parse error
    }
    throw new Error(message)
  }
  return res.json()
}

async function parseBlobResponse(res, fallbackMessage) {
  if (!res.ok) {
    let message = fallbackMessage
    try {
      const payload = await res.json()
      message = payload?.error || payload?.message || message
    } catch (error) {
      // ignore json parse error
    }
    throw new Error(message)
  }
  return res.blob()
}

async function loadReferenceData() {
  try {
    const [orgRes, deptRes, subRes] = await Promise.all([
      apiFetch('/api/organizations'),
      apiFetch('/api/departments'),
      apiFetch('/api/sub-departments')
    ])

    const [orgData, deptData, subData] = await Promise.all([
      parseResponse(orgRes, '無法載入機構資料'),
      parseResponse(deptRes, '無法載入部門資料'),
      parseResponse(subRes, '無法載入小單位資料')
    ])

    organizations.value = Array.isArray(orgData) ? orgData : []
    departments.value = Array.isArray(deptData) ? deptData : []
    subDepartments.value = Array.isArray(subData) ? subData : []
    referenceLoaded.value = true
  } catch (err) {
    const message = err?.message || '無法載入必要資料'
    errorMessage.value = message
    ElMessage.error(message)
  }
}

async function loadOverview() {
  if (!referenceLoaded.value || !selectedMonth.value) return
  const currentToken = ++requestSequence
  loading.value = true
  errorMessage.value = ''

  try {
    const params = new URLSearchParams({ month: selectedMonth.value })
    if (selectedOrganization.value) params.set('organization', selectedOrganization.value)
    if (selectedDepartment.value) params.set('department', selectedDepartment.value)
    if (selectedSubDepartment.value) params.set('subDepartment', selectedSubDepartment.value)

    const res = await apiFetch(`/api/schedules/overview?${params.toString()}`)
    const data = await parseResponse(res, '無法載入班表總覽資料')
    if (currentToken !== requestSequence) return
    days.value = Array.isArray(data?.days) ? data.days : []
    overviewData.value = Array.isArray(data?.organizations) ? data.organizations : []
  } catch (err) {
    if (currentToken !== requestSequence) return
    const message = err?.message || '載入班表總覽失敗'
    errorMessage.value = message
    overviewData.value = []
    days.value = []
    ElMessage.error(message)
  } finally {
    if (currentToken === requestSequence) {
      loading.value = false
    }
  }
}

function triggerOverviewReload() {
  loadOverview()
}

function onOrganizationChange() {
  if (!filteredDepartments.value.some(dept => toId(dept._id) === selectedDepartment.value)) {
    selectedDepartment.value = ''
  }
  selectedSubDepartment.value = ''
  loadOverview()
}

function onDepartmentChange() {
  if (!filteredSubDepartments.value.some(unit => toId(unit._id) === selectedSubDepartment.value)) {
    selectedSubDepartment.value = ''
  }
  loadOverview()
}

function findNameById(list, id) {
  if (!id) return ''
  const match = list.value.find(item => toId(item._id || item.id) === id)
  return match?.name || ''
}

function buildExportFilename(format) {
  const extension = format === 'pdf' ? 'pdf' : 'xlsx'
  const orgName = findNameById(organizations, selectedOrganization.value) || '全部機構'
  const deptName = findNameById(departments, selectedDepartment.value) || '全部部門'
  const subName = findNameById(subDepartments, selectedSubDepartment.value) || '全部小單位'
  return `班表總覽_${selectedMonth.value}_${orgName}_${deptName}_${subName}.${extension}`
}

async function handleExport(format) {
  if (!selectedMonth.value) {
    ElMessage.error('請先選擇月份')
    return
  }

  exportLoading.value = true
  exportFormat.value = format

  try {
    const params = new URLSearchParams({ month: selectedMonth.value })
    if (selectedOrganization.value) params.set('organization', selectedOrganization.value)
    if (selectedDepartment.value) params.set('department', selectedDepartment.value)
    if (selectedSubDepartment.value) params.set('subDepartment', selectedSubDepartment.value)
    params.set('format', format)

    const res = await apiFetch(`/api/schedules/export?${params.toString()}`)
    const blob = await parseBlobResponse(res, '匯出失敗')
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = buildExportFilename(format)
    link.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    const message = err?.message || '匯出失敗'
    ElMessage.error(message)
  } finally {
    exportLoading.value = false
    exportFormat.value = ''
  }
}

onMounted(async () => {
  await loadReferenceData()
  await loadOverview()
})
</script>

<style scoped>
.schedule-overview-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
  background: #f8fafc;
  min-height: 100%;
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-title {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: #0f172a;
}

.page-subtitle {
  margin: 0;
  color: #475569;
}

.filters-card {
  border-radius: 12px;
}

.filters-header {
  font-weight: 600;
  color: #0f172a;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.filters-title {
  font-weight: 600;
  color: #0f172a;
}

.export-actions {
  display: flex;
  align-items: center;
}

.filters-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-label {
  font-size: 14px;
  color: #475569;
}

.filter-control {
  width: 100%;
}

.message-block {
  border-radius: 8px;
}

.overview-skeleton {
  border-radius: 12px;
  padding: 16px;
  background: #fff;
}

.empty-state {
  background: #fff;
  border-radius: 12px;
  padding: 48px 0;
}

.overview-results {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.organization-block {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.organization-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.organization-title {
  margin: 0;
  font-size: 22px;
  color: #0f172a;
}

.organization-meta {
  color: #64748b;
}

.department-block {
  margin-top: 12px;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.department-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.department-title {
  margin: 0;
  font-size: 18px;
  color: #1e293b;
}

.department-meta {
  color: #94a3b8;
  font-size: 14px;
}

.unit-card {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  background: #fdfefd;
}

.unit-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 12px;
}

.unit-title {
  margin: 0;
  font-size: 16px;
  color: #0f172a;
}

.unit-meta {
  font-size: 14px;
  color: #64748b;
}

.unit-table-wrapper {
  overflow-x: auto;
}

.overview-table {
  min-width: 600px;
}

.shift-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 80px;
  padding: 4px 8px;
  border-radius: 8px;
  background: #e0f2fe;
  color: #0f172a;
  font-size: 13px;
  font-weight: 500;
}

.shift-label.empty {
  background: #f1f5f9;
  color: #94a3b8;
}

@media (max-width: 768px) {
  .schedule-overview-page {
    padding: 16px;
  }

  .filters-grid {
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }

  .overview-table {
    min-width: 520px;
  }
}
</style>
