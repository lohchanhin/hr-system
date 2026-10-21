<!-- src/Components/backComponents/ShiftScheduleSetting.vue -->
<template>
  <div class="shift-schedule-setting">
    <!-- 添加現代化的頁面標題和統計信息 -->
    <div class="page-header">
      <div class="header-content">
        <h1 class="page-title">排班與班別管理設定</h1>
        <p class="page-description">管理班別時間、假日設定與國定假日挪移配置</p>
      </div>
      <div class="header-stats">
        <div class="stat-item">
          <div class="stat-number" data-test="stat-statutory-this-year">{{ statutoryThisYear }}</div>
          <div class="stat-label">國定假日（今年）</div>
        </div>
        <div class="stat-item">
          <div class="stat-number">{{ shiftList.length }}</div>
          <div class="stat-label">班別</div>
        </div>
        <div class="stat-item">
          <div class="stat-number">{{ holidayMoveList.length }}</div>
          <div class="stat-label">假日挪移</div>
        </div>
      </div>
    </div>

    <!-- 美化標籤頁設計，添加圖標和現代化樣式 -->
    <el-tabs v-model="activeTab" type="card" class="schedule-tabs">
      <!-- 1) 年度行事曆/休假日設定 -->
      <el-tab-pane name="calendar">
        <template #label>
          <div class="tab-label">
            <i class="el-icon-calendar"></i>
            <span>行事曆設定</span>
          </div>
        </template>
        
        <div class="tab-content">
          <!-- 每年由政府辦公日曆表建立草稿，人資檢查後核定；公務機關補假只對行政人員生效 -->
          <CompanyCalendarPanel @years-loaded="onCalendarYearsLoaded" @calendar-changed="fetchMovableHolidays" />
        </div>
      </el-tab-pane>

      <!-- 2) 班別管理 (針對排班) -->
      <el-tab-pane name="shift">
        <template #label>
          <div class="tab-label">
            <i class="el-icon-time"></i>
            <span>班別設定</span>
          </div>
        </template>
        
        <div class="tab-content">
          <div class="content-header">
            <h2 class="section-title">班別管理</h2>
            <el-button type="primary" @click="openShiftDialog()" class="add-btn">
              <i class="el-icon-plus"></i>
              新增班別
            </el-button>
          </div>

          <el-alert
            v-if="shiftIdentityConflicts.length"
            class="shift-conflict-alert"
            type="warning"
            :closable="false"
            show-icon
            title="重複的班別代碼或名稱不可用於公版班表匯入"
            :description="shiftIdentityConflictDescription"
          />
          
          <div class="table-container">
            <el-table 
              :data="shiftList" 
              class="data-table"
              :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
              :row-style="{ height: '56px' }"
            >
              <el-table-column prop="code" label="班別代碼（匯入）" width="180" show-overflow-tooltip>
                <template #default="{ row }">
                  <el-tag class="code-tag">{{ row.code }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="name" label="班別名稱" width="220" show-overflow-tooltip>
                <template #default="{ row }">
                  <div class="shift-info">
                    <div class="shift-icon">
                      <i class="el-icon-time"></i>
                    </div>
                    <div class="shift-name">{{ row.name }}</div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="班別性質" width="150">
                <template #default="{ row }">
                  <el-tag :type="semanticTagType(row)" size="small" class="semantic-tag">
                    {{ semanticLabel(row) }}
                  </el-tag>
                  <div v-if="isWorkShiftWithoutWorkingTime(row)" class="shift-type-warning">
                    ⚠ 工作班沒有工作時間
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="夜班" width="100">
                <template #default="{ row }">
                  <div v-if="row.isNightShift">
                    <el-tag type="warning" size="small">
                      🌙 夜班
                    </el-tag>
                    <div v-if="row.hasAllowance" style="font-size: 11px; color: #666; margin-top: 2px;">
                      固定 ${{ row.fixedAllowanceAmount || 0 }}
                    </div>
                  </div>
                  <span v-else-if="isNonWorkRow(row)" class="shift-not-applicable">—</span>
                  <el-tag v-else type="info" size="small">日班</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="工作時間" width="200">
                <template #default="{ row }">
                  <div class="time-range">
                    <span class="start-time">{{ row.startTime }}</span>
                    <i class="el-icon-right time-separator"></i>
                    <span class="end-time">{{ row.endTime }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="休息" min-width="220">
                <template #default="{ row }">
                  <div class="break-info">
                    <div class="break-duration">{{ formatBreakDuration(row) }}</div>
                    <div v-if="formatBreakWindows(row)" class="break-window">{{ formatBreakWindows(row) }}</div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="crossDay" label="跨日班" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.crossDay ? 'warning' : 'success'" size="small">
                    {{ row.crossDay ? '是' : '否' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="remark" label="備註" min-width="150" />
              <el-table-column label="操作" width="200" fixed="right">
                <template #default="{ row, $index }">
                  <div class="action-buttons">
                    <el-button type="primary" size="small" @click="openShiftDialog($index)" class="edit-btn">
                      <i class="el-icon-edit"></i>
                      編輯
                    </el-button>
                    <el-button type="danger" size="small" @click="deleteShift($index)" class="delete-btn">
                      <i class="el-icon-delete"></i>
                      刪除
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- 美化班別對話框 -->
          <el-dialog v-model="shiftDialogVisible" title="班別資料" width="500px" class="form-dialog">
            <el-form :model="shiftForm" label-width="120px" class="dialog-form">
              <el-form-item label="班別代碼" required>
                <el-input v-model="shiftForm.code" maxlength="40" placeholder="如：D、E、N" />
                <div class="form-help">公版班表日期欄填寫此代碼；代碼是匯入識別鍵，不得與其他班別的代碼或名稱重複。</div>
              </el-form-item>
              <el-form-item label="班別名稱" required>
                <el-input v-model="shiftForm.name" maxlength="100" placeholder="如：早班 / 夜班 / 彈性班" />
                <div class="form-help">顯示於班表及報表，名稱不得與其他班別的名稱或代碼重複。</div>
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
                <div class="form-help">
                  系統會依班別代碼／名稱自動判斷（休＝休息日、例＝例假、國＝國定假日、事／病／特／補／公等＝請假，其餘為工作班），也可手動改選。
                </div>
                <div class="form-help">
                  休息日、例假、國定假日、請假不需上班：上下班時間固定為 00:00～00:00、休息 0 分鐘，不計工時。
                </div>
                <div v-if="workShiftTimeWarning" class="form-help form-help--warning" data-test="shift-work-time-warning">
                  {{ workShiftTimeWarning }}
                </div>
              </el-form-item>
              <el-form-item label="上班時間" :required="!isNonWorkForm">
                <el-time-picker
                  v-model="shiftForm.startTime"
                  :format="timeFormat"
                  :value-format="timeFormat"
                  :disabled="isNonWorkForm"
                  placeholder="選擇上班時間"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="下班時間" :required="!isNonWorkForm">
                <el-time-picker
                  v-model="shiftForm.endTime"
                  :format="timeFormat"
                  :value-format="timeFormat"
                  :disabled="isNonWorkForm"
                  placeholder="選擇下班時間"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="休息時長(分鐘)">
                <el-input-number
                  v-model="shiftForm.breakDuration"
                  :min="0"
                  :step="15"
                  :disabled="isNonWorkForm"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="休息時段">
                <div class="break-window-list">
                  <div v-for="(item, index) in shiftForm.breakWindows" :key="index" class="break-window-row">
                    <el-time-picker
                      v-model="item.start"
                      :disabled="isNonWorkForm"
                      :format="timeFormat"
                      :value-format="timeFormat"
                      placeholder="開始"
                      style="width: 120px"
                    />
                    <span class="time-separator">~</span>
                    <el-time-picker
                      v-model="item.end"
                      :disabled="isNonWorkForm"
                      :format="timeFormat"
                      :value-format="timeFormat"
                      placeholder="結束"
                      style="width: 120px"
                    />
                    <el-input v-model="item.label" placeholder="備註" style="width: 140px" :disabled="isNonWorkForm" />
                    <el-button type="danger" link :disabled="isNonWorkForm" @click="removeBreakWindow(index)">
                      <i class="el-icon-delete"></i>
                    </el-button>
                  </div>
                  <el-button type="primary" link :disabled="isNonWorkForm" @click="addBreakWindow">新增時段</el-button>
                  <div class="form-help">若未填休息時段，將以「休息時長」扣除工時計算。</div>
                </div>
              </el-form-item>
              <el-form-item label="跨日班">
                <el-switch
                  v-model="shiftForm.crossDay"
                  :disabled="isNonWorkForm"
                  active-text="是"
                  inactive-text="否"
                  active-color="#10b981"
                />
              </el-form-item>
              <el-form-item label="是否為夜班">
                <el-switch
                  v-model="shiftForm.isNightShift"
                  :disabled="isNonWorkForm"
                  active-text="是"
                  inactive-text="否"
                  active-color="#10b981"
                />
                <div class="form-help">標記此班別為夜班，用於薪資計算和津貼發放</div>
              </el-form-item>
              <el-form-item label="是否有夜班津貼">
                <el-switch
                  v-model="shiftForm.hasAllowance"
                  :disabled="isNonWorkForm || !shiftForm.isNightShift"
                  active-text="是"
                  inactive-text="否"
                  active-color="#10b981"
                />
                <div class="form-help">啟用後設定固定夜班津貼金額</div>
              </el-form-item>
              <el-form-item label="固定津貼金額" v-if="shiftForm.hasAllowance && shiftForm.isNightShift">
                <el-input-number 
                  v-model="shiftForm.fixedAllowanceAmount" 
                  :min="0" 
                  :step="100"
                  :precision="0"
                  :disabled="!shiftForm.isNightShift || !shiftForm.hasAllowance"
                  style="width: 100%" 
                />
                <div class="form-help">
                  固定津貼：每次上夜班可獲得固定金額的津貼<br/>
                  例如設定 200 元，則每上一次夜班可得 200 元津貼
                </div>
              </el-form-item>
              <el-form-item label="班別底色">
                <el-color-picker
                  v-model="shiftForm.bgColor"
                  :predefine="shiftBgPresets"
                  color-format="hex"
                  :show-alpha="false"
                />
              </el-form-item>
              <el-form-item label="文字顏色">
                <el-color-picker
                  v-model="shiftForm.color"
                  :predefine="shiftTextPresets"
                  color-format="hex"
                  :show-alpha="false"
                />
              </el-form-item>
              <el-form-item label="顏色預覽">
                <div class="shift-color-preview" :style="shiftPreviewStyle">
                  {{ shiftForm.code || shiftForm.name || 'SHIFT' }}
                </div>
              </el-form-item>
              <el-form-item label="備註">
                <el-input
                  v-model="shiftForm.remark"
                  type="textarea"
                  :rows="3"
                  placeholder="班別說明或特殊注意事項"
                />
              </el-form-item>
            </el-form>
            <template #footer>
              <div class="dialog-footer">
                <el-button @click="shiftDialogVisible = false" class="cancel-btn">取消</el-button>
                <el-button type="primary" @click="saveShift" class="save-btn">
                  <i class="el-icon-check"></i>
                  儲存
                </el-button>
              </div>
            </template>
          </el-dialog>
        </div>
      </el-tab-pane>

      <el-tab-pane name="holiday-move">
        <template #label>
          <div class="tab-label">
            <i class="el-icon-switch"></i>
            <span>國定假日挪移</span>
          </div>
        </template>

        <div class="tab-content">
          <div class="content-header">
            <h2 class="section-title">國定假日挪移</h2>
            <el-button type="primary" class="add-btn" @click="openHolidayMoveDialog()">
              <i class="el-icon-plus"></i>
              新增挪移
            </el-button>
          </div>

          <el-alert
            class="holiday-move-hint"
            type="info"
            :closable="false"
            show-icon
            title="此處為全公司統一調移（可跨月）；個別員工的調移需本人同意，請在排班頁「國定假日休假」的「個人調移」登記。"
            data-test="holiday-move-hint"
          />

          <div class="table-container">
            <el-table
              :data="holidayMoveList"
              class="data-table"
              :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
              :row-style="{ height: '56px' }"
            >
              <el-table-column prop="sourceDate" label="原國定假日" width="170" />
              <el-table-column prop="targetDate" label="挪移日期" width="170" />
              <el-table-column prop="reason" label="原因" min-width="220" />
              <el-table-column label="協議資料" width="200">
                <template #default="{ row }">
                  <!-- 調移國定假日一律需要勞資會議（或工會）同意；舊資料沒有填的要補上 -->
                  <el-tag v-if="!row.agreementReference || !row.agreementDate" type="warning" data-test="holiday-move-missing-agreement">
                    缺少協議資料
                  </el-tag>
                  <span v-else class="agreement-info">{{ row.agreementReference }}（{{ toApiDate(row.agreementDate) }}）</span>
                </template>
              </el-table-column>
              <el-table-column label="需補班" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.needMakeup ? 'warning' : 'info'">
                    {{ row.needMakeup ? '是' : '否' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="200" fixed="right">
                <template #default="{ $index }">
                  <div class="action-buttons">
                    <el-button type="primary" size="small" class="edit-btn" @click="openHolidayMoveDialog($index)">
                      編輯
                    </el-button>
                    <el-button type="danger" size="small" class="delete-btn" @click="deleteHolidayMove($index)">
                      刪除
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <el-dialog v-model="holidayMoveDialogVisible" title="國定假日挪移" width="520px" class="form-dialog">
            <el-form :model="holidayMoveForm" label-width="120px" class="dialog-form">
              <el-form-item label="原國定假日" required>
                <el-select v-model="holidayMoveForm.sourceDate" placeholder="選擇國定假日" style="width: 100%" data-test="holiday-move-source">
                  <el-option
                    v-for="holiday in movableHolidayOptions"
                    :key="holiday._id || holiday.date"
                    :label="`${toApiDate(holiday.date).replace(/-/g, '/')} ${holiday.name || holiday.desc || ''}`"
                    :value="toApiDate(holiday.date)"
                  />
                </el-select>
                <div class="form-help">只能選擇行事曆上的國定假日（公務機關補假、調整放假不是國定假日）</div>
              </el-form-item>
              <el-form-item label="挪移日期" required>
                <el-date-picker
                  v-model="holidayMoveForm.targetDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  format="YYYY/MM/DD"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="原因">
                <el-input v-model="holidayMoveForm.reason" type="textarea" :rows="3" maxlength="500" show-word-limit />
              </el-form-item>
              <el-form-item label="需經簽核">
                <!-- 調移國定假日一律需要協議資料，固定為開啟 -->
                <el-switch :model-value="true" disabled data-test="holiday-move-need-signature" />
              </el-form-item>
              <el-form-item label="安排補班">
                <el-switch v-model="holidayMoveForm.needMakeup" />
              </el-form-item>
              <el-form-item label="同意文件編號" required>
                <el-input v-model="holidayMoveForm.agreementReference" maxlength="200" data-test="holiday-move-agreement-reference" />
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
              <el-form-item v-if="holidayMoveForm.needMakeup" label="補休日確認" required>
                <el-checkbox v-model="holidayMoveForm.makeupConfirmed">已確認調移後休假日期</el-checkbox>
              </el-form-item>
            </el-form>
            <template #footer>
              <div class="dialog-footer">
                <el-button @click="holidayMoveDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveHolidayMove">儲存</el-button>
              </div>
            </template>
          </el-dialog>
        </div>
      </el-tab-pane>

    </el-tabs>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { apiFetch } from '../../api'
import { getToken } from '../../utils/tokenService'
import { buildShiftStyle } from '../../utils/shiftColors'
import { currentTaipeiYear, statutoryCountOfYear } from '../../utils/companyCalendar'
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

// =========== 1) 年度行事曆（CompanyCalendarPanel）與國定假日挪移 ===========
// 行事曆的新增、修改、核定都在 CompanyCalendarPanel；這裡只需要今年的國定假日數量與可挪移的國定假日
const calendarYears = ref([])
const movableHolidayOptions = ref([])
const holidayMoveList = ref([])
const holidayMoveDialogVisible = ref(false)
let holidayMoveEditIndex = null

const statutoryThisYear = computed(() => statutoryCountOfYear(calendarYears.value, currentTaipeiYear()))

const createHolidayMoveForm = () => ({
  sourceDate: '',
  targetDate: '',
  reason: '',
  // 調移國定假日一律需要協議資料（保留欄位相容舊資料）
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
}

function openHolidayMoveDialog(index = null) {
  holidayMoveEditIndex = index
  holidayMoveForm.value = index === null
    ? createHolidayMoveForm()
    : { ...createHolidayMoveForm(), ...holidayMoveList.value[index], needSignature: true }
  holidayMoveDialogVisible.value = true
}

async function saveHolidayMove() {
  const sourceDate = toApiDate(holidayMoveForm.value.sourceDate)
  const targetDate = toApiDate(holidayMoveForm.value.targetDate)
  if (!sourceDate || !targetDate) {
    ElMessage.error('請選擇原國定假日與挪移日期')
    return
  }
  // 可以跨月（例如 2027-02-28 週日的和平紀念日改到 3/2），但一律要有勞資會議（或工會）同意的文件編號與日期
  const agreementReference = String(holidayMoveForm.value.agreementReference || '').trim()
  const agreementDate = toApiDate(holidayMoveForm.value.agreementDate)
  if (!agreementReference || !agreementDate) {
    ElMessage.error('請填寫同意文件編號與同意日期')
    return
  }

  const editing = holidayMoveEditIndex !== null
  const current = editing ? holidayMoveList.value[holidayMoveEditIndex] : null
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
    ElMessage.error(body.error || '國定假日挪移儲存失敗')
    return
  }
  holidayMoveDialogVisible.value = false
  await fetchHolidayMoves()
  ElMessage.success('國定假日挪移已儲存')
}

async function deleteHolidayMove(index) {
  const current = holidayMoveList.value[index]
  if (!current?._id) return
  const res = await apiFetch(`/api/holiday-move-settings/${current._id}`, { method: 'DELETE' })
  if (!res.ok) {
    ElMessage.error('國定假日挪移刪除失敗')
    return
  }
  await fetchHolidayMoves()
}

// =========== 2) 班別管理 (排班用) ===========
const shiftList = ref([])
const shiftDialogVisible = ref(false)
let shiftEditIndex = null

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

watch(
  () => shiftForm.value.isNightShift,
  (val) => {
    if (val) {
      shiftForm.value.hasAllowance = true
    } else {
      shiftForm.value.hasAllowance = false
      shiftForm.value.fixedAllowanceAmount = 0
    }
  }
)

watch(
  () => shiftForm.value.hasAllowance,
  (val) => {
    if (!val) {
      shiftForm.value.fixedAllowanceAmount = 0
    }
  }
)

const semanticOptions = SHIFT_SEMANTIC_OPTIONS
const WORK_DEFAULT_BREAK_MINUTES = 60

// 休息日、例假、國定假日、請假：不需上班，時間固定為 00:00-00:00、休息 0 分鐘
const isNonWorkForm = computed(() => isNonWorkSemanticType(shiftForm.value.semanticType))

const workShiftTimeWarning = computed(() => (
  isWorkShiftWithoutWorkingTime(shiftForm.value)
    ? '工作班的上班與下班時間相同（且未勾跨日），等於沒有工作時間，無法儲存。若這是休假、例假、國定假日或請假，請改選班別性質。'
    : ''
))

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

const shiftPreviewStyle = computed(() => {
  const style = buildShiftStyle(shiftForm.value)
  return {
    background: `linear-gradient(135deg, ${
      style['--shift-cell-bg-start'] ?? '#f1f5f9'
    } 0%, ${style['--shift-cell-bg-end'] ?? '#e2e8f0'} 100%)`,
    color: style['--shift-text-color'] ?? '#0f172a',
    borderColor: style['--shift-border-color'] ?? 'rgba(148, 163, 184, 0.45)'
  }
})

async function fetchShifts() {
  const res = await apiFetch('/api/shifts', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    }
  })
  if (res.ok) {
    const data = await res.json()
    shiftList.value = Array.isArray(data?.shifts)
      ? data.shifts
      : Array.isArray(data)
        ? data
        : []
  }
}
  
function openShiftDialog(index = null) {
  if (index !== null) {
    // 編輯：班別性質以已儲存的值為準（舊資料沒有值時依代碼／名稱推斷），不再自動改動
    shiftEditIndex = index
    semanticTouched.value = true
    const stored = shiftList.value[index]
    shiftForm.value = {
      ...createEmptyShiftForm(),
      ...stored,
      semanticType: resolveShiftSemanticType(stored)
    }
  } else {
    // 新增：班別性質先依代碼／名稱自動帶入，管理者手動選擇後即停止自動判斷
    shiftEditIndex = null
    semanticTouched.value = false
    shiftForm.value = createEmptyShiftForm()
  }
  if (!Array.isArray(shiftForm.value.breakWindows)) {
    shiftForm.value.breakWindows = []
  }
  shiftDialogVisible.value = true
}

function formatBreakDuration(shift) {
  if (shift.breakDuration != null) return `${shift.breakDuration} 分鐘`
  if (shift.breakMinutes != null) return `${shift.breakMinutes} 分鐘`
  if (shift.breakTime) return shift.breakTime
  return '未設定'
}

function formatBreakWindows(shift) {
  if (!Array.isArray(shift.breakWindows) || !shift.breakWindows.length) return ''
  return shift.breakWindows
    .map((item) => {
      const range = [item.start, item.end].filter(Boolean).join('~')
      return item.label ? `${range}（${item.label}）` : range
    })
    .filter(Boolean)
    .join('，')
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
  const currentId = shiftEditIndex === null
    ? ''
    : String(shiftList.value[shiftEditIndex]?._id || '')
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
  }
  const method = shiftEditIndex === null ? 'POST' : 'PUT'
  let url = '/api/shifts'
  if (method === 'PUT') {
    const id = shiftList.value[shiftEditIndex]._id
    url += `/${id}`
  }
  const res = await apiFetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    },
    body: JSON.stringify(shiftForm.value)
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    ElMessage.error(body.error || '班別儲存失敗')
    return
  }
  await fetchShifts()
  shiftDialogVisible.value = false
  ElMessage.success('班別已儲存')
}

async function deleteShift(index) {
  const id = shiftList.value[index]._id
  await apiFetch(`/api/shifts/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    }
  })
  await fetchShifts()
}
  
onMounted(() => {
  fetchMovableHolidays()
  fetchShifts()
  fetchHolidayMoves()
})
</script>

<style scoped>
.shift-schedule-setting {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0;
}

/* 頁面標題區域 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
  color: white;
  padding: 32px;
  border-radius: 16px;
  margin-bottom: 32px;
  box-shadow: 0 4px 20px rgba(22, 78, 99, 0.3);
}

.header-content h1.page-title {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px 0;
  letter-spacing: 0.5px;
}

.page-description {
  font-size: 16px;
  opacity: 0.9;
  margin: 0;
}

.header-stats {
  display: flex;
  gap: 32px;
}

.stat-item {
  text-align: center;
}

.stat-number {
  font-size: 32px;
  font-weight: 700;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 14px;
  opacity: 0.8;
}

/* 標籤頁樣式 */
.schedule-tabs {
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.tab-content {
  padding: 32px;
}

/* 內容標題 */
.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.header-actions {
  display: flex;
  gap: 8px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
  padding-left: 16px;
  border-left: 4px solid #10b981;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
}

/* 表格樣式 */
.table-container {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.data-table {
  width: 100%;
}

/* 日期信息 */
.date-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.holiday-tag {
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 4px;
}

/* 班別信息 */
.shift-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.shift-icon {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
}

.shift-name {
  font-weight: 600;
  color: #1e293b;
}

.time-range {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Courier New', monospace;
  font-weight: 500;
}

.break-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #334155;
}

.break-duration {
  font-weight: 600;
}

.break-window-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.break-window-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.start-time {
  color: #10b981;
}

.end-time {
  color: #f59e0b;
}

.time-separator {
  color: #64748b;
}

.code-tag {
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 4px;
  background: #e2e8f0;
  color: #475569;
}

.shift-color-preview {
  min-width: 140px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* 操作按鈕 */
.action-buttons {
  display: flex;
  gap: 8px;
}

.edit-btn, .delete-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 6px;
  font-size: 12px;
}

/* 設定卡片 */
.settings-card {
  background: white;
  border-radius: 12px;
  padding: 32px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.settings-form {
  max-width: 800px;
}

.form-group {
  background: #f8fafc;
  padding: 24px;
  border-radius: 8px;
  margin-bottom: 24px;
}

.form-help {
  font-size: 12px;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.4;
}

.form-help--warning {
  color: #b45309;
}

.shift-not-applicable {
  color: #94a3b8;
}

.shift-type-warning {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.4;
  color: #b45309;
}

.shift-conflict-alert {
  margin-bottom: 16px;
}

.holiday-move-hint {
  margin-bottom: 16px;
}

.save-settings-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 32px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 16px;
}

/* 對話框樣式 */
.form-dialog .el-dialog__body {
  padding: 24px 32px;
}

.dialog-form {
  max-height: 60vh;
  overflow-y: auto;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
}

.cancel-btn {
  padding: 10px 20px;
  border-radius: 8px;
}

.save-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
}

/* 響應式設計 */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    text-align: center;
    gap: 20px;
  }
  
  .header-stats {
    gap: 20px;
  }
  
  .content-header {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }
  
  .tab-content {
    padding: 16px;
  }
  
  .settings-card {
    padding: 20px;
  }
}

@media (max-width: 480px) {
  .action-buttons {
    flex-direction: column;
    gap: 4px;
  }
  
  .stat-number {
    font-size: 24px;
  }
  
  .time-range {
    flex-direction: column;
    gap: 4px;
  }
}
</style>
