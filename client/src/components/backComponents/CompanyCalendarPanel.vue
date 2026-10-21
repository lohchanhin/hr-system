<!-- 行事曆設定：每年由政府辦公日曆表建立草稿，人資檢查後核定；重新匯入只顯示差異，不會覆蓋人資修改 -->
<template>
  <div class="company-calendar-panel">
    <div class="calendar-toolbar">
      <div class="toolbar-left">
        <el-select
          v-model="selectedYear"
          class="year-select"
          data-test="calendar-year-select"
          @change="onYearChange"
        >
          <el-option
            v-for="item in years"
            :key="item.year"
            :label="`${item.year} 年`"
            :value="item.year"
          />
        </el-select>
        <el-tag :type="stateTagType(currentItem.state)" data-test="calendar-state-tag">
          {{ stateLabel(currentItem.state) }}
        </el-tag>
        <el-button :loading="checking" data-test="calendar-check-updates" @click="checkUpdates">
          檢查更新
        </el-button>
        <el-button :loading="fetching" data-test="calendar-fetch-government" @click="fetchGovernment()">
          檢查政府資料
        </el-button>
      </div>
      <div class="last-check" data-test="calendar-last-check">
        <span v-if="lastCheck.lastCheckedAt">上次檢查：{{ formatTaipeiDateTime(lastCheck.lastCheckedAt) }}</span>
        <span v-else>尚未檢查政府資料</span>
        <span v-if="lastCheck.lastError" class="last-check-error">（{{ lastErrorLabel(lastCheck.lastError) }}）</span>
      </div>
    </div>

    <el-alert
      class="calendar-state-banner"
      data-test="calendar-state-banner"
      :type="stateBannerType(currentItem)"
      :closable="false"
      show-icon
      :title="stateBannerText(currentItem)"
    >
      <template #default>
        <div class="banner-body">
          <span v-if="currentItem.state !== 'none'" class="banner-counts">
            {{ describeKindCounts(currentItem.counts) || '沒有任何日期' }}
            <template v-if="currentItem.needsReview">；待確認 {{ currentItem.needsReview }} 筆</template>
          </span>
          <el-button
            v-if="currentItem.state === 'none'"
            type="primary"
            size="small"
            :loading="fetching"
            data-test="calendar-fetch-button"
            @click="createDraftFromGovernment"
          >
            從政府資料建立草稿
          </el-button>
          <el-button
            v-if="currentItem.state === 'draft'"
            type="success"
            size="small"
            data-test="calendar-approve"
            @click="approveYear"
          >
            核定
          </el-button>
          <el-button
            v-if="currentItem.state === 'approved'"
            size="small"
            data-test="calendar-reopen"
            @click="reopenYear"
          >
            重新開啟編輯
          </el-button>
        </div>
      </template>
    </el-alert>

    <div v-if="notices.length" class="calendar-notices">
      <div
        v-for="notice in notices"
        :key="notice.id"
        class="calendar-notice"
        :data-test="`calendar-notice-${notice.type}`"
      >
        <el-tag size="small" type="warning">{{ NOTICE_TYPE_LABELS[notice.type] || '提醒' }}</el-tag>
        <span class="notice-message">{{ notice.message }}</span>
        <el-button
          v-if="notice.snapshotId"
          link
          type="primary"
          size="small"
          data-test="calendar-notice-diff"
          @click="openNoticeDiff(notice)"
        >
          檢視差異
        </el-button>
        <el-button link size="small" data-test="calendar-notice-dismiss" @click="dismissNotice(notice)">略過</el-button>
      </div>
    </div>

    <div v-if="candidates.length > 1" class="calendar-candidates" data-test="calendar-candidates">
      <div class="candidates-title">這個年度有 {{ candidates.length }} 份政府辦公日曆表，請選擇要採用的版本：</div>
      <el-radio-group v-model="selectedCandidate" class="candidate-list">
        <el-radio
          v-for="candidate in candidates"
          :key="candidate.snapshotId"
          :value="candidate.snapshotId"
          :data-test="`calendar-candidate-${candidate.snapshotId}`"
        >
          <span>{{ candidate.resourceDescription || candidate.source }}</span>
          <span class="candidate-counts">（{{ describeKindCounts(candidate.counts) }}）</span>
          <el-tag v-if="candidate.recommended" size="small" type="success">建議</el-tag>
        </el-radio>
      </el-radio-group>
      <el-button
        type="primary"
        size="small"
        :disabled="!selectedCandidate"
        data-test="calendar-candidate-diff"
        @click="openSnapshotDiff(selectedCandidate)"
      >
        檢視差異
      </el-button>
    </div>

    <div class="calendar-legend" data-test="calendar-kind-legend">
      <div v-for="kind in HOLIDAY_KINDS" :key="kind" class="legend-item">
        <el-tag :type="HOLIDAY_KIND_TAG_TYPES[kind]" size="small">{{ HOLIDAY_KIND_LABELS[kind] }}</el-tag>
        <span class="legend-text">{{ HOLIDAY_KIND_DESCRIPTIONS[kind] }}</span>
      </div>
    </div>

    <div class="calendar-settings" data-test="calendar-settings-follow">
      <div class="settings-row">
        <el-switch
          v-model="settingsForm.followGovernmentAdjustments"
          data-test="calendar-follow-switch"
          active-text="依政府調整放假／補行上班（勞基法第 30 條第 3 項 8 週彈性工時）"
        />
      </div>
      <div class="form-help">只影響行政人員；需工會或勞資會議同意並公告。輪班人員不受影響</div>
      <div v-if="settingsForm.followGovernmentAdjustments" class="settings-agreement">
        <el-input
          v-model="settingsForm.reference"
          maxlength="200"
          placeholder="協議文號（必填）"
          data-test="calendar-agreement-reference"
        />
        <el-date-picker
          v-model="settingsForm.date"
          type="date"
          value-format="YYYY-MM-DD"
          format="YYYY/MM/DD"
          placeholder="同意日期（必填）"
          data-test="calendar-agreement-date"
        />
        <el-input v-model="settingsForm.note" maxlength="500" placeholder="備註" />
      </div>
      <el-button size="small" type="primary" data-test="calendar-settings-save" @click="saveSettings">儲存年度設定</el-button>
    </div>

    <div class="calendar-days">
      <div class="days-toolbar">
        <h3 class="days-title">{{ selectedYear }} 年行事曆</h3>
        <div class="days-actions">
          <el-switch v-model="showArchived" active-text="顯示已刪除" data-test="calendar-show-archived" />
          <el-button type="primary" size="small" data-test="calendar-add-day" @click="openDayDialog()">新增日期</el-button>
        </div>
      </div>
      <el-table :data="visibleDays" class="data-table" data-test="calendar-day-table" empty-text="這個年度還沒有任何日期">
        <el-table-column label="日期" width="120">
          <template #default="{ row }">{{ formatDateKey(row.date) }}</template>
        </el-table-column>
        <el-table-column label="星期" width="70">
          <template #default="{ row }">{{ weekdayLabel(row.date) }}</template>
        </el-table-column>
        <el-table-column label="類型" width="150">
          <template #default="{ row }">
            <el-tag :type="HOLIDAY_KIND_TAG_TYPES[row.kind] || 'info'" size="small">
              {{ HOLIDAY_KIND_LABELS[row.kind] || row.kind }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名稱" min-width="180" />
        <el-table-column label="對應" min-width="170">
          <template #default="{ row }">{{ describeDayLink(row) }}</template>
        </el-table-column>
        <el-table-column label="來源" width="100">
          <template #default="{ row }">{{ originLabel(row.origin) }}</template>
        </el-table-column>
        <el-table-column label="標記" min-width="150">
          <template #default="{ row }">
            <el-tooltip v-for="flag in dayFlags(row)" :key="flag" :content="row.reviewNote || flag" placement="top">
              <el-tag size="small" :type="flag === '待確認' ? 'warning' : 'info'" class="flag-tag">{{ flag }}</el-tag>
            </el-tooltip>
            <!-- 檢查過類型沒問題：只清掉「待確認」，內容不變 -->
            <el-button
              v-if="row.needsReview && !row.archived"
              link
              type="primary"
              size="small"
              data-test="calendar-day-confirm"
              @click="confirmDay(row)"
            >確認</el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <template v-if="row.archived">
              <el-button size="small" data-test="calendar-day-restore" @click="restoreDay(row)">復原</el-button>
            </template>
            <template v-else>
              <el-button size="small" type="primary" data-test="calendar-day-edit" @click="openDayDialog(row)">編輯</el-button>
              <el-button size="small" type="danger" data-test="calendar-day-delete" @click="deleteDay(row)">刪除</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-collapse class="calendar-reconciliation" data-test="calendar-reconciliation" @change="onReconciliationToggle">
      <el-collapse-item name="report">
        <template #title>
          對帳報告
          <span v-if="reconciliation" class="reconciliation-counts">
            （休假處理 {{ reconciliation.counts.resolutions }}、公司調移 {{ reconciliation.counts.moves }}、補假 {{ reconciliation.counts.compensations }}、個人調移 {{ reconciliation.counts.swaps }}）
          </span>
        </template>
        <div class="form-help">
          行事曆重新分類後，下列紀錄所在的日子已不是國定假日（例如 2026-02-20 原本被當成國定假日，現在是公務機關補假），請確認是否需要改排補假或調整。資料不會被自動刪除。
        </div>
        <template v-if="reconciliation">
          <el-table v-if="reconciliation.resolutions.length" :data="reconciliation.resolutions" size="small" class="reconciliation-table">
            <el-table-column label="員工" min-width="140">
              <template #default="{ row }">{{ row.employeeNo }} {{ row.name }}</template>
            </el-table-column>
            <el-table-column label="國定假日休假處理的日期" min-width="160">
              <template #default="{ row }">{{ formatDateWithWeekday(row.holidayDate) }} {{ row.holidayName }}</template>
            </el-table-column>
            <el-table-column label="目前類型" min-width="120">
              <template #default="{ row }">{{ HOLIDAY_KIND_LABELS[row.currentKind] || '無行事曆紀錄' }}</template>
            </el-table-column>
          </el-table>
          <el-table v-if="reconciliation.moves.length" :data="reconciliation.moves" size="small" class="reconciliation-table">
            <el-table-column label="公司調移" min-width="200">
              <template #default="{ row }">{{ formatDateKey(row.sourceDate) }} → {{ formatDateKey(row.targetDate) }}</template>
            </el-table-column>
            <el-table-column label="問題" min-width="160">
              <template #default="{ row }">{{ RECONCILIATION_PROBLEM_LABELS[row.problem] }}</template>
            </el-table-column>
          </el-table>
          <el-table
            v-if="reconciliation.compensations.length || reconciliation.swaps.length"
            :data="[...reconciliation.compensations, ...reconciliation.swaps]"
            size="small"
            class="reconciliation-table"
          >
            <el-table-column label="員工" prop="name" min-width="120" />
            <el-table-column label="日期" min-width="200">
              <template #default="{ row }">
                <template v-if="row.originalDate">個人調移 {{ formatDateKey(row.originalDate) }} → {{ formatDateKey(row.targetDate) }}</template>
                <template v-else>補假義務 {{ formatDateKey(row.holidayDate) }}</template>
              </template>
            </el-table-column>
            <el-table-column label="問題" min-width="160">
              <template #default="{ row }">{{ RECONCILIATION_PROBLEM_LABELS[row.problem] }}</template>
            </el-table-column>
          </el-table>
          <div v-if="!reconciliationTotal" class="form-help">沒有需要對帳的紀錄。</div>
        </template>
      </el-collapse-item>
    </el-collapse>

    <el-dialog
      v-model="dayDialogVisible"
      :title="dayForm.id ? '編輯日期' : '新增日期'"
      width="560px"
      class="form-dialog"
      data-test="calendar-day-dialog"
    >
      <el-form :model="dayForm" label-width="120px">
        <el-form-item label="日期" required>
          <el-date-picker
            v-model="dayForm.date"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY/MM/DD"
            style="width: 100%"
            data-test="calendar-day-date"
          />
        </el-form-item>
        <el-form-item label="類型" required>
          <el-select v-model="dayForm.kind" style="width: 100%" data-test="calendar-day-kind" @change="onDayKindChange">
            <el-option
              v-for="kind in HOLIDAY_KINDS"
              :key="kind"
              :label="HOLIDAY_KIND_LABELS[kind]"
              :value="kind"
            />
          </el-select>
          <div class="form-help">{{ HOLIDAY_KIND_DESCRIPTIONS[dayForm.kind] }}</div>
        </el-form-item>
        <el-form-item label="名稱" required>
          <el-input v-model="dayForm.name" maxlength="100" placeholder="例如：中秋節、院慶" data-test="calendar-day-name" />
        </el-form-item>
        <el-form-item v-if="dayForm.kind === 'gov_makeup_off'" label="補的國定假日">
          <el-date-picker
            v-model="dayForm.compensatesDate"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY/MM/DD"
            style="width: 100%"
            data-test="calendar-day-compensates"
          />
        </el-form-item>
        <el-form-item v-if="dayForm.kind === 'designated'" label="不適用的員工（例如沒有投票權）">
          <el-select
            v-model="dayForm.excludedEmployees"
            multiple
            filterable
            style="width: 100%"
            placeholder="選擇員工"
            data-test="calendar-day-excluded"
          >
            <el-option v-for="employee in employeeOptions" :key="employee.id" :label="employee.name" :value="employee.id" />
          </el-select>
          <div class="form-help">只適用當天原應出勤的員工，不補假、不可調移</div>
        </el-form-item>
        <el-form-item label="備註">
          <el-input v-model="dayForm.note" type="textarea" :rows="2" maxlength="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dayDialogVisible = false">取消</el-button>
          <el-button type="primary" data-test="calendar-day-save" @click="saveDay">儲存</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="diffDialogVisible"
      title="政府資料差異"
      width="880px"
      class="form-dialog"
      data-test="calendar-diff-dialog"
    >
      <template v-if="diff">
        <div class="diff-summary" data-test="calendar-diff-summary">
          {{ diff.year }} 年：新增 {{ diff.counts.add }}、變更 {{ diff.counts.change }}、刪除 {{ diff.counts.remove }}、相同 {{ diff.unchanged }}
          <template v-if="diff.counts.conflict">；其中 {{ diff.counts.conflict }} 筆是人資改過的資料（預設保留目前）</template>
        </div>
        <el-table :data="diff.changes" size="small" empty-text="和目前的行事曆相同，沒有需要套用的差異" class="diff-table">
          <el-table-column label="日期" width="140">
            <template #default="{ row }">{{ formatDateWithWeekday(row.date) }}</template>
          </el-table-column>
          <el-table-column label="類型" width="70">
            <template #default="{ row }">{{ DIFF_TYPE_LABELS[row.type] }}</template>
          </el-table-column>
          <el-table-column label="目前" min-width="170">
            <template #default="{ row }">{{ describeDiffSide(row.current) }}</template>
          </el-table-column>
          <el-table-column label="政府資料" min-width="170">
            <template #default="{ row }">{{ describeDiffSide(row.proposed) }}</template>
          </el-table-column>
          <el-table-column label="衝突" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.conflict" size="small" type="warning">HR 已修改</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="處理方式" min-width="200">
            <template #default="{ row }">
              <el-radio-group v-model="decisions[row.key]" size="small" :data-test="`calendar-diff-decision-${row.key}`">
                <el-radio value="accept">採用政府資料</el-radio>
                <el-radio value="keep">保留目前</el-radio>
              </el-radio-group>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <template #footer>
        <div class="dialog-footer">
          <el-button data-test="calendar-diff-reject" @click="rejectSnapshot">退回此版本</el-button>
          <el-button @click="diffDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="applying" data-test="calendar-diff-apply" @click="applyDiff">套用</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'
import {
  HOLIDAY_KINDS,
  HOLIDAY_KIND_DESCRIPTIONS,
  HOLIDAY_KIND_LABELS,
  HOLIDAY_KIND_TAG_TYPES
} from '../../constants/holidayCalendar'
import {
  DIFF_TYPE_LABELS,
  NOTICE_TYPE_LABELS,
  RECONCILIATION_PROBLEM_LABELS,
  buildDefaultDecisions,
  currentTaipeiYear,
  dayFlags,
  describeDayLink,
  describeDiffSide,
  describeKindCounts,
  formatDateKey,
  formatDateWithWeekday,
  formatTaipeiDateTime,
  lastErrorLabel,
  originLabel,
  readApiError,
  stateBannerText,
  stateBannerType,
  stateLabel,
  stateTagType,
  weekdayLabel
} from '../../utils/companyCalendar'

const emit = defineEmits(['years-loaded', 'calendar-changed'])

const years = ref([])
const notices = ref([])
const lastCheck = ref({})
const selectedYear = ref(currentTaipeiYear())
const days = ref([])
const showArchived = ref(false)
const checking = ref(false)
const fetching = ref(false)
const applying = ref(false)
const candidates = ref([])
const selectedCandidate = ref('')
const diff = ref(null)
const diffDialogVisible = ref(false)
const decisions = reactive({})
const reconciliation = ref(null)
const dayDialogVisible = ref(false)
const employeeOptions = ref([])
let employeeOptionsLoaded = false

const createDayForm = () => ({
  id: '',
  date: '',
  kind: 'company_off',
  name: '',
  compensatesDate: '',
  excludedEmployees: [],
  note: ''
})
const dayForm = ref(createDayForm())
const settingsForm = reactive({ followGovernmentAdjustments: false, reference: '', date: '', note: '' })

const currentItem = computed(() => (
  years.value.find((item) => item.year === selectedYear.value) || { year: selectedYear.value, state: 'none', counts: {}, needsReview: 0 }
))
const visibleDays = computed(() => days.value.filter((day) => showArchived.value || !day.archived))
const reconciliationTotal = computed(() => {
  const counts = reconciliation.value?.counts || {}
  return Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0)
})

