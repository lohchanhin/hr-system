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
  import { ElMessage } from 'element-plus'
  import { getAttendanceRecords, createAttendanceRecord } from '@/api.js'

  const records = ref([])

  const ACTION_TEXT = {
    clockIn: '上班簽到',
    clockOut: '下班簽退',
    outing: '外出登記',
    breakIn: '中午休息'
  }

  function formatRecord(record) {
    return {
      action: ACTION_TEXT[record.action] || record.action,
      time: dayjs(record.timestamp).format('YYYY-MM-DD HH:mm:ss'),
      remark: record.remark || ''
    }
  }

  async function loadRecords () {
    try {
      const data = await getAttendanceRecords()
      records.value = data.map(formatRecord)
    } catch (err) {
      ElMessage.error('載入出勤紀錄失敗')
    }
  }

  onMounted(loadRecords)

  async function addAction (actionKey) {
    try {
      const record = await createAttendanceRecord({ action: actionKey })
      records.value.push(formatRecord(record))
    } catch (err) {
      ElMessage.error('操作失敗')
    }
  }

  function onClockIn() {
    addAction('clockIn')
  }
  function onClockOut() {
    addAction('clockOut')
  }
  function onOuting() {
    addAction('outing')
  }
  function onBreakIn() {
    addAction('breakIn')
  }
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
  