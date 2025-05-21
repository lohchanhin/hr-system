<!-- src/views/front/Approval.vue -->
<template>
    <div class="approval-page">
      <h2>簽核流程</h2>
      <p>這裡是「簽核流程」的示範頁面。主管/HR 可看到申請單清單並進行審核。</p>
  
      <el-table :data="pendingList" style="margin-top: 20px;">
        <el-table-column prop="applicant" label="申請人" width="120" />
        <el-table-column prop="type" label="申請類型" width="120" />
        <el-table-column prop="content" label="申請內容" />
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
import { ref, onMounted } from 'vue'
import { apiFetch } from '../../api'
import { getToken } from '../../utils/tokenService'

const pendingList = ref([])

async function fetchApprovals() {
  const token = getToken() || ''
  const res = await apiFetch('/api/approvals', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    pendingList.value = await res.json()
  }
}

async function approve(index) {
  const item = pendingList.value[index]
  const token = getToken() || ''
  const res = await apiFetch(`/api/approvals/${item._id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    pendingList.value.splice(index, 1)
  }
}

async function reject(index) {
  const item = pendingList.value[index]
  const token = getToken() || ''
  const res = await apiFetch(`/api/approvals/${item._id}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    pendingList.value.splice(index, 1)
  }
}

onMounted(fetchApprovals)
</script>
  
  <style scoped>
  .approval-page {
    padding: 20px;
  }
  </style>
  