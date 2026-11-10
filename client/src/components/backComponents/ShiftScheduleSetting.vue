<!-- 排班表設定：行事曆設定、班別設定、全公司的國定假日挪移 -->
<template>
  <div class="shift-schedule-setting">
    <PageHeader title="排班表設定" subtitle="公司行事曆、班別，以及全公司的國定假日挪移">
      <template #stats>
        <span class="hr-stat">
          <span class="hr-stat__label">國定假日（今年）</span>
          <strong class="hr-stat__value" data-test="stat-statutory-this-year">{{ statutoryThisYear }}</strong>
        </span>
        <span class="hr-stat">
          <span class="hr-stat__label">班別</span>
          <strong class="hr-stat__value" data-test="stat-shift-count">{{ shiftList.length }}</strong>
        </span>
        <span class="hr-stat">
          <span class="hr-stat__label">假日挪移</span>
          <strong class="hr-stat__value" data-test="stat-move-count">{{ holidayMoveList.length }}</strong>
        </span>
      </template>
    </PageHeader>

    <el-tabs v-model="activeTab" class="schedule-tabs">
      <!-- 1) 年度行事曆 -->
      <el-tab-pane name="calendar" label="行事曆設定">
        <!-- 每年由政府辦公日曆表建立草稿，人資檢查後核定；公務機關補假只對行政人員生效 -->
        <CompanyCalendarPanel @years-loaded="onCalendarYearsLoaded" @calendar-changed="fetchMovableHolidays" />
      </el-tab-pane>

      <!-- 2) 班別 -->
      <el-tab-pane name="shift" label="班別設定">
        <div class="hr-toolbar">
          <span class="toolbar-note">左邊的色塊就是排班表格子顯示的樣子。</span>
          <span class="hr-toolbar__spacer" />
          <el-button type="primary" data-test="shift-add" @click="openShiftDialog()">新增班別</el-button>
        </div>

        <el-alert
          v-if="shiftLoadError"
          class="tab-alert"
          type="error"
          :closable="false"
          show-icon
          :title="shiftLoadError"
          data-test="shift-load-error"
        />
        <el-alert
          v-if="shiftIdentityConflicts.length"
          class="tab-alert"
          type="warning"
          :closable="false"
          show-icon
          title="重複的班別代碼或名稱不可用於公版班表匯入"
          :description="shiftIdentityConflictDescription"
        />

        <el-table
          v-loading="shiftLoading"
          :data="shiftList"
          class="data-table"
          data-test="shift-table"
          empty-text="尚未建立班別，請按右上角「新增班別」"
        >
          <el-table-column label="班別" min-width="200">
            <template #default="{ row }">
              <div class="shift-identity">
                <span class="shift-chip" :style="chipStyle(row)" data-test="shift-chip">{{ row.code }}</span>
                <span class="shift-name">{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="班別性質" width="120">
            <template #default="{ row }">
              <el-tag :type="semanticTagType(row)" size="small" class="semantic-tag" disable-transitions>
                {{ semanticLabel(row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="上下班時間" min-width="210">
            <template #default="{ row }">
              <span v-if="isNonWorkRow(row)" class="shift-not-applicable">—</span>
              <template v-else>
                <span class="time-range">{{ describeShiftTime(row) || `${row.startTime || '?'}–${row.endTime || '?'}` }}</span>
                <el-tag v-if="row.isNightShift" type="warning" size="small" class="inline-tag" disable-transitions>
                  夜班<template v-if="row.hasAllowance">・津貼 {{ row.fixedAllowanceAmount || 0 }} 元</template>
                </el-tag>
                <div v-if="isWorkShiftWithoutWorkingTime(row)" class="shift-type-warning">
                  工作班沒有工作時間，請編輯修正
                </div>
                <div v-else-if="crossDayFlagMismatch(row)" class="shift-type-warning" data-test="shift-crossday-mismatch">
                  「跨日」標記和時間不一致，請按編輯後重新儲存
                </div>
              </template>
            </template>
          </el-table-column>
          <el-table-column label="休息" min-width="170">
            <template #default="{ row }">
              <span v-if="isNonWorkRow(row)" class="muted">—</span>
              <template v-else>
                <span>{{ shiftBreakMinutes(row) }} 分鐘</span>
                <div v-if="formatBreakWindows(row)" class="break-window">{{ formatBreakWindows(row) }}</div>
              </template>
            </template>
          </el-table-column>
          <el-table-column label="工時" width="100">
            <template #default="{ row }">
              <span v-if="isNonWorkRow(row)" class="muted">—</span>
              <span v-else data-test="shift-work-hours">{{ workHoursLabel(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="備註" min-width="140" show-overflow-tooltip />
          <el-table-column label="操作" width="150" :fixed="actionColumnFixed">
            <template #default="{ row, $index }">
              <el-button size="small" data-test="shift-edit" @click="openShiftDialog($index)">編輯</el-button>
              <el-button
                size="small"
                type="danger"
                plain
                :loading="deletingShiftId === row._id"
                data-test="shift-delete"
                @click="deleteShift($index)"
              >
                刪除
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-dialog
          v-model="shiftDialogVisible"
          :title="shiftEditIndex === null ? '新增班別' : '編輯班別'"
          :width="dialogWidth(620)"
          class="form-dialog"
          :close-on-click-modal="false"
          :before-close="closeShiftDialog"
        >
          <el-form :model="shiftForm" label-width="110px" class="dialog-form" @submit.prevent>
            <el-form-item label="班別代碼" required>
              <el-input v-model="shiftForm.code" maxlength="40" placeholder="如：D、E、N" data-test="shift-code" />
              <div class="hr-hint">公版班表日期欄填寫此代碼；代碼是匯入識別鍵，不得與其他班別的代碼或名稱重複。</div>
            </el-form-item>
            <el-form-item label="班別名稱" required>
              <el-input v-model="shiftForm.name" maxlength="100" placeholder="如：早班、夜班" data-test="shift-name" />
            </el-form-item>
            <el-form-item label="班別性質" required>
              <el-select
                :model-value="shiftForm.semanticType"
                style="width: 100%"
                data-test="shift-semantic-select"
                @update:model-value="onSemanticTypeChange"
              >
                <el-option
                  v-for="option in semanticOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <div class="hr-hint">系統會依班別代碼／名稱自動判斷，也可以手動改選；休息日、例假、國定假日、請假不需上班，不計工時。</div>
            </el-form-item>

            <!-- 不需上班的班別沒有時間、休息與夜班設定（固定 00:00～00:00、休息 0 分鐘） -->
            <template v-if="!isNonWorkForm">
              <el-form-item label="上下班時間" required>
                <div class="time-row">
                  <el-time-picker
                    v-model="shiftForm.startTime"
                    :format="timeFormat"
                    :value-format="timeFormat"
                    placeholder="上班時間"
                    class="time-input"
                    style="width: 150px"
                    data-test="shift-start"
                  />
                  <span class="time-separator">–</span>
                  <el-time-picker
                    v-model="shiftForm.endTime"
                    :format="timeFormat"
                    :value-format="timeFormat"
                    placeholder="下班時間"
                    class="time-input"
                    style="width: 150px"
                    data-test="shift-end"
                  />
                </div>
                <!-- 下班早於上班一定跨日、晚於上班一定不跨日；只有上下班時間相同時需要管理者說明是不是 24 小時的班 -->
                <el-checkbox v-if="sameStartEnd" v-model="shiftForm.crossDay" data-test="shift-full-day">
                  這是 24 小時的班（隔天同一時間下班）
                </el-checkbox>
                <div v-if="workShiftTimeWarning" class="hr-hint hr-hint--warning" data-test="shift-work-time-warning">
                  {{ workShiftTimeWarning }}
                </div>
              </el-form-item>
              <el-form-item label="休息時長">
                <el-input-number v-model="shiftForm.breakDuration" :min="0" :max="1440" :step="15" data-test="shift-break-duration" />
                <span class="unit">分鐘</span>
                <div v-if="breakFromWindows" class="hr-hint hr-hint--warning" data-test="shift-break-from-windows">
                  已填休息時段：工時改以時段合計的 {{ formBreakMinutes }} 分鐘計算，不使用這個數字。
                </div>
              </el-form-item>
              <el-form-item label="休息時段">
                <div class="break-window-list">
                  <div v-for="(item, index) in shiftForm.breakWindows" :key="index" class="break-window-row">
                    <el-time-picker
                      v-model="item.start"
                      :format="timeFormat"
                      :value-format="timeFormat"
                      placeholder="開始"
                      class="break-time-input"
                      style="width: 116px"
                    />
                    <span class="time-separator">–</span>
                    <el-time-picker
                      v-model="item.end"
                      :format="timeFormat"
                      :value-format="timeFormat"
                      placeholder="結束"
                      class="break-time-input"
                      style="width: 116px"
                    />
                    <el-input v-model="item.label" placeholder="備註（如：午休）" class="break-label-input" />
                    <el-button type="danger" link @click="removeBreakWindow(index)">刪除</el-button>
                  </div>
                  <el-button link type="primary" data-test="shift-add-break" @click="addBreakWindow">新增休息時段</el-button>
                  <div class="hr-hint">選填。沒有填時段時，以「休息時長」從工時扣除。</div>
                </div>
              </el-form-item>
              <el-form-item label="計算結果">
                <div class="computed-summary" data-test="shift-computed-summary">{{ computedSummary }}</div>
                <ul v-if="timeProblems.length" class="problem-list" data-test="shift-time-problems">
                  <li v-for="problem in timeProblems" :key="problem">{{ problem }}</li>
                </ul>
              </el-form-item>
              <el-form-item label="夜班">
                <el-switch v-model="shiftForm.isNightShift" data-test="shift-night" @change="onNightShiftChange" />
                <span class="switch-note">標記為夜班，薪資計算夜班津貼時使用</span>
              </el-form-item>
              <el-form-item v-if="shiftForm.isNightShift" label="夜班津貼">
                <el-switch v-model="shiftForm.hasAllowance" data-test="shift-allowance" @change="onAllowanceChange" />
                <template v-if="shiftForm.hasAllowance">
                  <el-input-number
                    v-model="shiftForm.fixedAllowanceAmount"
                    :min="0"
                    :step="100"
                    :precision="0"
                    class="allowance-input"
                    data-test="shift-allowance-amount"
                  />
                  <span class="unit">元／每上一次夜班</span>
                </template>
              </el-form-item>
            </template>

            <el-form-item label="班表顏色">
              <div class="color-row">
                <span class="color-label">底色</span>
                <el-color-picker v-model="shiftForm.bgColor" :predefine="shiftBgPresets" color-format="hex" :show-alpha="false" />
                <span class="color-label">文字</span>
                <el-color-picker v-model="shiftForm.color" :predefine="shiftTextPresets" color-format="hex" :show-alpha="false" />
                <span class="shift-chip shift-chip--preview" :style="formChip.style" data-test="shift-color-preview">
                  {{ shiftForm.code || '代碼' }}
                </span>
              </div>
              <div v-if="formChip.lowContrast" class="hr-hint hr-hint--warning" data-test="shift-contrast-warning">
                文字和底色太接近，排班表上會看不清楚。
                <el-button link type="primary" data-test="shift-auto-text-color" @click="shiftForm.color = ''">改用自動文字顏色</el-button>
              </div>
              <div v-else class="hr-hint">沒有選顏色時由系統自動配色。</div>
            </el-form-item>
            <el-form-item label="備註">
              <el-input v-model="shiftForm.remark" type="textarea" :rows="2" maxlength="200" placeholder="班別說明或注意事項" />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="closeShiftDialog()">取消</el-button>
            <el-button type="primary" :loading="shiftSaving" data-test="shift-save" @click="saveShift">儲存</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>

      <!-- 3) 全公司的國定假日挪移 -->
      <el-tab-pane name="holiday-move" label="國定假日挪移">
        <div class="hr-toolbar">
          <span class="toolbar-note" data-test="holiday-move-hint">
            此處為全公司統一調移（可跨月）；個別員工的調移需本人同意，請在排班頁「國定假日休假」的「個人調移」登記。
          </span>
          <span class="hr-toolbar__spacer" />
          <el-button type="primary" data-test="holiday-move-add" @click="openHolidayMoveDialog()">新增挪移</el-button>
        </div>

        <el-table
          v-loading="holidayMoveLoading"
          :data="holidayMoveList"
          class="data-table"
          data-test="holiday-move-table"
          empty-text="尚未設定全公司的國定假日挪移；需要時請按右上角「新增挪移」"
        >
          <el-table-column label="原國定假日" min-width="200">
            <template #default="{ row }">{{ formatMoveDate(row.sourceDate) }} {{ holidayNameOf(row.sourceDate) }}</template>
          </el-table-column>
          <el-table-column label="改放這一天" width="160">
            <template #default="{ row }">{{ formatMoveDate(row.targetDate) }}</template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" min-width="200" show-overflow-tooltip />
          <el-table-column label="協議資料" min-width="220">
            <template #default="{ row }">
              <!-- 調移國定假日一律需要勞資會議（或工會）同意；舊資料沒有填的要補上 -->
              <el-tag v-if="!row.agreementReference || !row.agreementDate" type="warning" size="small" disable-transitions data-test="holiday-move-missing-agreement">
                缺少協議資料
              </el-tag>
              <span v-else class="agreement-info">{{ row.agreementReference }}（{{ toApiDate(row.agreementDate).replace(/-/g, '/') }}）</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" :fixed="actionColumnFixed">
            <template #default="{ row, $index }">
              <el-button size="small" data-test="holiday-move-edit" @click="openHolidayMoveDialog($index)">編輯</el-button>
              <el-button
                size="small"
                type="danger"
                plain
                :loading="deletingMoveId === row._id"
                data-test="holiday-move-delete"
                @click="deleteHolidayMove($index)"
              >
                刪除
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-dialog
          v-model="holidayMoveDialogVisible"
          :title="holidayMoveEditIndex === null ? '新增國定假日挪移' : '編輯國定假日挪移'"
          :width="dialogWidth(520)"
          class="form-dialog"
          :close-on-click-modal="false"
        >
          <el-form :model="holidayMoveForm" label-width="110px" class="dialog-form" @submit.prevent>
            <el-form-item label="原國定假日" required>
              <el-select
                v-model="holidayMoveForm.sourceDate"
                placeholder="選擇國定假日"
                filterable
                style="width: 100%"
                no-data-text="行事曆上沒有國定假日，請先到「行事曆設定」建立年度行事曆"
                data-test="holiday-move-source"
              >
                <el-option
                  v-for="holiday in movableHolidayOptions"
                  :key="holiday._id || holiday.date"
                  :label="`${formatMoveDate(holiday.date)} ${holiday.name || holiday.desc || ''}`"
                  :value="toApiDate(holiday.date)"
                />
              </el-select>
              <div class="hr-hint">只能選行事曆上的國定假日（公務機關補假、調整放假不是國定假日）。</div>
            </el-form-item>
            <el-form-item label="改放這一天" required>
              <el-date-picker
                v-model="holidayMoveForm.targetDate"
                type="date"
                value-format="YYYY-MM-DD"
                format="YYYY/MM/DD"
                style="width: 100%"
                data-test="holiday-move-target"
              />
            </el-form-item>
            <el-form-item label="同意文件編號" required>
              <el-input v-model="holidayMoveForm.agreementReference" maxlength="200" data-test="holiday-move-agreement-reference" />
              <div class="hr-hint">工會或勞資會議同意調移的文號。</div>
            </el-form-item>
            <el-form-item label="同意日期" required>
              <el-date-picker
                v-model="holidayMoveForm.agreementDate"
                type="date"
                value-format="YYYY-MM-DD"
                format="YYYY/MM/DD"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="原因">
              <el-input v-model="holidayMoveForm.reason" type="textarea" :rows="2" maxlength="500" show-word-limit />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="holidayMoveDialogVisible = false">取消</el-button>
            <el-button type="primary" :loading="holidayMoveSaving" data-test="holiday-move-save" @click="saveHolidayMove">儲存</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'
import { getToken } from '../../utils/tokenService'
import { currentTaipeiYear, statutoryCountOfYear } from '../../utils/companyCalendar'
import { describeShiftTime } from '../../utils/scheduleFormatting'
import {
  breakComesFromWindows,
  crossesMidnight,
  formatHours,
  resolveCrossDayFlag,
  shiftBreakMinutes,
  shiftChipAppearance,
  shiftSpanMinutes,
  shiftWorkMinutes,
  timeToMinutes,
  validateWorkShiftTimes
} from '../../utils/shiftTime'
import { useIsMobile } from '../../utils/useIsMobile'
import PageHeader from '../PageHeader.vue'
import CompanyCalendarPanel from './CompanyCalendarPanel.vue'
import {
  SHIFT_SEMANTIC_OPTIONS,
  SHIFT_SEMANTIC_LABELS,
  SHIFT_SEMANTIC_TAG_TYPES,
  NON_WORK_SHIFT_DEFAULTS,
  hasNoWorkingTime,
  inferShiftSemanticType,
  isNonWorkSemanticType,
  isWorkShiftWithoutWorkingTime,
  resolveShiftSemanticType
} from '../../utils/shiftSemantics'

const activeTab = ref('calendar')
const timeFormat = 'HH:mm'

// 手機上操作欄不固定在右側（固定欄會蓋住其他欄位，表格改成整個左右捲動）
const isMobile = useIsMobile()
const actionColumnFixed = computed(() => (isMobile.value ? false : 'right'))

// 對話框寬度：手機上不超出螢幕
// 手機寬度由共用樣式（page.css 的 .el-dialog 規則）限制，這裡只寫桌機寬度
const dialogWidth = (px) => `${px}px`

// =========== 1) 年度行事曆（CompanyCalendarPanel）與國定假日挪移 ===========
// 行事曆的新增、修改、核定都在 CompanyCalendarPanel；這裡只需要今年的國定假日數量與可挪移的國定假日
const calendarYears = ref([])
const movableHolidayOptions = ref([])
const holidayMoveList = ref([])
const holidayMoveLoading = ref(false)
const holidayMoveSaving = ref(false)
const deletingMoveId = ref('')
const holidayMoveDialogVisible = ref(false)
const holidayMoveEditIndex = ref(null)

const statutoryThisYear = computed(() => statutoryCountOfYear(calendarYears.value, currentTaipeiYear()))

// 伺服器對挪移的檢查訊息有些是英文，換成畫面上的說法
const HOLIDAY_MOVE_ERROR_MESSAGES = {
  'sourceDate must reference a statutory holiday': '原國定假日必須是行事曆上的國定假日',
  'targetDate is already a holiday': '改放的那一天已經是假日（國定假日、指定應放假日或公務機關補假），請改選其他日子',
  'targetDate must differ from sourceDate': '改放的日期不能和原國定假日同一天',
  'national holiday moves must stay within 366 days': '改放的日期不能和原國定假日相差超過一年',
  'labor agreement reference and date are required': '請填寫同意文件編號與同意日期',
  'sourceDate and targetDate must be provided together': '請選擇原國定假日與改放的日期',
  'sourceDate and targetDate must be valid dates': '日期格式不正確',
  'makeup holiday must be explicitly confirmed': '這筆舊資料勾選了「安排補班」但沒有確認，請聯絡系統管理員'
}

function holidayMoveErrorMessage(message, fallback) {
  const text = String(message || '')
  if (HOLIDAY_MOVE_ERROR_MESSAGES[text]) return HOLIDAY_MOVE_ERROR_MESSAGES[text]
  // 同一個國定假日只能有一筆全公司挪移（資料庫的唯一索引）
  if (/E11000|duplicate key/i.test(text)) return '這個國定假日已經設定過挪移，請直接編輯原本那一筆'
  return text || fallback
}

const createHolidayMoveForm = () => ({
  sourceDate: '',
  targetDate: '',
  reason: '',
  // 以下三個是舊欄位：調移一律需要協議資料（needSignature 固定為 true）；「安排補班」沒有任何功能讀取，
  // 畫面不再顯示，儲存時照原值送回，不會清掉舊資料
  needSignature: true,
  needMakeup: false,
  agreementReference: '',
  agreementDate: '',
  makeupConfirmed: false
})
const holidayMoveForm = ref(createHolidayMoveForm())

function toApiDate(value) {
  return String(value || '').slice(0, 10).replace(/\//g, '-')
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

// 'YYYY-MM-DD' -> 'YYYY/MM/DD（三）'；日期是台灣的日曆日，直接用字串算星期，不經過瀏覽器時區
function formatMoveDate(value) {
  const key = toApiDate(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key.replace(/-/g, '/')
  const weekday = new Date(`${key}T00:00:00.000Z`).getUTCDay()
  return `${key.replace(/-/g, '/')}（${WEEKDAY_LABELS[weekday]}）`
}

function holidayNameOf(dateKey) {
  const match = movableHolidayOptions.value.find((holiday) => holiday.date === toApiDate(dateKey))
  return match?.name || match?.desc || ''
}

function onCalendarYearsLoaded(years) {
  calendarYears.value = Array.isArray(years) ? years : []
}

// 原國定假日的選項：去年到明年行事曆上的國定假日（公務機關補假、調整放假不是國定假日，不能當成挪移來源）
async function fetchMovableHolidays() {
  const current = currentTaipeiYear()
  const results = await Promise.all([current - 1, current, current + 1].map(async (year) => {
    const res = await apiFetch(`/api/holidays?kind=statutory&year=${year}`)
    if (!res?.ok) return []
    const data = await res.json().catch(() => [])
    return Array.isArray(data) ? data : []
  }))
  movableHolidayOptions.value = results
    .flat()
    .map((item) => ({ ...item, date: toApiDate(item.date) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

async function fetchHolidayMoves() {
  holidayMoveLoading.value = true
  try {
    const res = await apiFetch('/api/holiday-move-settings')
    if (!res.ok) return
    const data = await res.json()
    holidayMoveList.value = (Array.isArray(data) ? data : [])
      .filter((item) => item.sourceDate && item.targetDate)
      .map((item) => ({
        ...item,
        sourceDate: toApiDate(item.sourceDate),
        targetDate: toApiDate(item.targetDate),
        agreementDate: item.agreementDate ? toApiDate(item.agreementDate) : ''
      }))
      .sort((a, b) => a.sourceDate.localeCompare(b.sourceDate))
  } finally {
    holidayMoveLoading.value = false
  }
}

function openHolidayMoveDialog(index = null) {
  holidayMoveEditIndex.value = index
  holidayMoveForm.value = index === null
    ? createHolidayMoveForm()
    : { ...createHolidayMoveForm(), ...holidayMoveList.value[index], needSignature: true }
  holidayMoveDialogVisible.value = true
}

async function saveHolidayMove() {
  if (holidayMoveSaving.value) return
  const sourceDate = toApiDate(holidayMoveForm.value.sourceDate)
  const targetDate = toApiDate(holidayMoveForm.value.targetDate)
  if (!sourceDate || !targetDate) {
    ElMessage.error('請選擇原國定假日與挪移日期')
    return
  }
  if (sourceDate === targetDate) {
    ElMessage.error(HOLIDAY_MOVE_ERROR_MESSAGES['targetDate must differ from sourceDate'])
    return
  }
  // 可以跨月（例如 2027-02-28 週日的和平紀念日改到 3/2），但一律要有勞資會議（或工會）同意的文件編號與日期
  const agreementReference = String(holidayMoveForm.value.agreementReference || '').trim()
  const agreementDate = toApiDate(holidayMoveForm.value.agreementDate)
  if (!agreementReference || !agreementDate) {
    ElMessage.error('請填寫同意文件編號與同意日期')
    return
  }

  const editing = holidayMoveEditIndex.value !== null
  const current = editing ? holidayMoveList.value[holidayMoveEditIndex.value] : null
  holidayMoveSaving.value = true
  try {
    const res = await apiFetch(
      editing ? `/api/holiday-move-settings/${current._id}` : '/api/holiday-move-settings',
      {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enableHolidayMove: true,
          sourceDate,
          targetDate,
          reason: holidayMoveForm.value.reason,
          needSignature: true,
          needMakeup: Boolean(holidayMoveForm.value.needMakeup),
          agreementReference,
          agreementDate,
          makeupConfirmed: Boolean(holidayMoveForm.value.makeupConfirmed)
        })
      }
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      ElMessage.error(holidayMoveErrorMessage(body.error, '國定假日挪移儲存失敗'))
      return
    }
    holidayMoveDialogVisible.value = false
    await fetchHolidayMoves()
    ElMessage.success('國定假日挪移已儲存')
  } catch (error) {
    ElMessage.error(`國定假日挪移儲存失敗（${error?.message || '連線失敗'}）`)
  } finally {
    holidayMoveSaving.value = false
  }
}

async function deleteHolidayMove(index) {
  const current = holidayMoveList.value[index]
  if (!current?._id || deletingMoveId.value) return
  try {
    await ElMessageBox.confirm(
      `確定刪除這筆挪移嗎？刪除後 ${formatMoveDate(current.sourceDate)} 恢復為國定假日，${formatMoveDate(current.targetDate)} 不再放假。`,
      '刪除國定假日挪移',
      { confirmButtonText: '刪除', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  deletingMoveId.value = current._id
  try {
    const res = await apiFetch(`/api/holiday-move-settings/${current._id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      ElMessage.error(holidayMoveErrorMessage(body.error, '國定假日挪移刪除失敗'))
      return
    }
    ElMessage.success('國定假日挪移已刪除')
    await fetchHolidayMoves()
  } catch (error) {
    ElMessage.error(`國定假日挪移刪除失敗（${error?.message || '連線失敗'}）`)
  } finally {
    deletingMoveId.value = ''
  }
}

// =========== 2) 班別管理 (排班用) ===========
const shiftList = ref([])
const shiftLoading = ref(false)
const shiftLoadError = ref('')
const shiftSaving = ref(false)
const deletingShiftId = ref('')
const shiftDialogVisible = ref(false)
const shiftEditIndex = ref(null)
// 開啟對話框當下的內容，用來判斷關閉時有沒有未儲存的變更
let shiftFormSnapshot = ''

const shiftIdentityConflicts = computed(() => {
  const owners = new Map()
  const conflicts = []
  for (const shift of shiftList.value) {
    for (const field of ['code', 'name']) {
      const value = String(shift?.[field] || '').trim()
      const key = normalizeShiftIdentifier(value)
      if (!key) continue
      const existing = owners.get(key)
      if (existing && existing.shift !== shift) {
        conflicts.push({ identifier: value, first: existing.shift, second: shift })
      } else {
        owners.set(key, { shift, field })
      }
    }
  }
  return conflicts
})

const shiftIdentityConflictDescription = computed(() => shiftIdentityConflicts.value
  .map(conflict => `「${conflict.identifier}」：${conflict.first.name || conflict.first.code}／${conflict.second.name || conflict.second.code}`)
  .join('；'))

const shiftBgPresets = [
  '#dbeafe',
  '#ede9fe',
  '#fef3c7',
  '#dcfce7',
  '#fee2e2',
  '#fce7f3',
  '#cffafe',
  '#fae8ff'
]

const shiftTextPresets = [
  '#0f172a',
  '#1e3a8a',
  '#047857',
  '#92400e',
  '#991b1b',
  '#9d174d',
  '#155e75',
  '#f8fafc'
]

const createEmptyShiftForm = () => ({
  name: '',
  code: '',
  semanticType: 'work',
  startTime: '',
  endTime: '',
  breakDuration: 60,
  breakWindows: [],
  crossDay: false,
  remark: '',
  color: '',
  bgColor: '',
  // 夜班津貼設定
  isNightShift: false,
  hasAllowance: false,
  fixedAllowanceAmount: 0
})

const shiftForm = ref(createEmptyShiftForm())

// 夜班與津貼的連動只在管理者自己切換開關時發生。
// 以前用 watch：開啟「夜班但沒有津貼」的班別編輯時，會因為表單內容換了而把津貼自動打開
function onNightShiftChange(enabled) {
  shiftForm.value.hasAllowance = Boolean(enabled)
  if (!enabled) shiftForm.value.fixedAllowanceAmount = 0
}

function onAllowanceChange(enabled) {
  if (!enabled) shiftForm.value.fixedAllowanceAmount = 0
}

const semanticOptions = SHIFT_SEMANTIC_OPTIONS
const WORK_DEFAULT_BREAK_MINUTES = 60

// 休息日、例假、國定假日、請假：不需上班，時間固定為 00:00-00:00、休息 0 分鐘
const isNonWorkForm = computed(() => isNonWorkSemanticType(shiftForm.value.semanticType))

const workShiftTimeWarning = computed(() => (
  isWorkShiftWithoutWorkingTime(shiftForm.value)
    ? '工作班的上班與下班時間相同，等於沒有工作時間，無法儲存。24 小時的班請勾選上方選項；休假、例假、國定假日或請假請改選班別性質。'
    : ''
))

const sameStartEnd = computed(() => {
  const start = timeToMinutes(shiftForm.value.startTime)
  return start !== null && start === timeToMinutes(shiftForm.value.endTime)
})

const breakFromWindows = computed(() => breakComesFromWindows(shiftForm.value))
const formBreakMinutes = computed(() => shiftBreakMinutes(shiftForm.value))
const timeProblems = computed(() => {
  if (isNonWorkForm.value) return []
  // 時間都還沒填時不急著列出問題，按儲存時才檢查
  if (!shiftForm.value.startTime && !shiftForm.value.endTime) return []
  return validateWorkShiftTimes(shiftForm.value)
})

// 「08:00–17:00，休息 60 分鐘，實際工時 8 小時」：和伺服器算工時的方式相同
const computedSummary = computed(() => {
  const form = shiftForm.value
  const span = shiftSpanMinutes(form)
  if (span === null) return '填好上下班時間後顯示工時'
  if (span === 0) return '上下班時間相同，沒有工作時間'
  const range = `${form.startTime}–${crossesMidnight(form) ? '次日 ' : ''}${form.endTime}`
  return `${range}，休息 ${shiftBreakMinutes(form)} 分鐘，實際工時 ${formatHours(shiftWorkMinutes(form))} 小時`
})

const formChip = computed(() => shiftChipAppearance(shiftForm.value))

// 班別性質預設依代碼／名稱推斷；管理者手動選過、或編輯既有班別之後，就不再自動改動
const semanticTouched = ref(false)

function applySemanticType(type) {
  const form = shiftForm.value
  if (isNonWorkSemanticType(type)) {
    Object.assign(form, NON_WORK_SHIFT_DEFAULTS, {
      breakWindows: [],
      isNightShift: false,
      hasAllowance: false,
      fixedAllowanceAmount: 0
    })
  } else if (hasNoWorkingTime(form)) {
    // 從不需上班的類型改回工作班：清掉自動帶入的 00:00-00:00，讓管理者填入真正的上下班時間
    form.startTime = ''
    form.endTime = ''
    form.breakDuration = WORK_DEFAULT_BREAK_MINUTES
  }
  form.semanticType = type
}

function onSemanticTypeChange(type) {
  semanticTouched.value = true
  applySemanticType(type)
}

watch(
  () => [shiftForm.value.code, shiftForm.value.name],
  ([code, name]) => {
    if (semanticTouched.value) return
    const inferred = inferShiftSemanticType({ code, name })
    if (inferred !== shiftForm.value.semanticType) applySemanticType(inferred)
  }
)

const isNonWorkRow = (row) => isNonWorkSemanticType(resolveShiftSemanticType(row))
const semanticLabel = (row) => SHIFT_SEMANTIC_LABELS[resolveShiftSemanticType(row)] || '工作班'
const semanticTagType = (row) => SHIFT_SEMANTIC_TAG_TYPES[resolveShiftSemanticType(row)] || 'info'
const chipStyle = (row) => shiftChipAppearance(row).style

function workHoursLabel(row) {
  const minutes = shiftWorkMinutes(row)
  return minutes === null ? '—' : `${formatHours(minutes)} 小時`
}

// 「跨日」旗標和時間對不上（22:00-06:00 沒勾，或 00:00-08:00 有勾）：夜班津貼與報表會算錯，提醒管理者重新儲存
function crossDayFlagMismatch(row) {
  if (timeToMinutes(row?.startTime) === null || timeToMinutes(row?.endTime) === null) return false
  return Boolean(row.crossDay) !== resolveCrossDayFlag(row)
}

async function fetchShifts() {
  shiftLoading.value = true
  try {
    const res = await apiFetch('/api/shifts', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      }
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      shiftLoadError.value = `讀取班別失敗${body?.error ? `：${body.error}` : ''}，請重新整理頁面`
      return
    }
    shiftLoadError.value = ''
    const data = await res.json()
    shiftList.value = Array.isArray(data?.shifts)
      ? data.shifts
      : Array.isArray(data)
        ? data
        : []
  } catch (error) {
    shiftLoadError.value = `讀取班別失敗（${error?.message || '連線失敗'}），請重新整理頁面`
  } finally {
    shiftLoading.value = false
  }
}

function openShiftDialog(index = null) {
  if (index !== null) {
    // 編輯：班別性質以已儲存的值為準（舊資料沒有值時依代碼／名稱推斷），不再自動改動
    shiftEditIndex.value = index
    semanticTouched.value = true
    const stored = shiftList.value[index]
    shiftForm.value = {
      ...createEmptyShiftForm(),
      ...stored,
      semanticType: resolveShiftSemanticType(stored)
    }
  } else {
    // 新增：班別性質先依代碼／名稱自動帶入，管理者手動選擇後即停止自動判斷
    shiftEditIndex.value = null
    semanticTouched.value = false
    shiftForm.value = createEmptyShiftForm()
  }
  // 每一筆休息時段複製一份，取消編輯時不會改到列表上的資料
  shiftForm.value.breakWindows = Array.isArray(shiftForm.value.breakWindows)
    ? shiftForm.value.breakWindows.map((item) => ({ start: item?.start || '', end: item?.end || '', label: item?.label || '' }))
    : []
  shiftFormSnapshot = JSON.stringify(shiftForm.value)
  shiftDialogVisible.value = true
}

// 關閉班別對話框（取消、右上角 X、Esc）：有未儲存的變更先確認
async function closeShiftDialog(done) {
  if (shiftSaving.value) return
  if (JSON.stringify(shiftForm.value) !== shiftFormSnapshot) {
    try {
      await ElMessageBox.confirm('班別內容尚未儲存，確定要關閉嗎？', '尚未儲存', {
        confirmButtonText: '不儲存並關閉',
        cancelButtonText: '繼續編輯',
        type: 'warning'
      })
    } catch {
      return
    }
  }
  if (typeof done === 'function') done()
  else shiftDialogVisible.value = false
}

function formatBreakWindows(shift) {
  if (!Array.isArray(shift.breakWindows) || !shift.breakWindows.length) return ''
  return shift.breakWindows
    .map((item) => {
      const range = [item.start, item.end].filter(Boolean).join('–')
      return item.label ? `${range}（${item.label}）` : range
    })
    .filter(Boolean)
    .join('、')
}

function addBreakWindow() {
  shiftForm.value.breakWindows.push({ start: '', end: '', label: '' })
}

function removeBreakWindow(index) {
  shiftForm.value.breakWindows.splice(index, 1)
}

function normalizeShiftIdentifier(value) {
  return String(value || '').trim().normalize('NFKC').toUpperCase()
}

function findLocalShiftConflict(candidate) {
  const currentId = shiftEditIndex.value === null
    ? ''
    : String(shiftList.value[shiftEditIndex.value]?._id || '')
  const candidateEntries = [
    { label: '班別代碼', value: String(candidate.code || '').trim() },
    { label: '班別名稱', value: String(candidate.name || '').trim() }
  ]

  for (const shift of shiftList.value) {
    if (currentId && String(shift?._id || '') === currentId) continue
    const existingEntries = [
      { label: '班別代碼', value: String(shift?.code || '').trim() },
      { label: '班別名稱', value: String(shift?.name || '').trim() }
    ]
    for (const candidateEntry of candidateEntries) {
      const normalized = normalizeShiftIdentifier(candidateEntry.value)
      if (!normalized) continue
      const matched = existingEntries.find(entry => normalizeShiftIdentifier(entry.value) === normalized)
      if (matched) {
        return `${candidateEntry.label}「${candidateEntry.value}」已由班別「${shift.name || shift.code}」作為${matched.label}使用`
      }
    }
  }
  return ''
}

async function saveShift() {
  if (shiftSaving.value) return
  shiftForm.value.code = String(shiftForm.value.code || '').trim()
  shiftForm.value.name = String(shiftForm.value.name || '').trim()
  if (!shiftForm.value.code || !shiftForm.value.name) {
    ElMessage.error('請填寫班別代碼與班別名稱')
    return
  }
  const localConflict = findLocalShiftConflict(shiftForm.value)
  if (localConflict) {
    ElMessage.error(localConflict)
    return
  }
  const form = shiftForm.value
  if (isNonWorkSemanticType(form.semanticType)) {
    // 不需上班的班別沒有工作時間；時間欄位還是空的就補上固定值
    if (!form.startTime || !form.endTime) Object.assign(form, NON_WORK_SHIFT_DEFAULTS)
  } else if (hasNoWorkingTime(form)) {
    ElMessage.error('工作班的上班與下班時間不可相同。若這是休假、例假、國定假日或請假，請改選班別性質。')
    return
  } else {
    const problems = validateWorkShiftTimes(form)
    if (problems.length) {
      ElMessage.error(problems[0])
      return
    }
    if (form.isNightShift && form.hasAllowance && !(Number(form.fixedAllowanceAmount) > 0)) {
      ElMessage.error('啟用夜班津貼時，固定津貼金額必須大於 0')
      return
    }
    // 「跨日」旗標由時間決定（只有上下班時間相同時才看管理者的勾選）
    form.crossDay = resolveCrossDayFlag(form)
  }
  const method = shiftEditIndex.value === null ? 'POST' : 'PUT'
  let url = '/api/shifts'
  if (method === 'PUT') {
    const id = shiftList.value[shiftEditIndex.value]._id
    url += `/${id}`
  }
  // 顏色選擇器清除後是 null，伺服器會把 null 當成「沒送」而保留舊顏色；改送空字串才清得掉
  const payload = {
    ...form,
    color: form.color || '',
    bgColor: form.bgColor || '',
    breakWindows: (form.breakWindows || []).filter((item) => item.start || item.end || String(item.label || '').trim())
  }
  shiftSaving.value = true
  try {
    const res = await apiFetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      ElMessage.error(body.error || '班別儲存失敗')
      return
    }
    await fetchShifts()
    shiftDialogVisible.value = false
    ElMessage.success('班別已儲存')
  } catch (error) {
    ElMessage.error(`班別儲存失敗（${error?.message || '連線失敗'}）`)
  } finally {
    shiftSaving.value = false
  }
}

// 小單位「使用班別」有勾選這個班別的單位名稱（讀不到時回傳空陣列，不擋刪除）
async function findUnitsUsingShift(shiftId) {
  try {
    const res = await apiFetch('/api/sub-departments')
    if (!res?.ok) return []
    const data = await res.json().catch(() => [])
    return (Array.isArray(data) ? data : [])
      .filter((unit) => Array.isArray(unit?.allowedShiftIds) && unit.allowedShiftIds.map(String).includes(String(shiftId)))
      .map((unit) => unit.name || unit.code || '')
      .filter(Boolean)
  } catch {
    return []
  }
}

async function deleteShift(index) {
  const shift = shiftList.value[index]
  if (!shift?._id || deletingShiftId.value) return
  deletingShiftId.value = shift._id
  try {
    const units = await findUnitsUsingShift(shift._id)
    const unitNote = units.length
      ? `小單位「${units.join('、')}」的「使用班別」有勾選這個班別，刪除後請到小單位設定重新選擇。`
      : ''
    try {
      await ElMessageBox.confirm(
        `確定刪除班別「${shift.name || shift.code}」嗎？已經排進班表的班別不能刪除。${unitNote}`,
        '刪除班別',
        { confirmButtonText: '刪除', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' }
      )
    } catch {
      return
    }
    const res = await apiFetch(`/api/shifts/${shift._id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      }
    })
    if (!res.ok) {
      // 還有班表在用時伺服器會回 409 與原因（幾筆班表、最近一筆的日期）
      const body = await res.json().catch(() => ({}))
      ElMessage.error({ message: body.error || '班別刪除失敗', duration: 6000 })
      return
    }
    ElMessage.success('班別已刪除')
    await fetchShifts()
  } catch (error) {
    ElMessage.error(`班別刪除失敗（${error?.message || '連線失敗'}）`)
  } finally {
    deletingShiftId.value = ''
  }
}

onMounted(() => {
  fetchMovableHolidays()
  fetchShifts()
  fetchHolidayMoves()
})
</script>

<style scoped>
.toolbar-note {
  font-size: 13px;
  color: var(--hr-gray-500);
}

.tab-alert {
  margin-bottom: var(--hr-space-sm);
}

.data-table {
  width: 100%;
}

/* 班別色塊：和排班表格子同一組顏色（底色、文字、邊框） */
.shift-identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.shift-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  max-width: 120px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--hr-gray-300);
  border-radius: var(--hr-radius-sm);
  font-size: 13px;
  font-weight: var(--hr-font-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shift-chip--preview {
  min-width: 72px;
  height: 32px;
}

.shift-name {
  font-weight: var(--hr-font-weight-medium);
  color: var(--hr-gray-800);
}

.time-range {
  font-variant-numeric: tabular-nums;
}

.inline-tag {
  margin-left: 8px;
}

.break-window {
  font-size: 12px;
  color: var(--hr-gray-500);
}

.muted,
.shift-not-applicable {
  color: var(--hr-gray-400);
}

.shift-type-warning {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.4;
  color: #b45309;
}

.agreement-info {
  font-size: 13px;
}

/* 對話框 */
.dialog-form {
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 8px;
}

.dialog-form .hr-hint {
  width: 100%;
}

.time-row,
.color-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.time-separator {
  color: var(--hr-gray-500);
}

.unit,
.switch-note,
.color-label {
  margin-left: 8px;
  font-size: 13px;
  color: var(--hr-gray-600);
}

.color-label {
  margin-left: 0;
}

.allowance-input {
  margin-left: 12px;
}

.break-window-list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
}

.break-window-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.break-label-input {
  width: 150px;
}

.computed-summary {
  font-weight: var(--hr-font-weight-medium);
  color: var(--hr-gray-800);
  font-variant-numeric: tabular-nums;
}

.problem-list {
  width: 100%;
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--hr-error);
}

@media (max-width: 767px) {
  .toolbar-note {
    flex-basis: 100%;
  }
}
</style>
