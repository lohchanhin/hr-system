<!-- src/Components/backComponents/ShiftScheduleSetting.vue -->
<template>
    <div class="shift-schedule-setting">
      <h2>排班與班別管理設定</h2>
      <el-tabs v-model="activeTab" type="card">
        <!-- 1) 年度行事曆/休假日設定 -->
        <el-tab-pane label="行事曆設定" name="calendar">
          <div class="tab-content">
            <el-button type="primary" @click="openCalendarDialog()">新增假日</el-button>
            <el-table :data="holidayList" style="margin-top: 20px;">
              <el-table-column prop="date" label="日期" width="140" />
              <el-table-column prop="type" label="假日類型" width="120" />
              <el-table-column prop="desc" label="描述" />
              <el-table-column label="操作" width="160">
                <template #default="{ row, $index }">
                  <el-button type="primary" @click="openCalendarDialog($index)">編輯</el-button>
                  <el-button type="danger" @click="deleteHoliday($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>
  
            <!-- 新增/編輯 假日 Dialog -->
            <el-dialog :visible.sync="calendarDialogVisible" title="假日資料" width="500px">
              <el-form :model="calendarForm" label-width="120px">
                <el-form-item label="日期">
                  <el-date-picker
                    v-model="calendarForm.date"
                    type="date"
                    placeholder="選擇日期"
                    :format="dateFormat"
                    :value-format="dateFormat"
                  />
                </el-form-item>
                <el-form-item label="假日類型">
                  <el-select v-model="calendarForm.type" placeholder="選擇類型">
                    <el-option label="國定假日" value="國定假日" />
                    <el-option label="例假日" value="例假日" />
                    <el-option label="公司休息日" value="公司休息日" />
                    <el-option label="補班日" value="補班日" />
                  </el-select>
                </el-form-item>
                <el-form-item label="描述">
                  <el-input v-model="calendarForm.desc" placeholder="例如：中秋節 / 週休 等" />
                </el-form-item>
              </el-form>
              <span slot="footer" class="dialog-footer">
                <el-button @click="calendarDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveHoliday">儲存</el-button>
              </span>
            </el-dialog>
          </div>
        </el-tab-pane>
  
        <!-- 2) 班別管理 (針對排班) -->
        <el-tab-pane label="班別設定" name="shift">
          <div class="tab-content">
            <el-button type="primary" @click="openShiftDialog()">新增班別</el-button>
            <el-table :data="shiftList" style="margin-top: 20px;">
              <el-table-column prop="name" label="班別名稱" width="160" />
              <el-table-column prop="startTime" label="上班時間" width="120" />
              <el-table-column prop="endTime" label="下班時間" width="120" />
              <el-table-column prop="crossDay" label="是否跨日" width="100" />
              <el-table-column prop="remark" label="備註" />
              <el-table-column label="操作" width="180">
                <template #default="{ row, $index }">
                  <el-button type="primary" @click="openShiftDialog($index)">編輯</el-button>
                  <el-button type="danger" @click="deleteShift($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>
  
            <!-- 新增/編輯 班別 Dialog -->
            <el-dialog :visible.sync="shiftDialogVisible" title="班別資料" width="500px">
              <el-form :model="shiftForm" label-width="120px">
                <el-form-item label="班別名稱">
                  <el-input v-model="shiftForm.name" placeholder="如：早班 / 夜班 / 彈性班" />
                </el-form-item>
                <el-form-item label="上班時間">
                  <el-time-picker 
                    v-model="shiftForm.startTime"
                    :format="timeFormat"
                    :value-format="timeFormat"
                    placeholder="選擇上班時間"
                  />
                </el-form-item>
                <el-form-item label="下班時間">
                  <el-time-picker 
                    v-model="shiftForm.endTime"
                    :format="timeFormat"
                    :value-format="timeFormat"
                    placeholder="選擇下班時間"
                  />
                </el-form-item>
                <el-form-item label="跨日班">
                  <el-switch v-model="shiftForm.crossDay" active-text="是" inactive-text="否" />
                </el-form-item>
                <el-form-item label="備註">
                  <el-input v-model="shiftForm.remark" />
                </el-form-item>
              </el-form>
              <span slot="footer" class="dialog-footer">
                <el-button @click="shiftDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveShift">儲存</el-button>
              </span>
            </el-dialog>
          </div>
        </el-tab-pane>
  
        <!-- 3) 部門排班規則 -->
        <el-tab-pane label="部門排班規則" name="deptSchedule">
          <div class="tab-content">
            <el-form :model="deptScheduleForm" label-width="180px">
              <el-form-item label="預設週休二日">
                <el-switch v-model="deptScheduleForm.defaultTwoDayOff" active-text="是" inactive-text="否" />
              </el-form-item>
              <el-form-item label="可否臨時調班">
                <el-switch v-model="deptScheduleForm.tempChangeAllowed" />
              </el-form-item>
              <el-form-item label="部門排班管理者">
                <el-select v-model="deptScheduleForm.deptManager" placeholder="選擇使用者">
                  <el-option v-for="mgr in managerList" :key="mgr.value" :label="mgr.label" :value="mgr.value" />
                </el-select>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveDeptSchedule">儲存部門排班規則</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
  
        <!-- 4) 中場休息時間全局設定 -->
        <el-tab-pane label="中場休息設定" name="breakSetting">
          <div class="tab-content">
            <el-form :model="breakSettingForm" label-width="200px">
              <el-form-item label="是否啟用全局中場休息設定">
                <el-switch v-model="breakSettingForm.enableGlobalBreak" />
              </el-form-item>
              <el-form-item label="全局休息時間 (分鐘)">
                <el-input-number v-model="breakSettingForm.breakMinutes" :min="0" :disabled="!breakSettingForm.enableGlobalBreak" />
              </el-form-item>
              <el-form-item label="是否允許多段休息">
                <el-switch v-model="breakSettingForm.allowMultiBreak" :disabled="!breakSettingForm.enableGlobalBreak" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveBreakSetting">儲存休息設定</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
  
        <!-- 5) 員工個人國定假日挪移/簽名 -->
        <el-tab-pane label="國定假日挪移" name="holidayMove">
          <div class="tab-content">
            <el-form :model="holidayMoveForm" label-width="180px">
              <el-form-item label="是否允許挪移國定假日">
                <el-switch v-model="holidayMoveForm.enableHolidayMove" />
              </el-form-item>
              <el-form-item label="挪移申請是否需簽名(電子簽核)">
                <el-switch v-model="holidayMoveForm.needSignature" :disabled="!holidayMoveForm.enableHolidayMove" />
              </el-form-item>
              <el-form-item label="挪移後是否補班">
                <el-switch v-model="holidayMoveForm.needMakeup" :disabled="!holidayMoveForm.enableHolidayMove" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveHolidayMove">儲存挪移規則</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue'
  
  const activeTab = ref('calendar')
  const dateFormat = 'YYYY-MM-DD'
  const timeFormat = 'HH:mm'
  
  // =========== 1) 年度行事曆/休假日設定 ===========
  const holidayList = ref([
    { date: '2025-01-01', type: '國定假日', desc: '元旦' },
    { date: '2025-02-28', type: '國定假日', desc: '和平紀念日' },
    { date: '2025-04-05', type: '公司休息日', desc: '兒童節補休' }
  ])
  const calendarDialogVisible = ref(false)
  let calendarEditIndex = null
  
  const calendarForm = ref({
    date: '',
    type: '',
    desc: ''
  })
  
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
  
  function saveHoliday() {
    if (calendarEditIndex === null) {
      holidayList.value.push({ ...calendarForm.value })
    } else {
      holidayList.value[calendarEditIndex] = { ...calendarForm.value }
    }
    calendarDialogVisible.value = false
  }
  
  function deleteHoliday(index) {
    holidayList.value.splice(index, 1)
  }
  
  // =========== 2) 班別管理 (排班用) ===========
  const shiftList = ref([
    { name: '早班', startTime: '08:00', endTime: '17:00', crossDay: false, remark: '普通日班' },
    { name: '夜班', startTime: '22:00', endTime: '06:00', crossDay: true, remark: '跨日夜班' },
    { name: '彈性班', startTime: '09:00', endTime: '18:00', crossDay: false, remark: '可前後彈性1小時' }
  ])
  const shiftDialogVisible = ref(false)
  let shiftEditIndex = null
  
  const shiftForm = ref({
    name: '',
    startTime: '',
    endTime: '',
    crossDay: false,
    remark: ''
  })
  
  function openShiftDialog(index = null) {
    if (index !== null) {
      // 編輯
      shiftEditIndex = index
      shiftForm.value = { ...shiftList.value[index] }
    } else {
      // 新增
      shiftEditIndex = null
      shiftForm.value = {
        name: '',
        startTime: '',
        endTime: '',
        crossDay: false,
        remark: ''
      }
    }
    shiftDialogVisible.value = true
  }
  
  function saveShift() {
    if (shiftEditIndex === null) {
      shiftList.value.push({ ...shiftForm.value })
    } else {
      shiftList.value[shiftEditIndex] = { ...shiftForm.value }
    }
    shiftDialogVisible.value = false
  }
  
  function deleteShift(index) {
    shiftList.value.splice(index, 1)
  }
  
  // =========== 3) 部門排班規則 ===========
  const deptScheduleForm = ref({
    defaultTwoDayOff: true,
    tempChangeAllowed: false,
    deptManager: ''
  })
  // 假資料: 管理者清單
  const managerList = [
    { label: '王小明', value: 'user001' },
    { label: '李主管', value: 'user002' },
    { label: 'HR-Alice', value: 'user003' }
  ]
  
  function saveDeptSchedule() {
    // 這裡可呼叫後端 API
    console.log('儲存部門排班規則', deptScheduleForm.value)
    alert('已儲存「部門排班規則」設定')
  }
  
  // =========== 4) 中場休息時間 ===========
  const breakSettingForm = ref({
    enableGlobalBreak: false,
    breakMinutes: 60,
    allowMultiBreak: false
  })
  
  function saveBreakSetting() {
    console.log('儲存中場休息設定', breakSettingForm.value)
    alert('已儲存「中場休息」設定')
  }
  
  // =========== 5) 員工個人國定假日挪移設定 ===========
  const holidayMoveForm = ref({
    enableHolidayMove: false,
    needSignature: false,
    needMakeup: false
  })
  
  function saveHolidayMove() {
    console.log('儲存國定假日挪移規則', holidayMoveForm.value)
    alert('已儲存「國定假日挪移」設定')
  }
  </script>
  
  <style scoped>
  .shift-schedule-setting {
    padding: 20px;
  }
  
  .tab-content {
    margin-top: 20px;
  }
  </style>
  