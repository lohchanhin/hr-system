<!-- src/views/front/Attendance.vue -->
<template>
    <div class="attendance-page">
      <h2>出勤打卡</h2>
      <p>這裡是「出勤打卡」的示範頁面。員工可進行上/下班打卡、外出登記、補卡等。</p>
  
      <el-card class="punch-card">
        <p>示範按鈕區：</p>
        <el-row :gutter="10">
          <el-col :span="6">
            <el-button type="primary" @click="onClockIn">上班簽到</el-button>
          </el-col>
          <el-col :span="6">
            <el-button type="warning" @click="onClockOut">下班簽退</el-button>
          </el-col>
          <el-col :span="6">
            <el-button type="info" @click="onOuting">外出登記</el-button>
          </el-col>
          <el-col :span="6">
            <el-button type="success" @click="onBreakIn">中午休息</el-button>
          </el-col>
        </el-row>
      </el-card>
  
      <!-- 簡易紀錄示範 -->
      <el-table :data="records" style="margin-top: 20px;">
        <el-table-column prop="action" label="動作" width="120" />
        <el-table-column prop="time" label="時間" width="180" />
        <el-table-column prop="remark" label="備註" />
      </el-table>
    </div>
  </template>
  
<script setup>
import { ref, onMounted } from 'vue'
import dayjs from 'dayjs'

// 將中文動作與後端定義的值互轉
const actionMap = {
  '上班簽到': 'clockIn',
  '下班簽退': 'clockOut',
  '外出登記': 'outing',
  '中午休息': 'breakIn'
}
const reverseActionMap = Object.fromEntries(
  Object.entries(actionMap).map(([k, v]) => [v, k])
)

const records = ref([])
const token = localStorage.getItem('token') || ''

async function fetchRecords() {
  const res = await fetch('/api/attendance', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    const data = await res.json()
    records.value = data.map(r => ({
      action: reverseActionMap[r.action] || r.action,
      time: dayjs(r.timestamp).format('YYYY-MM-DD HH:mm:ss'),
      remark: r.remark || ''
    }))
  }
}

function onClockIn() {
  addRecord('上班簽到')
}
function onClockOut() {
  addRecord('下班簽退')
}
function onOuting() {
  addRecord('外出登記')
}
function onBreakIn() {
  addRecord('中午休息')
}

async function addRecord(action) {
  const payload = {
    action: actionMap[action] || action,
    timestamp: new Date(),
    remark: '',
    employee: localStorage.getItem('employeeId') || ''
  }
  const res = await fetch('/api/attendance', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  })
  if (res.ok) {
    const saved = await res.json()
    records.value.push({
      action: reverseActionMap[saved.action] || saved.action,
      time: dayjs(saved.timestamp).format('YYYY-MM-DD HH:mm:ss'),
      remark: saved.remark || ''
    })
  }
}

onMounted(fetchRecords)
  </script>
  
  <style scoped>
  .attendance-page {
    padding: 20px;
  }
  .punch-card {
    padding: 20px;
    margin-top: 20px;
  }
  </style>
  