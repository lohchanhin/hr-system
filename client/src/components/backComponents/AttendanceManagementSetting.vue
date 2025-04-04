<!-- src/Components/backComponents/AttendanceManagementSetting.vue -->

<template>
    <div class="attendance-mgmt-setting">
      <h2>考勤管理設定</h2>
  
      <el-form :model="form" label-width="180px" class="setting-form">
  
        <!-- 1) 資料匯入設定 -->
        <el-divider content-position="left">資料匯入設定</el-divider>
        <el-form-item label="是否啟用外部刷卡匯入">
          <el-switch v-model="form.enableImport" active-text="啟用" inactive-text="停用" />
        </el-form-item>
        <el-form-item label="匯入檔案格式">
          <el-select v-model="form.importFormat" placeholder="選擇匯入檔格式" :disabled="!form.enableImport">
            <el-option label="CSV" value="csv" />
            <el-option label="Excel (XLSX)" value="xlsx" />
            <el-option label="TXT (定長欄位)" value="txt" />
          </el-select>
        </el-form-item>
        <el-form-item label="匯入欄位對應 (範例)">
          <el-input
            v-model="form.importMapping"
            placeholder="如：員工編號→Column A, 日期→Column B, 上班時間→Column C..."
            :disabled="!form.enableImport"
          />
        </el-form-item>
  
        <!-- 2) 補打卡審核設定 -->
        <el-divider content-position="left">補打卡審核設定</el-divider>
        <el-form-item label="是否允許員工提出補打卡">
          <el-switch v-model="form.allowMakeUpClock" active-text="允許" inactive-text="不允許" />
        </el-form-item>
        <el-form-item label="最晚可補打卡天數">
          <el-input-number v-model="form.makeUpDays" :min="0" :disabled="!form.allowMakeUpClock" />
          <small>（允許員工多少天之內可以補打卡）</small>
        </el-form-item>
        <el-form-item label="補打卡是否需主管簽核">
          <el-switch v-model="form.makeUpNeedApprove" :disabled="!form.allowMakeUpClock" />
        </el-form-item>
  
        <!-- 3) 查詢權限設定 -->
        <el-divider content-position="left">查詢權限設定</el-divider>
        <el-form-item label="主管是否可查跨部門考勤">
          <el-switch v-model="form.supervisorCrossDept" active-text="是" inactive-text="否" />
        </el-form-item>
        <el-form-item label="HR 是否可查所有部門">
          <el-switch v-model="form.hrAllDept" active-text="是" inactive-text="否" />
        </el-form-item>
        <el-form-item label="員工可查詢歷史紀錄(月)">
          <el-input-number v-model="form.employeeHistoryMonths" :min="1" />
          <small>（員工可往前查詢幾個月？）</small>
        </el-form-item>
  
        <!-- 4) 異常提醒設定 -->
        <el-divider content-position="left">異常提醒</el-divider>
        <el-form-item label="非延長工時提醒">
          <el-switch v-model="form.nonExtWorkAlert" active-text="啟用" inactive-text="停用" />
        </el-form-item>
        <el-form-item label="逾時未打卡是否自動通知">
          <el-switch v-model="form.overtimeNoClockNotify" active-text="啟用" inactive-text="停用" />
        </el-form-item>
        <el-form-item label="通知對象">
          <el-checkbox-group v-model="form.notifyTargets">
            <el-checkbox label="員工" />
            <el-checkbox label="主管" />
            <el-checkbox label="HR" />
          </el-checkbox-group>
        </el-form-item>
  
        <!-- 儲存按鈕 -->
        <el-form-item>
          <el-button type="primary" @click="saveSettings">儲存設定</el-button>
        </el-form-item>
      </el-form>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue'
  
  const form = ref({
    // 1) 資料匯入設定
    enableImport: false,
    importFormat: '',
    importMapping: '',
  
    // 2) 補打卡審核設定
    allowMakeUpClock: true,
    makeUpDays: 3,
    makeUpNeedApprove: true,
  
    // 3) 查詢權限設定
    supervisorCrossDept: false,
    hrAllDept: true,
    employeeHistoryMonths: 6,
  
    // 4) 異常提醒
    nonExtWorkAlert: false,
    overtimeNoClockNotify: true,
    notifyTargets: ['員工', '主管'] // 多選
  })
  
  const saveSettings = () => {
    // 這裡可呼叫後端 API
    console.log('儲存考勤管理設定:', form.value)
    alert('已儲存「考勤管理設定」')
  }
  </script>
  
  <style scoped>
  .attendance-mgmt-setting {
    padding: 20px;
    max-width: 700px; /* 視需求調整寬度 */
  }
  .setting-form {
    margin-top: 20px;
  }
  </style>
  