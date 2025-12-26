<!-- src/Components/backComponents/AttendanceManagementSetting.vue -->

<template>
    <div class="attendance-mgmt-setting">
      <h2>考勤管理設定</h2>
  
      <el-form :model="form" label-width="180px" class="setting-form">
  
        <!-- 資料匯入設定 -->
        <el-divider content-position="left">資料匯入設定</el-divider>
        <el-form-item label="考勤資料匯入">
          <el-button
            type="primary"
            data-test="attendance-import-button"
            @click="attendanceImportVisible = true"
          >
            開啟匯入流程
          </el-button>
        </el-form-item>
      </el-form>
    </div>
    <AttendanceImportDialog
      v-model="attendanceImportVisible"
      @import-complete="handleAttendanceImportComplete"
    />
  </template>

  <script setup>
import { ref } from 'vue'
import AttendanceImportDialog from './AttendanceImportDialog.vue'
  
  const attendanceImportVisible = ref(false)

  const form = ref({})

  function handleAttendanceImportComplete() {
    alert('考勤資料匯入完成')
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
