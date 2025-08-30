<template>
  <div class="login-container">
    <!-- Added professional background with gradient and branding -->
    <div class="login-background">
      <div class="login-brand">
        <div class="brand-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1 class="brand-title">HR Management System</h1>
        <p class="brand-subtitle">後台管理系統</p>
      </div>
    </div>
    
    <div class="login-form-container">
      <el-card class="login-card" shadow="always">
        <!-- Enhanced header with professional styling -->
        <div class="login-header">
          <h2 class="login-title">管理員登入</h2>
          <p class="login-description">請使用您的管理員帳號登入系統</p>
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
              <span>管理員帳號</span>
            </div>
            <el-input
              v-model="loginForm.username"
              placeholder="請輸入管理員帳號"
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
          class="employee-login-link"
          @click="router.push('/login')"
        >
          返回員工登入
        </el-button>

        <!-- Added security notice -->
        <div class="security-notice">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 22S8 18 8 13V6L12 4L16 6V13C16 18 12 22 12 22Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>您的登入資訊將被安全加密處理</span>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '../api'
import { setToken } from '../utils/tokenService'
import { ElMessage } from 'element-plus'

const router = useRouter()

const loginForm = ref({
  username: '',
  password: ''
})

const loginFormRef = ref(null)
const isLoading = ref(false)

const loginRules = {
  username: [
    { required: true, message: '請輸入管理員帳號', trigger: 'blur' },
    { min: 3, message: '帳號長度至少3個字符', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '請輸入密碼', trigger: 'blur' },
    { min: 6, message: '密碼長度至少6個字符', trigger: 'blur' }
  ]
}

const onLogin = async () => {
  if (!loginFormRef.value) return
  
  try {
    const valid = await loginFormRef.value.validate()
    if (!valid) return
    
    isLoading.value = true
    
    const res = await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginForm.value)
    })
    
    if (res.ok) {
      const data = await res.json()
      setToken(data.token)
      localStorage.setItem('role', data.user.role)
      localStorage.setItem('employeeId', data.user.employeeId || data.user.id)
      
      ElMessage.success('登入成功！')

      if (data.user.role === 'supervisor') {
        router.push('/front/schedule')
      } else if (data.user.role === 'admin') {
        router.push('/front/attendance')
      }
    } else {
      const errorData = await res.json()
      ElMessage.error(errorData.message || '登入失敗，請檢查帳號密碼')
    }
  } catch (error) {
    console.error('Login error:', error)
    ElMessage.error('登入過程中發生錯誤，請稍後再試')
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  min-height: 100vh;
  background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
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
  width: 480px;
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
  color: #164e63;
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
  background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
  border: none;
  font-weight: 600;
  font-size: 1rem;
  transition: all 0.2s ease;
}

.login-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(22, 78, 99, 0.3);
}

.employee-login-link {
  display: block;
  width: 100%;
  text-align: right;
  margin-top: 0.5rem;
}

.security-notice {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 1.5rem;
  padding: 1rem;
  background: #f0fdf4;
  border-radius: 8px;
  color: #166534;
  font-size: 0.85rem;
}

.security-notice svg {
  color: #10b981;
}

@media (max-width: 768px) {
  .login-container {
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
