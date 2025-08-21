<template>
  <div class="schedule-page">
    <h2>排班管理</h2>
    <el-date-picker v-model="currentMonth" type="month" @change="fetchSchedules" />
    <el-table :data="employees" style="margin-top: 20px;">
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
          <div :class="{ 'is-leave': scheduleMap[row._id]?.[d.date]?.leave }">
            <template v-if="scheduleMap[row._id]?.[d.date]">
              <el-select
                v-if="canEdit"
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
                  <span>{{ shiftInfo(scheduleMap[row._id][d.date].shiftId).code }}</span>
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
    <el-table :data="approvalList" style="margin-top: 20px;">
      <el-table-column label="申請人">
        <template #default="{ row }">{{ row.applicant_employee?.name }}</template>
      </el-table-column>
      <el-table-column label="類型">
        <template #default="{ row }">{{ row.form_data?.leaveType || row.form_data?.type || '' }}</template>
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

const currentMonth = ref(dayjs().format('YYYY-MM'))
const scheduleMap = ref({})
const shifts = ref([])
const employees = ref([])
const approvalList = ref([])

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
      await fetchEmployees()
    }
    employees.value.forEach(emp => {
      scheduleMap.value[emp._id] = {}
      ds.forEach(d => {
        scheduleMap.value[emp._id][d.date] = { shiftId: '' }
      })
    })
    data.forEach((s) => {
      const empId = s.employee?._id || s.employee
      const d = dayjs(s.date).date()
      scheduleMap.value[empId][d] = { id: s._id, shiftId: s.shiftId }
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

async function onSelect(empId, day, value) {
  const dateStr = `${currentMonth.value}-${String(day).padStart(2, '0')}`
  const existing = scheduleMap.value[empId][day]
  const prev = existing.shiftId
  if (existing && existing.id) {
    try {
      const res = await apiFetch(`/api/schedules/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftId: value })
      })
      if (!res.ok) {
        scheduleMap.value[empId][day].shiftId = prev
        ElMessage.error('更新排班失敗')
      }
    } catch (err) {
      scheduleMap.value[empId][day].shiftId = prev
      ElMessage.error('更新排班失敗')
    }
  } else {
    try {
      const res = await apiFetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee: empId, date: dateStr, shiftId: value })
      })
      if (res.ok) {
        const saved = await res.json()
        scheduleMap.value[empId][day] = { id: saved._id, shiftId: saved.shiftId }
      } else {
        scheduleMap.value[empId][day].shiftId = prev
        ElMessage.error('新增排班失敗')
      }
    } catch (err) {
      scheduleMap.value[empId][day].shiftId = prev
      ElMessage.error('新增排班失敗')
    }
  }
}

function shiftInfo(id) {
  return shifts.value.find(s => s._id === id)
}

async function fetchEmployees() {
  const supervisorId = localStorage.getItem('employeeId') || ''
  try {
    const res = await apiFetch(`/api/employees?supervisor=${supervisorId}`)
    if (!res.ok) throw new Error('Failed to fetch employees')
    const data = await res.json()
    const sorted = data
      .map(e => ({
        _id: e._id,
        name: e.name,
        department: e.department || '',
        subDepartment: e.subDepartment || ''
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
  await fetchEmployees()
  await fetchSchedules()
})
</script>

<style scoped>
.schedule-page {
  padding: 20px;
}
.is-leave {
  background-color: #fde2e2;
}
.leave-icon {
  margin-left: 4px;
  color: #f56c6c;
}
</style>