async function readJson(res) {
  if (!res || typeof res.json !== 'function') return null
  return res.json().catch(() => null)
}

function syncSettingsForm() {
  const item = currentItem.value
  settingsForm.followGovernmentAdjustments = Boolean(item.followGovernmentAdjustments)
  settingsForm.reference = item.adjustmentAgreement?.reference || ''
  settingsForm.date = item.adjustmentAgreement?.date || ''
  settingsForm.note = item.adjustmentAgreement?.note || ''
}

async function loadYears() {
  const res = await apiFetch('/api/company-calendar/years')
  if (!res?.ok) return
  const data = await readJson(res)
  years.value = Array.isArray(data?.years) ? data.years : []
  notices.value = Array.isArray(data?.notices) ? data.notices : []
  lastCheck.value = data?.lastCheck || {}
  if (years.value.length && !years.value.some((item) => item.year === selectedYear.value)) {
    const current = currentTaipeiYear()
    selectedYear.value = years.value.some((item) => item.year === current) ? current : years.value[years.value.length - 1].year
  }
  syncSettingsForm()
  emit('years-loaded', years.value)
}

async function loadYearDetail() {
  const res = await apiFetch(`/api/company-calendar/years/${selectedYear.value}`)
  if (!res?.ok) {
    days.value = []
    return
  }
  const data = await readJson(res)
  days.value = Array.isArray(data?.days) ? data.days : []
}

