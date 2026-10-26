<!-- src/components/backComponents/ScheduleAccessSetting.vue：其他控制設定 > 排班權限（scheduleAccessMode）。
     小單位的「排班人員」一律能排被指定的小單位；這裡決定主管是否因為是主管就能排班（說明見 docs/scheduler-access.md）。 -->
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
        部門的「排班管理者」可以排整個部門。主管欄位仍只作為簽核使用。
      </p>
    </el-alert>

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
      <el-radio value="supervisor_and_scheduler" data-test="schedule-access-mode-default">
        主管與排班人員都能排班（預設，與原本相同：主管排自己與直屬部屬）
      </el-radio>
      <el-radio value="scheduler_only" data-test="schedule-access-mode-scheduler-only">
        只有被指定的排班人員能排班（主管只負責簽核）
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

const DEFAULT_MODE = 'supervisor_and_scheduler'
const ENDPOINT = '/api/other-control-settings/schedule-access'

const mode = ref(DEFAULT_MODE)
const savedMode = ref(DEFAULT_MODE)
const loaded = ref(false)
const loading = ref(false)
const loadFailed = ref(false)
const saving = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await apiFetch(ENDPOINT, { method: 'GET' }, { autoRedirect: false })
    if (!res.ok) throw new Error('load failed')
    const data = await res.json()
    const current = data?.mode === 'scheduler_only' ? 'scheduler_only' : DEFAULT_MODE
    mode.value = current
    savedMode.value = current
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
        '切換後，沒有被指定為排班人員的主管將看不到排班頁，也不能再排直屬部屬的班。確定要切換嗎？',
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
    savedMode.value = data?.mode === 'scheduler_only' ? 'scheduler_only' : DEFAULT_MODE
    mode.value = savedMode.value
    ElMessage.success('排班權限已儲存，使用者重新整理頁面後生效')
  } catch (error) {
    ElMessage.error(error?.message || '儲存排班權限失敗')
  } finally {
    saving.value = false
  }
}

onMounted(load)

defineExpose({ load, save, mode, savedMode, loaded })
</script>

<style scoped>
.schedule-access-setting__note {
  margin: 4px 0 0;
  line-height: 1.6;
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
