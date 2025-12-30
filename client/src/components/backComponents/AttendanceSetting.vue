<!-- src/Components/backComponents/AttendanceSetting.vue -->

<template>
    <div class="attendance-setting">
      <h2>出勤設定</h2>
      <!-- 使用 Tabs 區分不同區塊 -->
      <el-tabs v-model="activeTab" type="card">
        <!-- 1. 異常判定規則 -->
        <el-tab-pane label="異常判定規則" name="abnormal">
          <el-form :model="abnormalForm" label-width="140px" class="rule-form">
            <el-form-item label="遲到容許誤差(分鐘)">
              <el-input-number v-model="abnormalForm.lateGrace" :min="0" />
            </el-form-item>
            <el-form-item label="早退容許誤差(分鐘)">
              <el-input-number v-model="abnormalForm.earlyLeaveGrace" :min="0" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveAbnormalRules">儲存規則</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 4. 打卡緩衝設定 -->
        <el-tab-pane label="打卡緩衝" name="action-buffers">
          <el-form :model="actionBufferForm" label-width="200px" class="rule-form">
            <el-form-item label="上班提前可打卡 (分鐘)">
              <el-input-number v-model="actionBufferForm.clockIn.earlyMinutes" :min="0" :max="720" />
            </el-form-item>
            <el-form-item label="上班最晚容許 (分鐘)">
              <el-input-number v-model="actionBufferForm.clockIn.lateMinutes" :min="0" :max="720" />
            </el-form-item>
            <el-divider />
            <el-form-item label="下班提前可打卡 (分鐘)">
              <el-input-number v-model="actionBufferForm.clockOut.earlyMinutes" :min="0" :max="720" />
            </el-form-item>
            <el-form-item label="下班最晚容許 (分鐘)">
              <el-input-number v-model="actionBufferForm.clockOut.lateMinutes" :min="0" :max="720" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveActionBuffers">儲存打卡緩衝</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

      </el-tabs>
    </div>
  </template>
  
  <script setup>
  import { ref, onMounted } from 'vue'
  import { ElMessage } from 'element-plus'
  import { apiFetch } from '../../api'

  const activeTab = ref('abnormal')

const defaultAbnormalRules = {
  lateGrace: 5,
  earlyLeaveGrace: 5
  }

const defaultActionBuffers = {
  clockIn: { earlyMinutes: 60, lateMinutes: 240 },
  clockOut: { earlyMinutes: 240, lateMinutes: 120 }
  }

  const MAX_BUFFER = 720

  function cloneActionBuffers(source = defaultActionBuffers) {
    return {
      clockIn: { ...source.clockIn },
      clockOut: { ...source.clockOut }
    }
  }

  function clampBuffer(value) {
    const num = Number(value)
    if (!Number.isFinite(num)) return null
    return Math.min(Math.max(num, 0), MAX_BUFFER)
  }

  function normalizeActionBuffersInput(buffers) {
    const normalized = cloneActionBuffers()
    const incoming = (buffers && typeof buffers === 'object') ? buffers : {}

    ;['clockIn', 'clockOut'].forEach(action => {
      const target = normalized[action]
      const source = incoming[action] || {}
      ;['earlyMinutes', 'lateMinutes'].forEach(field => {
        const clamped = clampBuffer(source[field])
        if (clamped !== null) {
          target[field] = clamped
        }
      })
    })

    return normalized
  }

const abnormalForm = ref({ ...defaultAbnormalRules })
const actionBufferForm = ref(cloneActionBuffers())

function applySetting(data) {
  if (!data || typeof data !== 'object') return
  if (data.abnormalRules) {
    abnormalForm.value = { ...defaultAbnormalRules, ...data.abnormalRules }
  }
  if (data.actionBuffers) {
    actionBufferForm.value = normalizeActionBuffersInput(data.actionBuffers)
  }
}

  async function loadSettings() {
    const res = await apiFetch('/api/attendance-settings')
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      console.error('讀取出勤設定失敗', data?.error || res.statusText)
      return
    }
    applySetting(data)
  }

async function saveSettings() {
  const payload = {
    abnormalRules: { ...abnormalForm.value },
    actionBuffers: normalizeActionBuffersInput(actionBufferForm.value)
  }
  const res = await apiFetch('/api/attendance-settings', {
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(data?.error || '儲存設定時發生錯誤')
    }
    applySetting(data)
    return data
  }

  const saveAbnormalRules = async () => {
    try {
    await saveSettings()
    ElMessage.success('已儲存「異常判定規則」設定')
  } catch (error) {
    ElMessage.error(error.message || '儲存失敗')
  }
}

const saveActionBuffers = async () => {
  try {
    await saveSettings()
    ElMessage.success('已儲存「打卡緩衝」設定')
  } catch (error) {
      ElMessage.error(error.message || '儲存失敗')
    }
  }

  onMounted(() => {
    loadSettings()
  })
</script>
  
  <style scoped>
  .attendance-setting {
    padding: 20px;
  }
  
  .rule-form {
    max-width: 400px;
    margin-top: 20px;
  }

  </style>
