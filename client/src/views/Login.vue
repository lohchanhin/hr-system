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
  
  const onLogin = async () => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginForm.value)
    })
    if (res.ok) {
      const data = await res.json()
      localStorage.setItem('token', data.token)
      localStorage.setItem('role', data.user.role)
      router.push({ name: 'Settings' })
    } else {
      alert('登入失敗')
    }
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
  