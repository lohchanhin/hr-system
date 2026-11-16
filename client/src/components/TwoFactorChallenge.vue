<template>
  <div class="two-factor-challenge">
    <el-alert
      title="此帳號已啟用雙因素驗證 (2FA)"
      type="info"
      :closable="false"
      show-icon
      class="mb-4"
    />
    <el-form @submit.prevent="handleSubmit">
      <el-form-item label="6 位數驗證碼或備用碼">
        <el-input
          v-model="code"
          placeholder="請輸入驗證器 6 碼或 8 碼備用碼"
          maxlength="16"
          autocomplete="one-time-code"
          @keyup.enter="handleSubmit"
        />
      </el-form-item>
      <div v-if="error" class="error-text">{{ error }}</div>
      <div class="actions">
        <el-button type="primary" :loading="loading" @click="handleSubmit">驗證並登入</el-button>
        <el-button @click="$emit('cancel')">返回</el-button>
      </div>
    </el-form>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { verifyTwoFactor } from '@/utils/authNavigation'

const props = defineProps({
  challengeToken: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['verified', 'cancel'])

const code = ref('')
const loading = ref(false)
const error = ref('')

async function handleSubmit() {
  const trimmed = code.value.trim()
  if (!trimmed) {
    error.value = '請輸入驗證碼'
    return
  }
  error.value = ''
  loading.value = true
  try {
    const result = await verifyTwoFactor(props.challengeToken, trimmed)
    if (result.error) {
      error.value = result.error
      return
    }
    emit('verified', result)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.two-factor-challenge {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mb-4 {
  margin-bottom: 12px;
}
.error-text {
  color: #f56c6c;
  font-size: 13px;
  margin-bottom: 10px;
}
.actions {
  display: flex;
  gap: 8px;
}
</style>
