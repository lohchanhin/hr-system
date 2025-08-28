<template>
  <div class="front-login-container">
    <!-- Added professional background with company branding -->
    <div class="login-background">
      <div class="login-brand">
        <div class="brand-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M23 21V19C23 18.1645 22.7155 17.3541 22.2094 16.6977C21.7033 16.0414 20.9999 15.5759 20.2 15.3805" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 3.13C16.8003 3.32548 17.5037 3.79099 18.0098 4.44738C18.5159 5.10377 18.8002 5.91416 18.8002 6.75C18.8002 7.58584 18.5159 8.39623 18.0098 9.05262C17.5037 9.70901 16.8003 10.1745 16 10.37" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1 class="brand-title">員工入口</h1>
        <p class="brand-subtitle">Human Resources Portal</p>
      </div>
    </div>
    
    <div class="login-form-container">
      <el-card class="login-card" shadow="always">
        <!-- Enhanced header -->
        <div class="login-header">
          <h2 class="login-title">員工登入</h2>
          <p class="login-description">請登入系統</p>
        </div>

        <!-- Enhanced form with better styling and validation -->
        <el-form 
          :model="loginForm" 
          ref="loginFormRef" 
          class="login-form"
          :rules="loginRules"
          @submit.prevent="onLogin"
        >
          <el-form-item prop="username" class="form-item">
            <div class="input-label">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>員工帳號</span>
            </div>
            <el-input
              v-model="loginForm.username"
              placeholder="請輸入員工帳號"
              size="large"
              class="custom-input"
            />
          </el-form-item>

          <el-form-item prop="password" class="form-item">
            <div class="input-label">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="12" cy="16" r="1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M7 11V7C7 5.67392 7.52678 4.40215 8.46447 3.46447C9.40215 2.52678 10.6739 2 12 2C13.3261 2 14.5979 2.52678 15.5355 3.46447C16.4732 4.40215 17 5.67392 17 7V11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>密碼</span>
            </div>
            <el-input
              v-model="loginForm.password"
              type="password"
              placeholder="請輸入密碼"
              size="large"
              class="custom-input"
              show-password
            />
          </el-form-item>

          <!-- Enhanced login button with loading state -->
          <el-form-item class="form-item">
            <el-button 
              type="primary" 
              size="large" 
              class="login-button"
              :loading="isLoading"
              @click="onLogin"
              native-type="submit"
            >
              <span v-if="!isLoading">登入系統</span>
              <span v-else>登入中...</span>
            </el-button>
          </el-form-item>
        </el-form>

        <el-button
          type="text"
          class="manager-login-link"
          @click="router.push('/manager/login')"
        >
          主管／系統管理員登入
        </el-button>

        <!-- Added role-based access information -->
        <div class="access-info">
          <div class="info-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>24小時全天候服務</span>
          </div>
          <div class="info-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 22S8 18 8 13V6L12 4L16 6V13C16 18 12 22 12 22Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>安全加密傳輸</span>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMenuStore } from '../../stores/menu'
import { apiFetch } from '../../api'
import { setToken } from '../../utils/tokenService'
import { ElMessage } from 'element-plus'

const router = useRouter()
const menuStore = useMenuStore()

const loginForm = ref({
  role: 'employee',
  username: '',
  password: ''
})

const loginFormRef = ref(null)
const isLoading = ref(false)

const roles = [
  {
    value: 'employee',
    label: '一般員工',
    description: '查看排班、打卡考勤',
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  }
]

const loginRules = {
  username: [
    { required: true, message: '請輸入員工帳號', trigger: 'blur' },
    { min: 3, message: '帳號長度至少3個字符', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '請輸入密碼', trigger: 'blur' },
    { min: 6, message: '密碼長度至少6個字符', trigger: 'blur' }
  ]
}

async function onLogin() {
  if (!loginFormRef.value) return
  
  try {
    const valid = await loginFormRef.value.validate()
    if (!valid) return
    
    isLoading.value = true
    
    const res = await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        username: loginForm.value.username, 
        password: loginForm.value.password 
      })
    })
    
    const data = await res.json()
    
    if (res.ok) {
      setToken(data.token)
      localStorage.setItem('role', data.user.role)
      localStorage.setItem('employeeId', data.user.employeeId)
      ElMessage.success(`歡迎回來，${roles[0].label}！`)

      await menuStore.fetchMenu()
      router.push('/front/attendance')
    } else {
      ElMessage.error(data.message || '登入失敗，請檢查帳號密碼')
    }
  } catch (err) {
    console.error('Login error:', err)
    ElMessage.error(`登入失敗: ${err.message}`)
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
.front-login-container {
  display: flex;
  min-height: 100vh;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

.login-background {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  position: relative;
}

.login-background::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: url('data:image/svg+xml,<svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><g fill="none" fill-rule="evenodd"><g fill="%23ffffff" fill-opacity="0.05"><circle cx="30" cy="30" r="2"/></g></g></svg>');
  opacity: 0.3;
}

.login-brand {
  text-align: center;
  color: white;
  z-index: 1;
  position: relative;
}

.brand-icon {
  width: 80px;
  height: 80px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1.5rem;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.brand-title {
  font-size: 2.5rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.brand-subtitle {
  font-size: 1.25rem;
  opacity: 0.9;
  margin: 0;
}

.login-form-container {
  width: 520px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(10px);
}

.login-card {
  width: 100%;
  border: none;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
}

.login-card :deep(.el-card__body) {
  padding: 3rem;
}

.login-header {
  text-align: center;
  margin-bottom: 2rem;
}

.login-title {
  font-size: 1.875rem;
  font-weight: 700;
  color: #059669;
  margin: 0 0 0.5rem;
}

.login-description {
  color: #6b7280;
  margin: 0;
  font-size: 0.95rem;
}

.login-form {
  margin-top: 2rem;
}

.form-item {
  margin-bottom: 1.5rem;
}

.form-item :deep(.el-form-item__content) {
  flex-direction: column;
  align-items: stretch;
}

.input-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  color: #374151;
  font-weight: 500;
  font-size: 0.9rem;
}

.input-label svg {
  color: #6b7280;
}
.custom-input :deep(.el-input__wrapper) {
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: all 0.2s ease;
}

.custom-input :deep(.el-input__wrapper:hover) {
  border-color: #10b981;
}

.custom-input :deep(.el-input__wrapper.is-focus) {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
}

.login-button {
  width: 100%;
  height: 48px;
  border-radius: 8px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border: none;
  font-weight: 600;
  font-size: 1rem;
  transition: all 0.2s ease;
}

.login-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.manager-login-link {
  display: block;
  width: 100%;
  text-align: right;
  margin-top: 0.5rem;
}

.access-info {
  display: flex;
  justify-content: space-between;
  margin-top: 1.5rem;
  padding: 1rem;
  background: #f8fafc;
  border-radius: 8px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #475569;
  font-size: 0.85rem;
}

.info-item svg {
  color: #10b981;
}

@media (max-width: 768px) {
  .front-login-container {
    flex-direction: column;
  }
  
  .login-background {
    flex: none;
    min-height: 200px;
  }
  
  .brand-title {
    font-size: 2rem;
  }
  
  .login-form-container {
    width: 100%;
  }
  
  .login-card :deep(.el-card__body) {
    padding: 2rem;
  }
}
</style>
