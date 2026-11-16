<template>
  <div class="security-controls-setting" data-test="security-controls-setting">
    <h3 class="hr-section__title">安全與認證設定</h3>
    <p class="hr-hint">設定後台兩步驗證 (TOTP)、密碼定期更換與後台存取 IP 白名單。</p>

    <el-alert
      v-if="loadFailed"
      title="無法讀取安全設定"
      type="warning"
      show-icon
      :closable="false"
      style="margin-bottom: 16px;"
    >
      <el-button size="small" type="primary" :loading="loading" @click="load">重新載入</el-button>
    </el-alert>

    <el-form :model="form" label-width="190px" style="max-width: 720px;" :disabled="!loaded || saving">
      <el-form-item label="強制後台啟用 2FA">
        <el-switch v-model="form.enforce2FA" data-test="security-enforce-2fa" />
        <span class="hr-hint" style="margin-left: 12px;">開啟後，後台人員需於帳號設定綁定 TOTP 驗證器</span>
      </el-form-item>

      <el-form-item label="啟用密碼定期更換">
        <el-switch v-model="form.passwordExpiration" data-test="security-password-expiration" />
      </el-form-item>

      <el-form-item label="密碼有效天數">
        <el-input-number
          v-model="form.passwordExpireDays"
          :min="30"
          :max="365"
          :disabled="!form.passwordExpiration"
          data-test="security-password-expire-days"
        />
        <span class="hr-hint" style="margin-left: 12px;">天（超過期限後登入將引導修改密碼）</span>
      </el-form-item>

      <el-form-item label="啟用後台 IP 白名單">
        <el-switch v-model="form.ipWhitelistEnabled" data-test="security-ip-whitelist-enabled" />
        <span class="hr-hint" style="margin-left: 12px;">僅限制後台路由（本機 loopback 與預設測試網段不阻擋）</span>
      </el-form-item>

      <el-form-item label="允許來源網段 / IP">
        <div class="whitelist-editor">
          <div v-for="(entry, idx) in form.ipWhitelist" :key="idx" class="whitelist-editor__row">
            <el-input v-model="entry.label" placeholder="備註（例：台北總部）" style="width: 180px;" />
            <el-input v-model="entry.address" placeholder="IP 或 CIDR（例：203.0.113.0/24）" style="width: 240px;" />
            <el-button link type="danger" @click="removeIpRow(idx)">刪除</el-button>
          </div>
          <el-button size="small" @click="addIpRow">新增 IP / CIDR</el-button>
        </div>
      </el-form-item>

      <el-form-item>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!loaded"
          data-test="security-controls-save"
          @click="save"
        >儲存安全設定</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiFetch } from '../../api'

const loaded = ref(false)
const loading = ref(false)
const loadFailed = ref(false)
const saving = ref(false)

const form = reactive({
  enforce2FA: true,
  passwordExpiration: true,
  passwordExpireDays: 90,
  ipWhitelistEnabled: false,
  ipWhitelist: []
})

async function load() {
  loading.value = true
  try {
    const res = await apiFetch('/api/other-control-settings')
    if (!res.ok) throw new Error('載入失敗')
    const data = await res.json()
    const sec = data?.security || {}
    form.enforce2FA = sec.enforce2FA !== false
    form.passwordExpiration = sec.passwordExpiration !== false
    form.passwordExpireDays = Number(sec.passwordExpireDays) || 90
    form.ipWhitelistEnabled = Boolean(sec.ipWhitelistEnabled)
    form.ipWhitelist = Array.isArray(sec.ipWhitelist)
      ? sec.ipWhitelist.map((item) => ({ label: item?.label || '', address: item?.address || '' }))
      : []
    loadFailed.value = false
    loaded.value = true
  } catch (err) {
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}

function addIpRow() {
  form.ipWhitelist.push({ label: '', address: '' })
}

function removeIpRow(index) {
  form.ipWhitelist.splice(index, 1)
}

async function save() {
  saving.value = true
  try {
    const payload = {
      enforce2FA: form.enforce2FA,
      passwordExpiration: form.passwordExpiration,
      passwordExpireDays: Number(form.passwordExpireDays) || 90,
      ipWhitelistEnabled: form.ipWhitelistEnabled,
      ipWhitelist: form.ipWhitelist
        .map((item) => ({
          label: String(item.label || '').trim(),
          address: String(item.address || '').trim()
        }))
        .filter((item) => item.address)
    }
    const res = await apiFetch('/api/other-control-settings/security', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error || '儲存失敗')
    }
    ElMessage.success('安全設定已儲存')
  } catch (err) {
    ElMessage.error(err?.message || '儲存安全設定失敗')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  load()
})
</script>

<style scoped>
.whitelist-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.whitelist-editor__row {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
