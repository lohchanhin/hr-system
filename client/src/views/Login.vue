<!-- src/views/Login.vue -->
<template>
    <div class="login-container">
      <el-card class="login-card">
        <h2>後台登入</h2>
        <el-form :model="loginForm" ref="loginFormRef" label-width="80px">
          <el-form-item label="帳號">
            <el-input
              v-model="loginForm.username"
              placeholder="請輸入帳號"
            />
          </el-form-item>
          <el-form-item label="密碼">
            <el-input
              v-model="loginForm.password"
              type="password"
              placeholder="請輸入密碼"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="onLogin">登入</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue'
  import { useRouter } from 'vue-router'
  
  const router = useRouter()
  const loginForm = ref({
    username: '',
    password: ''
  })
  
  const loginFormRef = ref(null)
  
  const onLogin = () => {
    // 這邊可以加上帳密判斷邏輯
    // 如果帳號密碼正確，則紀錄登入狀態
    localStorage.setItem('isAuthenticated', 'true')
    router.push({ name: 'Settings' }) // 登入後直接導向設定頁
  }
  </script>
  
  <style scoped>
  .login-container {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
  }
  .login-card {
    width: 400px;
    padding: 20px;
  }
  </style>
  