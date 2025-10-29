<template>
  <div class="preview-page">
    <div class="preview-header">
      <button type="button" class="back-button" @click="handleBack">← 返回排班</button>
      <h2>月表預覽</h2>
    </div>
    <table>
      <thead>
        <tr>
          <th>員工</th>
          <th v-for="d in days" :key="d.date">{{ d.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="emp in employees" :key="emp._id">
          <td>{{ emp.name }}</td>
          <td v-for="d in days" :key="d.date">{{ shiftCode(emp._id, d.date) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { onBeforeRouteLeave, useRouter } from 'vue-router'

const data = JSON.parse(sessionStorage.getItem('schedulePreview') || '{}')
const scheduleMap = data.scheduleMap || {}
const employees = data.employees || []
const days = data.days || []
const shifts = data.shifts || []

const router = useRouter()

const clearPreviewCache = () => {
  sessionStorage.removeItem('schedulePreview')
}

const handleBack = () => {
  clearPreviewCache()

  if (typeof window !== 'undefined') {
    const { history } = window
    if (history) {
      if (history.length > 1) {
        router.back()
        return
      }

      const state = history.state
      if (state && state.back != null) {
        router.back()
        return
      }
    }
  }

  router.push({ name: 'Schedule' })
}

onBeforeRouteLeave(() => {
  clearPreviewCache()
})

function shiftCode(empId, day) {
  const id = scheduleMap[empId]?.[day]?.shiftId
  const s = shifts.find(s => s._id === id)
  return s ? s.code : ''
}
</script>

<style scoped>
.preview-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.preview-header h2 {
  margin: 0;
}

.back-button {
  background-color: #409eff;
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  font-weight: 600;
  padding: 6px 14px;
  transition: background-color 0.2s ease;
}

.back-button:hover {
  background-color: #66b1ff;
}

.back-button:focus-visible {
  outline: 2px solid #1f6fff;
  outline-offset: 2px;
}

table {
  border-collapse: collapse;
}
th, td {
  border: 1px solid #ccc;
  padding: 4px;
}
</style>
