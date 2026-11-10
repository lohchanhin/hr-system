<!-- 行事曆設定：每年由政府辦公日曆表建立草稿，人資檢查後核定；重新匯入只顯示差異，不會覆蓋人資修改 -->
<template>
  <div class="company-calendar-panel">
    <!-- 這個年度的狀態與下一步 -->
    <section class="hr-section calendar-status" data-test="calendar-state-banner">
      <div class="status-row">
        <el-select
          :model-value="selectedYear"
          class="year-select"
          data-test="calendar-year-select"
          @change="onYearSelect"
        >
          <el-option
            v-for="item in years"
            :key="item.year"
            :label="`${item.year} 年`"
            :value="item.year"
          />
        </el-select>
        <el-tag :type="stateTagType(currentItem.state)" data-test="calendar-state-tag" disable-transitions>
          {{ stateLabel(currentItem.state) }}
        </el-tag>
        <span v-if="currentItem.state !== 'none'" class="status-counts">
          {{ describeKindCounts(currentItem.counts) || '沒有任何日期' }}
          <template v-if="currentItem.needsReview">；待確認 {{ currentItem.needsReview }} 筆</template>
        </span>
        <span class="hr-toolbar__spacer" />
        <el-button
          v-if="currentItem.state === 'none'"
          type="primary"
          :loading="fetching || applying"
          data-test="calendar-fetch-button"
          @click="createDraftFromGovernment"
        >
          從政府資料建立草稿
        </el-button>
        <template v-else>
          <el-button :loading="fetching" data-test="calendar-fetch-government" @click="fetchGovernment()">
            比對政府資料
          </el-button>
          <el-button
            v-if="currentItem.state === 'draft'"
            type="primary"
            :loading="approving"
            data-test="calendar-approve"
            @click="approveYear"
          >
            核定
          </el-button>
          <el-button
            v-if="currentItem.state === 'approved'"
            :loading="reopening"
            data-test="calendar-reopen"
            @click="reopenYear"
          >
            修改
          </el-button>
        </template>
      </div>
      <p class="status-text">{{ stateBannerText(currentItem) }}</p>
      <p class="last-check">
        <span data-test="calendar-last-check">
          <template v-if="lastCheck.lastCheckedAt">上次檢查：{{ formatTaipeiDateTime(lastCheck.lastCheckedAt) }}</template>
          <template v-else>尚未檢查政府資料</template>
          <span v-if="lastCheck.lastError" class="last-check-error">（{{ lastErrorLabel(lastCheck.lastError) }}）</span>
        </span>
        <el-button link type="primary" :loading="checking" data-test="calendar-check-updates" @click="checkUpdates">
          檢查政府有沒有新資料
        </el-button>
      </p>
    </section>

    <div v-if="notices.length" class="calendar-notices">
      <div
        v-for="notice in notices"
        :key="notice.id"
        class="calendar-notice"
        :data-test="`calendar-notice-${notice.type}`"
      >
        <el-tag size="small" type="warning" disable-transitions>{{ NOTICE_TYPE_LABELS[notice.type] || '提醒' }}</el-tag>
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
          <el-tag v-if="candidate.recommended" size="small" type="success" disable-transitions>建議</el-tag>
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

    <!-- 這個年度的特別日子 -->
    <section class="hr-section calendar-days">
      <div class="hr-toolbar">
        <h3 class="days-title">{{ selectedYear }} 年行事曆</h3>
        <!-- 類型同時是圖例與篩選：按一下只看那一種 -->
        <div v-if="kindChips.length" class="kind-chips" data-test="calendar-kind-chips">
          <button
            v-for="chip in kindChips"
            :key="chip.kind"
            type="button"
            class="kind-chip"
            :class="{ 'is-active': kindFilter === chip.kind, 'is-dimmed': kindFilter && kindFilter !== chip.kind }"
            :aria-pressed="kindFilter === chip.kind"
            :data-test="`calendar-kind-chip-${chip.kind}`"
            @click="toggleKindFilter(chip.kind)"
          >
            <el-tag :type="HOLIDAY_KIND_TAG_TYPES[chip.kind]" size="small" disable-transitions>{{ HOLIDAY_KIND_LABELS[chip.kind] }}</el-tag>
            <span class="kind-chip__count">{{ chip.count }}</span>
          </button>
        </div>
        <span class="hr-toolbar__spacer" />
        <el-switch v-model="showArchived" active-text="顯示已刪除" data-test="calendar-show-archived" />
        <el-button :disabled="readOnly" data-test="calendar-add-day" @click="openDayDialog()">新增日期</el-button>
      </div>
      <p v-if="readOnly" class="hr-hint read-only-hint" data-test="calendar-read-only-hint">
        已核定的年度只能檢視；要新增、編輯或刪除日期請先按上方的「修改」。
      </p>
      <el-table
        v-loading="daysLoading"
        :data="visibleDays"
        class="data-table"
        data-test="calendar-day-table"
        :empty-text="daysEmptyText"
        :row-class-name="dayRowClass"
      >
        <el-table-column label="日期" width="150">
          <template #default="{ row }">{{ formatDateWithWeekday(row.date) }}</template>
        </el-table-column>
        <el-table-column label="類型" width="150">
          <template #default="{ row }">
            <el-tag :type="HOLIDAY_KIND_TAG_TYPES[row.kind] || 'info'" size="small" disable-transitions>
              {{ HOLIDAY_KIND_LABELS[row.kind] || row.kind }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="名稱" min-width="220">
          <template #default="{ row }">
            <span>{{ row.name }}</span>
            <span v-if="describeDayLink(row)" class="day-link">{{ describeDayLink(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="來源" width="100">
          <template #default="{ row }">{{ originLabel(row.origin) }}</template>
        </el-table-column>
        <el-table-column label="標記" min-width="170">
          <template #default="{ row }">
            <el-tooltip v-for="flag in dayFlags(row)" :key="flag" :content="row.reviewNote || flag" placement="top">
              <el-tag size="small" :type="flag === '待確認' ? 'warning' : 'info'" class="flag-tag" disable-transitions>{{ flag }}</el-tag>
            </el-tooltip>
            <!-- 檢查過類型沒問題：只清掉「待確認」，內容不變 -->
            <el-button
              v-if="row.needsReview && !row.archived"
              link
              type="primary"
              size="small"
              :loading="busyDayId === row.id"
              data-test="calendar-day-confirm"
              @click="confirmDay(row)"
            >確認</el-button>
          </template>
        </el-table-column>
        <el-table-column v-if="!readOnly" label="操作" width="150" :fixed="actionColumnFixed">
          <template #default="{ row }">
            <template v-if="row.archived">
              <el-button size="small" :loading="busyDayId === row.id" data-test="calendar-day-restore" @click="restoreDay(row)">復原</el-button>
            </template>
            <template v-else>
              <el-button size="small" data-test="calendar-day-edit" @click="openDayDialog(row)">編輯</el-button>
              <el-button
                size="small"
                type="danger"
                plain
                :loading="busyDayId === row.id"
                data-test="calendar-day-delete"
                @click="deleteDay(row)"
              >刪除</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 說明、年度設定與對帳：需要時才展開 -->
    <el-collapse v-model="openPanels" class="calendar-extras" @change="onReconciliationToggle">
      <el-collapse-item name="legend" title="各類假日說明" data-test="calendar-kind-legend">
        <div class="calendar-legend">
          <div v-for="kind in HOLIDAY_KINDS" :key="kind" class="legend-item">
            <el-tag :type="HOLIDAY_KIND_TAG_TYPES[kind]" size="small" disable-transitions>{{ HOLIDAY_KIND_LABELS[kind] }}</el-tag>
            <span class="legend-text">{{ HOLIDAY_KIND_DESCRIPTIONS[kind] }}</span>
          </div>
        </div>
      </el-collapse-item>

      <el-collapse-item name="settings">
        <template #title>
          依政府調整放假
          <span class="collapse-note">（{{ currentItem.followGovernmentAdjustments ? '已啟用' : '未啟用' }}，只影響行政人員）</span>
        </template>
        <div class="calendar-settings" data-test="calendar-settings-follow">
          <el-switch
            v-model="settingsForm.followGovernmentAdjustments"
            :disabled="settingsLocked"
            data-test="calendar-follow-switch"
            active-text="依政府調整放假／補行上班（勞基法第 30 條第 3 項 8 週彈性工時）"
          />
          <div class="hr-hint">只影響行政人員；需工會或勞資會議同意並公告。輪班人員不受影響。</div>
          <div v-if="settingsForm.followGovernmentAdjustments" class="settings-agreement">
            <el-input
              v-model="settingsForm.reference"
              maxlength="200"
              placeholder="協議文號（必填）"
              :disabled="settingsLocked"
              data-test="calendar-agreement-reference"
            />
            <el-date-picker
              v-model="settingsForm.date"
              type="date"
              value-format="YYYY-MM-DD"
              format="YYYY/MM/DD"
              placeholder="同意日期（必填）"
              :disabled="settingsLocked"
              data-test="calendar-agreement-date"
            />
            <el-input v-model="settingsForm.note" maxlength="500" placeholder="備註" :disabled="settingsLocked" />
          </div>
          <div class="settings-actions">
            <el-button
              size="small"
              type="primary"
              :loading="savingSettings"
              :disabled="settingsLocked || !settingsDirty"
              data-test="calendar-settings-save"
              @click="saveSettings"
            >儲存</el-button>
            <span v-if="settingsLockedReason" class="hr-hint">{{ settingsLockedReason }}</span>
            <span v-else-if="settingsDirty" class="hr-hint hr-hint--warning" data-test="calendar-settings-dirty">尚未儲存</span>
          </div>
        </div>
      </el-collapse-item>

      <el-collapse-item name="report" data-test="calendar-reconciliation">
        <template #title>
          對帳報告
          <span v-if="reconciliation" class="collapse-note">
            （休假處理 {{ reconciliation.counts.resolutions }}、公司調移 {{ reconciliation.counts.moves }}、補假 {{ reconciliation.counts.compensations }}、個人調移 {{ reconciliation.counts.swaps }}）
          </span>
        </template>
        <div class="hr-hint">
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
          <div v-if="!reconciliationTotal" class="hr-hint">沒有需要對帳的紀錄。</div>
        </template>
      </el-collapse-item>
    </el-collapse>

    <el-dialog
      v-model="dayDialogVisible"
      :title="dayForm.id ? '編輯日期' : '新增日期'"
      :width="dialogWidth(560)"
      class="form-dialog"
      :close-on-click-modal="false"
      data-test="calendar-day-dialog"
    >
      <el-form :model="dayForm" label-width="120px" @submit.prevent>
        <el-form-item label="日期" required>
          <el-date-picker
            v-model="dayForm.date"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY/MM/DD"
            :default-value="dayPickerDefault"
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
          <div class="hr-hint">{{ HOLIDAY_KIND_DESCRIPTIONS[dayForm.kind] }}</div>
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
            :default-value="dayPickerDefault"
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
          <div class="hr-hint">只適用當天原應出勤的員工，不補假、不可調移</div>
        </el-form-item>
        <el-form-item label="備註">
          <el-input v-model="dayForm.note" type="textarea" :rows="2" maxlength="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dayDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingDay" data-test="calendar-day-save" @click="saveDay">儲存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="diffDialogVisible"
      title="政府資料差異"
      :width="dialogWidth(880)"
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
              <el-tag v-if="row.conflict" size="small" type="warning" disable-transitions>HR 已修改</el-tag>
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
        <p v-if="diff.changes?.length && currentItemOfDiff.state === 'approved'" class="hr-hint hr-hint--warning">
          套用後 {{ diff.year }} 年會回到草稿，需要重新核定。
        </p>
      </template>
      <template #footer>
        <el-button :disabled="applying" data-test="calendar-diff-reject" @click="rejectSnapshot">退回此版本</el-button>
        <el-button @click="diffDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="applying"
          :disabled="!diff?.changes?.length"
          data-test="calendar-diff-apply"
          @click="applyDiff"
        >套用</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'
import { useIsMobile } from '../../utils/useIsMobile'
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
  stateLabel,
  stateTagType
} from '../../utils/companyCalendar'

const emit = defineEmits(['years-loaded', 'calendar-changed'])

const years = ref([])
const notices = ref([])
const lastCheck = ref({})
const selectedYear = ref(currentTaipeiYear())
const days = ref([])
const daysLoading = ref(false)
const showArchived = ref(false)
const kindFilter = ref('')
const openPanels = ref([])
const checking = ref(false)
const fetching = ref(false)
const applying = ref(false)
const approving = ref(false)
const reopening = ref(false)
const savingDay = ref(false)
const savingSettings = ref(false)
const busyDayId = ref('')
const candidates = ref([])
const selectedCandidate = ref('')
const diff = ref(null)
const diffDialogVisible = ref(false)
const decisions = reactive({})
const reconciliation = ref(null)
const dayDialogVisible = ref(false)
const employeeOptions = ref([])
let employeeOptionsLoaded = false
// 切換年度很快時，晚回來的舊年度回應不可以蓋掉新年度的清單
let detailRequestId = 0
// 年度設定表單目前對應的年度（換年度時才重新帶入，重新整理清單不會蓋掉還沒儲存的修改）
let settingsYear = null

// 手機上操作欄不固定在右側（固定欄會蓋住其他欄位，表格改成整個左右捲動）
const isMobile = useIsMobile()
const actionColumnFixed = computed(() => (isMobile.value ? false : 'right'))

// 對話框寬度：手機上不超出螢幕
// 手機寬度由共用樣式（page.css 的 .el-dialog 規則）限制，這裡只寫桌機寬度
const dialogWidth = (px) => `${px}px`

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
// 已核定的年度只能檢視，按「修改」回到草稿後才能改（任何修改都會讓年度回到草稿，避免不小心取消核定）
const readOnly = computed(() => currentItem.value.state === 'approved')
const currentItemOfDiff = computed(() => (
  years.value.find((item) => item.year === diff.value?.year) || { state: 'none' }
))
const activeDays = computed(() => days.value.filter((day) => !day.archived))
const visibleDays = computed(() => days.value.filter((day) => (
  (showArchived.value || !day.archived) && (!kindFilter.value || day.kind === kindFilter.value)
)))
// 圖例兼篩選：只列這個年度實際有的類型與天數
const kindChips = computed(() => HOLIDAY_KINDS
  .map((kind) => ({ kind, count: activeDays.value.filter((day) => day.kind === kind).length }))
  .filter((chip) => chip.count > 0))
const daysEmptyText = computed(() => {
  if (kindFilter.value) return '這個年度沒有這種類型的日期'
  if (currentItem.value.state === 'none') return '這個年度還沒有任何日期；請按上方「從政府資料建立草稿」，或用「新增日期」自己建立'
  return '這個年度還沒有任何日期'
})
// 新增日期時，日期選擇器先翻到正在看的年度（不預先填入日期，避免沒注意就存成 1 月 1 日）
const dayPickerDefault = computed(() => new Date(selectedYear.value, 0, 1))
const reconciliationTotal = computed(() => {
  const counts = reconciliation.value?.counts || {}
  return Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0)
})

const settingsDirty = computed(() => {
  const item = currentItem.value
  return settingsForm.followGovernmentAdjustments !== Boolean(item.followGovernmentAdjustments)
    || settingsForm.reference !== (item.adjustmentAgreement?.reference || '')
    || (settingsForm.date || '') !== (item.adjustmentAgreement?.date || '')
    || settingsForm.note !== (item.adjustmentAgreement?.note || '')
})
const settingsLockedReason = computed(() => {
  if (currentItem.value.state === 'none') return '請先建立這個年度的行事曆'
  if (readOnly.value) return '已核定的年度請先按上方的「修改」'
  return ''
})
const settingsLocked = computed(() => Boolean(settingsLockedReason.value))

function dayRowClass({ row }) {
  return row.archived ? 'is-archived-day' : ''
}

function toggleKindFilter(kind) {
  kindFilter.value = kindFilter.value === kind ? '' : kind
}

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
  settingsYear = selectedYear.value
}

async function loadYears() {
  const res = await apiFetch('/api/company-calendar/years')
  if (!res?.ok) return
  const data = await readJson(res)
  // 讀取清單前還沒儲存的年度設定要保留（例如正在填協議文號時按了某一天的「確認」）
  const keepUnsavedSettings = settingsYear === selectedYear.value && settingsDirty.value
  years.value = Array.isArray(data?.years) ? data.years : []
  notices.value = Array.isArray(data?.notices) ? data.notices : []
  lastCheck.value = data?.lastCheck || {}
  if (years.value.length && !years.value.some((item) => item.year === selectedYear.value)) {
    const current = currentTaipeiYear()
    selectedYear.value = years.value.some((item) => item.year === current) ? current : years.value[years.value.length - 1].year
  }
  if (!keepUnsavedSettings || settingsYear !== selectedYear.value) syncSettingsForm()
  emit('years-loaded', years.value)
}

async function loadYearDetail() {
  const requestId = ++detailRequestId
  const year = selectedYear.value
  daysLoading.value = true
  try {
    const res = await apiFetch(`/api/company-calendar/years/${year}`)
    if (requestId !== detailRequestId) return
    if (!res?.ok) {
      days.value = []
      return
    }
    const data = await readJson(res)
    if (requestId !== detailRequestId) return
    days.value = Array.isArray(data?.days) ? data.days : []
  } finally {
    if (requestId === detailRequestId) daysLoading.value = false
  }
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
  kindFilter.value = ''
  days.value = []
  syncSettingsForm()
  loadYearDetail()
}

// 年度下拉選單：有還沒儲存的年度設定時先確認，取消就留在原年度
async function onYearSelect(year) {
  if (year === selectedYear.value) return
  if (settingsDirty.value) {
    try {
      await ElMessageBox.confirm(
        `${selectedYear.value} 年的「依政府調整放假」設定尚未儲存，切換年度會放棄這些變更。`,
        '尚未儲存',
        { confirmButtonText: '放棄變更並切換', cancelButtonText: '留在這個年度', type: 'warning' }
      )
    } catch {
      return
    }
  }
  selectedYear.value = year
  onYearChange()
}

async function checkUpdates() {
  if (checking.value) return
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
  if (fetching.value) return
  const data = await fetchCandidates(selectedYear.value)
  if (data?.diff) showDiff(data.diff)
}

async function createDraftFromGovernment() {
  if (fetching.value || applying.value) return
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
  if (applying.value) return false
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
  } catch (error) {
    ElMessage.error(`套用政府資料失敗（${error?.message || '連線失敗'}）`)
    return false
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

async function postApprove(year, acknowledgeWarnings) {
  return apiFetch(`/api/company-calendar/years/${year}/approve`, {
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
  if (approving.value) return
  // 核定的是按下按鈕當時選的年度：等確認視窗時就算切換了年度，也不會核定到別的年度
  const year = selectedYear.value
  const reviewCount = Number(currentItem.value.needsReview || 0)
  approving.value = true
  try {
    let acknowledge = false
    if (reviewCount) {
      if (!(await confirmReviewRows(reviewCount))) return
      acknowledge = true
    }
    let res = await postApprove(year, acknowledge)
    if (!res?.ok) {
      const error = await readApiError(res, '核定失敗')
      if (error.code === 'NEEDS_REVIEW_ROWS' && !acknowledge) {
        if (!(await confirmReviewRows(error.count || 0))) return
        res = await postApprove(year, true)
        if (!res?.ok) {
          ElMessage.error((await readApiError(res, '核定失敗')).message)
          return
        }
      } else {
        ElMessage.error(error.message)
        return
      }
    }
    ElMessage.success(`${year} 年公司行事曆已核定`)
    await afterCalendarChange()
  } catch (error) {
    ElMessage.error(`核定失敗（${error?.message || '連線失敗'}）`)
  } finally {
    approving.value = false
  }
}

async function reopenYear() {
  if (reopening.value) return
  const year = selectedYear.value
  try {
    await ElMessageBox.confirm(
      `修改後 ${year} 年會回到草稿：排班頁與請假單會顯示「尚未核定」，改完需要重新核定。`,
      `修改 ${year} 年行事曆`,
      { confirmButtonText: '開始修改', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  reopening.value = true
  try {
    const res = await apiFetch(`/api/company-calendar/years/${year}/reopen`, { method: 'POST' })
    if (!res?.ok) {
      ElMessage.error((await readApiError(res, '重新開啟失敗')).message)
      return
    }
    ElMessage.success(`${year} 年已回到草稿，修改完成後請重新核定`)
    await afterCalendarChange()
  } catch (error) {
    ElMessage.error(`重新開啟失敗（${error?.message || '連線失敗'}）`)
  } finally {
    reopening.value = false
  }
}

async function saveSettings() {
  if (savingSettings.value) return
  if (settingsForm.followGovernmentAdjustments && (!settingsForm.reference.trim() || !settingsForm.date)) {
    ElMessage.error('啟用「依政府調整放假」必須填寫協議文號與同意日期')
    return
  }
  const year = selectedYear.value
  savingSettings.value = true
  try {
    const res = await apiFetch(`/api/company-calendar/years/${year}/settings`, {
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
    // 已經存好了：讓重新讀取的內容覆蓋表單
    settingsYear = null
    await afterCalendarChange()
  } catch (error) {
    ElMessage.error(`儲存年度設定失敗（${error?.message || '連線失敗'}）`)
  } finally {
    savingSettings.value = false
  }
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
    : createDayForm()
  if (dayForm.value.kind === 'designated') loadEmployeeOptions()
  dayDialogVisible.value = true
}

async function saveDay() {
  if (savingDay.value) return
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
  savingDay.value = true
  try {
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
    // 存到別的年度時（例如在 2026 年的畫面新增 2027/01/01）切到那個年度，才看得到剛存的那一天
    const savedYear = Number(String(form.date).slice(0, 4))
    if (Number.isInteger(savedYear) && savedYear !== selectedYear.value) {
      selectedYear.value = savedYear
      kindFilter.value = ''
      ElMessage.success(`日期已儲存到 ${savedYear} 年行事曆`)
    } else {
      ElMessage.success('日期已儲存')
    }
    await afterCalendarChange()
  } catch (error) {
    ElMessage.error(`日期儲存失敗（${error?.message || '連線失敗'}）`)
  } finally {
    savingDay.value = false
  }
}

async function runDayAction(row, url, fallback, { method = 'POST', success = '' } = {}) {
  if (busyDayId.value) return
  busyDayId.value = row.id
  try {
    const res = await apiFetch(url, { method })
    if (!res?.ok) {
      ElMessage.error((await readApiError(res, fallback)).message)
      return
    }
    if (success) ElMessage.success(success)
    await afterCalendarChange()
  } catch (error) {
    ElMessage.error(`${fallback}（${error?.message || '連線失敗'}）`)
  } finally {
    busyDayId.value = ''
  }
}

async function deleteDay(row) {
  // 政府資料（含系統規則、舊版轉換）的日子刪除後留下「已刪除」紀錄，可以復原；手動新增的日子是直接刪掉
  const recoverable = row.origin && row.origin !== 'manual'
  const aftermath = recoverable ? '刪除後可以打開「顯示已刪除」復原。' : '這一天是手動新增的，刪除後無法復原。'
  try {
    await ElMessageBox.confirm(
      `確定刪除 ${formatDateWithWeekday(row.date)}「${row.name || HOLIDAY_KIND_LABELS[row.kind] || ''}」嗎？${aftermath}`,
      '刪除日期',
      { confirmButtonText: '刪除', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  await runDayAction(row, `/api/holidays/${row.id}`, '刪除失敗', { method: 'DELETE', success: '已刪除' })
}

async function restoreDay(row) {
  await runDayAction(row, `/api/holidays/${row.id}/restore`, '復原失敗', { success: '已復原' })
}

// 確認「待確認」的日子：內容不變，所以不算人資修改，也不會讓已核定的年度回到草稿
async function confirmDay(row) {
  await runDayAction(row, `/api/holidays/${row.id}/confirm`, '確認失敗')
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
  settingsDirty,
  kindFilter,
  readOnly,
  reconciliation,
  employeeOptions,
  refresh,
  onYearSelect,
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
  gap: var(--hr-space-md);
}

/* 這個面板自己用 gap 排版，不需要 .hr-section 之間預設的間距 */
.company-calendar-panel .hr-section + .hr-section {
  margin-top: 0;
}

.status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hr-space-sm);
}

.year-select {
  width: 130px;
}

.status-counts {
  font-size: 13px;
  color: var(--hr-gray-600);
}

.status-text {
  margin: var(--hr-space-sm) 0 0;
  font-size: var(--hr-font-size-sm);
  color: var(--hr-gray-800);
}

.last-check {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hr-space-sm);
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--hr-gray-500);
}

.last-check-error {
  color: #b45309;
}

.calendar-notices,
.calendar-candidates {
  padding: 12px 16px;
  border: 1px solid var(--hr-gray-200);
  border-radius: var(--hr-radius-md);
  background: var(--hr-gray-50);
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
  color: var(--hr-gray-700);
}

.candidates-title {
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--hr-gray-700);
}

.candidate-list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 8px;
}

.candidate-counts {
  margin: 0 6px;
  font-size: 12px;
  color: var(--hr-gray-500);
}

.days-title {
  margin: 0 var(--hr-space-sm) 0 0;
  font-size: var(--hr-font-size-base);
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-900);
}

.kind-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.kind-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 2px;
  border: 1px solid transparent;
  border-radius: var(--hr-radius-sm);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.kind-chip:hover,
.kind-chip.is-active {
  border-color: var(--hr-gray-300);
  background: var(--hr-gray-50);
}

.kind-chip.is-dimmed {
  opacity: 0.45;
}

.kind-chip__count {
  font-size: 13px;
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-700);
}

.read-only-hint {
  margin: 0 0 var(--hr-space-sm);
}

.data-table {
  width: 100%;
}

.data-table :deep(.is-archived-day) {
  color: var(--hr-gray-400);
}

.day-link {
  margin-left: 8px;
  font-size: 12px;
  color: var(--hr-gray-500);
}

.flag-tag {
  margin-right: 4px;
}

.calendar-extras {
  padding: 0 var(--hr-space-md);
  border: 1px solid var(--hr-gray-200);
  border-radius: var(--hr-radius-md);
  background: var(--hr-white);
}

.calendar-extras :deep(.el-collapse-item:last-child .el-collapse-item__header),
.calendar-extras :deep(.el-collapse-item:last-child .el-collapse-item__wrap) {
  border-bottom: none;
}

.collapse-note {
  margin-left: 6px;
  font-size: 12px;
  font-weight: var(--hr-font-weight-normal);
  color: var(--hr-gray-500);
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
  line-height: 1.5;
  color: var(--hr-gray-600);
}

.settings-agreement {
  display: grid;
  grid-template-columns: 1fr 180px 1fr;
  gap: 8px;
  margin: 8px 0;
}

.settings-actions {
  display: flex;
  align-items: center;
  gap: var(--hr-space-sm);
  margin-top: var(--hr-space-sm);
}

.settings-actions .hr-hint {
  margin-top: 0;
}

.reconciliation-table {
  margin-top: 8px;
}

.diff-summary {
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--hr-gray-700);
}

@media (max-width: 767px) {
  .settings-agreement {
    grid-template-columns: 1fr;
  }

  .calendar-legend {
    grid-template-columns: 1fr;
  }
}
</style>
