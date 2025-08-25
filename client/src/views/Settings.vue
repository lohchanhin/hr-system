<!-- src/views/Settings.vue -->
<template>
    <div class="settings-container">
      <h2>後台設定頁</h2>
      <div>這裡是設定內容範例...</div>
      <el-button type="danger" @click="logout">登出</el-button>
    </div>
  </template>
  
  <script setup>
import { useRouter } from 'vue-router'
import { clearToken, clearRefreshToken } from '../utils/tokenService'
  
  const router = useRouter()
  
const logout = () => {
  clearToken()
  clearRefreshToken()
  localStorage.removeItem('role')
  localStorage.removeItem('employeeId')
  router.push('/')
}
  </script>
  
  <style scoped>
  .settings-container {
    padding: 20px;
  }
  </style>
