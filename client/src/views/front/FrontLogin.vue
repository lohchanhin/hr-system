<template>
    <div class="front-login-container">
      <el-card class="login-card">
        <h2>前台登入</h2>
  
        <el-form :model="loginForm" ref="loginFormRef" label-width="80px">
          <el-form-item label="角色">
            <el-radio-group v-model="loginForm.role">
              <el-radio label="employee">員工</el-radio>
              <el-radio label="supervisor">主管</el-radio>
              <el-radio label="hr">人資</el-radio>
              <el-radio label="admin">管理員</el-radio>
            </el-radio-group>
          </el-form-item>
  
          <el-form-item label="帳號">
            <el-input v-model="loginForm.username" placeholder="隨意輸入" />
          </el-form-item>
          
          <el-form-item label="密碼">
            <el-input
              v-model="loginForm.password"
              type="password"
              placeholder="目前不做驗證"
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
    role: 'employee',   // 預設員工
    username: '',
    password: ''
  })
  const loginFormRef = ref(null)
  
  function onLogin () {
    // 1. 將角色與登入狀態儲存
    localStorage.setItem('role', loginForm.value.role)
    localStorage.setItem('isAuthenticated', 'true')
    localStorage.setItem('username', loginForm.value.username)
  
    // 2. 依角色跳不同頁面
    switch (loginForm.value.role) {
      case 'employee':
        router.push('/front/attendance')
        break
      case 'supervisor':
        router.push('/front/schedule')
        break
      case 'hr':
        // 你可以讓 HR 也去 /front/schedule 或 /front/attendance
        router.push('/front/attendance')
        break
      case 'admin':
        // 若要讓 admin 走後台，可 push('/layout')
        // 或若要讓 admin 測試前台某頁，也可:
        router.push('/front/attendance')
        break
      default:
        // 若角色莫名無法對應，就導回 /front/attendance
        router.push('/front/attendance')
        break
    }
  
    // 3. 可選: alert 提示
    alert(`以【${loginForm.value.role}】身份登入成功！(示範)`)
  }
  </script>
  
  <style scoped>
  .front-login-container {
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
  