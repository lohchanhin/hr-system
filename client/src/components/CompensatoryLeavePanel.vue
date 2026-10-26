<!-- src/components/CompensatoryLeavePanel.vue：調休存摺（單位是小時；客戶稱為移休、以天計，時數旁一律附上天數，1 天 = 8 小時）。
     簽核頁的「我的調休」、員工管理（管理員可手動給予、扣除、作廢、填寫存摺備註）、簽核明細（申請人的存摺）共用。
     傳 bank 就直接顯示（簽核明細已經帶在回應裡）；傳 employeeId 取那位員工的；什麼都不傳取登入者自己的。 -->
<template>
  <div class="comp-leave-panel" :class="{ compact }" data-test="comp-leave-panel">
    <div class="panel-header">
      <div class="panel-title">
        <b>{{ title }}</b>
        <span v-if="data" class="panel-sub" data-test="comp-leave-available">可用 {{ formatCompHours(data.availableHours) }}</span>
      </div>
      <el-button
        v-if="!bank"
        link
        type="primary"
        size="small"
        :loading="loading"
        data-test="comp-leave-refresh"
        @click="load"
      >
        重新整理
      </el-button>
    </div>

    <div v-if="error" class="panel-error" data-test="comp-leave-error">
      {{ error }}
      <el-button link type="primary" size="small" @click="load">再試一次</el-button>
    </div>

    <div v-if="data" class="comp-summary" data-test="comp-leave-summary">
      <el-tag type="success" effect="plain">存摺剩餘 {{ formatCompHours(data.balanceHours) }}</el-tag>
      <el-tag v-if="data.pendingHours > 0" type="warning" effect="plain">簽核中 {{ formatCompHours(data.pendingHours) }}</el-tag>
      <el-tag type="info" effect="plain">累計取得 {{ formatCompHours(data.earnedHours) }}</el-tag>
      <el-tag type="info" effect="plain">已使用 {{ formatCompHours(data.usedHours) }}</el-tag>
      <el-tag v-if="data.expiredHours > 0" type="danger" effect="plain">已過期 {{ formatCompHours(data.expiredHours) }}</el-tag>
      <span v-if="data.expiryMonths > 0" class="row-note">取得後 {{ data.expiryMonths }} 個月內使用</span>
    </div>
    <p v-if="data && !compact" class="panel-help" data-test="comp-leave-help">{{ COMP_LEAVE_HELP_TEXT }}</p>

    <!-- 存摺備註：管理員在員工管理填寫（空白 = 清除），員工在「我的調休」唯讀看得到 -->
    <div v-if="data && canManage && targetEmployeeId && !bank" class="comp-note" data-test="comp-leave-note-edit">
      <div class="note-label">存摺備註（員工在「我的調休」看得到）</div>
      <el-input
        v-model="noteDraft"
        type="textarea"
        :rows="2"
        :maxlength="MAX_BANK_NOTE_LENGTH"
        show-word-limit
        placeholder="例如：10/10 國慶日改發加倍工資，不另給移休"
        data-test="comp-leave-note-input"
      />
      <div class="note-actions">
        <span v-if="noteMeta" class="row-note" data-test="comp-leave-note-meta">{{ noteMeta }}</span>
        <el-button
          type="primary"
          size="small"
          :loading="noteSaving"
          :disabled="!noteChanged"
          data-test="comp-leave-note-save"
          @click="saveNote"
        >
          儲存備註
        </el-button>
      </div>
    </div>
    <div v-else-if="noteText" class="comp-note" data-test="comp-leave-note">
      <div class="note-label">人資備註</div>
      <p class="note-text" data-test="comp-leave-note-text">{{ noteText }}</p>
      <span v-if="noteMeta" class="row-note">{{ noteMeta }}</span>
    </div>

    <el-table
      v-if="rows.length"
      :data="rows"
      size="small"
      border
      class="comp-table"
      empty-text="目前沒有調休"
      data-test="comp-leave-table"
    >
      <el-table-column label="來源" min-width="220">
        <template #default="{ row }">
          <span class="source-text">{{ row.sourceText }}</span>
          <el-tooltip v-if="row.conflict" :content="CONFLICT_REASON_TEXT[row.conflictReason] || CONFLICT_REASON_TEXT.trigger_gone" placement="top">
            <el-tag size="small" type="warning" effect="plain" class="row-tag" data-test="comp-leave-conflict">請人資確認</el-tag>
          </el-tooltip>
          <span v-if="row.status === 'void' && row.voidReasonText" class="row-note">{{ row.voidReasonText }}</span>
        </template>
      </el-table-column>
      <el-table-column label="時數" min-width="150">
        <template #default="{ row }">{{ describeCreditHours(row) }}</template>
      </el-table-column>
      <el-table-column label="狀態" min-width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="CREDIT_STATUS_TAG_TYPES[row.status] || 'info'" effect="light">{{ row.statusLabel }}</el-tag>
          <span v-if="row.expiresOn" class="row-note">期限 {{ formatDateKey(row.expiresOn) }}</span>
        </template>
      </el-table-column>
      <el-table-column v-if="!compact" label="建議調休日" min-width="110">
        <template #default="{ row }">{{ row.suggestedDate ? formatDateKey(row.suggestedDate) : '—' }}</template>
      </el-table-column>
      <el-table-column label="使用紀錄" min-width="240">
        <template #default="{ row }">
          <template v-if="row.usages && row.usages.length">
            <div v-for="usage in row.usages" :key="usage.id || usage.at" class="usage-line" data-test="comp-leave-usage">{{ describeUsage(usage) }}</div>
          </template>
          <span v-else class="row-note">—</span>
        </template>
      </el-table-column>
      <el-table-column v-if="canManage" label="" width="80">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'available' && !(row.usedHours > 0)"
            link
            type="danger"
            size="small"
            data-test="comp-leave-void"
            @click="voidRow(row)"
          >
            作廢
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <div v-else-if="data && !error" class="panel-empty" data-test="comp-leave-empty">目前沒有調休</div>

    <div v-if="canManage && targetEmployeeId" class="comp-manage" data-test="comp-leave-manage">
      <el-radio-group v-model="manage.mode" size="small">
        <el-radio-button value="credit">手動給予</el-radio-button>
        <el-radio-button value="deduct">扣除調整</el-radio-button>
      </el-radio-group>
      <div class="manage-row">
        <el-input-number v-model="manage.hours" :min="0.5" :max="1000" :step="0.5" size="small" data-test="comp-leave-manage-hours" />
        <span class="row-note" data-test="comp-leave-manage-days">小時（{{ formatDays(manage.hours || 0) }}）</span>
        <el-date-picker
          v-if="manage.mode === 'credit'"
          v-model="manage.earnedDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="取得日期（預設今天）"
          size="small"
          data-test="comp-leave-manage-date"
        />
        <el-input
          v-model="manage.note"
          size="small"
          maxlength="500"
          :placeholder="manage.mode === 'credit' ? '給予原因（必填）' : '扣除原因（必填）'"
          class="manage-note"
          data-test="comp-leave-manage-note"
        />
        <el-button type="primary" size="small" :loading="manage.saving" data-test="comp-leave-manage-save" @click="submitManage">
          {{ manage.mode === 'credit' ? '給予' : '扣除' }}
        </el-button>
      </div>
      <p class="row-note">扣除會依到期日、取得日先後從還有剩的調休扣起；已用過的調休不能作廢，請改用扣除或撤回簽核單。</p>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../api'
