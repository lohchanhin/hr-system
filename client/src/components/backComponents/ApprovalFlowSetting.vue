<!-- src/Components/backComponents/ApprovalFlowSetting.vue -->
<template>
    <div class="approval-flow-setting">
      <h2>簽核流程設定</h2>
  
      <el-tabs v-model="activeTab" type="card">
        <!-- 1) 通用流程規則 -->
        <el-tab-pane label="通用流程規則" name="commonRule">
          <el-form :model="commonForm" label-width="160px" class="rule-form">
            <el-form-item label="最大簽核關卡數">
              <el-input-number v-model="commonForm.maxApprovalLevel" :min="1" />
            </el-form-item>
            <el-form-item label="是否允許代理簽核">
              <el-switch v-model="commonForm.allowDelegate" />
            </el-form-item>
            <el-form-item label="逾時提醒(天)">
              <el-input-number v-model="commonForm.overdueDays" :min="1" />
              <small>若簽核逾時超過此天數，系統自動發送提醒</small>
            </el-form-item>
            <el-form-item label="逾時處理方式">
              <el-select v-model="commonForm.overdueAction" placeholder="選擇逾時行為">
                <el-option label="不處理" value="none" />
                <el-option label="自動通過" value="autoPass" />
                <el-option label="自動退回" value="autoReject" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveCommonRules">儲存通用規則</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
  
        <!-- 2) 申請類型簽核關卡設定 -->
        <el-tab-pane label="申請類型設定" name="approvalLevels">
          <div class="tab-content">
            <el-button type="primary" @click="openTypeDialog()">新增申請類型</el-button>
            <el-table :data="approvalTypes" style="margin-top: 20px;">
              <el-table-column prop="name" label="申請類型" width="180" />
              <el-table-column prop="levels" label="關卡數" width="80" />
              <el-table-column label="詳細" />
              <el-table-column label="操作" width="180">
                <template #default="{ row, $index }">
                  <el-button type="primary" @click="openTypeDialog($index)">編輯</el-button>
                  <el-button type="danger" @click="deleteApprovalType($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>
  
            <!-- 新增/編輯 申請類型 Dialog -->
            <el-dialog v-model="typeDialogVisible" title="申請類型簽核關卡設定" width="600px">
              <el-form :model="typeForm" label-width="120px">
                <el-form-item label="類型名稱">
                  <el-input v-model="typeForm.name" placeholder="如：請假申請 / 加班申請 / 補卡申請" />
                </el-form-item>
                <el-form-item label="關卡數">
                  <el-input-number v-model="typeForm.levels" :min="1" />
                </el-form-item>
                <!-- 簽核人設定 (簡易示範) -->
                <div v-for="i in typeForm.levels" :key="i" class="approval-level">
                  <el-form-item :label="`第${i}關審核人`">
                    <el-select v-model="typeForm.approvers[i - 1]" placeholder="選擇審核人">
                      <el-option v-for="opt in approverOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                    </el-select>
                  </el-form-item>
                </div>
              </el-form>
              <span slot="footer" class="dialog-footer">
                <el-button @click="typeDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveApprovalType">儲存</el-button>
              </span>
            </el-dialog>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue'
  
  // 預設活動的 Tab
  const activeTab = ref('commonRule')
  
  // =================== (1) 通用流程規則 ===================
  const commonForm = ref({
    maxApprovalLevel: 5,   // 可設定最高幾層簽核
    allowDelegate: true,   // 是否允許代理
    overdueDays: 3,        // 簽核逾時天數
    overdueAction: 'none'  // 逾時不處理 / autoPass / autoReject
  })
  
  function saveCommonRules() {
    console.log('儲存通用規則:', commonForm.value)
    alert('已儲存「通用流程規則」')
  }
  
  // =================== (2) 申請類型簽核關卡 ===================
  const approvalTypes = ref([
    // 每個類型都定義 [name, levels, approvers]
    { name: '請假申請', levels: 2, approvers: ['user002', 'user003'] },
    { name: '加班申請', levels: 3, approvers: ['user002', 'user004', 'user005'] },
    { name: '補打卡申請', levels: 1, approvers: ['user002'] }
  ])
  
  const typeDialogVisible = ref(false)
  let editIndex = null
  
  // 新增/編輯類型
  const typeForm = ref({
    name: '',
    levels: 1,
    approvers: []
  })
  
  // 假的審核人選單 (實務上可從後端或「帳號管理」API 取得)
  const approverOptions = [
    { label: '王小明 (user001)', value: 'user001' },
    { label: '李主管 (user002)', value: 'user002' },
    { label: '陳會計 (user003)', value: 'user003' },
    { label: 'HR-Alice (user004)', value: 'user004' },
    { label: 'Manager-Bob (user005)', value: 'user005' }
  ]
  
  function openTypeDialog(index = null) {
    if (index !== null) {
      // 編輯模式
      editIndex = index
      const item = approvalTypes.value[index]
      typeForm.value = {
        name: item.name,
        levels: item.levels,
        approvers: [...item.approvers]
      }
    } else {
      // 新增模式
      editIndex = null
      typeForm.value = {
        name: '',
        levels: 1,
        approvers: []
      }
    }
    typeDialogVisible.value = true
  }
  
  function saveApprovalType() {
    if (!typeForm.value.approvers) {
      typeForm.value.approvers = []
    }
    // 若 approvers 數量 < levels，要先填滿
    while (typeForm.value.approvers.length < typeForm.value.levels) {
      typeForm.value.approvers.push('')
    }
    // 若多於 levels，要裁剪
    if (typeForm.value.approvers.length > typeForm.value.levels) {
      typeForm.value.approvers.splice(typeForm.value.levels)
    }
  
    if (editIndex === null) {
      approvalTypes.value.push({ ...typeForm.value })
    } else {
      approvalTypes.value[editIndex] = { ...typeForm.value }
    }
    typeDialogVisible.value = false
  }
  
  function deleteApprovalType(index) {
    approvalTypes.value.splice(index, 1)
  }
  </script>
  
  <style scoped>
  .approval-flow-setting {
    padding: 20px;
  }
  
  .rule-form {
    max-width: 500px;
    margin-top: 20px;
  }
  
  .approval-level {
    margin-left: 20px;
  }
  </style>
  