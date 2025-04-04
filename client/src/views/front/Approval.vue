<!-- src/views/front/Approval.vue -->
<template>
    <div class="approval-page">
      <h2>簽核流程</h2>
      <p>這裡是「簽核流程」的示範頁面。主管/HR 可看到申請單清單並進行審核。</p>
  
      <el-table :data="pendingList" style="margin-top: 20px;">
        <el-table-column prop="applicant" label="申請人" width="120" />
        <el-table-column prop="type" label="申請類型" width="120" />
        <el-table-column prop="detail" label="申請內容" />
        <el-table-column label="操作" width="200">
          <template #default="{ row, $index }">
            <el-button type="primary" @click="approve($index)">通過</el-button>
            <el-button type="danger" @click="reject($index)">退回</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue'
  
  // 模擬待簽核清單
  const pendingList = ref([
    { applicant: '王小明', type: '請假', detail: '事假：2025/04/15 ~ 2025/04/16' },
    { applicant: '李大華', type: '補打卡', detail: '補 2025/04/10 上午打卡' },
    { applicant: '林美麗', type: '加班', detail: '2025/04/18 18:00~22:00' }
  ])
  
  function approve(index) {
    const item = pendingList.value[index]
    alert(`已通過：${item.applicant} 的 ${item.type}\n(示範, 未串後端)`)
    pendingList.value.splice(index, 1)
  }
  function reject(index) {
    const item = pendingList.value[index]
    alert(`已退回：${item.applicant} 的 ${item.type}\n(示範, 未串後端)`)
    pendingList.value.splice(index, 1)
  }
  </script>
  
  <style scoped>
  .approval-page {
    padding: 20px;
  }
  </style>
  