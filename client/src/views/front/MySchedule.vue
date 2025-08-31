<template>
  <div class="my-schedule">
    <el-table v-if="schedules.length" :data="schedules" class="schedule-table">
      <el-table-column prop="date" label="日期" width="120" />
      <el-table-column prop="shiftId" label="班別" />
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

onMounted(async () => {
  const token = getToken()
  if (!token) return
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    const userId = payload.id || payload._id || payload.sub
    const month = dayjs().format('YYYY-MM')
    const res = await apiFetch(`/api/schedules/monthly?month=${month}&employee=${userId}`)
    if (res.ok) {
      schedules.value = await res.json()
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
