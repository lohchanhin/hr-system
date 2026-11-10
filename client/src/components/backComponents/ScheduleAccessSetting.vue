<!-- src/components/backComponents/ScheduleAccessSetting.vue：其他控制設定 > 排班權限（scheduleAccessMode）。
     小單位的「排班人員」一律能排被指定的小單位；這裡決定主管是否因為是主管就能排班（說明見 docs/scheduler-access.md）。
     預設（沒有存過）是「只有排班人員能排班」；伺服器回應的 saved 是 false 時顯示正在使用預設值。 -->
<template>
  <div class="schedule-access-setting" data-test="schedule-access-setting">
    <h3 class="hr-section__title">誰可以排班</h3>
    <p class="hr-hint schedule-access-setting__note">
      被指定的排班人員一律可以排班（在「權限&機構&部門設定」的小單位指定排班人員、部門指定排班管理者）；這裡決定主管是否也能排班。
      不論選哪一個，主管都照樣收到、簽核直屬部屬的單。
    </p>

    <el-alert
      v-if="loadFailed"
      title="無法讀取排班權限設定"
      type="warning"
      show-icon
      :closable="false"
      class="schedule-access-setting__alert"
      data-test="schedule-access-load-alert"
    >
      <el-button size="small" type="primary" :loading="loading" @click="load">重新載入</el-button>
    </el-alert>

    <el-radio-group
      v-model="mode"
      class="schedule-access-setting__modes"
      :disabled="!loaded || saving"
      data-test="schedule-access-mode"
    >
      <el-radio value="scheduler_only" class="schedule-access-setting__mode" data-test="schedule-access-mode-scheduler-only">
        <span class="schedule-access-setting__mode-title">只有被指定的排班人員能排班（預設）</span>
        <span class="schedule-access-setting__mode-desc">沒被指定為排班人員的主管看不到「排班管理」，也不能排直屬部屬的班。</span>
      </el-radio>
      <el-radio value="supervisor_and_scheduler" class="schedule-access-setting__mode" data-test="schedule-access-mode-supervisor">
        <span class="schedule-access-setting__mode-title">主管與排班人員都能排班</span>
        <span class="schedule-access-setting__mode-desc">主管不必被指定，就能排自己與直屬部屬的班。</span>
      </el-radio>
    </el-radio-group>

    <p v-if="loaded && !saved" class="hr-hint" data-test="schedule-access-default-hint">
      目前沒有儲存過這個設定，使用預設值：只有被指定的排班人員能排班。
    </p>

    <div class="schedule-access-setting__actions">
      <el-button
        type="primary"
        :loading="saving"
        :disabled="!loaded || mode === savedMode"
        data-test="schedule-access-save"
        @click="save"
      >儲存</el-button>
      <span v-if="loaded && mode !== savedMode" class="hr-hint schedule-access-setting__pending" data-test="schedule-access-pending">尚未儲存；儲存後使用者重新整理頁面才會生效</span>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'

// 伺服器沒有存過設定時的模式（2026/11 起：只有排班人員能排班）；伺服器回應的 defaultMode 為準
const DEFAULT_MODE = 'scheduler_only'
const MODES = ['scheduler_only', 'supervisor_and_scheduler']
const ENDPOINT = '/api/other-control-settings/schedule-access'

const mode = ref(DEFAULT_MODE)
const savedMode = ref(DEFAULT_MODE)
// 伺服器上有沒有存過（沒有存過時顯示「使用預設值」）
const saved = ref(true)
const loaded = ref(false)
const loading = ref(false)
const loadFailed = ref(false)
const saving = ref(false)

const normalizeMode = (value, fallback = DEFAULT_MODE) => (MODES.includes(value) ? value : fallback)

async function load() {
  loading.value = true
  try {
    const res = await apiFetch(ENDPOINT, { method: 'GET' }, { autoRedirect: false })
    if (!res.ok) throw new Error('load failed')
    const data = await res.json()
    const current = normalizeMode(data?.mode, normalizeMode(data?.defaultMode))
    mode.value = current
    savedMode.value = current
    saved.value = data?.saved !== false
    loaded.value = true
    loadFailed.value = false
  } catch (error) {
    loaded.value = false
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!loaded.value || saving.value) return
  if (mode.value === 'scheduler_only') {
    try {
      await ElMessageBox.confirm(
        '切換後，沒有被指定為排班人員的主管將看不到排班頁，也不能再排直屬部屬的班（簽核與查看直屬部屬的假別餘額不受影響）。確定要切換嗎？',
        '只有排班人員能排班',
        { type: 'warning', confirmButtonText: '確定切換', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
  }
  // 確認視窗開著時又按了一次：只送一次
  if (saving.value) return
  saving.value = true
  try {
    let res
    try {
      res = await apiFetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode.value })
      })
    } catch (networkError) {
      // 連不上伺服器：不把瀏覽器的英文錯誤（Failed to fetch）直接顯示出來
      throw new Error('儲存排班權限失敗，請檢查網路後再試')
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || '儲存排班權限失敗')
    savedMode.value = normalizeMode(data?.mode, mode.value)
    mode.value = savedMode.value
    saved.value = true
    ElMessage.success('排班權限已儲存，使用者重新整理頁面後生效')
  } catch (error) {
    ElMessage.error(error?.message || '儲存排班權限失敗')
  } finally {
    saving.value = false
  }
}

onMounted(load)

defineExpose({ load, save, mode, savedMode, saved, loaded })
</script>

<style scoped>
.schedule-access-setting {
  max-width: 760px;
}

.schedule-access-setting__note {
  margin: 0 0 12px;
}

.schedule-access-setting__alert {
  margin-bottom: 12px;
}

.schedule-access-setting__modes {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  margin-bottom: 12px;
}

/* 每個選項一張卡片：標題一行、後果一行 */
.schedule-access-setting__mode {
  height: auto;
  margin-right: 0;
  padding: 12px 16px;
  align-items: flex-start;
  border: 1px solid var(--hr-gray-200);
  border-radius: var(--hr-radius-md);
  white-space: normal;
}

.schedule-access-setting__mode.is-checked {
  border-color: var(--hr-primary-light);
}

.schedule-access-setting__mode :deep(.el-radio__input) {
  margin-top: 3px;
}

.schedule-access-setting__mode-title {
  display: block;
  font-size: 14px;
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-900);
}

.schedule-access-setting__mode-desc {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  font-weight: var(--hr-font-weight-normal);
  line-height: 1.5;
  color: var(--hr-gray-600);
}

.schedule-access-setting__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.schedule-access-setting__pending {
  margin-top: 0;
}
</style>
