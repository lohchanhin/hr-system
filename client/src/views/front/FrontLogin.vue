<template>
    <div class="front-login-container">
      <el-card class="login-card">
        <h2>前台登入</h2>
  
        <el-form :model="loginForm" ref="loginFormRef" label-width="80px">
          <el-form-item label="角色">
            <el-radio-group v-model="loginForm.role">
              <el-radio label="employee">員工</el-radio>
              <el-radio label="supervisor">主管</el-radio>
              <el-radio label="admin">管理員</el-radio>
            </el-radio-group>
          </el-form-item>
  
          <el-form-item label="帳號">
            <el-input v-model="loginForm.username" placeholder="請輸入帳號" />
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
import { useMenuStore } from '../../stores/menu'
import { apiFetch } from '../../api'
import { setToken } from '../../utils/tokenService'
  
const router = useRouter()
const menuStore = useMenuStore()
  
  const loginForm = ref({
    role: 'employee',
    username: '',
    password: ''
  })
  const loginFormRef = ref(null)
  
async function onLogin () {
  try {
    const res = await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginForm.value.username, password: loginForm.value.password })
    })
    const data = await res.json()
    if (res.ok) {
      setToken(data.token)
      localStorage.setItem('role', data.user.role)
      localStorage.setItem('employeeId', data.user.employeeId)
      await menuStore.fetchMenu()

      switch (data.user.role) {
        case 'employee':
          router.push('/front/attendance')
          break
        case 'supervisor':
          router.push('/front/schedule')
          break
        case 'admin':
          const first = menuStore.items[0]
          if (first) {
            router.push({ name: first.name })
          } else {
            router.push('/layout')
          }
          break
        default:
          router.push('/front/attendance')
          break
      }
    } else {
      alert(data.message || '登入失敗')
    }
  } catch (err) {
    alert(`登入失敗: ${err.message}`)
  }
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
  