import { formatDays } from '../utils/leaveBalance'
import {
  COMP_LEAVE_HELP_TEXT,
  CONFLICT_REASON_TEXT,
  CREDIT_STATUS_TAG_TYPES,
  MAX_BANK_NOTE_LENGTH,
  describeCreditHours,
  describeNoteMeta,
  describeUsage,
  formatCompHours,
  formatDateKey,
  validateBankNote,
  validateManualForm,
} from '../utils/compensatoryLeave'

const props = defineProps({
  // 取這位員工的存摺；不傳就取登入者自己的
  employeeId: { type: String, default: '' },
  // 已經取好的存摺（簽核明細的回應裡就有），傳了就不再向伺服器取
  bank: { type: Object, default: null },
  // 精簡模式（簽核明細）：不顯示說明與建議調休日
  compact: { type: Boolean, default: false },
  title: { type: String, default: '調休存摺' },
  // 管理員：可以手動給予、扣除、作廢
  canManage: { type: Boolean, default: false },
  // 最小請假單位（手動給予、扣除的時數要是它的倍數）
  minUnitHours: { type: Number, default: 0.5 },
})

const emit = defineEmits(['loaded', 'changed'])

const fetched = ref(null)
const loading = ref(false)
const error = ref('')
let loadSeq = 0

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const data = computed(() => {
  const source = props.bank !== null ? props.bank : fetched.value
  return isObject(source) && Array.isArray(source.credits) ? source : null
})
const rows = computed(() => data.value?.credits || [])
const targetEmployeeId = computed(() => props.employeeId || data.value?.employeeId || '')

