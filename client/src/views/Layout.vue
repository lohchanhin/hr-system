<!-- src/views/Layout.vue (示例) -->
<template>
  <div class="layout-container">
    <el-aside width="200px" class="sidebar">
      <el-menu default-active="Settings" class="el-menu-vertical-demo">
        <el-menu-item
          v-for="item in menuItems"
          :key="item.name"
          :index="item.name"
          @click="gotoPage(item.name)"
        >
          <i :class="item.icon"></i>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-main>
      <router-view />
    </el-main>
  </div>
</template>

<script setup>
import { useRouter } from "vue-router";
const router = useRouter();

const gotoPage = (name) => {
  router.push({ name });
};

const menuItems = [
  { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-postcard' },
  { name: 'AttendanceManagementSetting', label: '考勤管理設定', icon: 'el-icon-folder-opened' },
  { name: 'LeaveOvertimeSetting', label: '請假與加班設定', icon: 'el-icon-date' },
  { name: 'ShiftScheduleSetting', label: '排班管理設定', icon: 'el-icon-timer' },
  { name: 'ApprovalFlowSetting', label: '簽核流程設定', icon: 'el-icon-s-operation' },
  { name: 'ReportManagementSetting', label: '報表管理設定', icon: 'el-icon-document-copy' },
  { name: 'SalaryManagementSetting', label: '薪資管理設定', icon: 'el-icon-coin' },
  { name: 'SocialInsuranceRetirementSetting', label: '勞健保 / 勞退設定', icon: 'el-icon-s-check' },
  { name: 'HRManagementSystemSetting', label: '人事管理與系統設定', icon: 'el-icon-user-solid' },
];
</script>

<style scoped>
.layout-container {
  display: flex;
  height: 100vh;
}
.sidebar {
  border-right: 1px solid #ebeef5;
}
</style>
