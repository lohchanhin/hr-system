<!-- src/views/Settings.vue -->
<!-- 後台首頁（/manager/settings）：外框讀到選單後會立刻帶到第一個後台頁面，這裡只是過場；
     選單讀不到時才會停在這一頁，所以內容延後顯示，並留一個登出的出口 -->
<template>
  <div class="settings-container">
    <p class="settings-text">正在載入選單…</p>
    <p class="hr-hint">沒有自動進入後台時，請重新整理頁面，或登出後重新登入。</p>
    <el-button class="settings-logout" @click="logout">登出</el-button>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { endSession } from '../utils/authNavigation'

const router = useRouter()

const logout = () => {
  endSession()
  router.push('/')
}
</script>

<style scoped>
.settings-container {
  animation: settings-reveal 0.2s ease 0.8s both;
}

.settings-text {
  margin: 0;
  color: var(--hr-gray-700);
  font-size: 14px;
}

.settings-logout {
  margin-top: 16px;
}

@keyframes settings-reveal {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
