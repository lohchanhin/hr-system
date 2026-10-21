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
      <el-button :type="yearEnd.visible ? 'primary' : 'default'" plain data-test="holiday-ledger-year-end-toggle" @click="toggleYearEnd">
        年度未排補假
      </el-button>
    </div>

    <p class="ledger-help">
      班表上的「國」排在假日當天是<strong>當日休</strong>，排在當月其他日期是<strong>移休</strong>（顯示是哪一天）；
      本月沒有對應的「國」就是<strong>未休</strong>。「國」與假日依日期先後配對，總數一定正確，個別日期僅供參考。
      國定假日剛好是員工自己的休息日／例假時要另排<strong>補假</strong>（日期由勞雇雙方協商）；行政人員依政府公告的補假日放假。
      公司統一挪移假日請到「班別設定 &gt; 國定假日挪移」，個別員工的調移請按員工下方的「個人調移」（須本人同意）。匯出 Excel 會依目前的篩選與搜尋匯出。
    </p>

    <div v-if="ledger?.holidays?.length" class="ledger-holidays" data-test="holiday-ledger-holidays">
      <span v-for="holiday in ledger.holidays" :key="holiday.id" class="ledger-holiday-chip">
        <strong>{{ holiday.name }}</strong>
        {{ describeHolidayHeader(holiday).date }}
        <em v-if="describeHolidayHeader(holiday).note">{{ describeHolidayHeader(holiday).note }}</em>
      </span>
    </div>

    <div v-if="summary" class="ledger-summary" data-test="holiday-ledger-summary">
      <el-tag effect="plain">應休 {{ summary.entitled }}</el-tag>
      <el-tag type="success" effect="plain">當日休 {{ summary.rested }}</el-tag>
      <el-tag type="primary" effect="plain">移休 {{ summary.moved }}</el-tag>
      <el-tag type="success" effect="plain">補假 {{ summary.compensated ?? 0 }}</el-tag>
      <el-tag type="danger" effect="plain">未休 {{ summary.notTaken }}</el-tag>
      <el-tag type="warning" effect="plain">待處理 {{ summary.open }}</el-tag>
      <el-tag type="danger" effect="plain">待排補假 {{ summary.compensationOpen ?? 0 }}</el-tag>
      <el-tag type="info" effect="plain">多排的國 {{ summary.extra }}</el-tag>
      <span v-if="summary.excluded?.notScheduled" class="ledger-excluded">
        另有 {{ summary.excluded.notScheduled }} 人未排班或不在職，未列入
      </span>
      <span v-if="ledger?.calendar?.provisional" class="ledger-provisional" data-test="holiday-ledger-calendar-provisional">
        {{ ledger.calendar.year }} 年公司行事曆尚未核定，國定假日僅供參考
      </span>
    </div>

    <section v-if="yearEnd.visible" class="ledger-year-end" data-test="holiday-ledger-year-end">
      <div class="ledger-year-end__toolbar">
        <strong>年度未排補假</strong>
        <el-select v-model="yearEnd.year" class="ledger-year-end__year" data-test="holiday-ledger-year-end-year" @change="loadYearEnd">
          <el-option v-for="year in yearOptions" :key="year" :label="`${year} 年`" :value="year" />
        </el-select>
        <el-button
          v-if="canResolve"
          :loading="yearEnd.syncing"
          data-test="holiday-ledger-year-end-sync"
          @click="syncYearEnd"
        >
          重新計算 {{ yearEnd.year }} 年
        </el-button>
        <span class="ledger-excluded">國定假日落在休息日／例假、還沒排補假的員工（沒有期限，請和員工協商補假日）</span>
      </div>
      <p v-if="!yearEnd.error && yearEnd.conflicts > 0" class="ledger-excluded" data-test="holiday-ledger-year-end-conflicts">
        另有 {{ yearEnd.conflicts }} 筆已排定的補假需要確認（班表已變更，例如補假日被排成休息日），請到該國定假日所在月份的休假紀錄修改補假
      </p>
      <el-alert v-if="yearEnd.error" :title="yearEnd.error" type="error" show-icon :closable="false" />
      <el-table v-else v-loading="yearEnd.loading" :data="yearEnd.rows" :max-height="260" border empty-text="沒有待排的補假">
        <el-table-column label="員工" min-width="140">
          <template #default="{ row }">
            <span :data-test="`year-end-row-${row.id}`">{{ row.name }}</span>
            <span class="ledger-person__meta">{{ [row.employeeNo, row.subDepartmentName].filter(Boolean).join('・') }}</span>
          </template>
        </el-table-column>
        <el-table-column label="國定假日" min-width="150">
          <template #default="{ row }">{{ row.holidayName }} {{ formatMonthDay(row.holidayDate) }}</template>
        </el-table-column>
        <el-table-column label="建議補假日" min-width="110">
          <template #default="{ row }">{{ row.suggestedDate ? formatMonthDay(row.suggestedDate) : '—' }}</template>
        </el-table-column>
        <el-table-column label="" min-width="100">
          <template #default="{ row }">
            <el-button
              v-if="canResolve"
              link
              type="primary"
              size="small"
              data-test="holiday-ledger-year-end-assign"
              :data-compensation="row.id"
              @click="openCompensationRecord(row)"
            >
              排定補假
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

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
            <el-tag v-if="row.regime === 'office'" size="small" effect="plain" :data-test="`ledger-regime-${row.employeeId}`">行政</el-tag>
            <el-tooltip v-if="row.isIndigenous" :content="INDIGENOUS_TOOLTIP" placement="top">
              <el-tag size="small" type="success" effect="plain" :data-test="`ledger-indigenous-${row.employeeId}`">原住民</el-tag>
            </el-tooltip>
          </div>
          <div class="ledger-person__meta">{{ [row.employeeNo, row.subDepartmentName, row.title].filter(Boolean).join('・') }}</div>
          <el-button
            v-if="showSwapButton(row)"
            link
            type="primary"
            size="small"
            data-test="holiday-ledger-swap-button"
            :data-employee="row.employeeId"
            @click="openSwap(row)"
          >
            個人調移
          </el-button>
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
            <em v-if="describeHolidayHeader(holiday).note">{{ describeHolidayHeader(holiday).note }}</em>
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
            <el-tag v-if="itemOf(row, holiday).type === 'designated'" size="small" type="primary" effect="plain" class="ledger-cell__designated">指定</el-tag>
            <div v-if="showCompensationButton(row, holiday)" class="ledger-cell__action">
              <el-button
                link
                type="danger"
                size="small"
                data-test="holiday-ledger-assign-compensation"
                :data-cell="`${row.employeeId}-${holiday.id}`"
                @click="openCompensation(row, itemOf(row, holiday))"
              >
                {{ itemOf(row, holiday).compensation?.via === 'assigned' ? '修改補假' : '排定補假' }}
              </el-button>
            </div>
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
          <span v-else class="ledger-none" :data-test="`ledger-cell-${row.employeeId}-${holiday.id}`">—</span>
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

    <el-dialog
      v-model="compensation.visible"
      :title="`排定補假：${compensation.employeeName}　${compensation.holidayName}`"
      width="min(460px, 92vw)"
      :append-to="appendTo"
      destroy-on-close
      data-test="holiday-ledger-compensation-dialog"
    >
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="國定假日">
          <span>{{ compensation.holidayName }} {{ formatMonthDay(compensation.holidayDate) }}（{{ weekdayLabel(compensation.holidayDate) }}）</span>
          <el-tag size="small" type="info" effect="plain" class="ledger-unit">{{ compensation.reasonText }}</el-tag>
        </el-form-item>
        <el-form-item label="補假日期">
          <el-date-picker
            v-model="compensation.assignedDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="選擇補假日期"
            data-test="holiday-ledger-compensation-date"
          />
        </el-form-item>
        <el-form-item label="協商紀錄">
          <el-input
            v-model="compensation.agreementNote"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="例：與員工協商於 3/2 補假"
            data-test="holiday-ledger-compensation-note"
          />
        </el-form-item>
        <p class="ledger-help">補假日須是員工原本要上班的日子；排定後當天就是該員工的國定假日（不會自動產生薪資，出勤仍需加班單）。</p>
      </el-form>
      <template #footer>
        <el-button
          v-if="compensation.status === 'assigned'"
          type="danger"
          plain
          :loading="compensation.saving"
          data-test="holiday-ledger-compensation-unassign"
          @click="unassignCompensation"
        >
          取消排定
        </el-button>
        <el-button @click="compensation.visible = false">取消</el-button>
        <el-button type="primary" :loading="compensation.saving" data-test="holiday-ledger-compensation-save" @click="saveCompensation">儲存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="swap.visible"
      :title="`個人調移：${swap.employeeName}`"
      width="min(560px, 94vw)"
      :append-to="appendTo"
      destroy-on-close
      data-test="holiday-ledger-swap-dialog"
    >
      <el-alert :title="SWAP_WARNING_TEXT" type="warning" show-icon :closable="false" class="ledger-swap__warning" />
      <el-form label-width="132px" @submit.prevent>
        <el-form-item label="原國定假日">
          <el-select v-if="swap.options.length" v-model="swap.originalDate" data-test="holiday-ledger-swap-original">
            <el-option v-for="option in swap.options" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <el-date-picker v-else v-model="swap.originalDate" type="date" value-format="YYYY-MM-DD" data-test="holiday-ledger-swap-original-date" />
        </el-form-item>
        <el-form-item label="調移到">
          <el-date-picker v-model="swap.targetDate" type="date" value-format="YYYY-MM-DD" data-test="holiday-ledger-swap-target" />
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="swap.reason" maxlength="500" data-test="holiday-ledger-swap-reason" />
        </el-form-item>
        <el-form-item label="本人同意方式">
          <el-select v-model="swap.consentMethod" data-test="holiday-ledger-swap-consent-method">
            <el-option v-for="option in CONSENT_METHOD_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="同意日期">
          <el-date-picker v-model="swap.consentedAt" type="date" value-format="YYYY-MM-DD" data-test="holiday-ledger-swap-consent-date" />
        </el-form-item>
        <el-form-item label="同意文件編號或存放位置（必填）">
          <el-input v-model="swap.evidenceRef" maxlength="200" data-test="holiday-ledger-swap-evidence" />
        </el-form-item>
        <el-form-item label="備註">
          <el-input v-model="swap.consentNote" maxlength="500" data-test="holiday-ledger-swap-note" />
        </el-form-item>
      </el-form>
      <div class="ledger-swap__list" data-test="holiday-ledger-swap-list">
        <strong>目前有效的個人調移</strong>
        <p v-if="swap.loading" class="ledger-help">載入中…</p>
        <p v-else-if="!swap.swaps.length" class="ledger-help">沒有個人調移</p>
        <template v-else>
          <div v-for="record in swap.swaps" :key="record.id" class="ledger-swap__item">
            <span>{{ record.originalName }} {{ formatMonthDay(record.originalDate) }} → {{ formatMonthDay(record.targetDate) }}</span>
            <span class="ledger-person__meta">{{ record.consent?.evidenceRef }}</span>
            <el-button link type="danger" size="small" data-test="holiday-ledger-swap-revoke" :data-swap="record.id" @click="revokeSwap(record)">撤銷</el-button>
          </div>
          <el-input v-model="swap.revokeReason" placeholder="撤銷原因（必填）" maxlength="500" data-test="holiday-ledger-swap-revoke-reason" />
        </template>
      </div>
      <template #footer>
        <el-button @click="swap.visible = false">取消</el-button>
        <el-button type="primary" :loading="swap.saving" data-test="holiday-ledger-swap-save" @click="saveSwap">登記調移</el-button>
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
import { CONSENT_METHOD_OPTIONS } from '../../constants/holidayCalendar'
import {
  INDIGENOUS_TOOLTIP,
  LEDGER_CONFLICT_TEXT,
  LEDGER_FILTERS,
  RESOLUTION_OPTIONS,
  SWAP_WARNING_TEXT,
  buildLedgerQuery,
  buildSwapBody,
  canShowCompensationButton,
  canShowResolveButton,
  canShowSwapButton,
  compensationReasonText,
  countLedgerFilters,
  describeHolidayHeader,
  describeLedgerCell,
  describeResolutionAuthor,
  formatMonthDay,
  getViewerEmployeeId,
  ledgerRowMatchesFilter,
  resolveButtonLabel,
  validateSwapForm,
  weekdayLabel,
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
  // 補假、個人調移的錯誤帶有 code，訊息已經是繁體中文
  if (body?.code && body?.error) return String(body.error)
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

const showCompensationButton = (row, holiday) => canShowCompensationButton({
  canResolve: props.canResolve,
  role: authStore.role,
  viewerId: viewerId.value,
  row,
  item: itemOf(row, holiday),
})
const showSwapButton = (row) => canShowSwapButton({ canResolve: props.canResolve, role: authStore.role, viewerId: viewerId.value, row })

/* ---------------- 補假 ---------------- */

const compensation = reactive({
  visible: false,
  saving: false,
  id: '',
  status: 'open',
  employeeName: '',
  holidayName: '',
  holidayDate: '',
  reasonText: '',
  assignedDate: '',
  agreementNote: '',
  originalNote: '',
})

function fillCompensation({ id, status, employeeName, holidayName, holidayDate, reasonText, assignedDate, agreementNote }) {
  compensation.id = id
  compensation.status = status
  compensation.employeeName = employeeName
  compensation.holidayName = holidayName
  compensation.holidayDate = holidayDate
  compensation.reasonText = reasonText
  compensation.assignedDate = assignedDate || ''
  compensation.agreementNote = agreementNote || ''
  compensation.originalNote = agreementNote || ''
  compensation.visible = true
}

function openCompensation(row, item) {
  const assigned = item.compensation?.via === 'assigned'
  fillCompensation({
    id: assigned ? item.compensation.compensationId : item.compensation?.id,
    status: assigned ? 'assigned' : 'open',
    employeeName: row.name,
    holidayName: item.holidayName,
    holidayDate: item.originalDate,
    reasonText: compensationReasonText(item),
    // 待排的預填系統建議日；已排的帶目前的補假日
    assignedDate: assigned ? item.compensation.date : (item.compensation?.suggestedDate || ''),
  })
}

function openCompensationRecord(record) {
  fillCompensation({
    id: record.id,
    status: record.status,
    employeeName: record.name,
    holidayName: record.holidayName,
    holidayDate: record.holidayDate,
    reasonText: record.origin === 'office_weekend' ? '適逢週末' : '適逢休息日／例假',
    assignedDate: record.status === 'assigned' ? record.assignedDate : (record.suggestedDate || ''),
    agreementNote: record.agreementNote,
  })
}

async function afterCompensationChange(message) {
  ElMessage.success(message)
  compensation.visible = false
  await loadLedger()
  if (yearEnd.visible) await loadYearEnd()
}

async function saveCompensation() {
  if (compensation.saving || !compensation.id) return
  if (!compensation.assignedDate) {
    ElMessage.warning('請選擇補假日期')
    return
  }
  compensation.saving = true
  try {
    const body = { assignedDate: compensation.assignedDate }
    // 協商紀錄有改才送（已排定的補假只改日期時保留原本的紀錄）
    const note = compensation.agreementNote.trim()
    if (compensation.status !== 'assigned' || note !== compensation.originalNote.trim()) body.agreementNote = note
    const res = await apiFetch(`/api/holiday-ledger/compensations/${compensation.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      ElMessage.error(await failureMessage(res, '排定補假失敗'))
      return
    }
    await afterCompensationChange('已排定補假')
  } catch (error) {
    ElMessage.error('排定補假失敗，請稍後再試')
  } finally {
    compensation.saving = false
  }
}

async function unassignCompensation() {
  if (compensation.saving || !compensation.id) return
  compensation.saving = true
  try {
    const res = await apiFetch(`/api/holiday-ledger/compensations/${compensation.id}/unassign`, { method: 'POST' })
    if (!res.ok) {
      ElMessage.error(await failureMessage(res, '取消排定失敗'))
      return
    }
    await afterCompensationChange('已取消排定，回到待排補假')
  } catch (error) {
    ElMessage.error('取消排定失敗，請稍後再試')
  } finally {
    compensation.saving = false
  }
}

/* ---------------- 年度未排補假 ---------------- */

const yearEnd = reactive({ visible: false, loading: false, syncing: false, error: '', year: 0, rows: [], conflicts: 0 })
const yearOptions = computed(() => {
  const base = Number(String(month.value || '').slice(0, 4)) || new Date().getFullYear()
  return [base - 1, base, base + 1]
})

function yearEndQuery(extra = {}) {
  const params = new URLSearchParams(buildLedgerQuery({ ...props.scope, month: '' }))
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  return params.toString()
}

async function loadYearEnd() {
  yearEnd.loading = true
  yearEnd.error = ''
  try {
    const res = await apiFetch(`/api/holiday-ledger/compensations?${yearEndQuery({ year: String(yearEnd.year), status: 'open' })}`)
    if (!res.ok) {
      yearEnd.error = await failureMessage(res, '載入年度未排補假失敗')
      yearEnd.rows = []
      yearEnd.conflicts = 0
      return
    }
    const body = await res.json()
    yearEnd.rows = body?.compensations || []
    // 已排定但需要確認的補假不在待排清單裡，另外提示件數
    yearEnd.conflicts = Number(body?.summary?.conflict) || 0
  } catch (error) {
    yearEnd.error = '載入年度未排補假失敗，請稍後再試'
    yearEnd.rows = []
    yearEnd.conflicts = 0
  } finally {
    yearEnd.loading = false
  }
}

async function toggleYearEnd() {
  yearEnd.visible = !yearEnd.visible
  if (!yearEnd.visible) return
  yearEnd.year = Number(String(month.value || '').slice(0, 4)) || new Date().getFullYear()
  await loadYearEnd()
}

async function syncYearEnd() {
  if (yearEnd.syncing) return
  yearEnd.syncing = true
  try {
    const res = await apiFetch('/api/holiday-ledger/compensations/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${yearEnd.year}-01`, to: `${yearEnd.year}-12` }),
    })
    if (!res.ok) {
      ElMessage.error(await failureMessage(res, '重新計算失敗'))
      return
    }
    const result = await res.json().catch(() => ({}))
    ElMessage.success(`已重新計算 ${yearEnd.year} 年：新增 ${result.created ?? 0} 筆、失效 ${result.voided ?? 0} 筆`)
    await loadYearEnd()
  } catch (error) {
    ElMessage.error('重新計算失敗，請稍後再試')
  } finally {
    yearEnd.syncing = false
  }
}

