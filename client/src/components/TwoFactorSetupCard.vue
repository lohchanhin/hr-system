<template>
  <el-card shadow="never" class="two-factor-setup-card">
    <template #header>
      <div class="card-header">
        <span>雙因素驗證 (TOTP 2FA)</span>
        <el-tag :type="enabled ? 'success' : 'info'" size="small">
          {{ enabled ? '已啟用' : '未啟用' }}
        </el-tag>
      </div>
    </template>

    <div v-if="!enabled">
      <p class="desc">使用 Google Authenticator、Microsoft Authenticator 或 1Password 掃描/輸入金鑰以提升帳號安全性。</p>
      <el-button v-if="!setupData" type="primary" :loading="loading" @click="startSetup">
        開始設定 2FA
      </el-button>

      <div v-else class="setup-box">
        <div class="secret-row">
          <span class="label">手動輸入金鑰：</span>
          <code>{{ setupData.secret }}</code>
        </div>
        <div class="uri-row">
          <span class="label">OTPAuth URI：</span>
          <el-input :model-value="setupData.otpauthUrl" readonly size="small" />
        </div>
        <el-form-item label="輸入驗證器產生的 6 位數驗證碼" class="verify-item">
          <el-input v-model="verifyCode" maxlength="6" placeholder="例如 123456" style="max-width: 220px" />
        </el-form-item>
        <el-button type="success" :loading="loading" @click="confirmSetup">確認並啟用</el-button>
      </div>
    </div>

    <div v-else class="enabled-box">
      <el-alert
        v-if="backupCodes.length"
        title="請妥善保存以下一次性備用碼（關閉後將不再顯示）："
        type="warning"
        :closable="false"
        class="mb-3"
      >
        <div class="backup-grid">
          <code v-for="item in backupCodes" :key="item">{{ item }}</code>
        </div>
      </el-alert>

      <el-form-item label="停用 2FA（需輸入目前密碼或 6 碼驗證碼）">
        <div class="disable-row">
          <el-input v-model="disableCredential" placeholder="輸入密碼或 6 碼驗證碼" show-password style="max-width: 240px" />
          <el-button type="danger" plain :loading="loading" @click="disableTwoFactor">停用 2FA</el-button>
        </div>
      </el-form-item>
    </div>
  </el-card>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiFetch } from '@/api'

const props = defineProps({
  initialEnabled: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['updated'])

const enabled = ref(props.initialEnabled)
const loading = ref(false)
const setupData = ref(null)
const verifyCode = ref('')
const backupCodes = ref([])
const disableCredential = ref('')

async function startSetup() {
  loading.value = true
  try {
    const res = await apiFetch('/api/auth/2fa/setup', { method: 'POST' })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      ElMessage.error(data?.error || '無法產生 2FA 設定')
      return
    }
    setupData.value = data
  } finally {
    loading.value = false
  }
}

async function confirmSetup() {
  if (!verifyCode.value.trim()) {
    ElMessage.warning('請輸入 6 位數驗證碼')
    return
  }
  loading.value = true
  try {
    const res = await apiFetch('/api/auth/2fa/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: verifyCode.value.trim() }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      ElMessage.error(data?.error || '驗證失敗')
      return
    }
    enabled.value = true
    setupData.value = null
    verifyCode.value = ''
    backupCodes.value = Array.isArray(data?.backupCodes) ? data.backupCodes : []
    ElMessage.success('已成功啟用雙因素驗證')
    emit('updated', true)
  } finally {
    loading.value = false
  }
}

async function disableTwoFactor() {
  const val = disableCredential.value.trim()
  if (!val) {
    ElMessage.warning('請輸入密碼或驗證碼')
    return
  }
  loading.value = true
  try {
    const body = /^\d{6}$/.test(val) ? { code: val } : { password: val }
    const res = await apiFetch('/api/auth/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      ElMessage.error(data?.error || '停用失敗')
      return
    }
    enabled.value = false
    backupCodes.value = []
    disableCredential.value = ''
    ElMessage.success('已停用雙因素驗證')
    emit('updated', false)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.desc {
  color: #606266;
  margin-bottom: 12px;
}
.setup-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.backup-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(80px, 1fr));
  gap: 8px;
  margin-top: 8px;
}
.disable-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.mb-3 {
  margin-bottom: 12px;
}
</style>
