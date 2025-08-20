<!-- src/Components/backComponents/AttendanceSetting.vue -->

<template>
    <div class="attendance-setting">
      <h2>出勤設定</h2>
      <!-- 使用 Tabs 區分不同區塊 -->
      <el-tabs v-model="activeTab" type="card">
        <!-- 1. 班別設定 -->
        <el-tab-pane label="班別設定" name="shift">
          <el-button type="primary" @click="openShiftDialog()">新增班別</el-button>
          <el-table :data="shiftList" style="margin-top: 20px; width: 100%;">
            <el-table-column prop="name" label="班別名稱" width="180" />
            <el-table-column prop="startTime" label="上班時間" width="120" />
            <el-table-column prop="endTime" label="下班時間" width="120" />
            <el-table-column prop="breakTime" label="休息時段" />
            <el-table-column label="操作" width="180">
              <template #default="{ row, $index }">
                <el-button type="primary" @click="openShiftDialog($index)">編輯</el-button>
                <el-button type="danger" @click="deleteShift($index)">刪除</el-button>
              </template>
            </el-table-column>
          </el-table>
          
          <!-- 班別新增/編輯 Dialog -->
          <el-dialog
            title="班別資料"
            v-model="shiftDialogVisible"
            width="500px"
          >
            <el-form :model="shiftForm" label-width="100px">
              <el-form-item label="名稱">
                <el-input v-model="shiftForm.name" placeholder="例如：早班 / 晚班" />
              </el-form-item>
              <el-form-item label="上班時間">
                <el-time-picker 
                  v-model="shiftForm.startTime" 
                  placeholder="選擇上班時間"
                  :format="timeFormat" 
                  :value-format="timeFormat"
                />
              </el-form-item>
              <el-form-item label="下班時間">
                <el-time-picker 
                  v-model="shiftForm.endTime" 
                  placeholder="選擇下班時間"
                  :format="timeFormat" 
                  :value-format="timeFormat"
                />
              </el-form-item>
              <el-form-item label="休息時段">
                <el-input 
                  v-model="shiftForm.breakTime" 
                  placeholder="例如：12:00~13:00" 
                />
              </el-form-item>
            </el-form>
            <span slot="footer" class="dialog-footer">
              <el-button @click="shiftDialogVisible = false">取消</el-button>
              <el-button type="primary" @click="saveShift">儲存</el-button>
            </span>
          </el-dialog>
        </el-tab-pane>
  
        <!-- 2. 異常判定規則 -->
        <el-tab-pane label="異常判定規則" name="abnormal">
          <el-form :model="abnormalForm" label-width="140px" class="rule-form">
            <el-form-item label="遲到容許誤差(分鐘)">
              <el-input-number v-model="abnormalForm.lateGrace" :min="0" />
            </el-form-item>
            <el-form-item label="早退容許誤差(分鐘)">
              <el-input-number v-model="abnormalForm.earlyLeaveGrace" :min="0" />
            </el-form-item>
            <el-form-item label="缺卡判斷時間(分鐘)">
              <el-input-number v-model="abnormalForm.missingThreshold" :min="0" />
            </el-form-item>
            <el-form-item label="未打卡自動通知">
              <el-switch v-model="abnormalForm.autoNotify" active-text="啟用" inactive-text="停用" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveAbnormalRules">儲存規則</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
  
        <!-- 3. 分段打卡/外出規則 -->
        <el-tab-pane label="分段打卡/外出" name="break-outing">
          <el-form :model="breakOutForm" label-width="140px" class="rule-form">
            <el-form-item label="是否允許分段打卡">
              <el-switch v-model="breakOutForm.enableBreakPunch" active-text="是" inactive-text="否" />
            </el-form-item>
            <el-form-item label="分段打卡最少間隔(分鐘)">
              <el-input-number v-model="breakOutForm.breakInterval" :min="0" :disabled="!breakOutForm.enableBreakPunch" />
            </el-form-item>
            <el-form-item label="外出登記需審核">
              <el-switch v-model="breakOutForm.outingNeedApprove" active-text="需要" inactive-text="不需要" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveBreakOutSetting">儲存設定</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
  
        <!-- 4. 加班判定規則 -->
        <el-tab-pane label="加班規則" name="overtime">
          <el-form :model="overtimeForm" label-width="120px" class="rule-form">
            <el-form-item label="平日加班起算(分)">
              <el-input-number v-model="overtimeForm.weekdayThreshold" :min="0" />
            </el-form-item>
            <el-form-item label="假日加班倍數">
              <el-input-number v-model="overtimeForm.holidayRate" :min="1" :step="0.1" />
            </el-form-item>
            <el-form-item label="轉補休折算比率">
              <el-input-number v-model="overtimeForm.toCompRate" :min="1" :step="0.1" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveOvertimeRules">儲存加班規則</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
  
      </el-tabs>
    </div>
  </template>
  
  <script setup>
  import { ref, onMounted } from 'vue'
  import { apiFetch } from '../../api'


