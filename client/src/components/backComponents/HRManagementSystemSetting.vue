<!-- src/Components/backComponents/HRManagementSystemSetting.vue -->

<template>
  <div class="hr-management-system-setting">
    <h2>人事管理與系統設定</h2>

    <el-tabs v-model="activeTab" type="card">
      <EmployeeManagement />
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import EmployeeManagement from './EmployeeManagement.vue'

const activeTab = ref('employeeMgmt')
</script>

<style scoped>
.hr-management-system-setting {
  padding: 20px;
}

.tab-content {
  margin-top: 20px;
}
</style>
