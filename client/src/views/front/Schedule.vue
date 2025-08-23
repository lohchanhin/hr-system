<template>
  <div class="schedule-page">
    <h2>排班管理</h2>
    <div class="filters">
      <el-date-picker v-model="currentMonth" type="month" @change="fetchSchedules" />
      <el-select
        class="schedule-select"
        v-model="selectedDepartment"
        placeholder="部門"
        @change="onDepartmentChange"
      >
        <el-option
          v-for="dept in departments"
          :key="dept._id"
          :label="dept.name"
          :value="dept._id"
        />
      </el-select>
      <el-select
        class="schedule-select"
        v-model="selectedSubDepartment"
        placeholder="單位"
        @change="onSubDepartmentChange"
      >
        <el-option
          v-for="sub in filteredSubDepartments"
          :key="sub._id"
          :label="sub.name"
          :value="sub._id"
        />
      </el-select>
    </div>
    <div class="actions">
      <el-button type="primary" @click="saveAll">儲存</el-button>
      <el-button @click="preview('week')">預覽週表</el-button>
      <el-button @click="preview('month')">預覽月表</el-button>
      <el-button @click="() => exportSchedules('pdf')">匯出 PDF</el-button>
      <el-button @click="() => exportSchedules('excel')">匯出 Excel</el-button>
    </div>
    <el-table class="schedule-table" :data="employees" style="margin-top: 20px;">
      <el-table-column label="樓層／單位">
        <template #default="{ row }">
          {{ row.department }}<span v-if="row.subDepartment">／{{ row.subDepartment }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="員工" />
      <el-table-column
        v-for="d in days"
        :key="d.date"
        :label="d.label"
      >
        <template #default="{ row }">
          <div
            class="schedule-cell"
            :class="[
              shiftClass(scheduleMap[row._id]?.[d.date]?.shiftId),
              { 'is-leave': scheduleMap[row._id]?.[d.date]?.leave }
            ]"
          >
            <template v-if="scheduleMap[row._id]?.[d.date]">
              <template v-if="canEdit">
                <el-select
                  class="schedule-select"
                  v-model="scheduleMap[row._id][d.date].shiftId"
                  placeholder=""
                  @change="val => onSelect(row._id, d.date, val)"
                >
                  <el-option
                    v-for="opt in shifts"
                    :key="opt._id"
                    :label="opt.code"
                    :value="opt._id"
                  />
                </el-select>
                <el-select
                  class="schedule-select"
                  v-model="scheduleMap[row._id][d.date].department"
                  placeholder="部門"
                  size="small"
                  @change="() => (scheduleMap[row._id][d.date].subDepartment = '')"
                >
                  <el-option
                    v-for="dept in departments"
                    :key="dept._id"
                    :label="dept.name"
                    :value="dept._id"
                  />
                </el-select>
                <el-select
                  class="schedule-select"
                  v-model="scheduleMap[row._id][d.date].subDepartment"
                  placeholder="單位"
                  size="small"
                >
                  <el-option
                    v-for="sub in subDepsFor(scheduleMap[row._id][d.date].department)"
                    :key="sub._id"
                    :label="sub.name"
                    :value="sub._id"
                  />
                </el-select>
              </template>
              <el-popover
                v-else
                v-if="shiftInfo(scheduleMap[row._id][d.date].shiftId)"
                placement="top"
                trigger="click"
              >
                <p>上班：{{ shiftInfo(scheduleMap[row._id][d.date].shiftId).startTime }}</p>
                <p>下班：{{ shiftInfo(scheduleMap[row._id][d.date].shiftId).endTime }}</p>
                <p v-if="shiftInfo(scheduleMap[row._id][d.date].shiftId).remark">
                  備註：{{ shiftInfo(scheduleMap[row._id][d.date].shiftId).remark }}
                </p>
                <template #reference>
                  <span class="shift-tag">{{ shiftInfo(scheduleMap[row._id][d.date].shiftId).code }}</span>
                </template>
              </el-popover>
              <span v-else></span>
              <span v-if="scheduleMap[row._id][d.date].leave" class="leave-icon">L</span>
            </template>
            <span v-else>-</span>
          </div>
        </template>
      </el-table-column>
    </el-table>
    <el-table class="schedule-table" :data="approvalList" style="margin-top: 20px;">
      <el-table-column label="申請人">
        <template #default="{ row }">{{ row.applicant_employee?.name }}</template>
      </el-table-column>
      <el-table-column label="類型">
        <template #default="{ row }">{{ row.form?.name || '' }}</template>
      </el-table-column>
      <el-table-column prop="status" label="狀態" />
    </el-table>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import { apiFetch } from '../../api'
import { useAuthStore } from '../../stores/auth'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'

const currentMonth = ref(dayjs().format('YYYY-MM'))
const scheduleMap = ref({})
const shifts = ref([])
const employees = ref([])
const approvalList = ref([])
const departments = ref([])
const subDepartments = ref([])
const selectedDepartment = ref('')
const selectedSubDepartment = ref('')

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
  const supervisorId = localStorage.getItem('employeeId') || ''
  try {
    const res = await apiFetch(
      `/api/schedules/monthly?month=${currentMonth.value}&supervisor=${supervisorId}`
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
      `/api/schedules/leave-approvals?month=${currentMonth.value}&supervisor=${supervisorId}`
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
  const supervisorId = localStorage.getItem('employeeId') || ''
  let url = `/api/employees?supervisor=${supervisorId}`
  if (department) url += `&department=${department}`
  if (subDepartment) url += `&subDepartment=${subDepartment}`
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

onMounted(async () => {
  await fetchShiftOptions()
  await fetchOptions()
  await fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
  await fetchSchedules()
})
</script>

<style scoped lang="scss">
@use "element-plus/theme-chalk/src/common/var.scss" as *;

.schedule-page {
  padding: 20px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}

.actions {
  margin: 10px 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.schedule-select {
  font-size: 14px;
  margin-right: 8px;

  ::v-deep(.el-input__wrapper:hover) {
    border-color: var(--el-color-primary);
  }
}

.schedule-table {
  font-size: 14px;

  ::v-deep(.el-table__row:hover) {
    background-color: var(--el-color-primary-light-9);
  }
}

.schedule-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  border-radius: 4px;
}

.shift-tag {
  display: inline-block;
  padding: 2px 4px;
  border-radius: 4px;
}

.shift-morning {
  background-color: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-5);
}

.shift-evening {
  background-color: var(--el-color-success-light-9);
  border: 1px solid var(--el-color-success-light-5);
}

.shift-normal {
  background-color: #f5f7fa;
  border: 1px solid #e4e7ed;
}

.is-leave {
  background-color: var(--el-color-warning-light-9);
  border: 1px solid var(--el-color-warning-light-5);
}

.leave-icon {
  margin-left: 4px;
  color: var(--el-color-danger);
}

@media (max-width: 600px) {
  .actions {
    flex-direction: column;
  }

  ::v-deep(.schedule-table .el-table__cell:first-child) {
    display: none;
  }
}
</style>