/* ---------------- 個人調移 ---------------- */

const swap = reactive({
  visible: false,
  saving: false,
  loading: false,
  employee: '',
  employeeName: '',
  options: [],
  originalDate: '',
  targetDate: '',
  reason: '',
  consentMethod: 'signature',
  consentedAt: '',
  evidenceRef: '',
  consentNote: '',
  revokeReason: '',
  swaps: [],
})

async function loadSwaps() {
  swap.loading = true
  try {
    const res = await apiFetch(`/api/holiday-ledger/swaps?employee=${encodeURIComponent(swap.employee)}&status=active`)
    swap.swaps = res.ok ? ((await res.json())?.swaps || []) : []
  } catch (error) {
    swap.swaps = []
  } finally {
    swap.loading = false
  }
}

function openSwap(row) {
  swap.employee = row.employeeId
  swap.employeeName = row.name
  // 已經個人調移過、或公司已統一調移的國定假日不能再個別調移（伺服器會回 409），不列入選項
  swap.options = (row.items || [])
    .filter((entry) => entry.type === 'statutory' && entry.via !== 'swap' && entry.via !== 'company_move' && entry.status !== 'na')
    .map((entry) => ({ value: entry.originalDate, label: `${entry.holidayName} ${formatMonthDay(entry.originalDate)}` }))
  swap.originalDate = swap.options[0]?.value || ''
  swap.targetDate = ''
  swap.reason = ''
  swap.consentMethod = 'signature'
  swap.consentedAt = ''
  swap.evidenceRef = ''
  swap.consentNote = ''
  swap.revokeReason = ''
  swap.swaps = []
  swap.visible = true
  loadSwaps()
}

