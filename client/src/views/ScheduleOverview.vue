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
      <el-collapse v-model="activeOrganizations" class="organization-collapse">
        <el-collapse-item
          v-for="org in overviewData"
          :key="org.id"
          :name="org.id"
          class="organization-block"
          data-test="organization-block"
        >
          <template #title>
            <header class="organization-header">
              <h2 class="organization-title">{{ org.name }}</h2>
              <span class="organization-meta">{{ org.departments.length }} 個部門</span>
            </header>
          </template>

          <el-collapse v-model="activeDepartments[org.id]" class="department-collapse">
            <el-collapse-item
              v-for="dept in org.departments"
              :key="dept.id"
              :name="dept.id"
              class="department-block"
              data-test="department-block"
            >
              <template #title>
                <header class="department-header">
                  <h3 class="department-title">{{ dept.name }}</h3>
                  <span class="department-meta">{{ dept.subDepartments.length }} 個小單位</span>
                </header>
              </template>

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
            </el-collapse-item>
          </el-collapse>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
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
const activeOrganizations = ref([])
const activeDepartments = ref({})
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
  // Pre-create empty entries object once
  const emptyEntries = {}
  days.value.forEach(day => {
    emptyEntries[day] = ''
  })
  
  return unit.employees
    .map(emp => {
      // Create a shallow copy of empty entries
      const entries = { ...emptyEntries }
      
      // Build schedule map directly using pre-initialized entries
      ;(emp.schedules || []).forEach(item => {
        entries[item.date] = item.shiftName || ''
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

// ---------- 通用 response 處理 ----------

async function parseResponse(res, fallbackMessage) {
  if (!res.ok) {
    let message = fallbackMessage
    try {
      const payload = await res.json()
      message = payload?.error || payload?.message || message
    } catch (error) {
      // ignore
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
      // ignore
    }
    throw new Error(message)
  }
  return res.blob()
}



// ---------- 載入參考資料（機構 / 部門 / 小單位） ----------

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


// ---------- 把重複的小單位 / 員工合併（避免 A 出現兩塊、主管獨立一塊） ----------
function normalizeOverviewOrganizations(rawOrgs) {
  if (!Array.isArray(rawOrgs)) return []

  return rawOrgs.map(org => {
    const normalizedDepts = Array.isArray(org.departments)
      ? org.departments.map(dept => {
          // 依小單位 id（沒有就用 name）合併
          const unitMap = new Map()
          const rawUnits = Array.isArray(dept.subDepartments) ? dept.subDepartments : []

          rawUnits.forEach(unit => {
            if (!unit) return
            const unitKey = unit.id || `name:${unit.name || ''}`

            let holder = unitMap.get(unitKey)
            if (!holder) {
              holder = {
                ...unit,
                // 用 Map 暫存員工，避免重複
                _employeesMap: new Map()
              }
              holder.employees = []
              unitMap.set(unitKey, holder)
            }

            const employees = Array.isArray(unit.employees) ? unit.employees : []
            employees.forEach(emp => {
              if (!emp) return
              const empKey = emp.id || `name:${emp.name || ''}`
              const empMap = holder._employeesMap
              const existing = empMap.get(empKey)

              if (!existing) {
                empMap.set(empKey, {
                  ...emp,
                  schedules: Array.isArray(emp.schedules) ? [...emp.schedules] : []
                })
              } else if (Array.isArray(emp.schedules) && emp.schedules.length) {
                const prev = Array.isArray(existing.schedules) ? existing.schedules : []
                // 簡單合併班表（不特別去重日期，原本就只取第一個）
                existing.schedules = prev.concat(emp.schedules)
              }
            })
          })

          const mergedUnits = Array.from(unitMap.values()).map(holder => {
            const { _employeesMap, ...rest } = holder
            return {
              ...rest,
              employees: Array.from(_employeesMap.values())
            }
          })

          return {
            ...dept,
            subDepartments: mergedUnits
          }
        })
      : []

    return {
      ...org,
      departments: normalizedDepts
    }
  })
}


// ---------- 載入班表總覽 ----------

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

    const rawDays = Array.isArray(data?.days) ? data.days : []
    const rawOrgs = Array.isArray(data?.organizations) ? data.organizations : []

    days.value = rawDays
    // ✅ 這裡先把重複的小單位 / 員工合併掉
    overviewData.value = normalizeOverviewOrganizations(rawOrgs)
    
    // Initialize collapse state - expand first organization and its first department by default
    if (overviewData.value.length > 0) {
      const firstOrg = overviewData.value[0]
      activeOrganizations.value = [firstOrg.id]
      
      // Initialize department collapse states for each organization
      const newActiveDepartments = {}
      overviewData.value.forEach(org => {
        if (org.id === firstOrg.id && org.departments.length > 0) {
          newActiveDepartments[org.id] = [org.departments[0].id]
        } else {
          newActiveDepartments[org.id] = []
        }
      })
      activeDepartments.value = newActiveDepartments
    } else {
      activeOrganizations.value = []
      activeDepartments.value = {}
    }
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


// ---------- 篩選切換 ----------

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

// ---------- 匯出相關 ----------

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

    const res = await apiFetch(`/api/schedules/overview/export?${params.toString()}`)
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

// ---------- 初始化 ----------

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

.organization-collapse {
  border: none;
}

.organization-collapse :deep(.el-collapse-item__header) {
  background: transparent;
  border: none;
  padding: 0;
  height: auto;
}

.organization-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border: none;
}

.organization-collapse :deep(.el-collapse-item__content) {
  padding: 0;
}

.organization-block {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
  margin-bottom: 16px;
}

.organization-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 8px 0;
}

.organization-title {
  margin: 0;
  font-size: 22px;
  color: #0f172a;
}

.organization-meta {
  color: #64748b;
}

.department-collapse {
  border: none;
  margin-top: 12px;
}

.department-collapse :deep(.el-collapse-item__header) {
  background: transparent;
  border: none;
  padding: 0;
  height: auto;
}

.department-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border: none;
}

.department-collapse :deep(.el-collapse-item__content) {
  padding: 0;
}

.department-block {
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 12px;
}

.department-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 8px 0;
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
  
  /* Enhanced scrollbar styling for better visibility */
  &::-webkit-scrollbar {
    height: 14px;
  }
  
  &::-webkit-scrollbar-track {
    background: #f1f5f9;
    border-radius: 8px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: #475569;
    border-radius: 8px;
    border: 2px solid #f1f5f9;
    
    &:hover {
      background: #334155;
    }
    
    &:active {
      background: #1e293b;
    }
  }
}

.overview-table {
  min-width: 600px;
  
  /* Fixed header for better visibility when scrolling */
  :deep(.el-table__header-wrapper) {
    position: sticky;
    top: 0;
    z-index: 10;
    background: #ecfeff;
  }
  
  :deep(.el-table__fixed-header-wrapper) {
    z-index: 11;
  }
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
