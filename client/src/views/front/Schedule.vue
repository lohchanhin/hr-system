<template>
  <div class="schedule-page">
    <h2>排班管理</h2>
    <el-date-picker v-model="currentMonth" type="month" @change="fetchSchedules" />
    <el-table :data="[scheduleRow]" style="margin-top: 20px;">
      <el-table-column
        v-for="d in days"
        :key="d"
        :label="d"
      >
        <template #default>
          <el-select
            v-if="canEdit"
            v-model="scheduleMap[d].shiftType"
            placeholder=""
            @change="val => onSelect(d, val)"
          >
            <el-option
              v-for="opt in shiftOptions"
              :key="opt"
              :label="opt"
              :value="opt"
            />
          </el-select>
          <span v-else>{{ scheduleMap[d]?.shiftType || '' }}</span>
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
const scheduleRow = computed(() => ({ id: 1 }))

const canEdit = computed(() => {
  const role = localStorage.getItem('role') || 'employee'
  return ['supervisor', 'admin'].includes(role)
})

const days = computed(() => {
  const dt = dayjs(currentMonth.value + '-01')
  const end = dt.endOf('month').date()
  const arr = Array.from({ length: end }, (_, i) => i + 1)
  arr.forEach(d => {
    if (!scheduleMap.value[d]) scheduleMap.value[d] = { shiftType: '' }
  })
  return arr
})

async function fetchSchedules() {
  const token = getToken() || ''
  const employeeId = localStorage.getItem('employeeId') || ''
  const res = await apiFetch(
    `/api/schedules/monthly?month=${currentMonth.value}&employee=${employeeId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (res.ok) {
    const data = await res.json()
    scheduleMap.value = {}
    data.forEach((s) => {
      const d = dayjs(s.date).date()
      scheduleMap.value[d] = { id: s._id, shiftType: s.shiftType }
    })
  }
}

async function onSelect(day, value) {
  const token = getToken() || ''
  const employeeId = localStorage.getItem('employeeId') || ''
  const dateStr = `${currentMonth.value}-${String(day).padStart(2, '0')}`
  const existing = scheduleMap.value[day]
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
      body: JSON.stringify({ employee: employeeId, date: dateStr, shiftType: value })
    })
    if (res.ok) {
      const saved = await res.json()
      scheduleMap.value[day] = { id: saved._id, shiftType: saved.shiftType }
    }
  }
}

onMounted(fetchSchedules)
</script>

<style scoped>
.schedule-page {
  padding: 20px;
}
</style>
