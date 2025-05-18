<!-- src/views/front/Leave.vue -->
<template>
    <div class="leave-page">
      <h2>請假申請</h2>
      <p>這裡是「請假申請」的示範頁面。員工可提出請假，選擇假別、起迄日期等。</p>
  
      <el-card class="leave-card">
        <el-form :model="leaveForm" label-width="100px">
          <el-form-item label="假別">
            <el-select v-model="leaveForm.leaveType" placeholder="選擇假別">
              <el-option label="特休" value="特休" />
              <el-option label="事假" value="事假" />
              <el-option label="病假" value="病假" />
            </el-select>
          </el-form-item>
  
          <el-form-item label="開始日期">
            <el-date-picker
              v-model="leaveForm.startDate"
              type="date"
              placeholder="選擇開始日期"
            />
          </el-form-item>
  
          <el-form-item label="結束日期">
            <el-date-picker
              v-model="leaveForm.endDate"
              type="date"
              placeholder="選擇結束日期"
            />
          </el-form-item>
  
          <el-form-item label="事由">
            <el-input
              type="textarea"
              v-model="leaveForm.reason"
              placeholder="請輸入請假事由"
            />
          </el-form-item>
  
          <el-form-item>
            <el-button type="primary" @click="onSubmitLeave">提交請假</el-button>
          </el-form-item>
        </el-form>
      </el-card>
  
      <!-- 請假紀錄範例表 -->
      <el-table :data="leaveRecords" style="margin-top: 20px;">
        <el-table-column prop="leaveType" label="假別" width="100" />
        <el-table-column label="開始日期" width="120">
          <template #default="{ row }">{{ dayjs(row.startDate).format('YYYY-MM-DD') }}</template>
        </el-table-column>
        <el-table-column label="結束日期" width="120">
          <template #default="{ row }">{{ dayjs(row.endDate).format('YYYY-MM-DD') }}</template>
        </el-table-column>
        <el-table-column prop="reason" label="事由" />
      </el-table>
    </div>
  </template>
  
  <script setup>
import { ref, onMounted } from 'vue'
import dayjs from 'dayjs'
  
  const leaveForm = ref({
    leaveType: '',
    startDate: '',
    endDate: '',
    reason: ''
  })
  
const leaveRecords = ref([])

const token = localStorage.getItem('token') || ''

async function fetchLeaves() {
  const res = await fetch('/api/leaves', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    leaveRecords.value = await res.json()
  }
}

async function onSubmitLeave() {
  const payload = {
    employee: localStorage.getItem('employeeId') || '000000000000000000000000',
    leaveType: leaveForm.value.leaveType,
    startDate: leaveForm.value.startDate,
    endDate: leaveForm.value.endDate,
    reason: leaveForm.value.reason
  }
  const res = await fetch('/api/leaves', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  })
  if (res.ok) {
    const saved = await res.json()
    leaveRecords.value.push(saved)
    leaveForm.value.leaveType = ''
    leaveForm.value.startDate = ''
    leaveForm.value.endDate = ''
    leaveForm.value.reason = ''
  }
}

onMounted(fetchLeaves)
  </script>
  
  <style scoped>
  .leave-page {
    padding: 20px;
  }
  .leave-card {
    margin-top: 20px;
    padding: 20px;
  }
  </style>
  