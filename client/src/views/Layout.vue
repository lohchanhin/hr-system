<!-- src/views/Layout.vue (示例) -->
<template>
  <div class="layout-container">
    <el-aside width="200px" class="sidebar">
      <el-menu default-active="Settings" class="el-menu-vertical-demo">
        <!-- 已有三個 -->
        <el-menu-item
          index="AttendanceSetting"
          @click="gotoPage('AttendanceSetting')"
        >
          <i class="el-icon-postcard"></i>
          <span>出勤設定</span>
        </el-menu-item>
        <el-menu-item
          index="AttendanceManagementSetting"
          @click="gotoPage('AttendanceManagementSetting')"
        >
          <i class="el-icon-folder-opened"></i>
          <span>考勤管理設定</span>
        </el-menu-item>
        <el-menu-item
          index="LeaveOvertimeSetting"
          @click="gotoPage('LeaveOvertimeSetting')"
        >
          <i class="el-icon-date"></i>
          <span>請假與加班設定</span>
        </el-menu-item>

        <!-- ★ 第四模組: 排班管理設定 -->
        <el-menu-item
          index="ShiftScheduleSetting"
          @click="gotoPage('ShiftScheduleSetting')"
        >
          <i class="el-icon-timer"></i>
          <span>排班管理設定</span>
        </el-menu-item>

        <!-- ★ 第五模組: 簽核流程設定 -->
        <el-menu-item index="ApprovalFlowSetting" @click="gotoPage('ApprovalFlowSetting')">
          <i class="el-icon-s-operation"></i>
          <span>簽核流程設定</span>
        </el-menu-item>

        <!-- ★ 第六模組: 報表管理設定 -->
        <el-menu-item index="ReportManagementSetting" @click="gotoPage('ReportManagementSetting')">
          <i class="el-icon-document-copy"></i>
          <span>報表管理設定</span>
        </el-menu-item>

        <!-- ★ 第七模組: 薪資管理設定 -->
        <el-menu-item index="SalaryManagementSetting" @click="gotoPage('SalaryManagementSetting')">
          <i class="el-icon-coin"></i>
          <span>薪資管理設定</span>
        </el-menu-item>

        <!-- ★ 第8模組: 勞健保、勞退管理設定 -->
        <el-menu-item index="SocialInsuranceRetirementSetting" @click="gotoPage('SocialInsuranceRetirementSetting')">
          <i class="el-icon-s-check"></i>
          <span>勞健保 / 勞退設定</span>
        </el-menu-item>

        <!-- ★ 第9模組: 人事管理與系統設定 -->
        <el-menu-item index="HRManagementSystemSetting" @click="gotoPage('HRManagementSystemSetting')">
          <i class="el-icon-user-solid"></i>
          <span>人事管理與系統設定</span>
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
