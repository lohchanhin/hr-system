<!-- src/Components/backComponents/HRManagementSystemSetting.vue -->

<template>
  <!-- 這一頁只有「員工管理」：頁首（標題、統計、新增員工）在 EmployeeManagement 裡，不再另外放標題與單一頁籤 -->
  <div class="hr-management-system-setting">
    <EmployeeManagement />
  </div>
</template>

<script setup>
import EmployeeManagement from './EmployeeManagement.vue'
</script>

<!-- 外框（ModernLayout 的 .main-content）已經有留白：這裡不再加 padding（以前多了一圈 20px，標題比其他頁低、內容比其他頁窄） -->
