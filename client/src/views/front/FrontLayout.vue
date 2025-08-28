<template>
  <!-- 美化前台員工系統布局 -->
  <div class="front-layout">
    <!-- 左側導覽列 -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2 class="brand-title">員工系統</h2>
        <div class="user-info">
          <el-avatar :size="40" class="user-avatar">
            <i class="el-icon-user"></i>
          </el-avatar>
          <span class="user-name">{{ username || '員工' }}</span>
        </div>
      </div>
      
      <el-menu 
        :default-active="activeMenu" 
        class="sidebar-menu"
        background-color="#0f172a"
        text-color="#cbd5e1"
        active-text-color="#ffffff"
      >
        <el-menu-item
          v-for="item in menuItems"
          :key="item.name"
          :index="item.name"
          @click="gotoPage(item.name)"
          class="menu-item"
        >
          <el-icon class="menu-icon"><i :class="item.icon"></i></el-icon>
          <span class="menu-label">{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
      <!-- 進入後台按鈕 -->
      <div v-if="showManagerBtn" class="manager-section">
        <el-button
          type="primary"
          @click="gotoManager"
          class="manager-btn"
          block
          data-test="manager-btn"
        >
          進入後台
        </el-button>
      </div>

      <!-- 登出按鈕 -->
      <div class="logout-section">
        <el-button type="danger" @click="onLogout" class="logout-btn" block>
          <el-icon><i class="el-icon-switch-button" /></el-icon>
          登出系統
        </el-button>
      </div>
    </aside>

    <!-- 右側主內容區 -->
    <main class="main-view">
      <div class="content-wrapper">
        <router-view />
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useMenuStore } from "../../stores/menu";
import { clearToken } from "../../utils/tokenService";
import { storeToRefs } from "pinia";

const router = useRouter();
const route = useRoute();
const menuStore = useMenuStore();
const { items: menuItems } = storeToRefs(menuStore);

const username = ref("");
const activeMenu = computed(() => route.name?.toLowerCase() || "");
const showManagerBtn = ref(false);

onMounted(() => {
  const savedRole = localStorage.getItem("role");
  const savedUsername = localStorage.getItem("username");
  if (savedUsername) {
    username.value = savedUsername;
  }

  if (savedRole === "supervisor" || savedRole === "admin") {
    showManagerBtn.value = true;
  }

  if (menuItems.value.length === 0) {
    menuStore.fetchMenu();
  }
});

function gotoPage(pageName) {
  router.push(`/front/${pageName}`);
}

function gotoManager() {
  router.push(`/manager`);
}

function onLogout() {
  localStorage.removeItem("role");
  localStorage.removeItem("username");
  clearToken();
  router.push(`/`);
}
</script>

<style scoped>
/* 全新的前台員工系統樣式設計 */
.front-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  background: #f1f5f9;
}

.sidebar {
  flex: 0 0 280px;
  background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
  display: flex;
  flex-direction: column;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.1);
}

.sidebar-header {
  padding: 24px 20px;
  border-bottom: 1px solid rgba(203, 213, 225, 0.1);
  text-align: center;
}

.brand-title {
  color: #ffffff;
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 16px 0;
  letter-spacing: 0.5px;
}

.user-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.user-avatar {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #ffffff;
}

.user-name {
  color: #cbd5e1;
  font-size: 14px;
  font-weight: 500;
}

.sidebar-menu {
  flex: 1;
  border: none !important;
  background: transparent !important;
  padding: 16px 12px;
}

.menu-item {
  margin-bottom: 8px;
  border-radius: 8px !important;
  transition: all 0.3s ease;
  min-height: 48px !important;
  display: flex;
  align-items: center;
  padding: 0 16px !important;
}

.menu-item:hover {
  background-color: rgba(203, 213, 225, 0.1) !important;
  transform: translateX(4px);
}

.menu-item.is-active {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
}

.menu-icon {
  margin-right: 12px;
  font-size: 18px;
}

.menu-label {
  font-weight: 500;
  font-size: 14px;
}

.manager-section {
  padding: 20px;
  border-top: 1px solid rgba(203, 213, 225, 0.1);
}

.manager-btn {
  background: #3b82f6 !important;
  border: none !important;
  color: #ffffff !important;
  font-weight: 500;
  height: 44px;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.manager-btn:hover {
  background: #2563eb !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.logout-section {
  padding: 20px;
  border-top: 1px solid rgba(203, 213, 225, 0.1);
}

.logout-btn {
  background: rgba(239, 68, 68, 0.9) !important;
  border: none !important;
  color: #ffffff !important;
  font-weight: 500;
  height: 44px;
  border-radius: 8px;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.logout-btn:hover {
  background: #dc2626 !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

.main-view {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.content-wrapper {
  flex: 1;
  padding: 24px;
  overflow: auto;
  background: #ffffff;
  margin: 16px;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* 響應式設計 */
@media (max-width: 768px) {
  .sidebar {
    flex: 0 0 240px;
  }
  
  .content-wrapper {
    margin: 8px;
    padding: 16px;
  }
}

@media (max-width: 480px) {
  .front-layout {
    flex-direction: column;
  }
  
  .sidebar {
    flex: 0 0 auto;
    height: auto;
    flex-direction: row;
    padding: 8px;
  }
  
  .sidebar-header {
    display: none;
  }
  
  .sidebar-menu {
    display: flex;
    flex-direction: row;
    padding: 0;
    gap: 8px;
  }
  
  .menu-item {
    margin: 0;
    min-width: 80px;
    justify-content: center;
  }
  
  .menu-label {
    display: none;
  }

  .logout-section {
    padding: 8px;
  }

  .manager-section {
    padding: 8px;
  }
}
</style>
