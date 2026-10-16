<template>
  <el-dialog
    :model-value="modelValue"
    title="國定假日休假紀錄"
    width="min(1080px, 96vw)"
    class="holiday-ledger-dialog"
    :append-to="appendTo"
    destroy-on-close
    data-test="holiday-ledger-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="ledger-toolbar">
      <el-date-picker
        v-model="month"
        type="month"
        value-format="YYYY-MM"
        :clearable="false"
        class="ledger-month"
        data-test="holiday-ledger-month"
        @change="loadLedger"
      />
      <el-input
        v-model="search"
        placeholder="搜尋員工姓名或代號"
        clearable
        class="ledger-search"
        data-test="holiday-ledger-search"
      />
      <el-radio-group v-model="filter" data-test="holiday-ledger-filter">
        <el-radio-button v-for="option in LEDGER_FILTERS" :key="option.value" :value="option.value">
          {{ option.label }}（{{ filterCounts[option.value] ?? 0 }}）
        </el-radio-button>
      </el-radio-group>
      <el-button :loading="exporting" :disabled="loading || !ledger" data-test="holiday-ledger-export" @click="exportLedger">
        <el-icon><Download /></el-icon>
        匯出 Excel
      </el-button>
    </div>

    <p class="ledger-help">
      班表上的「國」排在假日當天是<strong>當日休</strong>，排在當月其他日期是<strong>移休</strong>（顯示是哪一天）；
      本月沒有對應的「國」就是<strong>未休</strong>。「國」與假日依日期先後配對，總數一定正確，個別日期僅供參考。
      公司統一挪移假日請到「班別設定 &gt; 國定假日挪移」。匯出 Excel 會依目前的篩選與搜尋匯出。
    </p>

    <div v-if="ledger?.holidays?.length" class="ledger-holidays" data-test="holiday-ledger-holidays">
      <span v-for="holiday in ledger.holidays" :key="holiday.id" class="ledger-holiday-chip">
        <strong>{{ holiday.name }}</strong>
        {{ describeHolidayHeader(holiday).date }}
        <em v-if="holiday.movedFrom">{{ describeHolidayHeader(holiday).note }}</em>
      </span>
    </div>

    <div v-if="summary" class="ledger-summary" data-test="holiday-ledger-summary">
      <el-tag effect="plain">應休 {{ summary.entitled }}</el-tag>
      <el-tag type="success" effect="plain">當日休 {{ summary.rested }}</el-tag>
      <el-tag type="primary" effect="plain">移休 {{ summary.moved }}</el-tag>
      <el-tag type="danger" effect="plain">未休 {{ summary.notTaken }}</el-tag>
      <el-tag type="warning" effect="plain">待處理 {{ summary.open }}</el-tag>
      <el-tag type="info" effect="plain">多排的國 {{ summary.extra }}</el-tag>
      <span v-if="summary.excluded?.notScheduled" class="ledger-excluded">
        另有 {{ summary.excluded.notScheduled }} 人未排班或不在職，未列入
      </span>
    </div>

    <el-alert
      v-if="loadError"
      :title="loadError"
      type="error"
      show-icon
      :closable="false"
      data-test="holiday-ledger-error"
    />
    <el-empty
      v-else-if="ledger && !ledger.holidays.length"
      description="這個月沒有國定假日"
      data-test="holiday-ledger-no-holiday"
    />
    <el-table
      v-else
      v-loading="loading"
      :data="visibleRows"
      :max-height="460"
      border
      stripe
      empty-text="沒有符合條件的員工"
      row-key="employeeId"
      data-test="holiday-ledger-table"
    >
      <el-table-column label="員工" min-width="150" fixed>
        <template #default="{ row }">
          <div class="ledger-person">
            <strong>{{ row.name }}</strong>
            <el-tag v-if="row.partTime" size="small" type="info" effect="plain">兼職</el-tag>
          </div>
          <div class="ledger-person__meta">{{ [row.employeeNo, row.subDepartmentName, row.title].filter(Boolean).join('・') }}</div>
        </template>
      </el-table-column>
      <el-table-column
        v-for="holiday in ledger?.holidays || []"
        :key="holiday.id"
        min-width="170"
        align="center"
      >
        <template #header>
          <div class="ledger-header">
            <strong>{{ holiday.name }}</strong>
            <span>{{ describeHolidayHeader(holiday).date }}</span>
            <em v-if="holiday.movedFrom">{{ describeHolidayHeader(holiday).note }}</em>
          </div>
        </template>
        <template #default="{ row }">
          <template v-if="itemOf(row, holiday)">
            <el-tooltip :content="cellOf(row, holiday).tooltip" :disabled="!cellOf(row, holiday).tooltip" placement="top">
              <el-tag
                :type="cellOf(row, holiday).type"
                effect="light"
                :data-test="`ledger-cell-${row.employeeId}-${holiday.id}`"
              >
                {{ cellOf(row, holiday).text }}
              </el-tag>
            </el-tooltip>
            <div
              v-if="itemOf(row, holiday).resolutionConflict"
              class="ledger-cell__conflict"
              :data-test="`ledger-conflict-${row.employeeId}-${holiday.id}`"
            >
              {{ LEDGER_CONFLICT_TEXT }}
            </div>
            <div v-if="showResolveButton(row, holiday)" class="ledger-cell__action">
              <el-button
                link
                type="primary"
                size="small"
                :data-test="`ledger-resolve-${row.employeeId}-${holiday.id}`"
                @click="openResolve(row, itemOf(row, holiday))"
              >
                {{ resolveButtonLabel(itemOf(row, holiday)) }}
              </el-button>
            </div>
            <div v-if="describeResolutionAuthor(itemOf(row, holiday).resolution)" class="ledger-cell__note">
              {{ describeResolutionAuthor(itemOf(row, holiday).resolution) }}
            </div>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="多排的國" min-width="130" align="center">
        <template #default="{ row }">
          <el-tooltip v-if="row.extraGuoDates.length" content="比本月國定假日天數多出來的「國」，僅供參考" placement="top">
            <el-tag type="warning" effect="plain" :data-test="`ledger-extra-${row.employeeId}`">
              {{ row.extraGuoDates.map(formatMonthDay).join('、') }}
            </el-tag>
          </el-tooltip>
          <span v-else class="ledger-none">—</span>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="form.visible"
      :title="`登記處理方式：${form.employeeName}　${form.holidayName}`"
      width="min(460px, 92vw)"
      :append-to="appendTo"
      destroy-on-close
      data-test="holiday-ledger-resolve-dialog"
    >
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="處理方式">
          <el-radio-group v-model="form.kind" data-test="holiday-ledger-kind">
            <el-radio v-for="option in RESOLUTION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.kind === 'compensatory_leave'" label="補休時數">
          <el-input-number v-model="form.compensatoryHours" :min="0.5" :max="24" :step="0.5" data-test="holiday-ledger-hours" />
          <span class="ledger-unit">小時</span>
        </el-form-item>
        <el-form-item v-if="form.kind === 'rested_later'" label="實際補休日">
          <el-date-picker v-model="form.restedDate" type="date" value-format="YYYY-MM-DD" data-test="holiday-ledger-rested-date" />
        </el-form-item>
        <el-form-item :label="form.kind === 'waived' ? '備註（必填）' : '備註'">
          <el-input v-model="form.note" type="textarea" :rows="3" maxlength="500" show-word-limit data-test="holiday-ledger-note" />
        </el-form-item>
        <p class="ledger-help">這裡只登記處理方式，不會自動改動薪資或員工的補休時數餘額。</p>
      </el-form>
      <template #footer>
        <el-button
          v-if="form.resolutionId"
          type="danger"
          plain
          :loading="form.saving"
          data-test="holiday-ledger-remove"
          @click="removeResolution"
        >
          刪除登記
        </el-button>
        <el-button @click="form.visible = false">取消</el-button>
        <el-button type="primary" :loading="form.saving" data-test="holiday-ledger-save" @click="saveResolution">儲存</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Download } from '@element-plus/icons-vue'
