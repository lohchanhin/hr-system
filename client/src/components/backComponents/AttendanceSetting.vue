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
            <el-form-item label="缺卡判斷時間(分鐘)">
              <el-input-number v-model="abnormalForm.missingThreshold" :min="0" />
            </el-form-item>
            <el-form-item label="未打卡自動通知">
              <el-switch v-model="abnormalForm.autoNotify" active-text="啟用" inactive-text="停用" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveAbnormalRules">儲存規則</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
  
        <!-- 2. 分段打卡/外出規則 -->
        <el-tab-pane label="分段打卡/外出" name="break-outing">
          <el-form :model="breakOutForm" label-width="140px" class="rule-form">
            <el-form-item label="是否允許分段打卡">
              <el-switch v-model="breakOutForm.enableBreakPunch" active-text="是" inactive-text="否" />
            </el-form-item>
            <el-form-item label="分段打卡最少間隔(分鐘)">
              <el-input-number v-model="breakOutForm.breakInterval" :min="0" :disabled="!breakOutForm.enableBreakPunch" />
            </el-form-item>
            <el-form-item label="外出登記需審核">
              <el-switch v-model="breakOutForm.outingNeedApprove" active-text="需要" inactive-text="不需要" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveBreakOutSetting">儲存設定</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
  
        <!-- 3. 加班判定規則 -->
        <el-tab-pane label="加班規則" name="overtime">
          <el-form :model="overtimeForm" label-width="120px" class="rule-form">
            <el-form-item label="平日加班起算(分)">
              <el-input-number v-model="overtimeForm.weekdayThreshold" :min="0" />
            </el-form-item>
            <el-form-item label="假日加班倍數">
              <el-input-number v-model="overtimeForm.holidayRate" :min="1" :step="0.1" />
            </el-form-item>
            <el-form-item label="轉補休折算比率">
              <el-input-number v-model="overtimeForm.toCompRate" :min="1" :step="0.1" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveOvertimeRules">儲存加班規則</el-button>
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
    earlyLeaveGrace: 5,
    missingThreshold: 30,
    autoNotify: true
  }

  const defaultBreakOutRules = {
    enableBreakPunch: true,
    breakInterval: 60,
    outingNeedApprove: false
  }

  const defaultOvertimeRules = {
    weekdayThreshold: 30,
    holidayRate: 2.0,
    toCompRate: 1.5
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
  const breakOutForm = ref({ ...defaultBreakOutRules })
  const overtimeForm = ref({ ...defaultOvertimeRules })
  const actionBufferForm = ref(cloneActionBuffers())

  function applySetting(data) {
    if (!data || typeof data !== 'object') return
    if (data.abnormalRules) {
      abnormalForm.value = { ...defaultAbnormalRules, ...data.abnormalRules }
    }
    if (data.breakOutRules) {
      breakOutForm.value = { ...defaultBreakOutRules, ...data.breakOutRules }
    }
    if (data.overtimeRules) {
      overtimeForm.value = { ...defaultOvertimeRules, ...data.overtimeRules }
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
      breakOutRules: { ...breakOutForm.value },
      overtimeRules: { ...overtimeForm.value },
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

  const saveBreakOutSetting = async () => {
    try {
      await saveSettings()
      ElMessage.success('已儲存「分段打卡/外出」設定')
    } catch (error) {
      ElMessage.error(error.message || '儲存失敗')
    }
  }

  const saveOvertimeRules = async () => {
    try {
      await saveSettings()
      ElMessage.success('已儲存「加班規則」設定')
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