async function saveSwap() {
  if (swap.saving) return
  const problem = validateSwapForm(swap)
  if (problem) {
    ElMessage.warning(problem)
    return
  }
  swap.saving = true
  try {
    const res = await apiFetch('/api/holiday-ledger/swaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSwapBody(swap)),
    })
    if (!res.ok) {
      ElMessage.error(await failureMessage(res, '登記個人調移失敗'))
      return
    }
    ElMessage.success('已登記個人調移')
    swap.visible = false
    await loadLedger()
  } catch (error) {
    ElMessage.error('登記個人調移失敗，請稍後再試')
  } finally {
    swap.saving = false
  }
}

async function revokeSwap(record) {
  if (swap.saving) return
  const reason = swap.revokeReason.trim()
  if (!reason) {
    ElMessage.warning('撤銷個人調移需填寫原因')
    return
  }
  swap.saving = true
  try {
    const res = await apiFetch(`/api/holiday-ledger/swaps/${record.id}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    if (!res.ok) {
      ElMessage.error(await failureMessage(res, '撤銷失敗'))
      return
    }
    ElMessage.success('已撤銷個人調移')
    swap.revokeReason = ''
    await loadSwaps()
    await loadLedger()
  } catch (error) {
    ElMessage.error('撤銷失敗，請稍後再試')
  } finally {
    swap.saving = false
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

.ledger-provisional {
  color: var(--el-color-warning);
  font-size: 13px;
}

.ledger-year-end {
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.ledger-year-end__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.ledger-year-end__year {
  width: 110px;
}

.ledger-cell__designated {
  margin-left: 4px;
}

.ledger-swap__warning {
  margin-bottom: 12px;
}

.ledger-swap__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.ledger-swap__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
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
