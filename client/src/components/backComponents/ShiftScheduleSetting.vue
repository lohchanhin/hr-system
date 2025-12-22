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
            <el-button type="primary" @click="openCalendarDialog()" class="add-btn">
              <i class="el-icon-plus"></i>
              新增假日
            </el-button>
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
          
          <div class="table-container">
            <el-table 
              :data="shiftList" 
              class="data-table"
              :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
              :row-style="{ height: '56px' }"
            >
              <el-table-column prop="code" label="代碼" width="100">
                <template #default="{ row }">
                  <el-tag class="code-tag">{{ row.code }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="name" label="班別名稱" width="180">
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
                      <span v-if="row.allowanceType === 'fixed'">
                        固定 ${{ row.fixedAllowanceAmount || 0 }}
                      </span>
                      <span v-else>
                        津貼 × {{ row.allowanceMultiplier || 0 }}
                      </span>
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
                <el-input v-model="shiftForm.code" placeholder="如：A1, B2, C3" />
              </el-form-item>
              <el-form-item label="班別名稱" required>
                <el-input v-model="shiftForm.name" placeholder="如：早班 / 夜班 / 彈性班" />
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
                <div class="form-help">啟用後可選擇固定津貼或倍率計算</div>
              </el-form-item>
              <el-form-item label="津貼計算方式" v-if="shiftForm.hasAllowance && shiftForm.isNightShift">
                <el-radio-group v-model="shiftForm.allowanceType">
                  <el-radio label="multiplier">倍率計算</el-radio>
                  <el-radio label="fixed">固定津貼</el-radio>
                </el-radio-group>
                <div class="form-help">選擇津貼計算方式：倍率計算或固定金額</div>
              </el-form-item>
              <el-form-item label="津貼倍數" v-if="shiftForm.allowanceType === 'multiplier'">
                <el-input-number 
                  v-model="shiftForm.allowanceMultiplier" 
                  :min="0" 
                  :max="10"
                  :step="0.1"
                  :precision="2"
                  :disabled="!shiftForm.isNightShift || !shiftForm.hasAllowance"
                  style="width: 100%" 
                />
                <div class="form-help">津貼金額 = 基本時薪 × 夜班時數 × 津貼倍數</div>
              </el-form-item>
              <el-form-item label="固定津貼金額" v-if="shiftForm.allowanceType === 'fixed'">
                <el-input-number 
                  v-model="shiftForm.fixedAllowanceAmount" 
                  :min="0" 
                  :step="100"
                  :precision="0"
                  :disabled="!shiftForm.isNightShift || !shiftForm.hasAllowance"
                  style="width: 100%" 
                />
                <div class="form-help">每次上夜班的固定津貼金額（元）</div>
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

      <!-- 3) 員工個人國定假日挪移/簽名 -->
      <el-tab-pane name="holidayMove">
        <template #label>
          <div class="tab-label">
            <i class="el-icon-s-promotion"></i>
            <span>國定假日挪移</span>
          </div>
        </template>
        
        <div class="tab-content">
          <div class="settings-card">
            <h2 class="section-title">假日挪移規則</h2>
            <el-form :model="holidayMoveForm" label-width="220px" class="settings-form">
              <div class="form-group">
                <el-form-item label="是否允許挪移國定假日">
                  <el-switch 
                    v-model="holidayMoveForm.enableHolidayMove"
                    active-text="允許" 
                    inactive-text="禁止"
                    active-color="#10b981"
                  />
                  <div class="form-help">允許員工申請將國定假日挪移到其他日期</div>
                </el-form-item>
                
                <el-form-item label="挪移申請是否需簽名(電子簽核)">
                  <el-switch 
                    v-model="holidayMoveForm.needSignature" 
                    :disabled="!holidayMoveForm.enableHolidayMove"
                    active-text="需要" 
                    inactive-text="不需要"
                    active-color="#10b981"
                  />
                  <div class="form-help">挪移申請是否需要經過電子簽核流程</div>
                </el-form-item>
                
                <el-form-item label="挪移後是否補班">
                  <el-switch 
                    v-model="holidayMoveForm.needMakeup" 
                    :disabled="!holidayMoveForm.enableHolidayMove"
                    active-text="需要" 
                    inactive-text="不需要"
                    active-color="#10b981"
                  />
                  <div class="form-help">挪移假日後是否需要在其他日期補班</div>
                </el-form-item>
              </div>
              
              <el-form-item>
                <el-button type="primary" @click="saveHolidayMove" class="save-settings-btn">
                  <i class="el-icon-check"></i>
                  儲存挪移規則
                </el-button>
              </el-form-item>
            </el-form>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
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

const calendarForm = ref({
  date: '',
  type: '',
  desc: ''
})

async function fetchHolidays() {
  const res = await apiFetch('/api/holidays', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    }
  })
  if (res.ok) {
    holidayList.value = await res.json()
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
    calendarForm.value = { date: '', type: '', desc: '' }
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
  await apiFetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    },
    body: JSON.stringify(calendarForm.value)
  })
  await fetchHolidays()
  calendarDialogVisible.value = false
}

async function deleteHoliday(index) {
  const id = holidayList.value[index]._id
  await apiFetch(`/api/holidays/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    }
  })
  await fetchHolidays()
}
  
// =========== 2) 班別管理 (排班用) ===========
const shiftList = ref([])
const shiftDialogVisible = ref(false)
let shiftEditIndex = null

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
  allowanceType: 'multiplier', // 'multiplier' 或 'fixed'
  allowanceMultiplier: 0,
  fixedAllowanceAmount: 0
})

const shiftForm = ref(createEmptyShiftForm())

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
  
async function saveShift() {
  const method = shiftEditIndex === null ? 'POST' : 'PUT'
  let url = '/api/shifts'
  if (method === 'PUT') {
    const id = shiftList.value[shiftEditIndex]._id
    url += `/${id}`
  }
  await apiFetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    },
    body: JSON.stringify(shiftForm.value)
  })
  await fetchShifts()
  shiftDialogVisible.value = false
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
  
// =========== 3) 員工個人國定假日挪移設定 ===========
const holidayMoveForm = ref({
  enableHolidayMove: false,
  needSignature: false,
  needMakeup: false
})
  
async function saveHolidayMove() {
  const method = holidayMoveForm.value._id ? 'PUT' : 'POST'
  let url = '/api/holiday-move-settings'
  if (method === 'PUT') {
    url += `/${holidayMoveForm.value._id}`
  }
  const res = await apiFetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    },
    body: JSON.stringify(holidayMoveForm.value)
  })
  if (res.ok) {
    alert('已儲存「國定假日挪移」設定')
  }
}

onMounted(() => {
  fetchHolidays()
  fetchShifts()
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
