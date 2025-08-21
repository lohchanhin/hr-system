<template>
  <div class="preview-page">
    <h2>週表預覽</h2>
    <div v-for="(week, index) in weeks" :key="index" class="week">
      <h3>第{{ index + 1 }}週</h3>
      <table>
        <thead>
          <tr>
            <th>員工</th>
            <th v-for="d in week" :key="d.date">{{ d.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="emp in employees" :key="emp._id">
            <td>{{ emp.name }}</td>
            <td v-for="d in week" :key="d.date">{{ shiftCode(emp._id, d.date) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
const data = JSON.parse(sessionStorage.getItem('schedulePreview') || '{}')
const scheduleMap = data.scheduleMap || {}
const employees = data.employees || []
const days = data.days || []
const shifts = data.shifts || []

function shiftCode(empId, day) {
  const id = scheduleMap[empId]?.[day]?.shiftId
  const s = shifts.find(s => s._id === id)
  return s ? s.code : ''
}

const weeks = []
for (let i = 0; i < days.length; i += 7) {
  weeks.push(days.slice(i, i + 7))
}
</script>

<style scoped>
table {
  border-collapse: collapse;
}
th, td {
  border: 1px solid #ccc;
  padding: 4px;
}
.week {
  margin-bottom: 16px;
}
</style>