async function refresh() {
  await loadYears()
  await loadYearDetail()
}

async function afterCalendarChange() {
  await refresh()
  if (reconciliation.value) await loadReconciliation()
  emit('calendar-changed')
}

function onYearChange() {
  candidates.value = []
  selectedCandidate.value = ''
  syncSettingsForm()
  loadYearDetail()
}

async function checkUpdates() {
  checking.value = true
  try {
    const res = await apiFetch('/api/company-calendar/check-updates', { method: 'POST' })
    if (!res?.ok) {
      const { message } = await readApiError(res, '檢查政府資料失敗')
      ElMessage.error(message)
      return
    }
    const data = await readJson(res)
    const created = Array.isArray(data?.notices) ? data.notices.length : 0
    if (data?.errors?.length) ElMessage.warning(`檢查完成，部分資料無法取得（${lastErrorLabel(data.errors[0])}）`)
    else ElMessage.success(created ? `檢查完成，有 ${created} 則新提醒` : '檢查完成，沒有新的政府資料')
  } catch (error) {
    ElMessage.error(`檢查政府資料失敗（${error?.message || '連線失敗'}）`)
  } finally {
    checking.value = false
    await loadYears()
  }
}

/** 下載政府資料：只有一份時回傳 { snapshotId, diff }；多份時列出讓人資選；失敗時顯示錯誤、不寫入任何資料 */
async function fetchCandidates(year) {
  fetching.value = true
  try {
    const res = await apiFetch(`/api/company-calendar/years/${year}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'auto' })
    })
    if (!res?.ok) {
      const { message } = await readApiError(res, '無法取得政府辦公日曆表，請稍後再試')
      ElMessage.error(`${message}（未寫入任何資料）`)
      return null
    }
    const data = await readJson(res)
    if (data?.conflict) {
      candidates.value = data.candidates || []
      selectedCandidate.value = (candidates.value.find((candidate) => candidate.recommended) || {}).snapshotId || ''
      ElMessage.warning('這個年度有多份政府辦公日曆表，請選擇要採用的版本')
      return null
    }
    candidates.value = []
    return data
  } catch (error) {
    ElMessage.error(`無法取得政府辦公日曆表，未寫入任何資料（${error?.message || '連線失敗'}）`)
    return null
  } finally {
    fetching.value = false
  }
}

async function fetchGovernment() {
  const data = await fetchCandidates(selectedYear.value)
  if (data?.diff) showDiff(data.diff)
}

async function createDraftFromGovernment() {
  const year = selectedYear.value
  const data = await fetchCandidates(year)
  if (!data?.selected) return
  await postApply(year, data.selected, buildDefaultDecisions(data.diff))
}

function showDiff(nextDiff) {
  diff.value = nextDiff
  Object.keys(decisions).forEach((key) => { delete decisions[key] })
  Object.assign(decisions, buildDefaultDecisions(nextDiff))
  diffDialogVisible.value = true
}

async function openSnapshotDiff(snapshotId) {
  if (!snapshotId) return
  const res = await apiFetch(`/api/company-calendar/snapshots/${snapshotId}/diff`)
  if (!res?.ok) {
    const { message } = await readApiError(res, '讀取差異失敗')
    ElMessage.error(message)
    return
  }
  const data = await readJson(res)
  if (data) showDiff(data)
}

async function openNoticeDiff(notice) {
  if (notice.year && notice.year !== selectedYear.value && years.value.some((item) => item.year === notice.year)) {
    selectedYear.value = notice.year
    onYearChange()
  }
  await openSnapshotDiff(notice.snapshotId)
}

async function postApply(year, snapshotId, decisionMap) {
  applying.value = true
  try {
    const res = await apiFetch(`/api/company-calendar/years/${year}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotId, decisions: decisionMap })
    })
    if (!res?.ok) {
      const { message } = await readApiError(res, '套用政府資料失敗')
      ElMessage.error(message)
      return false
    }
    const data = await readJson(res)
    const applied = data?.applied || {}
    ElMessage.success(`已套用：新增 ${applied.added || 0}、變更 ${applied.changed || 0}、刪除 ${applied.removed || 0}、保留 ${applied.kept || 0}`)
    candidates.value = []
    await afterCalendarChange()
    return true
  } finally {
    applying.value = false
  }
}

