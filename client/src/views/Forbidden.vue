<template>
  <div class="forbidden status-page">
    <p class="status-code">403</p>
    <h1 class="status-title">沒有權限</h1>
    <p class="status-text">您沒有權限瀏覽此頁面</p>
    <div class="status-actions">
      <el-button type="primary" data-test="go-home" @click="goHome">{{ loggedIn ? '回首頁' : '前往登入' }}</el-button>
      <el-button v-if="loggedIn" data-test="logout" @click="logout">登出</el-button>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { getActivePinia } from 'pinia'
import { getToken } from '../utils/tokenService'
import { resolveUserRole } from '../utils/roleResolver'
import { endSession, getAuthenticatedHomeRoute } from '../utils/authNavigation'
import { useProfileStore } from '../stores/profile'

const router = useRouter()
const loggedIn = Boolean(getToken())

// 回到自己的首頁：主管看排班權限（個人資料已讀到時），讀不到就進出勤打卡；沒登入則回登入頁
function goHome() {
  if (!loggedIn) {
    router.push('/login')
    return
  }
  const scheduleAccess = getActivePinia() ? useProfileStore().profile?.scheduleAccess : null
  router.push(getAuthenticatedHomeRoute(resolveUserRole(), scheduleAccess) || '/login')
}

function logout() {
  endSession()
  router.push('/login')
}
</script>

<style scoped>
.status-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 24px 16px;
  text-align: center;
  background: var(--hr-gray-100);
}

.status-code {
  margin: 0;
  color: var(--hr-gray-400);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.status-title {
  margin: 0;
  color: var(--hr-gray-900);
  font-size: 20px;
  font-weight: 600;
}

.status-text {
  margin: 0;
  color: var(--hr-gray-600);
  font-size: 14px;
}

.status-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}
</style>
