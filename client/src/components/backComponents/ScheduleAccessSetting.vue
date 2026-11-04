<!-- src/components/backComponents/ScheduleAccessSetting.vue：其他控制設定 > 排班權限（scheduleAccessMode）。
     小單位的「排班人員」一律能排被指定的小單位；這裡決定主管是否因為是主管就能排班（說明見 docs/scheduler-access.md）。
     預設（沒有存過）是「只有排班人員能排班」；伺服器回應的 saved 是 false 時顯示正在使用預設值。 -->
<template>
  <div class="schedule-access-setting" data-test="schedule-access-setting">
    <el-alert
      title="排班權限：被指定的排班人員一律可以排班，這裡決定主管是否也能排班"
      type="info"
      show-icon
      :closable="false"
      class="info-alert"
    >
      <p class="schedule-access-setting__note">
        排班人員在「權限&機構&部門設定」的小單位指定（任何角色都可以），只看得到、只能排被指定的小單位；
        部門的「排班管理者」可以排整個部門。主管欄位作為簽核使用：不論哪一種設定，主管都照樣收到、簽核直屬部屬的簽核單，
        看得到他們的假別餘額與調休存摺。
      </p>
    </el-alert>

    <p v-if="loaded && !saved" class="schedule-access-setting__default" data-test="schedule-access-default-hint">
      目前沒有儲存過這個設定，使用預設值：只有被指定的排班人員能排班。
    </p>

    <el-alert
      v-if="loadFailed"
      title="無法讀取排班權限設定"
      type="warning"
      show-icon
      :closable="false"
      class="info-alert"
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
      <el-radio value="scheduler_only" data-test="schedule-access-mode-scheduler-only">
        只有被指定的排班人員能排班（預設：主管只負責簽核，沒被指定的主管沒有「排班管理」）
      </el-radio>
      <el-radio value="supervisor_and_scheduler" data-test="schedule-access-mode-supervisor">
        主管與排班人員都能排班（主管排自己與直屬部屬，2026/11 以前的做法）
      </el-radio>
    </el-radio-group>

    <div class="schedule-access-setting__actions">
      <el-button
        type="primary"
        :loading="saving"
        :disabled="!loaded || mode === savedMode"
        data-test="schedule-access-save"
        @click="save"
      >儲存</el-button>
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
  if (!loaded.value) return
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
  saving.value = true
  try {
    const res = await apiFetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: mode.value })
    })
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
.schedule-access-setting__note {
  margin: 4px 0 0;
  line-height: 1.6;
}

.schedule-access-setting__default {
  margin: 12px 0 0;
  color: var(--el-text-color-secondary, #909399);
  font-size: 13px;
}

.schedule-access-setting__modes {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  margin: 16px 0;
}

.schedule-access-setting__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
