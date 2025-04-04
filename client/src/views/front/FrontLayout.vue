<template>
  <div class="front-layout">
    <!-- 左側導覽列 -->
    <aside class="sidebar">
      <el-menu default-active="" class="el-menu-vertical-demo">
        <!-- 出勤打卡 -->
        <template
          v-if="['employee', 'supervisor', 'hr', 'admin'].includes(role)"
        >
          <el-menu-item index="attendance" @click="gotoPage('attendance')">
            <i class="el-icon-postcard"></i>
            <span>出勤打卡</span>
          </el-menu-item>
        </template>

        <!-- 請假申請 -->
        <template
          v-if="['employee', 'supervisor', 'hr', 'admin'].includes(role)"
        >
          <el-menu-item index="leave" @click="gotoPage('leave')">
            <i class="el-icon-date"></i>
            <span>請假申請</span>
          </el-menu-item>
        </template>

        <!-- 排班管理 (主管/HR/Admin) -->
        <template v-if="['supervisor', 'hr', 'admin'].includes(role)">
          <el-menu-item index="schedule" @click="gotoPage('schedule')">
            <i class="el-icon-timer"></i>
            <span>排班管理</span>
          </el-menu-item>
        </template>

        <!-- 簽核流程 (主管/HR/Admin) -->
        <template v-if="['supervisor', 'hr', 'admin'].includes(role)">
          <el-menu-item index="approval" @click="gotoPage('approval')">
            <i class="el-icon-s-operation"></i>
            <span>簽核流程</span>
          </el-menu-item>
        </template>
      </el-menu>

      <!-- 登出按鈕 -->
      <div class="logout-section">
        <el-button type="danger" @click="onLogout">登出</el-button>
      </div>
    </aside>

    <!-- 右側主內容區 -->
    <main class="main-view">
      <!-- 在此放置 router-view，顯示對應頁面 (Attendance, Leave, etc.) -->
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();

// 暫存角色，從 localStorage 讀取
const role = ref("employee");

onMounted(() => {
  // 讀取 localStorage
  const savedRole = localStorage.getItem("role");
  if (savedRole) {
    role.value = savedRole;
  }
});

// 點擊 Menu 切換子路由
function gotoPage(pageName) {
  // ex: pageName = 'attendance' => path = '/front/attendance'
  router.push(`/front/${pageName}`);
}

// 登出
function onLogout() {
  localStorage.removeItem("role");
  localStorage.removeItem("isAuthenticated");
  localStorage.removeItem("username");
  // 回到前台登入
  router.push({ name: "FrontLogin" });
}
</script>

<style scoped>
.front-layout {
  display: flex;
  height: 100vh; /* 讓畫面佔滿視窗 */
}

.sidebar {
  width: 220px;
  border-right: 1px solid #ebeef5;
  padding: 10px;
}

.logout-section {
  margin-top: 20px;
  display: flex;
  justify-content: center; /* 水平置中 */
}

.main-view {
  flex: 1;
  padding: 20px;
  overflow: auto;
}
</style>
