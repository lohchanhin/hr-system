<!-- src/views/front/Schedule.vue -->
<template>
    <div class="schedule-page">
      <h2>排班管理</h2>
      <p>這裡是「排班管理」的基本範例頁面。未來可顯示月曆、表格或拖曳指派班別功能。</p>
  
      <el-card class="schedule-card">
        <el-form :model="scheduleForm" label-width="80px">
          <el-form-item label="日期">
            <el-date-picker v-model="scheduleForm.date" type="date" />
          </el-form-item>
          <el-form-item label="班別">
            <el-input v-model="scheduleForm.shiftType" placeholder="班別" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="onAddSchedule">新增排班</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <el-table :data="schedules" style="margin-top: 20px;">
        <el-table-column label="日期" width="120">
          <template #default="{ row }">{{ dayjs(row.date).format('YYYY-MM-DD') }}</template>
        </el-table-column>
        <el-table-column prop="shiftType" label="班別" width="100" />
      </el-table>
    </div>
  </template>

  <script setup>
  import { ref, onMounted } from 'vue'
  import dayjs from 'dayjs'

  const schedules = ref([])
  const scheduleForm = ref({ date: '', shiftType: '' })
  const token = localStorage.getItem('token') || ''

  async function fetchSchedules() {
    const res = await fetch('/api/schedules', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      schedules.value = await res.json()
    }
  }

  async function onAddSchedule() {
    const payload = {
      employee: localStorage.getItem('employeeId') || '000000000000000000000000',
      date: scheduleForm.value.date,
      shiftType: scheduleForm.value.shiftType
    }
    const res = await fetch('/api/schedules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })
    if (res.ok) {
      const saved = await res.json()
      schedules.value.push(saved)
      scheduleForm.value.date = ''
      scheduleForm.value.shiftType = ''
    }
  }

  onMounted(fetchSchedules)
  </script>
  
  <style scoped>
  .schedule-page {
    padding: 20px;
  }
  .schedule-card {
    margin-top: 20px;
    padding: 20px;
  }
  </style>
  