async function load() {
  if (props.bank !== null) return
  const seq = ++loadSeq
  loading.value = true
  error.value = ''
  try {
    const url = props.employeeId
      ? `/api/compensatory-leave?employeeId=${encodeURIComponent(props.employeeId)}`
      : '/api/compensatory-leave/mine'
    const res = await apiFetch(url)
    if (seq !== loadSeq) return
    if (!res.ok) throw new Error(`status ${res.status}`)
    const json = await res.json()
    fetched.value = isObject(json) ? json : null
    emit('loaded', fetched.value)
  } catch {
    if (seq !== loadSeq) return
    // 存摺只是參考資訊：載入失敗只顯示一行提示，送出調休單時伺服器會再檢查一次
    error.value = '調休存摺暫時無法載入'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/* ---------- 管理員：手動給予、扣除、作廢 ---------- */

const manage = reactive({ mode: 'credit', hours: 8, earnedDate: '', note: '', saving: false })

async function errorMessageOf(res, fallback) {
  try {
    const body = await res.json()
    return body?.error || fallback
  } catch {
    return fallback
  }
}

async function submitManage() {
  if (manage.saving || !targetEmployeeId.value) return
  const problem = validateManualForm(manage, { minUnitHours: props.minUnitHours })
  if (problem) {
    ElMessage.warning(problem)
    return
  }
  manage.saving = true
  try {
    const isCredit = manage.mode === 'credit'
    const body = { employeeId: targetEmployeeId.value, hours: Number(manage.hours), note: manage.note.trim() }
    if (isCredit && manage.earnedDate) body.earnedDate = manage.earnedDate
    const res = await apiFetch(isCredit ? '/api/compensatory-leave/credits' : '/api/compensatory-leave/adjustments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      ElMessage.error(await errorMessageOf(res, isCredit ? '給予調休失敗' : '扣除調休失敗'))
      return
    }
    ElMessage.success(isCredit ? '已給予調休' : '已扣除調休')
    manage.note = ''
    manage.earnedDate = ''
    emit('changed')
    await load()
  } catch {
    ElMessage.error('儲存失敗，請稍後再試')
  } finally {
    manage.saving = false
  }
}

async function voidRow(row) {
  let note = ''
  try {
    const result = await ElMessageBox.prompt(`作廢「${row.sourceText}」（${formatCompHours(row.hours)}）。請填寫原因：`, '作廢調休', {
      confirmButtonText: '作廢',
      cancelButtonText: '取消',
      inputValidator: (value) => (String(value ?? '').trim() ? true : '請填寫原因'),
    })
    note = String(result?.value ?? '').trim()
  } catch {
    return
  }
  try {
    const res = await apiFetch(`/api/compensatory-leave/credits/${encodeURIComponent(row.id)}/void`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    })
    if (!res.ok) {
      ElMessage.error(await errorMessageOf(res, '作廢失敗'))
      return
    }
    ElMessage.success('已作廢')
    emit('changed')
    await load()
  } catch {
    ElMessage.error('作廢失敗，請稍後再試')
  }
}

/* ---------- 存摺備註（管理員填寫，員工唯讀） ---------- */

const noteText = computed(() => (typeof data.value?.note?.text === 'string' ? data.value.note.text : ''))
const noteMeta = computed(() => describeNoteMeta(data.value?.note))
const noteDraft = ref('')
const noteSaving = ref(false)
const noteChanged = computed(() => noteDraft.value.trim() !== noteText.value)
// 換員工或重新載入時，輸入框回到伺服器上的備註
watch(noteText, (text) => { noteDraft.value = text }, { immediate: true })

async function saveNote() {
  if (noteSaving.value || !targetEmployeeId.value) return
  const problem = validateBankNote(noteDraft.value)
  if (problem) {
    ElMessage.warning(problem)
    return
  }
  noteSaving.value = true
  try {
    const res = await apiFetch('/api/compensatory-leave/note', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: targetEmployeeId.value, note: noteDraft.value.trim() }),
    })
    if (!res.ok) {
      ElMessage.error(await errorMessageOf(res, '儲存備註失敗'))
      return
    }
    ElMessage.success(noteDraft.value.trim() ? '已儲存備註' : '已清除備註')
    emit('changed')
    await load()
  } catch {
    ElMessage.error('儲存備註失敗，請稍後再試')
  } finally {
    noteSaving.value = false
  }
}

defineExpose({ load, refresh: load })

onMounted(load)
watch(() => props.employeeId, () => {
  if (props.bank === null) load()
})
</script>

<style scoped>
.comp-leave-panel {
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 8px;
  padding: 12px 14px;
  background: #fff;
  margin-bottom: 12px;
}
.comp-leave-panel.compact {
  padding: 8px 10px;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.panel-sub {
  margin-left: 8px;
  color: #67c23a;
  font-size: 13px;
  font-weight: 600;
}
.panel-error {
  color: #e6a23c;
  font-size: 13px;
  margin-bottom: 8px;
}
.comp-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.panel-help {
  margin: 0 0 8px;
  color: #909399;
  font-size: 12px;
  line-height: 1.6;
}
.panel-empty {
  color: #909399;
  font-size: 13px;
}
.comp-table {
  width: 100%;
}
.source-text {
  font-weight: 600;
}
.row-tag {
  margin-left: 6px;
}
.row-note {
  display: block;
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}
.usage-line {
  font-size: 12px;
  line-height: 1.6;
}
.comp-manage {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--el-border-color-lighter, #ebeef5);
}
.manage-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0 4px;
}
.manage-row .row-note {
  display: inline;
}
.manage-note {
  flex: 1 1 200px;
  min-width: 160px;
}
.comp-note {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fdf6ec;
}
.note-label {
  font-size: 12px;
  font-weight: 600;
  color: #b88230;
  margin-bottom: 4px;
}
.note-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.note-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
.note-actions .row-note {
  display: inline;
  margin-right: auto;
}
</style>
