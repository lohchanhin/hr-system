<template>
  <change-password-form
    title="變更密碼"
    description="密碼更新後會自動登出，請使用新密碼重新登入"
    redirect-to="/login"
  />
</template>

<script setup>
import ChangePasswordForm from '../../components/ChangePasswordForm.vue'
</script>
