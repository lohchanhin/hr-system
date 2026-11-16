<template>
  <div class="change-password-page">
    <change-password-form
      title="變更密碼"
      description="密碼更新後會自動登出，請使用新密碼重新登入"
      redirect-to="/manager/login"
    />
    <div class="two-factor-section">
      <two-factor-setup-card :initial-enabled="Boolean(profileStore.profile?.twoFactorEnabled)" />
    </div>
  </div>
</template>

<script setup>
import ChangePasswordForm from '../components/ChangePasswordForm.vue'
import TwoFactorSetupCard from '../components/TwoFactorSetupCard.vue'
import { useProfileStore } from '../stores/profile'

const profileStore = useProfileStore()
</script>

<style scoped>
.change-password-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.two-factor-section {
  max-width: 640px;
  margin: 0 auto;
  width: 100%;
}
</style>