async function applyDiff() {
  if (!diff.value) return
  const ok = await postApply(diff.value.year, diff.value.snapshotId, { ...decisions })
  if (ok) diffDialogVisible.value = false
}

async function rejectSnapshot() {
  if (!diff.value) return
  const res = await apiFetch(`/api/company-calendar/years/${diff.value.year}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshotId: diff.value.snapshotId })
  })
  if (!res?.ok) {
    const { message } = await readApiError(res, '退回失敗')
    ElMessage.error(message)
    return
  }
  ElMessage.success('已退回這個版本，之後不會再提醒同一份資料')
  diffDialogVisible.value = false
  candidates.value = []
  await loadYears()
}

async function postApprove(acknowledgeWarnings) {
  return apiFetch(`/api/company-calendar/years/${selectedYear.value}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acknowledgeWarnings })
  })
}

async function confirmReviewRows(count) {
  try {
    await ElMessageBox.confirm(
      `還有 ${count} 筆待確認的日期（例如名稱不在法定假日清單、補假找不到對應的國定假日）。確定已檢查並要核定嗎？`,
      '確認核定',
      { confirmButtonText: '核定', cancelButtonText: '取消', type: 'warning' }
    )
    return true
  } catch {
    return false
  }
}

async function approveYear() {
  const reviewCount = Number(currentItem.value.needsReview || 0)
  let acknowledge = false
  if (reviewCount) {
    if (!(await confirmReviewRows(reviewCount))) return
    acknowledge = true
  }
  let res = await postApprove(acknowledge)
  if (!res?.ok) {
    const error = await readApiError(res, '核定失敗')
    if (error.code === 'NEEDS_REVIEW_ROWS' && !acknowledge) {
      if (!(await confirmReviewRows(error.count || 0))) return
      res = await postApprove(true)
      if (!res?.ok) {
        ElMessage.error((await readApiError(res, '核定失敗')).message)
        return
      }
    } else {
      ElMessage.error(error.message)
      return
    }
  }
  ElMessage.success(`${selectedYear.value} 年公司行事曆已核定`)
  await afterCalendarChange()
}

