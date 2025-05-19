<!-- src/Components/backComponents/ReportManagementSetting.vue -->

<template>
    <div class="report-management-setting">
      <h2>報表管理設定</h2>
  
      <el-tabs v-model="activeTab" type="card">
        <!-- 1) 報表模板管理 -->
        <el-tab-pane label="報表模板管理" name="template">
          <div class="tab-content">
            <el-button type="primary" @click="openTemplateDialog()">新增報表模板</el-button>
            <el-table :data="reportTemplates" style="margin-top: 20px;">
              <el-table-column prop="name" label="報表名稱" width="180"></el-table-column>
              <el-table-column prop="type" label="類型" width="120"></el-table-column>
              <el-table-column prop="fields" label="欄位數">
                <template #default="{ row }">
                  <!-- 顯示欄位陣列長度 -->
                  {{ row.fields.length }} 項
                </template>
              </el-table-column>
              <el-table-column label="操作" width="180">
                <template #default="{ row, $index }">
                  <el-button type="primary" @click="openTemplateDialog($index)">編輯</el-button>
                  <el-button type="danger" @click="deleteTemplate($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>
  
            <!-- 新增/編輯 報表模板 Dialog -->
            <el-dialog v-model="templateDialogVisible" title="報表模板設定" width="600px">
              <el-form :model="templateForm" label-width="120px">
                <el-form-item label="報表名稱">
                  <el-input v-model="templateForm.name" placeholder="如：出勤統計報表 / 請假統計 / 薪資明細..."></el-input>
                </el-form-item>
                <el-form-item label="類型">
                  <el-select v-model="templateForm.type" placeholder="選擇報表類型">
                    <el-option label="出勤" value="出勤" />
                    <el-option label="請假" value="請假" />
                    <el-option label="加班/補休" value="加班補休" />
                    <el-option label="薪資" value="薪資" />
                    <el-option label="其他" value="其他" />
                  </el-select>
                </el-form-item>
                <el-form-item label="欄位列表">
                  <div class="field-list">
                    <el-tag
                      v-for="(field, idx) in templateForm.fields"
                      :key="idx"
                      closable
                      @close="removeField(idx)"
                      style="margin: 4px;"
                    >
                      {{ field }}
                    </el-tag>
                    <el-input
                      v-model="newField"
                      placeholder="輸入欄位名稱後按 Enter"
                      @keyup.enter="addField"
                      style="width: 100%; margin-top: 4px;"
                    />
                  </div>
                </el-form-item>
              </el-form>
              <span slot="footer" class="dialog-footer">
                <el-button @click="templateDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveTemplate">儲存</el-button>
              </span>
            </el-dialog>
          </div>
        </el-tab-pane>
  
        <!-- 2) 匯出格式與樣式 -->
        <el-tab-pane label="匯出格式與樣式" name="export">
          <div class="tab-content">
            <el-form :model="exportForm" label-width="160px">
              <el-form-item label="支援匯出格式">
                <el-checkbox-group v-model="exportForm.formats">
                  <el-checkbox label="PDF" />
                  <el-checkbox label="Excel" />
                  <el-checkbox label="CSV" />
                </el-checkbox-group>
              </el-form-item>
              <el-form-item label="是否包含公司 Logo">
                <el-switch v-model="exportForm.includeLogo" />
              </el-form-item>
              <el-form-item label="頁尾備註">
                <el-input v-model="exportForm.footerNote" placeholder="如：機密文件/僅供內部參考"></el-input>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveExportSetting">儲存匯出設定</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
  
        <!-- 3) 權限與範圍設定 -->
        <el-tab-pane label="權限與範圍" name="permission">
          <div class="tab-content">
            <el-form :model="permissionForm" label-width="180px">
              <el-form-item label="主管可查部門彙總報表">
                <el-switch v-model="permissionForm.supervisorDept" />
              </el-form-item>
              <el-form-item label="HR 可查所有部門報表">
                <el-switch v-model="permissionForm.hrAllDept" />
              </el-form-item>
              <el-form-item label="員工是否可下載個人報表">
                <el-switch v-model="permissionForm.employeeDownload" />
              </el-form-item>
              <el-form-item label="報表歷史可查詢 (月)">
                <el-input-number v-model="permissionForm.historyMonths" :min="1" />
                <small>可查詢往前幾個月報表？</small>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="savePermission">儲存權限設定</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
  
        <!-- 4) 報表通知與寄送 (選擇性) -->
        <el-tab-pane label="通知與寄送" name="notification">
          <div class="tab-content">
            <el-form :model="notifyForm" label-width="160px">
              <el-form-item label="自動寄送報表">
                <el-switch v-model="notifyForm.autoSend" />
                <small>若啟用，可設定排程定期寄送</small>
              </el-form-item>
              <el-form-item label="寄送頻率">
                <el-select v-model="notifyForm.sendFrequency" :disabled="!notifyForm.autoSend">
                  <el-option label="每日" value="daily" />
                  <el-option label="每週" value="weekly" />
                  <el-option label="每月" value="monthly" />
                </el-select>
              </el-form-item>
              <el-form-item label="寄送對象 (多選)">
                <el-checkbox-group v-model="notifyForm.recipients" :disabled="!notifyForm.autoSend">
                  <el-checkbox label="主管" />
                  <el-checkbox label="HR" />
                  <el-checkbox label="員工本人" />
                  <el-checkbox label="財務" />
                </el-checkbox-group>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveNotifySetting">儲存通知設定</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue'
  
  const activeTab = ref('template')
  
  // =============== (1) 報表模板管理 ===============
  const reportTemplates = ref([
    {
      name: '出勤統計報表',
      type: '出勤',
      fields: ['員工姓名', '部門', '應出勤天數', '實際出勤天數', '遲到次數', '早退次數']
    },
    {
      name: '請假統計報表',
      type: '請假',
      fields: ['員工姓名', '部門', '請假天數', '請假類型', '剩餘特休']
    }
  ])
  const templateDialogVisible = ref(false)
  let templateEditIndex = null
  
  const templateForm = ref({
    name: '',
    type: '',
    fields: []
  })
  
  const newField = ref('')
  
  function openTemplateDialog(index = null) {
    if (index !== null) {
      // 編輯模式
      templateEditIndex = index
      templateForm.value = { ...reportTemplates.value[index] }
    } else {
      // 新增模式
      templateEditIndex = null
      templateForm.value = { name: '', type: '', fields: [] }
    }
    newField.value = ''
    templateDialogVisible.value = true
  }
  
  function addField() {
    if (newField.value.trim()) {
      templateForm.value.fields.push(newField.value.trim())
      newField.value = ''
    }
  }
  
  function removeField(idx) {
    templateForm.value.fields.splice(idx, 1)
  }
  
  function saveTemplate() {
    if (templateEditIndex === null) {
      reportTemplates.value.push({ ...templateForm.value })
    } else {
      reportTemplates.value[templateEditIndex] = { ...templateForm.value }
    }
    templateDialogVisible.value = false
  }
  
  function deleteTemplate(index) {
    reportTemplates.value.splice(index, 1)
  }
  
  // =============== (2) 匯出格式與樣式 ===============
  const exportForm = ref({
    formats: ['PDF', 'Excel'], // 預設勾選
    includeLogo: true,
    footerNote: '機密文件，請勿外流'
  })
  
  function saveExportSetting() {
    console.log('儲存匯出設定', exportForm.value)
    alert('已儲存「匯出格式與樣式」設定')
  }
  
  // =============== (3) 權限與範圍 ===============
  const permissionForm = ref({
    supervisorDept: true,
    hrAllDept: true,
    employeeDownload: true,
    historyMonths: 6
  })
  
  function savePermission() {
    console.log('儲存權限與範圍設定', permissionForm.value)
    alert('已儲存「權限與範圍」設定')
  }
  
  // =============== (4) 通知與寄送 ===============
  const notifyForm = ref({
    autoSend: false,
    sendFrequency: '',
    recipients: []
  })
  
  function saveNotifySetting() {
    console.log('儲存報表通知設定', notifyForm.value)
    alert('已儲存「通知與寄送」設定')
  }
  </script>
  
  <style scoped>
  .report-management-setting {
    padding: 20px;
  }
  
  .tab-content {
    margin-top: 20px;
  }
  
  .field-list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  </style>
  