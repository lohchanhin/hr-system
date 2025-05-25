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
          <template v-if="scheduleMap[row._id]">
            <el-select
              v-if="canEdit"
              v-model="scheduleMap[row._id][d].shiftType"
              placeholder=""
              @change="val => onSelect(row._id, d, val)"
            >
              <el-option
                v-for="opt in shiftOptions"
                :key="opt"
                :label="opt"
                :value="opt"
              />
            </el-select>
            <span v-else>{{ scheduleMap[row._id][d]?.shiftType || '' }}</span>
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
import { getToken } from '../../utils/tokenService'

const currentMonth = ref(dayjs().format('YYYY-MM'))
const scheduleMap = ref({})
const shiftOptions = ['早班', '中班', '晚班']
const employees = ref([])

const canEdit = computed(() => {
  const role = localStorage.getItem('role') || 'employee'
  return ['supervisor', 'admin'].includes(role)
})

const days = computed(() => {
  const dt = dayjs(currentMonth.value + '-01')
  const end = dt.endOf('month').date()
  return Array.from({ length: end }, (_, i) => i + 1)
})

async function fetchSchedules() {
  const token = getToken() || ''
  const supervisorId = localStorage.getItem('employeeId') || ''
  const res = await apiFetch(
    `/api/schedules/monthly?month=${currentMonth.value}&supervisor=${supervisorId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (res.ok) {
    const data = await res.json()
    const ds = days.value
    scheduleMap.value = {}
    employees.value.forEach(emp => {
      scheduleMap.value[emp._id] = {}
      ds.forEach(d => {
        scheduleMap.value[emp._id][d] = { shiftType: '' }
      })
    })
    data.forEach((s) => {
      const empId = s.employee?._id || s.employee
      const d = dayjs(s.date).date()
      scheduleMap.value[empId][d] = { id: s._id, shiftType: s.shiftType }
    })
  }
}

async function onSelect(empId, day, value) {
  const token = getToken() || ''
  const dateStr = `${currentMonth.value}-${String(day).padStart(2, '0')}`
  const existing = scheduleMap.value[empId][day]
  if (existing && existing.id) {
    await apiFetch(`/api/schedules/${existing.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shiftType: value })
    })
  } else {
    const res = await apiFetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ employee: empId, date: dateStr, shiftType: value })
    })
    if (res.ok) {
      const saved = await res.json()
      scheduleMap.value[empId][day] = { id: saved._id, shiftType: saved.shiftType }
    }
  }
}

async function fetchEmployees() {
  const token = getToken() || ''
  const supervisorId = localStorage.getItem('employeeId') || ''
  const res = await apiFetch(`/api/employees?supervisor=${supervisorId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    employees.value = await res.json()
  }
}

onMounted(async () => {
  await fetchEmployees()
  await fetchSchedules()
})
</script>

<style scoped>
.schedule-page {
  padding: 20px;
}
</style>
