<template>
  <div class="schedule-page">
    <h2>排班管理</h2>
    <el-date-picker v-model="currentMonth" type="month" @change="fetchSchedules" />
    <el-table :data="employees" style="margin-top: 20px;">
      <el-table-column prop="name" label="員工" />
      <el-table-column
        v-for="d in days"
        :key="d"
        :label="d"
      >
        <template #default="{ row }">
          <template v-if="scheduleMap[row._id]?.[d]">
            <el-select
              v-if="canEdit"
              v-model="scheduleMap[row._id][d].shiftId"
              placeholder=""
              @change="val => onSelect(row._id, d, val)"
            >
              <el-option
                v-for="opt in shifts"
                :key="opt._id"
                :label="opt.name"
                :value="opt._id"
              />
            </el-select>
            <span v-else>{{ shiftName(scheduleMap[row._id]?.[d]?.shiftId) || '' }}</span>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
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

const authStore = useAuthStore()
authStore.loadUser()

const canEdit = computed(() => {
  return ['supervisor', 'admin'].includes(authStore.role)
})

const days = computed(() => {
  const dt = dayjs(currentMonth.value + '-01')
  const end = dt.endOf('month').date()
  return Array.from({ length: end }, (_, i) => i + 1)
})

async function fetchShiftOptions() {
  const res = await apiFetch('/api/attendance-settings')
  if (res.ok) {
    const data = await res.json()
    const list = Array.isArray(data?.shifts) ? data.shifts : data
    if (Array.isArray(list)) {
      shifts.value = list.map(s => ({ _id: s._id, name: s.name }))
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
        scheduleMap.value[emp._id][d] = { shiftId: '' }
      })
    })
    data.forEach((s) => {
      const empId = s.employee?._id || s.employee
      const d = dayjs(s.date).date()
      scheduleMap.value[empId][d] = { id: s._id, shiftId: s.shiftId }
    })
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

function shiftName(id) {
  const found = shifts.value.find(s => s._id === id)
  return found?.name || ''
}

async function fetchEmployees() {
  const supervisorId = localStorage.getItem('employeeId') || ''
  try {
    const res = await apiFetch(`/api/employees?supervisor=${supervisorId}`)
    if (!res.ok) throw new Error('Failed to fetch employees')
    console.log("employee:",res)
    employees.value = await res.json()
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
</style>