import { apiFetch } from '../../api'
import { useAuthStore } from '../../stores/auth'
import { translateServerMessage } from '../../utils/approvalErrors'
import {
  LEDGER_CONFLICT_TEXT,
  LEDGER_FILTERS,
  RESOLUTION_OPTIONS,
  buildLedgerQuery,
  canShowResolveButton,
  countLedgerFilters,
  describeHolidayHeader,
  describeLedgerCell,
  describeResolutionAuthor,
  formatMonthDay,
  getViewerEmployeeId,
  ledgerRowMatchesFilter,
  resolveButtonLabel,
} from '../../utils/holidayLedger'

defineOptions({ name: 'HolidayLedgerDialog' })

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 排班頁目前的範圍：{ month, department, subDepartment, includeSelf }
  scope: { type: Object, default: () => ({}) },
  // 只有能維護班表的人（主管、管理員）可以登記處理方式
  canResolve: { type: Boolean, default: false },
  appendTo: { type: [String, Object], default: undefined },
})
const emit = defineEmits(['update:modelValue'])

const authStore = useAuthStore()
// 登入者自己的員工 _id：主管不能替自己登記處理方式（伺服器會拒絕），自己那一列不顯示按鈕
const viewerId = ref(getViewerEmployeeId())

const month = ref(props.scope?.month || '')
const search = ref('')
const filter = ref('all')
const loading = ref(false)
const exporting = ref(false)
const loadError = ref('')
const response = ref(null)
let requestSeq = 0

