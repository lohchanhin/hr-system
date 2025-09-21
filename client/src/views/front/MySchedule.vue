<template>
  <div class="my-schedule">
    <el-date-picker v-model="selectedMonth" type="month" value-format="YYYY-MM" />
    <el-table v-if="schedules.length" :data="schedules" class="schedule-table">
      <el-table-column prop="date" label="日期" width="120" />
      <el-table-column prop="shiftName" label="班別" />
    </el-table>
    <p v-else>目前無排班資料</p>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import dayjs from 'dayjs'
import { apiFetch } from '../../api'
import { getToken } from '../../utils/tokenService'

const schedules = ref([])
const shiftMap = ref({})
const selectedMonth = ref(dayjs().format('YYYY-MM'))

function formatShiftLabel(shift) {
  if (!shift) return ''
  const name = (shift.name || '').trim()
  const code = (shift.code || '').trim()
  if (name && code) return `${name} (${code})`
  return name || code
}

async function fetchShifts() {
  try {
    const res = await apiFetch('/api/shifts')
    const data = await res.json().catch(() => null)
    if (!res.ok) return
    const list = Array.isArray(data) ? data : []
    shiftMap.value = Object.fromEntries(
      list.map(s => [
        s._id,
        {
          name: s.name || '',
          code: s.code || ''
        }
      ])
    )
  } catch (err) {
    console.error(err)
  }
}

async function loadSchedules() {
  const token = getToken()
  if (!token) return
  try {
    await fetchShifts()
    const payload = JSON.parse(atob(token.split('.')[1]))
    const userId =
      payload.employeeId || payload.id || payload._id || payload.sub
    if (!userId) return
    const params = new URLSearchParams({ month: selectedMonth.value })
    params.set('employee', userId)
    const res = await apiFetch(`/api/schedules/monthly?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      schedules.value = data.map(s => {
        const shift = shiftMap.value[s.shiftId]
        return {
          ...s,
          date: dayjs(s.date).format('YYYY/MM/DD'),
          shiftName: formatShiftLabel(shift) || s.shiftName || ''
        }
      })
    }
  } catch (err) {
    console.error(err)
  }
}

onMounted(loadSchedules)

watch(selectedMonth, loadSchedules)
</script>

<style scoped>
.my-schedule {
  padding: 20px;
}
.schedule-table {
  width: 100%;
}
</style>
