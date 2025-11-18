<template>
  <div class="page-wrapper">
    <change-password-form
      title="後台帳號變更密碼"
      description="請輸入舊密碼並設定符合強度的新密碼"
      redirect-to="/manager/login"
    />
  </div>
</template>

<script setup>
import ChangePasswordForm from '../components/ChangePasswordForm.vue'
</script>

<style scoped>
.page-wrapper {
  padding: 24px;
  background: #f8fafc;
  min-height: calc(100vh - 64px);
}
</style>
