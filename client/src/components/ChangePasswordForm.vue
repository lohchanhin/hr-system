<template>
  <div class="change-password">
    <PageHeader :title="title" :subtitle="description" />
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" hide-required-asterisk class="hr-section form-body" @submit.prevent="submit">
      <el-form-item label="舊密碼" prop="oldPassword">
        <el-input
          v-model="form.oldPassword"
          type="password"
          placeholder="請輸入目前使用的密碼"
          autocomplete="current-password"
          show-password
          data-test="old-password"
        />
      </el-form-item>
      <el-form-item label="新密碼" prop="newPassword">
        <el-input
          v-model="form.newPassword"
          type="password"
          placeholder="至少 8 碼，需包含大小寫與數字"
          autocomplete="new-password"
          show-password
          data-test="new-password"
        />
      </el-form-item>
      <el-form-item label="確認新密碼" prop="confirmPassword">
        <el-input
          v-model="form.confirmPassword"
          type="password"
          placeholder="請再次輸入新密碼"
          autocomplete="new-password"
          show-password
          data-test="confirm-password"
        />
      </el-form-item>
      <div class="form-actions">
        <el-button type="primary" :loading="loading" native-type="submit" data-test="submit-btn">儲存</el-button>
        <el-button :disabled="loading" @click="reset">清除</el-button>
      </div>
    </el-form>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { apiFetch } from '../api'
import { endSession } from '../utils/authNavigation'
import PageHeader from './PageHeader.vue'

const props = defineProps({
  title: { type: String, default: '變更密碼' },
  description: { type: String, default: '請驗證舊密碼並設定新密碼' },
  redirectTo: { type: String, default: '/login' }
})

const router = useRouter()
const formRef = ref(null)
const loading = ref(false)
const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const rules = {
  oldPassword: [{ required: true, message: '請輸入舊密碼', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '請輸入新密碼', trigger: 'blur' },
    { min: 8, message: '新密碼需至少 8 碼', trigger: 'blur' },
    {
      validator: (_, value, callback) => {
        const hasUpper = /[A-Z]/.test(value || '')
        const hasLower = /[a-z]/.test(value || '')
        const hasNumber = /\d/.test(value || '')
        if (!(hasUpper && hasLower && hasNumber)) {
          callback(new Error('需包含大小寫字母與數字'))
        } else if (value === form.oldPassword) {
          callback(new Error('新密碼不可與舊密碼相同'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  confirmPassword: [
    { required: true, message: '請再次輸入新密碼', trigger: 'blur' },
    {
      validator: (_, value, callback) => {
        if (value !== form.newPassword) {
          callback(new Error('兩次輸入的密碼不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

async function submit() {
  // loading 在第一個 await 之前就要擋：按 Enter 與按按鈕不會各送一次
  if (!formRef.value || loading.value) return
  loading.value = true
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) {
    loading.value = false
    return
  }
  try {
    let res
    try {
      res = await apiFetch(
        '/api/change-password',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPassword: form.oldPassword, newPassword: form.newPassword })
        },
        { autoRedirect: false }
      )
    } catch (networkError) {
      throw new Error('無法連線到伺服器，請確認網路連線後再試')
    }
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) {
      // 登入已逾時（token 過期或已作廢）：回登入頁，不顯示伺服器的英文訊息
      endSession({ revokeToken: false })
      ElMessage.error('登入已逾時，請重新登入後再變更密碼')
      router.push(props.redirectTo)
      return
    }
    if (!res.ok) {
      throw new Error(data.error || '變更密碼失敗')
    }
    // 伺服器已經作廢這個 token；清掉本機的登入狀態與上一個人的快取（選單、個人資料、照片）
    endSession({ revokeToken: false })
    ElMessage.success(data.message || '密碼已更新，請重新登入')
    router.push(props.redirectTo)
  } catch (err) {
    ElMessage.error(err?.message || '變更密碼失敗')
  } finally {
    loading.value = false
  }
}

function reset() {
  form.oldPassword = ''
  form.newPassword = ''
  form.confirmPassword = ''
  formRef.value?.clearValidate?.()
}
</script>

<style scoped>
.change-password {
  max-width: 480px;
}

/* 手機上輸入框字級小於 16px 時，iOS 會在聚焦時自動放大整個畫面 */
.form-body :deep(.el-input__inner) {
  font-size: 16px;
}

.form-actions {
  display: flex;
  gap: 8px;
}
</style>
