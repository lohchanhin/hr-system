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
          <div class="stat-number">{{ holidayList.length }}</div>
          <div class="stat-label">假日</div>
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
           <div class="content-header">
            <h2 class="section-title">假日管理</h2>
            <div class="header-actions">
              <el-button type="primary" @click="openCalendarDialog()" class="add-btn">
              <i class="el-icon-plus"></i>
              新增假日
              </el-button>
              <el-button plain size="small" @click="loadRocHolidays" :loading="loadingHolidays">
                一鍵載入當年國定假日
              </el-button>
            </div>
          </div>
          
          <div class="table-container">
            <el-table 
              :data="holidayList" 
              class="data-table"
              :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
              :row-style="{ height: '56px' }"
            >
              <el-table-column prop="date" label="日期" width="160">
                <template #default="{ row }">
                  <div class="date-info">
                    <i class="el-icon-date"></i>
                    {{ row.date }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="type" label="假日類型" width="140">
                <template #default="{ row }">
                  <el-tag :type="getHolidayTagType(row.type)" class="holiday-tag">
                    {{ row.type }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="desc" label="描述" min-width="200" />
              <el-table-column label="操作" width="200" fixed="right">
                <template #default="{ row, $index }">
                  <div class="action-buttons">
                    <el-button type="primary" size="small" @click="openCalendarDialog($index)" class="edit-btn">
                      <i class="el-icon-edit"></i>
                      編輯
                    </el-button>
                    <el-button type="danger" size="small" @click="deleteHoliday($index)" class="delete-btn">
                      <i class="el-icon-delete"></i>
                      刪除
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- 美化假日對話框 -->
          <el-dialog v-model="calendarDialogVisible" title="假日資料" width="500px" class="form-dialog">
            <el-form :model="calendarForm" label-width="120px" class="dialog-form">
              <el-form-item label="日期" required>
                <el-date-picker
                  v-model="calendarForm.date"
                  type="date"
                  placeholder="選擇日期"
                  :format="dateFormat"
                  :value-format="dateFormat"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="假日類型" required>
                <el-select v-model="calendarForm.type" placeholder="選擇類型" style="width: 100%">
                  <el-option label="國定假日" value="國定假日" />
                  <el-option label="例假日" value="例假日" />
                  <el-option label="公司休息日" value="公司休息日" />
                  <el-option label="補班日" value="補班日" />
                </el-select>
              </el-form-item>
              <el-form-item label="描述">
                <el-input 
                  v-model="calendarForm.desc" 
                  placeholder="例如：中秋節 / 週休 等"
                  type="textarea"
                  :rows="3"
                />
              </el-form-item>
            </el-form>
            <template #footer>
              <div class="dialog-footer">
                <el-button @click="calendarDialogVisible = false" class="cancel-btn">取消</el-button>
                <el-button type="primary" @click="saveHoliday" class="save-btn">
                  <i class="el-icon-check"></i>
                  儲存
                </el-button>
              </div>
            </template>
          </el-dialog>
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
                <el-select v-model="shiftForm.semanticType" style="width: 100%">
                  <el-option label="工作班" value="work" />
                  <el-option label="休息日" value="rest_day" />
                  <el-option label="例假" value="regular_rest" />
                  <el-option label="國定假日" value="holiday" />
                  <el-option label="請假" value="leave" />
                </el-select>
              </el-form-item>
              <el-form-item label="上班時間" required>
                <el-time-picker
                  v-model="shiftForm.startTime"
                  :format="timeFormat"
                  :value-format="timeFormat"
                  placeholder="選擇上班時間"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="下班時間" required>
                <el-time-picker
                  v-model="shiftForm.endTime"
                  :format="timeFormat"
                  :value-format="timeFormat"
                  placeholder="選擇下班時間"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="休息時長(分鐘)">
                <el-input-number v-model="shiftForm.breakDuration" :min="0" :step="15" style="width: 100%" />
              </el-form-item>
              <el-form-item label="休息時段">
                <div class="break-window-list">
                  <div v-for="(item, index) in shiftForm.breakWindows" :key="index" class="break-window-row">
                    <el-time-picker
                      v-model="item.start"
                      :format="timeFormat"
                      :value-format="timeFormat"
                      placeholder="開始"
                      style="width: 120px"
                    />
                    <span class="time-separator">~</span>
                    <el-time-picker
                      v-model="item.end"
                      :format="timeFormat"
                      :value-format="timeFormat"
                      placeholder="結束"
                      style="width: 120px"
                    />
                    <el-input v-model="item.label" placeholder="備註" style="width: 140px" />
                    <el-button type="danger" link @click="removeBreakWindow(index)">
                      <i class="el-icon-delete"></i>
                    </el-button>
                  </div>
                  <el-button type="primary" link @click="addBreakWindow">新增時段</el-button>
                  <div class="form-help">若未填休息時段，將以「休息時長」扣除工時計算。</div>
                </div>
              </el-form-item>
              <el-form-item label="跨日班">
                <el-switch
                  v-model="shiftForm.crossDay"
                  active-text="是"
                  inactive-text="否"
                  active-color="#10b981"
                />
              </el-form-item>
              <el-form-item label="是否為夜班">
                <el-switch
                  v-model="shiftForm.isNightShift"
                  active-text="是"
                  inactive-text="否"
                  active-color="#10b981"
                />
                <div class="form-help">標記此班別為夜班，用於薪資計算和津貼發放</div>
              </el-form-item>
              <el-form-item label="是否有夜班津貼">
                <el-switch
                  v-model="shiftForm.hasAllowance"
                  :disabled="!shiftForm.isNightShift"
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
              <el-table-column label="需簽核" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.needSignature ? 'warning' : 'info'">
                    {{ row.needSignature ? '是' : '否' }}
                  </el-tag>
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
                <el-select v-model="holidayMoveForm.sourceDate" placeholder="選擇國定假日" style="width: 100%">
                  <el-option
                    v-for="holiday in movableHolidayOptions"
                    :key="holiday._id || `${holiday.date}-${holiday.desc}`"
                    :label="`${holiday.date} ${holiday.desc || holiday.name || ''}`"
                    :value="toApiDate(holiday.date)"
                  />
                </el-select>
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
                <el-switch v-model="holidayMoveForm.needSignature" />
              </el-form-item>
              <el-form-item label="安排補班">
                <el-switch v-model="holidayMoveForm.needMakeup" />
              </el-form-item>
              <el-form-item v-if="holidayMoveForm.needSignature" label="同意文件編號" required>
                <el-input v-model="holidayMoveForm.agreementReference" maxlength="200" />
              </el-form-item>
              <el-form-item v-if="holidayMoveForm.needSignature" label="同意日期" required>
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

const activeTab = ref('calendar')
const dateFormat = 'YYYY/MM/DD'
const timeFormat = 'HH:mm'

// =========== 1) 年度行事曆/休假日設定 ===========
const holidayList = ref([])
const calendarDialogVisible = ref(false)
let calendarEditIndex = null
const loadingHolidays = ref(false)
const holidayMoveList = ref([])
const holidayMoveDialogVisible = ref(false)
let holidayMoveEditIndex = null

const calendarForm = ref({
  name: '',
  date: '',
  type: '',
  desc: ''
})

const createHolidayMoveForm = () => ({
  sourceDate: '',
  targetDate: '',
  reason: '',
  needSignature: false,
  needMakeup: false,
  agreementReference: '',
  agreementDate: '',
  makeupConfirmed: false
})
const holidayMoveForm = ref(createHolidayMoveForm())

const movableHolidayOptions = computed(() => (
  holidayList.value.filter((holiday) => (
    String(holiday.type || '').includes('國定假日')
  ))
))

function toApiDate(value) {
  return String(value || '').slice(0, 10).replace(/\//g, '-')
}

function formatHolidayDate(value) {
  if (!value) return ''
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return ''
  const year = dt.getFullYear()
  const month = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

async function fetchHolidays() {
  const res = await apiFetch('/api/holidays', {
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (res.ok) {
    const data = await res.json()
    holidayList.value = Array.isArray(data)
      ? data.map((item) => ({
          ...item,
          type: item.type || item.holidayCategory || '國定假日',
          desc: item.desc ?? item.description ?? item.name ?? '',
          date: formatHolidayDate(item.date)
        }))
      : []
  }
}
  
function openCalendarDialog(index = null) {
  if (index !== null) {
    // 編輯模式
    calendarEditIndex = index
    calendarForm.value = { ...holidayList.value[index] }
  } else {
    // 新增模式
    calendarEditIndex = null
    calendarForm.value = { name: '', date: '', type: '', desc: '' }
  }
  calendarDialogVisible.value = true
}
  
async function saveHoliday() {
  const method = calendarEditIndex === null ? 'POST' : 'PUT'
  let url = '/api/holidays'
  if (method === 'PUT') {
    const id = holidayList.value[calendarEditIndex]._id
    url += `/${id}`
  }
  const payload = {
    ...calendarForm.value,
    description: calendarForm.value.desc,
    type: calendarForm.value.type || '國定假日'
  }
  if (payload.date?.includes('/')) {
    payload.date = payload.date.replace(/\//g, '-')
  }
  await apiFetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  await fetchHolidays()
  calendarDialogVisible.value = false
}

async function deleteHoliday(index) {
  const id = holidayList.value[index]._id
  await apiFetch(`/api/holidays/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  await fetchHolidays()
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
      targetDate: toApiDate(item.targetDate)
    }))
}

function openHolidayMoveDialog(index = null) {
  holidayMoveEditIndex = index
  holidayMoveForm.value = index === null
    ? createHolidayMoveForm()
    : { ...createHolidayMoveForm(), ...holidayMoveList.value[index] }
  holidayMoveDialogVisible.value = true
}

async function saveHolidayMove() {
  const sourceDate = toApiDate(holidayMoveForm.value.sourceDate)
  const targetDate = toApiDate(holidayMoveForm.value.targetDate)
  if (!sourceDate || !targetDate) {
    ElMessage.error('請選擇原國定假日與挪移日期')
    return
  }
  if (sourceDate.slice(0, 7) !== targetDate.slice(0, 7)) {
    ElMessage.error('國定假日只能在同一月份內挪移')
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
        needSignature: Boolean(holidayMoveForm.value.needSignature),
        needMakeup: Boolean(holidayMoveForm.value.needMakeup),
        agreementReference: holidayMoveForm.value.agreementReference || '',
        agreementDate: holidayMoveForm.value.agreementDate || null,
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

// 一鍵載入當年國定假日（簡化：使用內建清單）
function buildRocHolidays(year = new Date().getFullYear()) {
  return [
    { date: `${year}-01-01`, type: '國定假日', desc: '元旦' },
    { date: `${year}-02-28`, type: '國定假日', desc: '和平紀念日' },
    { date: `${year}-04-04`, type: '國定假日', desc: '兒童節' },
    { date: `${year}-04-05`, type: '國定假日', desc: '清明節' },
    { date: `${year}-05-01`, type: '國定假日', desc: '勞動節' },
    { date: `${year}-06-10`, type: '國定假日', desc: '端午節(示例)' },
    { date: `${year}-09-17`, type: '國定假日', desc: '中秋節(示例)' },
    { date: `${year}-10-10`, type: '國定假日', desc: '國慶日' }
  ]
}

async function loadRocHolidays() {
  loadingHolidays.value = true
  const currentYear = new Date().getFullYear()
  try {
    const res = await apiFetch(`/api/holidays/import/roc?year=${currentYear}`, { method: 'POST' })
    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      throw new Error(
        `Import ROC holidays failed (${res.status})${errorText ? `: ${errorText}` : ''}`
      )
    }
  } catch (e) {
    console.error('載入國定假日失敗', e)
    const payload = buildRocHolidays(currentYear).map((item) => ({
      ...item,
      name: item.desc || '國定假日',
      description: item.desc,
      desc: item.desc,
      type: item.type || '國定假日'
    }))
    for (const item of payload) {
      await apiFetch('/api/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      })
    }
  } finally {
    await fetchHolidays()
    loadingHolidays.value = false
  }
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
    // 編輯
    shiftEditIndex = index
    shiftForm.value = { ...createEmptyShiftForm(), ...shiftList.value[index] }
  } else {
    // 新增
    shiftEditIndex = null
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
  fetchHolidays()
  fetchShifts()
  fetchHolidayMoves()
})
  
function getHolidayTagType(type) {
  const typeMap = {
    '國定假日': 'danger',
    '例假日': 'success',
    '公司休息日': 'warning',
    '補班日': 'info'
  }
  return typeMap[type] || 'default'
}
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

.shift-conflict-alert {
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