async function reopenYear() {
  const res = await apiFetch(`/api/company-calendar/years/${selectedYear.value}/reopen`, { method: 'POST' })
  if (!res?.ok) {
    ElMessage.error((await readApiError(res, '重新開啟失敗')).message)
    return
  }
  await afterCalendarChange()
}

async function saveSettings() {
  if (settingsForm.followGovernmentAdjustments && (!settingsForm.reference.trim() || !settingsForm.date)) {
    ElMessage.error('啟用「依政府調整放假」必須填寫協議文號與同意日期')
    return
  }
  const res = await apiFetch(`/api/company-calendar/years/${selectedYear.value}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      followGovernmentAdjustments: settingsForm.followGovernmentAdjustments,
      adjustmentAgreement: {
        reference: settingsForm.reference.trim(),
        date: settingsForm.date || null,
        note: settingsForm.note
      }
    })
  })
  if (!res?.ok) {
    ElMessage.error((await readApiError(res, '儲存年度設定失敗')).message)
    return
  }
  ElMessage.success('年度設定已儲存')
  await afterCalendarChange()
}

async function dismissNotice(notice) {
  const res = await apiFetch(`/api/company-calendar/notices/${notice.id}/dismiss`, { method: 'POST' })
  if (!res?.ok) {
    ElMessage.error('略過提醒失敗')
    return
  }
  notices.value = notices.value.filter((item) => item.id !== notice.id)
}

async function loadEmployeeOptions() {
  if (employeeOptionsLoaded) return
  const res = await apiFetch('/api/employees/options')
  if (!res?.ok) return
  const data = await readJson(res)
  employeeOptions.value = (Array.isArray(data) ? data : []).map((item) => ({ id: item.id ?? item._id, name: item.name || item.displayName || '' }))
  employeeOptionsLoaded = true
}

function onDayKindChange(kind) {
  if (kind === 'designated') loadEmployeeOptions()
}

function openDayDialog(row = null) {
  dayForm.value = row
    ? {
        id: row.id,
        date: row.date,
        kind: row.kind,
        name: row.name,
        compensatesDate: row.compensatesDate || '',
        excludedEmployees: [...(row.excludedEmployees || [])],
        note: row.note || ''
      }
    : { ...createDayForm(), date: `${selectedYear.value}-01-01` }
  if (dayForm.value.kind === 'designated') loadEmployeeOptions()
  dayDialogVisible.value = true
}

async function saveDay() {
  const form = dayForm.value
  if (!form.date || !form.kind || !String(form.name || '').trim()) {
    ElMessage.error('請填寫日期、類型與名稱')
    return
  }
  const payload = {
    date: form.date,
    kind: form.kind,
    name: String(form.name).trim(),
    note: form.note || '',
    compensatesDate: form.kind === 'gov_makeup_off' ? (form.compensatesDate || null) : null,
    excludedEmployees: form.kind === 'designated' ? form.excludedEmployees : []
  }
  const res = await apiFetch(form.id ? `/api/holidays/${form.id}` : '/api/holidays', {
    method: form.id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res?.ok) {
    ElMessage.error((await readApiError(res, '日期儲存失敗')).message)
    return
  }
  dayDialogVisible.value = false
  ElMessage.success('已儲存；這個年度需要重新核定')
  await afterCalendarChange()
}

async function deleteDay(row) {
  const res = await apiFetch(`/api/holidays/${row.id}`, { method: 'DELETE' })
  if (!res?.ok) {
    ElMessage.error((await readApiError(res, '刪除失敗')).message)
    return
  }
  await afterCalendarChange()
}

async function restoreDay(row) {
  const res = await apiFetch(`/api/holidays/${row.id}/restore`, { method: 'POST' })
  if (!res?.ok) {
    ElMessage.error((await readApiError(res, '復原失敗')).message)
    return
  }
  await afterCalendarChange()
}

// 確認「待確認」的日子：內容不變，所以不算人資修改，也不會讓已核定的年度回到草稿
async function confirmDay(row) {
  const res = await apiFetch(`/api/holidays/${row.id}/confirm`, { method: 'POST' })
  if (!res?.ok) {
    ElMessage.error((await readApiError(res, '確認失敗')).message)
    return
  }
  await afterCalendarChange()
}

async function loadReconciliation() {
  const res = await apiFetch('/api/company-calendar/reconciliation')
  if (!res?.ok) return
  const data = await readJson(res)
  if (data?.counts) reconciliation.value = data
}

function onReconciliationToggle(active) {
  const opened = Array.isArray(active) ? active.includes('report') : active === 'report'
  if (opened && !reconciliation.value) loadReconciliation()
}

onMounted(refresh)

defineExpose({
  years,
  days,
  notices,
  selectedYear,
  candidates,
  selectedCandidate,
  diff,
  decisions,
  diffDialogVisible,
  dayDialogVisible,
  dayForm,
  settingsForm,
  reconciliation,
  employeeOptions,
  refresh,
  checkUpdates,
  fetchGovernment,
  createDraftFromGovernment,
  openSnapshotDiff,
  openNoticeDiff,
  applyDiff,
  rejectSnapshot,
  approveYear,
  reopenYear,
  saveSettings,
  dismissNotice,
  openDayDialog,
  onDayKindChange,
  saveDay,
  deleteDay,
  restoreDay,
  confirmDay,
  loadReconciliation
})
</script>

<style scoped>
.company-calendar-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.calendar-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.year-select {
  width: 130px;
}

.last-check {
  font-size: 12px;
  color: #64748b;
}

.last-check-error {
  color: #b45309;
}

.banner-body {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
}

.banner-counts {
  font-size: 13px;
  color: #475569;
}

.calendar-notices,
.calendar-candidates,
.calendar-settings,
.calendar-legend {
  background: #f8fafc;
  border-radius: 8px;
  padding: 12px 16px;
}

.calendar-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.notice-message {
  flex: 1;
  font-size: 13px;
  color: #334155;
}

.candidates-title {
  font-size: 13px;
  margin-bottom: 8px;
  color: #334155;
}

.candidate-list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 8px;
}

.candidate-counts {
  color: #64748b;
  font-size: 12px;
  margin: 0 6px;
}

.calendar-legend {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 8px 16px;
}

.legend-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.legend-text {
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
}

.settings-row {
  margin-bottom: 4px;
}

.settings-agreement {
  display: grid;
  grid-template-columns: 1fr 180px 1fr;
  gap: 8px;
  margin: 8px 0;
}

.days-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.days-title {
  margin: 0;
  font-size: 16px;
  color: #1e293b;
}

.days-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.flag-tag {
  margin-right: 4px;
}

.reconciliation-counts {
  font-size: 12px;
  color: #64748b;
  margin-left: 6px;
}

.reconciliation-table {
  margin-top: 8px;
}

.diff-summary {
  font-size: 13px;
  color: #334155;
  margin-bottom: 8px;
}

.form-help {
  font-size: 12px;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.4;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

@media (max-width: 768px) {
  .settings-agreement {
    grid-template-columns: 1fr;
  }
}
</style>
