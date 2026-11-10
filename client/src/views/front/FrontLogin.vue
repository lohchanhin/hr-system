<template>
  <!-- 員工登入：只問帳號與密碼；主管或管理員帳號從這一頁登入也會進到各自的首頁 -->
  <div class="login-page">
    <el-card class="login-card" shadow="never">
      <div class="login-header">
        <p class="login-system">人資管理系統</p>
        <h1 class="login-title">員工登入</h1>
      </div>

      <el-form
        :model="loginForm"
        ref="loginFormRef"
        class="login-form"
        :rules="loginRules"
        label-position="top"
        hide-required-asterisk
        @submit.prevent="onLogin"
      >
        <el-form-item label="帳號" prop="username">
          <el-input
            v-model="loginForm.username"
            placeholder="請輸入員工帳號"
            size="large"
            name="username"
            autocomplete="username"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
          />
        </el-form-item>

        <el-form-item label="密碼" prop="password">
          <el-input
            v-model="loginForm.password"
            type="password"
            placeholder="請輸入密碼"
            size="large"
            name="password"
            autocomplete="current-password"
            show-password
          />
        </el-form-item>

        <el-button
          type="primary"
          size="large"
          class="login-button"
          :loading="isLoading"
          native-type="submit"
          @click="onLogin"
        >
          登入
        </el-button>
      </el-form>

      <el-button
        link
        type="primary"
        class="manager-login-link"
        @click="router.push('/manager/login')"
      >
        主管／系統管理員登入
      </el-button>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useMenuStore } from '../../stores/menu'
import { signIn } from '../../utils/authNavigation'

const router = useRouter()
const menuStore = useMenuStore()

const loginForm = ref({
  username: '',
  password: ''
})

const loginFormRef = ref(null)
const isLoading = ref(false)
// 送出中的旗標要在第一個 await 之前設好：按鈕的 click 與表單的 submit 會同時觸發，
// 以前各送一次登入請求，密碼打錯一次就算兩次失敗（同一帳號失敗 5 次會被暫時鎖住）
let submitting = false

const loginRules = {
  username: [{ required: true, message: '請輸入員工帳號', trigger: 'blur' }],
  password: [{ required: true, message: '請輸入密碼', trigger: 'blur' }]
}

async function onLogin() {
  if (!loginFormRef.value || submitting) return
  submitting = true
  try {
    const valid = await Promise.resolve(loginFormRef.value.validate()).catch(() => false)
    if (!valid) return

    isLoading.value = true
    const { destination, error } = await signIn(loginForm.value.username, loginForm.value.password)
    if (!destination) {
      ElMessage.error(error)
      return
    }

    // 選單讀不到不擋登入：外框載入時會再讀一次
    try {
      await menuStore.fetchMenu()
    } catch (menuError) {
      // 略過
    }
    // 依伺服器回應的角色前往各自的首頁
    await router.push(destination)
  } catch (err) {
    console.error('Login error:', err)
    ElMessage.error('登入過程中發生錯誤，請稍後再試')
  } finally {
    submitting = false
    isLoading.value = false
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 24px 16px;
  background: var(--hr-gray-100);
}

.login-card {
  width: 100%;
  max-width: 400px;
  border: 1px solid var(--hr-gray-200);
  border-radius: 12px;
}

.login-card :deep(.el-card__body) {
  padding: 32px;
}

.login-header {
  margin-bottom: 24px;
}

.login-system {
  margin: 0 0 4px;
  color: var(--hr-gray-500);
  font-size: 14px;
}

.login-title {
  margin: 0;
  color: var(--hr-gray-900);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
}

/* 手機上輸入框字級小於 16px 時，iOS 會在聚焦時自動放大整個畫面 */
.login-form :deep(.el-input__inner) {
  font-size: 16px;
}

.login-button {
  width: 100%;
  margin-top: 4px;
}

.manager-login-link {
  display: block;
  margin: 16px auto 0;
}

@media (max-width: 480px) {
  .login-card :deep(.el-card__body) {
    padding: 24px 20px;
  }
}
</style>