const ledger = computed(() => response.value?.months?.[0] || null)
const summary = computed(() => ledger.value?.summary || null)
const rows = computed(() => ledger.value?.employees || [])
const filterCounts = computed(() => countLedgerFilters(rows.value))
const visibleRows = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return rows.value.filter((row) => (
    ledgerRowMatchesFilter(row, filter.value)
    && (!keyword || `${row.name} ${row.employeeNo}`.toLowerCase().includes(keyword))
  ))
})

const form = reactive({
  visible: false,
  saving: false,
  employee: '',
  employeeName: '',
  holidayDate: '',
  holidayName: '',
  resolutionId: '',
  kind: 'compensatory_leave',
  compensatoryHours: 8,
  restedDate: '',
  note: '',
})

const itemOf = (row, holiday) => row.items.find((item) => item.holidayId === holiday.id)
const cellOf = (row, holiday) => describeLedgerCell(itemOf(row, holiday))
const showResolveButton = (row, holiday) => canShowResolveButton({
  canResolve: props.canResolve,
  role: authStore.role,
  viewerId: viewerId.value,
  row,
  item: itemOf(row, holiday),
})

const LEDGER_ERROR_MESSAGES = [
  [/too many employees/i, '員工人數太多，請先在排班頁選擇部門或單位縮小範圍'],
  [/not a national holiday/i, '這一天不是國定假日，無法登記'],
  [/note required/i, '選擇「不補」時請填寫備註'],
  [/restedDate/i, '請選擇實際補休的日期'],
  [/compensatoryHours/i, '補休時數必須大於 0 且不超過 24 小時'],
]

async function failureMessage(res, fallback) {
  const body = await res.json().catch(() => ({}))
  const known = LEDGER_ERROR_MESSAGES.find(([pattern]) => pattern.test(String(body?.error || '')))
  if (known) return known[1]
  const message = translateServerMessage(body?.error, { status: Number(res?.status) || 0 })
  return message || fallback
}

async function loadLedger() {
  if (!month.value) return
  const seq = ++requestSeq
  loading.value = true
  loadError.value = ''
  try {
    const query = buildLedgerQuery({ ...props.scope, month: month.value })
    const res = await apiFetch(`/api/holiday-ledger?${query}`)
    if (seq !== requestSeq) return
    if (!res.ok) {
      loadError.value = await failureMessage(res, '載入國定假日休假紀錄失敗')
      response.value = null
      return
    }
    response.value = await res.json()
  } catch (error) {
    if (seq !== requestSeq) return
    loadError.value = '載入國定假日休假紀錄失敗，請稍後再試'
    response.value = null
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

// 每次打開視窗都以排班頁目前的月份重新載入（排班表可能剛改過）
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    month.value = props.scope?.month || month.value
    search.value = ''
    filter.value = 'all'
    viewerId.value = getViewerEmployeeId()
    loadLedger()
  },
  { immediate: true },
)

