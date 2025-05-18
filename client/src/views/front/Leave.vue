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
  import { ElMessage } from 'element-plus'
  import { getLeaveRequests, createLeaveRequest } from '@/api.js'

  
  const leaveForm = ref({
    leaveType: '',
    startDate: '',
    endDate: '',
    reason: ''
  })
  

  const leaveRecords = ref([])

  function formatRecord(rec) {
    return {
      leaveType: rec.leaveType,
      dateRange: `${dayjs(rec.startDate).format('YYYY-MM-DD')}~ ${dayjs(rec.endDate).format('YYYY-MM-DD')}`,
      reason: rec.reason
    }
  }

  async function loadRecords() {
    try {
      const data = await getLeaveRequests()
      leaveRecords.value = data.map(formatRecord)
    } catch (err) {
      ElMessage.error('\u8f09\u5165\u8acb\u5047\u7d00\u9304\u5931\u6557')
    }
  }

  onMounted(loadRecords)

  async function onSubmitLeave() {
    try {
      const record = await createLeaveRequest({
        leaveType: leaveForm.value.leaveType,
        startDate: leaveForm.value.startDate,
        endDate: leaveForm.value.endDate,
        reason: leaveForm.value.reason
      })
      leaveRecords.value.push(formatRecord(record))

      leaveForm.value.leaveType = ''
      leaveForm.value.startDate = ''
      leaveForm.value.endDate = ''
      leaveForm.value.reason = ''
    } catch (err) {
      ElMessage.error('\u63d0\u4ea4\u5931\u6557')
    }

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
  