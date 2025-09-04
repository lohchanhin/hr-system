<template>
  <div class="schedule-page">
    <!-- Modern header with better typography and spacing -->
    <div class="page-header">
      <h1 class="page-title">排班管理</h1>
      <p class="page-subtitle">管理員工排班與班表預覽</p>
    </div>

    <ScheduleDashboard :summary="summary" />

    <!-- Enhanced filters section with card design -->
    <div class="filters-card">
      <div class="filters-header">
        <h3 class="filters-title">篩選條件</h3>
      </div>
      <div class="filters-content">
        <div class="filter-group">
          <label class="filter-label">選擇月份</label>
          <el-date-picker
            v-model="currentMonth"
            type="month"
            @change="onMonthChange"
            class="modern-date-picker"
          />
        </div>
        <div class="filter-group">
          <label class="filter-label">部門</label>
          <el-select
            v-model="selectedDepartment"
            placeholder="請選擇部門"
            @change="onDepartmentChange"
            class="modern-select"
          >
            <el-option
              v-for="dept in departments"
              :key="dept._id"
              :label="dept.name"
              :value="dept._id"
            />
          </el-select>
        </div>
        <div class="filter-group">
          <label class="filter-label">單位</label>
          <el-select
            v-model="selectedSubDepartment"
            placeholder="請選擇單位"
            @change="onSubDepartmentChange"
            class="modern-select"
          >
            <el-option
              v-for="sub in filteredSubDepartments"
              :key="sub._id"
              :label="sub.name"
              :value="sub._id"
            />
          </el-select>
        </div>
      </div>
    </div>

    <!-- Enhanced actions section with modern button design -->
    <div class="actions-card">
      <div class="primary-actions">
        <el-button type="primary" @click="saveAll" class="action-btn primary">
          <i class="el-icon-check"></i>
          儲存排班
        </el-button>
      </div>
      <div class="secondary-actions">
        <el-button @click="preview('week')" class="action-btn secondary">
          <i class="el-icon-calendar"></i>
          預覽週表
        </el-button>
        <el-button @click="preview('month')" class="action-btn secondary">
          <i class="el-icon-date"></i>
          預覽月表
        </el-button>
        <el-button @click="() => exportSchedules('pdf')" class="action-btn export">
          <i class="el-icon-download"></i>
          匯出 PDF
        </el-button>
        <el-button @click="() => exportSchedules('excel')" class="action-btn export">
          <i class="el-icon-s-grid"></i>
          匯出 Excel
        </el-button>
      </div>
    </div>

    <!-- Enhanced schedule table with modern design -->
    <div class="schedule-card">
      <div class="schedule-header">
        <h3 class="schedule-title">員工排班表</h3>
        <div class="schedule-legend">
          <span class="legend-item morning">早班</span>
          <span class="legend-item evening">晚班</span>
          <span class="legend-item normal">正常班</span>
          <span class="legend-item leave">請假</span>
        </div>
        <el-input
          v-model="employeeSearch"
          placeholder="搜尋員工"
          clearable
          class="employee-search"
        />
        <el-select v-model="statusFilter" placeholder="狀態" class="status-filter">
          <el-option label="全部" value="all" />
          <el-option label="缺班" value="unscheduled" />
          <el-option label="待審核請假" value="onLeave" />
        </el-select>
      </div>

      <el-table
        class="modern-schedule-table"
        :data="filteredEmployees"
        :header-cell-style="{ backgroundColor: '#ecfeff', color: '#164e63', fontWeight: '600' }"
        :row-style="{ backgroundColor: '#ffffff' }"
        @row-click="row => lazyMode && toggleRow(row._id)"
      >
        <el-table-column label="部門／單位" width="180" fixed="left">
          <template #default="{ row }">
            <div class="employee-info">
              <div class="department-name">{{ row.department }}</div>
              <div v-if="row.subDepartment" class="sub-department">{{ row.subDepartment }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="員工姓名" width="120" fixed="left">
          <template #default="{ row }">
            <div class="employee-name">
              <component
                v-if="employeeStatus(row._id) === 'unscheduled'"
                :is="CircleCloseFilled"
                class="status-icon unscheduled"
              />
              <component
                v-else-if="employeeStatus(row._id) === 'onLeave'"
                :is="WarningFilled"
                class="status-icon on-leave"
              />
              {{ row.name }}
            </div>
          </template>
        </el-table-column>
        <el-table-column
          v-for="d in days"
          :key="d.date"
          :label="d.label"
          width="140"
          align="center"
        >
          <template #default="{ row }">
            <div
              v-if="!lazyMode || expandedRows.has(row._id)"
              class="modern-schedule-cell"
              :class="[
                shiftClass(scheduleMap[row._id]?.[d.date]?.shiftId),
                {
                  'has-leave': scheduleMap[row._id]?.[d.date]?.leave,
                  'missing-shift':
                    !scheduleMap[row._id]?.[d.date]?.shiftId &&
                    !scheduleMap[row._id]?.[d.date]?.leave
                }
              ]"
            >
              <template v-if="scheduleMap[row._id]?.[d.date]">
                <template v-if="canEdit">
                  <el-select
                    v-model="scheduleMap[row._id][d.date].shiftId"
                    placeholder="選擇班別"
                    @change="val => onSelect(row._id, d.date, val)"
                    class="cell-select shift-select"
                    size="small"
                  >
                    <el-option
                      v-for="opt in shifts"
                      :key="opt._id"
                      :label="opt.code"
                      :value="opt._id"
                    />
                  </el-select>
                  <div class="department-selects">
                    <el-select
                      v-model="scheduleMap[row._id][d.date].department"
                      placeholder="部門"
                      size="small"
                      @change="() => (scheduleMap[row._id][d.date].subDepartment = '')"
                      class="cell-select dept-select"
                    >
                      <el-option
                        v-for="dept in departments"
                        :key="dept._id"
                        :label="dept.name"
                        :value="dept._id"
                      />
                    </el-select>
                    <el-select
                      v-model="scheduleMap[row._id][d.date].subDepartment"
                      placeholder="單位"
                      size="small"
                      class="cell-select sub-dept-select"
                    >
                      <el-option
                        v-for="sub in subDepsFor(scheduleMap[row._id][d.date].department)"
                        :key="sub._id"
                        :label="sub.name"
                        :value="sub._id"
                      />
                    </el-select>
                  </div>
                </template>
                <template v-else>
                  <div
                    v-if="scheduleMap[row._id][d.date].leave"
                    class="leave-indicator"
                  >
                    請假中
                  </div>
                  <el-popover
                    v-else-if="shiftInfo(scheduleMap[row._id][d.date].shiftId)"
                    placement="top"
                    trigger="hover"
                    :width="200"
                  >
                    <div class="shift-details">
                      <div class="detail-row">
                        <span class="detail-label">上班時間：</span>
                        <span class="detail-value">{{ shiftInfo(scheduleMap[row._id][d.date].shiftId).startTime }}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">下班時間：</span>
                        <span class="detail-value">{{ shiftInfo(scheduleMap[row._id][d.date].shiftId).endTime }}</span>
                      </div>
                      <div
                        v-if="shiftInfo(scheduleMap[row._id][d.date].shiftId).remark"
                        class="detail-row"
                      >
                        <span class="detail-label">備註：</span>
                        <span class="detail-value">{{ shiftInfo(scheduleMap[row._id][d.date].shiftId).remark }}</span>
                      </div>
                    </div>
                    <template #reference>
                      <div class="modern-shift-tag">
                        {{ shiftInfo(scheduleMap[row._id][d.date].shiftId).code }}
                      </div>
                    </template>
                  </el-popover>
                </template>
                <div
                  v-if="
                    !scheduleMap[row._id][d.date].shiftId &&
                    !scheduleMap[row._id][d.date].leave
                  "
                  class="missing-label"
                >
                  未排班
                </div>
              </template>
              <span v-else class="empty-cell">-</span>
            </div>
            <div v-else class="modern-schedule-cell collapsed-cell">展開班表</div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- Enhanced approval list with modern card design -->
    <div v-if="approvalList.length" class="approval-card">
      <div class="approval-header">
        <h3 class="approval-title">待處理審批</h3>
        <div class="approval-count">{{ approvalList.length }} 項待處理</div>
      </div>
      <el-table 
        class="modern-approval-table" 
        :data="approvalList"
        :header-cell-style="{ backgroundColor: '#f1f5f9', color: '#164e63', fontWeight: '600' }"
      >
        <el-table-column label="申請人" width="120">
          <template #default="{ row }">
            <div class="applicant-name">{{ row.applicant_employee?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="申請類型" width="150">
          <template #default="{ row }">
            <div class="form-type">{{ row.form?.name || '未知類型' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="狀態" width="100">
          <template #default="{ row }">
            <el-tag 
              :type="row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'"
              class="status-tag"
            >
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import { apiFetch } from '../../api'
import { useAuthStore } from '../../stores/auth'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import ScheduleDashboard from './ScheduleDashboard.vue'
import { CircleCloseFilled, WarningFilled } from '@element-plus/icons-vue'

const currentMonth = ref(dayjs().format('YYYY-MM'))
const scheduleMap = ref({})
const shifts = ref([])
const employees = ref([])
const approvalList = ref([])
const departments = ref([])
const subDepartments = ref([])
const selectedDepartment = ref('')
const selectedSubDepartment = ref('')
const summary = ref({ direct: 0, unscheduled: 0, onLeave: 0 })
const employeeSearch = ref('')
const statusFilter = ref('all')
const expandedRows = ref(new Set())

const employeeStatus = empId => {
  const days = scheduleMap.value[empId] || {}
  const values = Object.values(days)
  const hasShift = values.some(v => v.shiftId)
  const hasLeave = values.some(v => v.leave)
  if (!hasShift) return 'unscheduled'
  if (hasLeave) return 'onLeave'
  return 'scheduled'
}

const filteredEmployees = computed(() => {
  let list = employeeSearch.value
    ? employees.value.filter(e => e.name.includes(employeeSearch.value))
    : employees.value
  if (statusFilter.value !== 'all') {
    list = list.filter(e => employeeStatus(e._id) === statusFilter.value)
  }
  return list
})

const lazyMode = computed(() => employees.value.length > 50)
const toggleRow = id => {
  if (expandedRows.value.has(id)) expandedRows.value.delete(id)
  else expandedRows.value.add(id)
}

const filteredSubDepartments = computed(() =>
  subDepartments.value.filter(s => s.department === selectedDepartment.value)
)

const router = useRouter()

const authStore = useAuthStore()
authStore.loadUser()

const canEdit = computed(() => {
  return ['supervisor', 'admin'].includes(authStore.role)
})

const days = computed(() => {
  const dt = dayjs(currentMonth.value + '-01')
  const end = dt.endOf('month').date()
  const week = ['日', '一', '二', '三', '四', '五', '六']
  return Array.from({ length: end }, (_, i) => {
    const date = i + 1
    const wd = week[dt.date(date).day()]
    return { date, label: `${date}(${wd})` }
  })
})

async function fetchShiftOptions() {
  const res = await apiFetch('/api/attendance-settings')
  if (res.ok) {
    const data = await res.json()
    const list = Array.isArray(data?.shifts) ? data.shifts : data
    if (Array.isArray(list)) {
      shifts.value = list.map(s => ({
        _id: s._id,
        code: s.code,
        startTime: s.startTime,
        endTime: s.endTime,
        remark: s.remark
      }))
    }
  } else {
    if (res.status === 403) {
      alert('缺少權限，請重新登入或聯絡管理員')
    } else {
      console.error('取得班表設定失敗', res.status)
    }
  }
}

async function fetchSubDepartments(dept = '') {
  try {
    const url = dept ? `/api/sub-departments?department=${dept}` : '/api/sub-departments'
    const res = await apiFetch(url)
    if (!res.ok) throw new Error('Failed to fetch sub departments')
    const subData = await res.json()
    const deptMap = departments.value.reduce((acc, d) => {
      acc[d._id] = d._id
      acc[d.name] = d._id
      return acc
    }, {})
    subDepartments.value = Array.isArray(subData)
      ? subData.map(s => {
          let deptId = ''
          if (s && typeof s.department === 'object') {
            deptId = s.department._id || deptMap[s.department.name] || ''
          } else {
            deptId = deptMap[s.department] || s.department || ''
          }
          return { ...s, _id: String(s._id), department: String(deptId) }
        })
      : []
    if (subDepartments.value.length && !selectedSubDepartment.value) {
      selectedSubDepartment.value = subDepartments.value[0]._id
    }
  } catch (err) {
    console.error(err)
    subDepartments.value = []
    selectedSubDepartment.value = ''
  }
}

async function fetchOptions() {
  try {
    const deptRes = await apiFetch('/api/departments')
    departments.value = deptRes.ok ? await deptRes.json() : []
    await fetchSubDepartments(selectedDepartment.value)
  } catch (err) {
    console.error(err)
  }
}

async function fetchSchedules() {
  const supervisorId = localStorage.getItem('employeeId')
  const supParam = supervisorId && supervisorId !== 'undefined' ? `&supervisor=${supervisorId}` : ''
  try {
    const res = await apiFetch(
      `/api/schedules/monthly?month=${currentMonth.value}${supParam}`
    )
    if (!res.ok) throw new Error('Failed to fetch schedules')
    const data = await res.json()
    console.log("Schedules:",data)

    const ds = days.value
    scheduleMap.value = {}
    if (!employees.value.length) {
      await fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
    }
    employees.value.forEach(emp => {
      scheduleMap.value[emp._id] = {}
      ds.forEach(d => {
        scheduleMap.value[emp._id][d.date] = {
          shiftId: '',
          department: emp.departmentId,
          subDepartment: emp.subDepartmentId
        }
      })
    })
    data.forEach((s) => {
      const empId = s.employee?._id || s.employee
      const d = dayjs(s.date).date()
      const emp = employees.value.find(e => e._id === empId) || {}
      scheduleMap.value[empId][d] = {
        id: s._id,
        shiftId: s.shiftId,
        department: s.department || emp.departmentId,
        subDepartment: s.subDepartment || emp.subDepartmentId
      }
    })

    const res2 = await apiFetch(
      `/api/schedules/leave-approvals?month=${currentMonth.value}${supParam}`
    )
    if (res2.ok) {
      const extra = await res2.json()
      approvalList.value = extra.approvals || []
      ;(extra.leaves || []).forEach(l => {
        if (l.status !== 'approved') return
        const empId = l.employee?._id || l.employee
        const start = dayjs(l.startDate).date()
        const end = dayjs(l.endDate).date()
        for (let d = start; d <= end; d++) {
          if (scheduleMap.value[empId]?.[d]) {
            scheduleMap.value[empId][d].leave = { type: l.leaveType }
          }
        }
      })
    }
  } catch (err) {
    console.error(err)
    ElMessage.error('取得排班資料失敗')
  }
}

async function saveAll() {
  const hasMissing = Object.values(scheduleMap.value).some(days =>
    Object.values(days).some(it => !it.shiftId && !it.leave)
  )
  if (hasMissing) {
    ElMessage.warning('尚有未排班項目，請確認後再儲存')
    return
  }
  const schedules = []
  Object.keys(scheduleMap.value).forEach(empId => {
    Object.keys(scheduleMap.value[empId]).forEach(day => {
      const item = scheduleMap.value[empId][day]
      if (item.shiftId && !item.id) {
        schedules.push({
          employee: empId,
          date: `${currentMonth.value}-${String(day).padStart(2, '0')}`,
          shiftId: item.shiftId,
          department: item.department,
          subDepartment: item.subDepartment
        })
      }
    })
  })
  if (!schedules.length) return
  try {
    const res = await apiFetch('/api/schedules/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedules })
    })
    if (!res.ok) throw new Error('save failed')
    const inserted = await res.json()
    inserted.forEach(it => {
      const empId = it.employee?._id || it.employee
      const d = dayjs(it.date).date()
      if (!scheduleMap.value[empId]) scheduleMap.value[empId] = {}
      scheduleMap.value[empId][d] = { id: it._id, shiftId: it.shiftId }
    })
    ElMessage.success('儲存完成')
  } catch (err) {
    ElMessage.error('儲存失敗')
  }
}

function preview(type) {
  sessionStorage.setItem(
    'schedulePreview',
    JSON.stringify({
      scheduleMap: scheduleMap.value,
      employees: employees.value,
      days: days.value,
      shifts: shifts.value
    })
  )
  router.push({ name: type === 'week' ? 'PreviewWeek' : 'PreviewMonth' })
}

async function exportSchedules(format) {
  try {
    const res = await apiFetch(
      `/api/schedules/export?month=${currentMonth.value}&format=${format}`
    )
    if (!res.ok) throw new Error()
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `schedules-${currentMonth.value}.${
      format === 'excel' ? 'xlsx' : 'pdf'
    }`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    ElMessage.error('匯出失敗')
  }
}

async function onSelect(empId, day, value) {
  const dateStr = `${currentMonth.value}-${String(day).padStart(2, '0')}`
  const existing = scheduleMap.value[empId][day]
  const prev = existing.shiftId
  if (existing && existing.id) {
    try {
      const res = await apiFetch(`/api/schedules/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shiftId: value,
          department: existing.department,
          subDepartment: existing.subDepartment
        })
      })
      if (!res.ok) {
        await handleScheduleError(res, '更新排班失敗', empId, day, prev)
      }
    } catch (err) {
      await handleScheduleError(null, '更新排班失敗', empId, day, prev)
    }
  } else {
    try {
      const res = await apiFetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee: empId,
          date: dateStr,
          shiftId: value,
          department: existing.department,
          subDepartment: existing.subDepartment
        })
      })
      if (res.ok) {
        const saved = await res.json()
        scheduleMap.value[empId][day] = {
          id: saved._id,
          shiftId: saved.shiftId,
          department: existing.department,
          subDepartment: existing.subDepartment
        }
      } else {
        await handleScheduleError(res, '新增排班失敗', empId, day, prev)
      }
    } catch (err) {
      await handleScheduleError(null, '新增排班失敗', empId, day, prev)
    }
  }
}

async function onDepartmentChange() {
  selectedSubDepartment.value = ''
  await fetchSubDepartments(selectedDepartment.value)
  await fetchEmployees(selectedDepartment.value, '')
  await fetchSchedules()
}

async function onSubDepartmentChange() {
  await fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
  await fetchSchedules()
}

async function handleScheduleError(res, defaultMsg, empId, day, prev) {
  scheduleMap.value[empId][day].shiftId = prev
  let msg = ''
  try {
    if (res) {
      const data = await res.json()
      msg = data?.error || ''
    }
  } catch (e) {}
  if (msg === 'employee conflict') {
    ElMessageBox.alert('人員衝突')
  } else if (msg === 'department overlap') {
    ElMessageBox.alert('跨區重複')
  } else if (msg === 'leave conflict') {
    ElMessageBox.alert('請假衝突')
  } else {
    ElMessage.error(defaultMsg)
  }
}

function shiftInfo(id) {
  return shifts.value.find(s => s._id === id)
}

function shiftClass(id) {
  const info = shiftInfo(id)
  if (!info) return ''
  if (/早/.test(info.code)) return 'shift-morning'
  if (/晚|夜/.test(info.code)) return 'shift-evening'
  return 'shift-normal'
}

function subDepsFor(deptId) {
  return subDepartments.value.filter(s => s.department === deptId)
}

async function fetchEmployees(department = '', subDepartment = '') {
  const supervisorId = localStorage.getItem('employeeId')
  const params = []
  if (supervisorId && supervisorId !== 'undefined') params.push(`supervisor=${supervisorId}`)
  if (department) params.push(`department=${department}`)
  if (subDepartment) params.push(`subDepartment=${subDepartment}`)
  const url = `/api/employees${params.length ? `?${params.join('&')}` : ''}`
  try {
    const empRes = await apiFetch(url)
    if (!empRes.ok) throw new Error('Failed to fetch employees')
    const empData = await empRes.json()
    const deptMap = departments.value.reduce((acc, d) => {
      acc[d._id] = d.name
      return acc
    }, {})
    const subMap = subDepartments.value.reduce((acc, s) => {
      acc[s._id] = s.name
      return acc
    }, {})
    const sorted = empData
      .map(e => ({
        _id: e._id,
        name: e.name,
        departmentId: e.department,
        subDepartmentId: e.subDepartment,
        department: deptMap[e.department] || '',
        subDepartment: subMap[e.subDepartment] || ''
      }))
      .sort((a, b) => a.department.localeCompare(b.department))
    employees.value = sorted
  } catch (err) {
    console.error(err)
    ElMessage.error('取得員工資料失敗')
  }
}

async function fetchSummary() {
  try {
    const res = await apiFetch(`/api/schedules/summary?month=${currentMonth.value}`)
    if (res.ok) {
      const data = await res.json()
      summary.value = {
        direct: data.length,
        unscheduled: data.filter(e => e.shiftCount === 0).length,
        onLeave: data.filter(e => e.leaveCount > 0).length
      }
    }
  } catch (err) {
    console.error(err)
  }
}

async function onMonthChange() {
  await fetchSchedules()
  await fetchSummary()
}

onMounted(async () => {
  await fetchSummary()
  await fetchShiftOptions()
  await fetchOptions()
  await fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
  await fetchSchedules()
})
</script>

<style scoped lang="scss">
@use "element-plus/theme-chalk/src/common/var.scss" as *;

/* Modern HR system styling with professional design */
.schedule-page {
  padding: 24px;
  background: linear-gradient(135deg, #f8fafc 0%, #ecfeff 100%);
  min-height: 100vh;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

.page-header {
  margin-bottom: 32px;
  text-align: center;
  
  .page-title {
    font-size: 2.5rem;
    font-weight: 800;
    color: #164e63;
    margin: 0 0 8px 0;
    letter-spacing: -0.025em;
  }
  
  .page-subtitle {
    font-size: 1.125rem;
    color: #475569;
    margin: 0;
    font-weight: 400;
  }
}

.filters-card, .actions-card, .schedule-card, .approval-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  margin-bottom: 24px;
  overflow: hidden;
  border: 1px solid #ecfeff;
}

.filters-card {
  .filters-header {
    background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
    padding: 20px 24px;
    
    .filters-title {
      color: white;
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0;
    }
  }
  
  .filters-content {
    padding: 24px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
  }
  
  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    
    .filter-label {
      font-weight: 600;
      color: #164e63;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  }
}

.modern-date-picker, .modern-select {
  ::v-deep(.el-input__wrapper) {
    border-radius: 8px;
    border: 2px solid #ecfeff;
    transition: all 0.2s ease;
    
    &:hover {
      border-color: #10b981;
    }
    
    &.is-focus {
      border-color: #10b981;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
    }
  }
}

.actions-card {
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  
  .primary-actions, .secondary-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
}

.action-btn {
  border-radius: 8px;
  font-weight: 600;
  padding: 12px 20px;
  transition: all 0.2s ease;
  
  &.primary {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border: none;
    color: white;
    
    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    }
  }
  
  &.secondary {
    background: white;
    border: 2px solid #164e63;
    color: #164e63;
    
    &:hover {
      background: #164e63;
      color: white;
      transform: translateY(-1px);
    }
  }
  
  &.export {
    background: white;
    border: 2px solid #10b981;
    color: #10b981;
    
    &:hover {
      background: #10b981;
      color: white;
      transform: translateY(-1px);
    }
  }
}

.schedule-card {
  .schedule-header {
    background: linear-gradient(135deg, #f1f5f9 0%, #ecfeff 100%);
    padding: 20px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    
    .schedule-title {
      color: #164e63;
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0;
    }
    
    .schedule-legend {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      
      .legend-item {
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        
        &.morning {
          background: #dbeafe;
          color: #1e40af;
        }
        
        &.evening {
          background: #d1fae5;
          color: #059669;
        }
        
        &.normal {
          background: #f1f5f9;
          color: #475569;
        }
        
        &.leave {
          background: #fef3c7;
          color: #d97706;
        }
      }
    }

    .employee-search {
      max-width: 200px;
    }
    .status-filter {
      max-width: 160px;
    }
  }
}

.modern-schedule-table {
  ::v-deep(.el-table__header) {
    th {
      border-bottom: 2px solid #ecfeff;
    }
  }
  
  ::v-deep(.el-table__row) {
    &:hover {
      background-color: #f8fafc !important;
    }
  }
}

.employee-info {
  .department-name {
    font-weight: 600;
    color: #164e63;
    font-size: 0.875rem;
  }
  
  .sub-department {
    font-size: 0.75rem;
    color: #64748b;
    margin-top: 2px;
  }
}

.employee-name {
  font-weight: 600;
  color: #1e293b;
}

.status-icon {
  margin-right: 4px;
  &.unscheduled { color: #dc2626; }
  &.on-leave { color: #f59e0b; }
}

.modern-schedule-cell {
  padding: 8px;
  border-radius: 8px;
  min-height: 60px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: all 0.2s ease;
  
  &.shift-morning {
    background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
    border: 1px solid #93c5fd;
  }
  
  &.shift-evening {
    background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
    border: 1px solid #6ee7b7;
  }
  
  &.shift-normal {
    background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
    border: 1px solid #cbd5e1;
  }
  
  &.has-leave {
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
    border: 1px solid #fbbf24;
  }
}

.collapsed-cell {
  color: #94a3b8;
  text-align: center;
}

.cell-select {
  ::v-deep(.el-input__wrapper) {
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(4px);
  }
}

.department-selects {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.modern-shift-tag {
  background: white;
  color: #164e63;
  padding: 4px 8px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.75rem;
  text-align: center;
  cursor: pointer;
  border: 1px solid rgba(22, 78, 99, 0.2);
  transition: all 0.2s ease;
  
  &:hover {
    background: #164e63;
    color: white;
    transform: scale(1.05);
  }
}

.shift-details {
  .detail-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    
    .detail-label {
      font-weight: 600;
      color: #475569;
    }
    
    .detail-value {
      color: #164e63;
      font-weight: 500;
    }
  }
}

.leave-indicator {
  display: inline-block;
  color: #b45309;
  font-size: 0.75rem;
  font-weight: 600;
  background: #fef9c3;
  padding: 2px 6px;
  border-radius: 4px;
}

.missing-shift {
  background: #fee2e2;
}

.missing-label {
  color: #b91c1c;
  font-size: 0.75rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  &::before {
    content: '⚠';
    margin-right: 4px;
  }
}

.empty-cell {
  color: #94a3b8;
  font-size: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.approval-card {
  .approval-header {
    background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
    padding: 20px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    
    .approval-title {
      color: white;
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0;
    }
    
    .approval-count {
      background: rgba(255, 255, 255, 0.2);
      color: white;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.875rem;
      font-weight: 600;
    }
  }
}

.modern-approval-table {
  ::v-deep(.el-table__row) {
    &:hover {
      background-color: #f8fafc !important;
    }
  }
}

.applicant-name, .form-type {
  font-weight: 500;
  color: #1e293b;
}

.status-tag {
  font-weight: 600;
  border-radius: 6px;
}

@media (max-width: 768px) {
  .schedule-page {
    padding: 16px;
  }
  
  .page-header .page-title {
    font-size: 2rem;
  }
  
  .filters-content {
    grid-template-columns: 1fr;
  }
  
  .actions-card {
    flex-direction: column;
    align-items: stretch;
    
    .primary-actions, .secondary-actions {
      justify-content: center;
    }
  }
  
  .schedule-header {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .modern-schedule-table {
    ::v-deep(.el-table__fixed-column--left) {
      z-index: 10;
    }
  }
}
</style>