async function loadSettings() {
  const res = await apiFetch('/api/attendance-settings')
  if (res.ok) {
    const data = await res.json()
    if (data.abnormalRules) abnormalForm.value = { ...abnormalForm.value, ...data.abnormalRules }
    if (data.breakOutRules) breakOutForm.value = { ...breakOutForm.value, ...data.breakOutRules }
    if (data.overtimeRules) overtimeForm.value = { ...overtimeForm.value, ...data.overtimeRules }
  }
}

async function loadShifts() {
  const res = await apiFetch('/api/shifts')
  if (res.ok) {
    shiftList.value = await res.json()
  }
}

async function saveSettings() {
  const payload = {
    abnormalRules: abnormalForm.value,
    breakOutRules: breakOutForm.value,
    overtimeRules: overtimeForm.value
  }
  await apiFetch('/api/attendance-settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
}
  
  const activeTab = ref('shift')
  
// ================ 班別設定 ================
const shiftList = ref([])
  const shiftDialogVisible = ref(false)
  const timeFormat = 'HH:mm'
  
  const shiftForm = ref({
    name: '',
    startTime: '',
    endTime: '',
    breakTime: ''
  })
  let editIndex = null // 用於區分是"新增"還是"編輯"
  
  // 開啟 dialog
  const openShiftDialog = (index = null) => {
    if (index !== null) {
      // 編輯
      editIndex = index
      shiftForm.value = { ...shiftList.value[index] }
    } else {
      // 新增
      editIndex = null
      shiftForm.value = { name: '', startTime: '', endTime: '', breakTime: '' }
    }
    shiftDialogVisible.value = true
  }
  
  // 儲存 (新增或編輯)
  const saveShift = async () => {
    if (editIndex === null) {
      // 新增
      const res = await apiFetch('/api/shifts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(shiftForm.value)
      })
      if (res.ok) {
        const newShift = await res.json()
        shiftList.value.push(newShift)
      }
    } else {
      // 編輯
      const id = shiftList.value[editIndex]._id
      const res = await apiFetch(`/api/shifts/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(shiftForm.value)
      })
      if (res.ok) {
        const updated = await res.json()
        shiftList.value[editIndex] = updated
      }
    }
    shiftDialogVisible.value = false
  }

  const deleteShift = async (index) => {
    const id = shiftList.value[index]._id
    const res = await apiFetch(`/api/shifts/${id}`, {
      method: 'DELETE'
    })
    if (res.ok) {
      shiftList.value.splice(index, 1)
    }
  }
  
  // ================ 異常判定規則 ================
  const abnormalForm = ref({
    lateGrace: 5,            // 遲到容許誤差
    earlyLeaveGrace: 5,      // 早退容許誤差
    missingThreshold: 30,    // 超過多少分鐘不打卡視為缺卡
    autoNotify: true         // 是否自動通知
  })
  
  const saveAbnormalRules = async () => {
    await saveSettings()
    alert('已儲存「異常判定規則」設定')
  }
  
  // ================ 分段打卡/外出規則 ================
  const breakOutForm = ref({
    enableBreakPunch: true,   // 是否允許分段打卡
    breakInterval: 60,        // 分段打卡最少間隔
    outingNeedApprove: false  // 外出登記是否需要主管審核
  })
  
  const saveBreakOutSetting = async () => {
    await saveSettings()
    alert('已儲存「分段打卡/外出」設定')
  }
  
  // ================ 加班規則 ================
  const overtimeForm = ref({
    weekdayThreshold: 30, // 下班後 30 分鐘起算加班
    holidayRate: 2.0,     // 假日加班倍數
    toCompRate: 1.5       // 轉補休時的折算比率
  })
  
  const saveOvertimeRules = async () => {
    await saveSettings()
    alert('已儲存「加班規則」設定')
  }

  onMounted(() => {
    loadSettings()
    loadShifts()
  })
</script>
  
  <style scoped>
  .attendance-setting {
    padding: 20px;
  }
  
  .rule-form {
    max-width: 400px;
    margin-top: 20px;
  }
  </style>
  