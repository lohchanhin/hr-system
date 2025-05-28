<template>
  <div class="front-layout">
    <!-- 左側導覽列 -->
    <aside class="sidebar">
      <el-menu default-active="" class="el-menu-vertical-demo">
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
import { useMenuStore } from "../../stores/menu";
import { clearToken } from "../../utils/tokenService";
import { storeToRefs } from "pinia";

const router = useRouter();
const menuStore = useMenuStore();
const { items: menuItems } = storeToRefs(menuStore);

// 暫存角色，從 localStorage 讀取
const role = ref("employee");

onMounted(() => {
  // 讀取 localStorage
  const savedRole = localStorage.getItem("role");
  if (savedRole) {
    role.value = savedRole;
  }
  if (menuItems.value.length === 0) {
    menuStore.fetchMenu();
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
  localStorage.removeItem("username");
  clearToken();
  // 回到前台登入
  router.push(`/`);
}
</script>

<style scoped>
.front-layout {
  display: flex;
  height: 100vh; /* 讓畫面佔滿視窗 */
  width: 100vw; /* 讓寬度也滿版 */
}

.sidebar {
  flex: 0 0 25%;
  border-right: 1px solid #ebeef5;
  padding: 10px;
}

.logout-section {
  margin-top: 20px;
  display: flex;
  justify-content: center; /* 水平置中 */
}

.main-view {
  flex: 0 0 75%;
  padding: 20px;
  overflow: auto;
}
</style>
