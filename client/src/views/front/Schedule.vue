<!-- src/views/front/Schedule.vue -->
<template>
  <div class="schedule-page">
    <h2>排班管理</h2>
    <el-card class="schedule-card">
      <div class="controls">
        <el-select v-model="selectedUnit" placeholder="選擇單位" class="mr-2">
          <el-option
            v-for="unit in unitList"
            :key="unit._id"
            :label="unit.label"
            :value="unit._id"
          />
        </el-select>
        <el-select v-model="selectedEmployee" placeholder="選擇員工">
          <el-option
            v-for="emp in employeeList"
            :key="emp._id"
            :label="emp.name"
            :value="emp._id"
          />
        </el-select>
      </div>
      <el-calendar v-model="currentDate">
        <template #date-cell="{ data }">
          <div class="date-cell" @click="assignShift(data)">
            <div>{{ data.day.split('-').pop() }}</div>
            <span class="shift-label" v-if="scheduleMap[data.day]">{{ scheduleMap[data.day] }}</span>
            <el-tag type="danger" size="small" v-if="leaveMap[data.day]">假</el-tag>
          </div>
        </template>
      </el-calendar>
    </el-card>
  </div>
</template>


<script setup>
import { ref, onMounted, watch } from 'vue'
import dayjs from 'dayjs'
import { apiFetch } from '../../api.js'


const schedules = ref([])
const scheduleMap = ref({})
const leaveMap = ref({})
const unitList = ref([])
const employeeList = ref([])
const selectedUnit = ref('')
const selectedEmployee = ref('')
const currentDate = ref(new Date())
const token = localStorage.getItem('token') || ''
const defaultShift = 'A'

async function fetchUnits() {
  const res = await apiFetch('/api/departments', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    unitList.value = await res.json()
  }
}

async function fetchEmployees() {
  const res = await apiFetch('/api/employees', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    employeeList.value = await res.json()
  }
}


async function fetchSchedules() {
  const res = await apiFetch('/api/schedules', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    schedules.value = await res.json()
    scheduleMap.value = Object.fromEntries(
      schedules.value.map(s => [dayjs(s.date).format('YYYY-MM-DD'), s.shiftType])
    )

  }
}

async function fetchLeaves() {
  if (!selectedEmployee.value) return
  const res = await apiFetch('/api/leaves', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    const all = await res.json()
    leaveMap.value = {}
    all
      .filter(l => l.status === 'approved' && l.employee?._id === selectedEmployee.value)
      .forEach(l => {
        let start = dayjs(l.startDate)
        const end = dayjs(l.endDate)
        for (; start.isSameOrBefore(end); start = start.add(1, 'day')) {
          leaveMap.value[start.format('YYYY-MM-DD')] = true
        }
      })
  }
}

watch(selectedEmployee, fetchLeaves)

async function assignShift(data) {
  if (!selectedEmployee.value) return
  const day = data.day
  const payload = {
    employee: selectedEmployee.value,
    date: dayjs(day).toDate(),
    shiftType: defaultShift,
    unit: selectedUnit.value || ''
  }
  const res = await apiFetch('/api/schedules', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  })
  if (res.ok) {
    scheduleMap.value[day] = defaultShift
  }
}

onMounted(() => {
  fetchUnits()
  fetchEmployees()
  fetchSchedules()
})
</script>

<style scoped>
.schedule-page {
  padding: 20px;
}
.schedule-card {
  margin-top: 20px;
  padding: 20px;
}
.controls {
  margin-bottom: 20px;
}
.date-cell {
  position: relative;
  height: 80px;
}
.shift-label {
  position: absolute;
  bottom: 4px;
  left: 4px;
  font-size: 12px;
}
</style>