function openResolve(row, item) {
  form.employee = row.employeeId
  form.employeeName = row.name
  // 以原始日期為鍵：公司挪移假日後，有效日期會變，原始日期不會
  form.holidayDate = item.originalDate
  form.holidayName = item.holidayName
  form.resolutionId = item.resolution?.id || ''
  form.kind = item.resolution?.kind || 'compensatory_leave'
  form.compensatoryHours = item.resolution?.compensatoryHours ?? 8
  form.restedDate = item.resolution?.restedDate || ''
  form.note = item.resolution?.note || ''
  form.visible = true
}

function buildResolutionBody() {
  const body = {
    employee: form.employee,
    holidayDate: form.holidayDate,
    kind: form.kind,
    note: form.note.trim(),
  }
  if (form.kind === 'compensatory_leave') body.compensatoryHours = form.compensatoryHours
  if (form.kind === 'rested_later') body.restedDate = form.restedDate
  return body
}

async function saveResolution() {
  if (form.saving) return
  const body = buildResolutionBody()
  if (form.kind === 'waived' && !body.note) {
    ElMessage.warning('選擇「不補」時請填寫備註')
    return
  }
  if (form.kind === 'rested_later' && !form.restedDate) {
    ElMessage.warning('請選擇實際補休的日期')
    return
  }
  if (form.kind === 'compensatory_leave' && !(Number(form.compensatoryHours) > 0 && Number(form.compensatoryHours) <= 24)) {
    ElMessage.warning('補休時數必須大於 0 且不超過 24 小時')
    return
  }
  form.saving = true
  try {
    const res = await apiFetch('/api/holiday-ledger/resolutions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      ElMessage.error(await failureMessage(res, '登記失敗'))
      return
    }
    ElMessage.success('已登記處理方式')
    form.visible = false
    await loadLedger()
  } catch (error) {
    ElMessage.error('登記失敗，請稍後再試')
  } finally {
    form.saving = false
  }
}

async function removeResolution() {
  if (form.saving || !form.resolutionId) return
  form.saving = true
  try {
    const res = await apiFetch(`/api/holiday-ledger/resolutions/${form.resolutionId}`, { method: 'DELETE' })
    if (!res.ok) {
      ElMessage.error(await failureMessage(res, '刪除失敗'))
      return
    }
    ElMessage.success('已刪除登記')
    form.visible = false
    await loadLedger()
  } catch (error) {
    ElMessage.error('刪除失敗，請稍後再試')
  } finally {
    form.saving = false
  }
}

async function exportLedger() {
  if (exporting.value || !month.value) return
  exporting.value = true
  try {
    // 匯出的就是畫面上看到的那些員工：帶目前的篩選與搜尋文字
    const query = buildLedgerQuery({ ...props.scope, month: month.value, status: filter.value, search: search.value })
    const res = await apiFetch(`/api/holiday-ledger/export?${query}`)
    if (!res.ok) {
      ElMessage.error(await failureMessage(res, '匯出失敗'))
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `holiday-ledger-${month.value}.xlsx`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error('匯出失敗，請稍後再試')
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.ledger-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.ledger-month {
  width: 150px;
}

.ledger-search {
  width: 200px;
}

.ledger-help {
  margin: 0 0 10px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.ledger-holidays {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.ledger-holiday-chip {
  padding: 4px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 14px;
  background: var(--el-fill-color-lighter);
  font-size: 13px;
}

.ledger-holiday-chip em {
  margin-left: 6px;
  color: var(--el-color-warning);
  font-style: normal;
}

.ledger-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.ledger-excluded {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.ledger-person {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ledger-person__meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.ledger-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.4;
}

.ledger-header em {
  color: var(--el-color-warning);
  font-size: 12px;
  font-style: normal;
}

.ledger-cell__action {
  margin-top: 2px;
}

.ledger-cell__note {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.ledger-cell__conflict {
  margin-top: 2px;
  color: var(--el-color-warning);
  font-size: 12px;
  line-height: 1.4;
}

.ledger-none {
  color: var(--el-text-color-placeholder);
}

.ledger-unit {
  margin-left: 8px;
}
</style>
