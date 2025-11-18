<template>
  <div class="front-change-page">
    <div class="card-wrapper">
      <change-password-form
        title="變更登入密碼"
        description="密碼更新後會自動登出，請使用新密碼重新登入"
        redirect-to="/login"
      />
    </div>
  </div>
</template>

<script setup>
import ChangePasswordForm from '../../components/ChangePasswordForm.vue'
</script>

<style scoped>
.front-change-page {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 32px;
  background: #f1f5f9;
  min-height: 100%;
}

.card-wrapper {
  width: 100%;
  max-width: 720px;
}
</style>
