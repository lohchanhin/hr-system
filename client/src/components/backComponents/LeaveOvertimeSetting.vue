<!-- src/Components/backComponents/LeaveOvertimeSetting.vue -->

<template>
    <div class="leave-overtime-setting">
      <h2>請假與加班設定</h2>
      <el-tabs v-model="activeTab" type="card">
        <!-- 1) 假別管理 -->
        <el-tab-pane label="假別管理" name="leaveType">
          <el-button type="primary" @click="openLeaveDialog()">新增假別</el-button>
          <el-table :data="leaveTypeList" style="margin-top: 20px;">
            <el-table-column prop="name" label="假別名稱" width="180" />
            <el-table-column prop="code" label="代碼" width="120" />
            <el-table-column prop="annualDays" label="年度可用天數" width="160" />
            <el-table-column prop="needProof" label="需證明?" width="100" />
            <el-table-column prop="paidRule" label="計薪/扣薪" />
            <el-table-column label="操作" width="200">
              <template #default="{ row, $index }">
                <el-button type="primary" @click="openLeaveDialog($index)">編輯</el-button>
                <el-button type="danger" @click="deleteLeaveType($index)">刪除</el-button>
              </template>
            </el-table-column>
          </el-table>
  
          <!-- 新增/編輯 假別 Dialog -->
          <el-dialog
            title="假別資料"
            v-model="leaveDialogVisible"
            width="500px"
          >
            <el-form :model="leaveForm" label-width="120px">
              <el-form-item label="假別名稱">
                <el-input v-model="leaveForm.name" placeholder="如：病假、事假、產假、特休…" />
              </el-form-item>
              <el-form-item label="代碼">
                <el-input v-model="leaveForm.code" placeholder="如：SICK, PERSONAL…" />
              </el-form-item>
              <el-form-item label="年度可用天數">
                <el-input-number v-model="leaveForm.annualDays" :min="0" />
              </el-form-item>
              <el-form-item label="是否需證明?">
                <el-switch v-model="leaveForm.needProof" active-text="需要" inactive-text="不需要" />
              </el-form-item>
              <el-form-item label="計薪/扣薪規則">
                <el-select v-model="leaveForm.paidRule" placeholder="選擇規則">
                  <el-option label="照薪(不扣薪)" value="paid" />
                  <el-option label="半薪" value="half-paid" />
                  <el-option label="全扣" value="unpaid" />
                </el-select>
              </el-form-item>
            </el-form>
            <span slot="footer" class="dialog-footer">
              <el-button @click="leaveDialogVisible = false">取消</el-button>
              <el-button type="primary" @click="saveLeaveType">儲存</el-button>
            </span>
          </el-dialog>
        </el-tab-pane>
  
        <!-- 2) 加班類型管理 -->
        <el-tab-pane label="加班類型管理" name="overtimeType">
          <el-button type="primary" @click="openOvertimeDialog()">新增加班類型</el-button>
          <el-table :data="overtimeTypeList" style="margin-top: 20px;">
            <el-table-column prop="name" label="加班名稱" width="150" />
            <el-table-column prop="rate" label="加班倍數" width="120" />
            <el-table-column prop="allowComp" label="可轉補休?" width="120" />
            <el-table-column prop="desc" label="說明" />
            <el-table-column label="操作" width="200">
              <template #default="{ row, $index }">
                <el-button type="primary" @click="openOvertimeDialog($index)">編輯</el-button>
                <el-button type="danger" @click="deleteOvertimeType($index)">刪除</el-button>
              </template>
            </el-table-column>
          </el-table>
  
          <!-- 新增/編輯 加班類型 Dialog -->
          <el-dialog
            title="加班類型資料"
            v-model="overtimeDialogVisible"
            width="500px"
          >
            <el-form :model="overtimeForm" label-width="120px">
              <el-form-item label="加班名稱">
                <el-input v-model="overtimeForm.name" placeholder="如：平日加班、休息日、國定假日…" />
              </el-form-item>
              <el-form-item label="加班倍數">
                <el-input-number v-model="overtimeForm.rate" :min="1" :step="0.1" />
              </el-form-item>
              <el-form-item label="可轉補休?">
                <el-switch v-model="overtimeForm.allowComp" active-text="是" inactive-text="否" />
              </el-form-item>
              <el-form-item label="說明">
                <el-input v-model="overtimeForm.desc" />
              </el-form-item>
            </el-form>
            <span slot="footer" class="dialog-footer">
              <el-button @click="overtimeDialogVisible = false">取消</el-button>
              <el-button type="primary" @click="saveOvertimeType">儲存</el-button>
            </span>
          </el-dialog>
        </el-tab-pane>
  
        <!-- 3) 申請與簽核規則 -->
        <el-tab-pane label="申請與簽核規則" name="approvalRule">
          <el-form :model="approvalForm" label-width="160px">
            <el-form-item label="請假/加班是否需附件">
              <el-switch v-model="approvalForm.needAttachment" />
            </el-form-item>
            <el-form-item label="防止超用(可用天數不足自動拒絕)">
              <el-switch v-model="approvalForm.preventOveruse" />
            </el-form-item>
            <el-form-item label="是否需多層簽核">
              <el-switch v-model="approvalForm.multiApproval" />
            </el-form-item>
            <el-form-item label="最高關卡數 (若多層簽核)">
              <el-input-number v-model="approvalForm.maxSteps" :min="1" :disabled="!approvalForm.multiApproval" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveApprovalRules">儲存規則</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
  
        <!-- 4) 補休/特休控管 -->
        <el-tab-pane label="補休/特休控管" name="compControl">
          <el-form :model="compForm" label-width="140px">
            <el-form-item label="加班轉補休折算比率(倍)">
              <el-input-number v-model="compForm.compRate" :min="1" :step="0.1" />
            </el-form-item>
            <el-form-item label="補休先進先出(啟用)?">
              <el-switch v-model="compForm.fifoEnabled" />
            </el-form-item>
            <el-form-item label="補休有效期限(天)">
              <el-input-number v-model="compForm.expireDays" :min="0" :disabled="!compForm.fifoEnabled" />
              <small>0 代表不限制期限</small>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveCompRules">儲存補休規則</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue'
  
  const activeTab = ref('leaveType')
  
  // =============== 假別管理 ===============
  const leaveTypeList = ref([
    { name: '病假', code: 'SICK', annualDays: 30, needProof: true, paidRule: 'half-paid' },
    { name: '事假', code: 'PERSONAL', annualDays: 14, needProof: false, paidRule: 'unpaid' },
    { name: '特休', code: 'ANNUAL', annualDays: 10, needProof: false, paidRule: 'paid' }
  ])
  const leaveDialogVisible = ref(false)
  let leaveEditIndex = null
  
  const leaveForm = ref({
    name: '',
    code: '',
    annualDays: 0,
    needProof: false,
    paidRule: 'paid'
  })
  
  function openLeaveDialog(index = null) {
    if (index !== null) {
      // 編輯模式
      leaveEditIndex = index
      leaveForm.value = { ...leaveTypeList.value[index] }
    } else {
      // 新增模式
      leaveEditIndex = null
      leaveForm.value = { name: '', code: '', annualDays: 0, needProof: false, paidRule: 'paid' }
    }
    leaveDialogVisible.value = true
  }
  
  function saveLeaveType() {
    if (leaveEditIndex === null) {
      leaveTypeList.value.push({ ...leaveForm.value })
    } else {
      leaveTypeList.value[leaveEditIndex] = { ...leaveForm.value }
    }
    leaveDialogVisible.value = false
  }
  
  function deleteLeaveType(index) {
    leaveTypeList.value.splice(index, 1)
  }
  
  // =============== 加班類型管理 ===============
  const overtimeTypeList = ref([
    { name: '平日加班', rate: 1.33, allowComp: true, desc: '工作日下班後加班' },
    { name: '休息日加班', rate: 1.66, allowComp: true, desc: '休息日(週休)加班' },
    { name: '例假日加班', rate: 2.0, allowComp: false, desc: '例假日本不可轉補休' }
  ])
  const overtimeDialogVisible = ref(false)
  let overtimeEditIndex = null
  
  const overtimeForm = ref({
    name: '',
    rate: 1,
    allowComp: true,
    desc: ''
  })
  
  function openOvertimeDialog(index = null) {
    if (index !== null) {
      // 編輯模式
      overtimeEditIndex = index
      overtimeForm.value = { ...overtimeTypeList.value[index] }
    } else {
      // 新增模式
      overtimeEditIndex = null
      overtimeForm.value = { name: '', rate: 1, allowComp: true, desc: '' }
    }
    overtimeDialogVisible.value = true
  }
  
  function saveOvertimeType() {
    if (overtimeEditIndex === null) {
      overtimeTypeList.value.push({ ...overtimeForm.value })
    } else {
      overtimeTypeList.value[overtimeEditIndex] = { ...overtimeForm.value }
    }
    overtimeDialogVisible.value = false
  }
  
  function deleteOvertimeType(index) {
    overtimeTypeList.value.splice(index, 1)
  }
  
  // =============== 申請與簽核規則 ===============
  const approvalForm = ref({
    needAttachment: false,
    preventOveruse: true,
    multiApproval: true,
    maxSteps: 3
  })
  
  function saveApprovalRules() {
    // 這裡可對接後端 API
    console.log('儲存 申請與簽核規則:', approvalForm.value)
    alert('已儲存「申請與簽核規則」設定')
  }
  
  // =============== 補休/特休控管 ===============
  const compForm = ref({
    compRate: 1.5,
    fifoEnabled: true,
    expireDays: 180
  })
  
  function saveCompRules() {
    // 這裡可對接後端 API
    console.log('儲存 補休/特休控管:', compForm.value)
    alert('已儲存「補休/特休控管」設定')
  }
  </script>
  
  <style scoped>
  .leave-overtime-setting {
    padding: 20px;
  }
  
  .leave-overtime-setting .el-tabs {
    margin-top: 20px;
  }
  </style>
  