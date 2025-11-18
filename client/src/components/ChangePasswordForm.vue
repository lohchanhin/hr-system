<template>
  <div class="change-password-card">
    <h2 class="title">{{ title }}</h2>
    <p class="description">{{ description }}</p>
    <el-form ref="formRef" :model="form" :rules="rules" label-width="120px" class="form-body">
      <el-form-item label="舊密碼" prop="oldPassword">
        <el-input
          v-model="form.oldPassword"
          type="password"
          placeholder="請輸入目前使用的密碼"
          show-password
          data-test="old-password"
        />
      </el-form-item>
      <el-form-item label="新密碼" prop="newPassword">
        <el-input
          v-model="form.newPassword"
          type="password"
          placeholder="至少 8 碼，需包含大小寫與數字"
          show-password
          data-test="new-password"
        />
      </el-form-item>
      <el-form-item label="確認新密碼" prop="confirmPassword">
        <el-input
          v-model="form.confirmPassword"
          type="password"
          placeholder="請再次輸入新密碼"
          show-password
          data-test="confirm-password"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="loading" @click="submit" data-test="submit-btn">確認變更</el-button>
        <el-button @click="reset">重設</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { apiFetch } from '../api'
import { clearToken } from '../utils/tokenService'

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

function clearAuth() {
  clearToken()
  sessionStorage.removeItem('role')
  sessionStorage.removeItem('employeeId')
  localStorage.removeItem('role')
  localStorage.removeItem('employeeId')
  localStorage.removeItem('username')
}

async function submit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    const res = await apiFetch(
      '/api/change-password',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: form.oldPassword, newPassword: form.newPassword })
      },
      { autoRedirect: false }
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || '變更密碼失敗')
    }
    clearAuth()
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
.change-password-card {
  max-width: 520px;
  margin: 0 auto;
  background: #ffffff;
  padding: 32px;
  border-radius: 16px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08);
}

.title {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 4px;
  color: #0f172a;
}

.description {
  margin: 0 0 20px;
  color: #475569;
}

.form-body {
  margin-top: 12px;
}
</style>
