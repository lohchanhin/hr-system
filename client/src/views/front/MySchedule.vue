<template>
  <div class="my-schedule">
    <el-table v-if="schedules.length" :data="schedules" class="schedule-table">
      <el-table-column prop="date" label="日期" width="120" />
      <el-table-column prop="shiftName" label="班別" />
    </el-table>
    <p v-else>目前無排班資料</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import dayjs from 'dayjs'
import { apiFetch } from '../../api'
import { getToken } from '../../utils/tokenService'

const schedules = ref([])
const shiftMap = ref({})

async function fetchShifts() {
  try {
    const res = await apiFetch('/api/attendance-settings')
    if (res.ok) {
      const data = await res.json()
      const list = Array.isArray(data?.shifts) ? data.shifts : data
      shiftMap.value = Object.fromEntries(list.map(s => [s._id, s.name]))
    }
  } catch (err) {
    console.error(err)
  }
}

onMounted(async () => {
  const token = getToken()
  if (!token) return
  try {
    await fetchShifts()
    const payload = JSON.parse(atob(token.split('.')[1]))
    const userId = payload.id || payload._id || payload.sub
    const month = dayjs().format('YYYY-MM')
    const res = await apiFetch(`/api/schedules/monthly?month=${month}&employee=${userId}`)
    if (res.ok) {
      const data = await res.json()
      schedules.value = data.map(s => ({
        ...s,
        date: dayjs(s.date).format('YYYY/MM/DD'),
        shiftName: shiftMap.value[s.shiftId] || ''
      }))
    }
  } catch (err) {
    console.error(err)
  }
})
</script>

<style scoped>
.my-schedule {
  padding: 20px;
}
.schedule-table {
  width: 100%;
}
</style>
