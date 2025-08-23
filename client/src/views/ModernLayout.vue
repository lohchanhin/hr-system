<template>
  <el-container class="modern-layout">
    <el-header class="layout-header">
      <div class="header-left">
        <el-button link @click="toggleCollapse" class="collapse-btn">
          <el-icon size="20"><i :class="isCollapse ? 'el-icon-menu' : 'el-icon-close'" /></el-icon>
        </el-button>
        <h1 class="system-title">HR 管理系統</h1>
      </div>
      <div class="header-right">
        <el-button type="primary" @click="logout" class="logout-btn">
          <el-icon><i class="el-icon-switch-button" /></el-icon>
          登出
        </el-button>
      </div>
    </el-header>
    <el-container>
      <el-aside class="layout-aside" :width="isCollapse ? '64px' : '280px'">
        <div class="sidebar-content">
          <el-menu 
            :default-active="active" 
            :collapse="isCollapse"
            class="sidebar-menu"
            background-color="#164e63"
            text-color="#ecfeff"
            active-text-color="#ffffff"
          >
            <el-menu-item
              v-for="item in menuItems"
              :key="item.name"
              :index="item.name"
              @click="gotoPage(item.name)"
              class="menu-item"
            >
              <el-icon><i :class="item.icon"></i></el-icon>
              <span class="menu-text">{{ item.label }}</span>
            </el-menu-item>
          </el-menu>
        </div>
      </el-aside>
      <el-main class="layout-main">
        <div class="main-content">
          <router-view />
        </div>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMenuStore } from '../stores/menu'
import { clearToken } from '../utils/tokenService'
import { storeToRefs } from 'pinia'

const router = useRouter()
const menuStore = useMenuStore()
const { items: menuItems } = storeToRefs(menuStore)

const active = ref('')
const isCollapse = ref(false)

onMounted(async () => {
  if (menuItems.value.length === 0) {
    await menuStore.fetchMenu()
  }
})

function gotoPage(name) {
  active.value = name
  router.push({ name })
}
function toggleCollapse() {
  isCollapse.value = !isCollapse.value
}

function logout() {
  clearToken()
  localStorage.removeItem('role')
  localStorage.removeItem('employeeId')
  router.push('/')
}
</script>

<style scoped>
.modern-layout {
  height: 100vh;
  background: #f8fafc;
}

.layout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
  background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
  border-bottom: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  padding: 0 24px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-right {
  display: flex;
  align-items: center;
}

.collapse-btn {
  color: #ecfeff !important;
  font-size: 18px;
  padding: 8px;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.collapse-btn:hover {
  background-color: rgba(236, 254, 255, 0.1) !important;
  color: #ffffff !important;
}

.system-title {
  color: #ffffff;
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  letter-spacing: 0.5px;
}

.logout-btn {
  background: rgba(239, 68, 68, 0.9) !important;
  border: none !important;
  color: #ffffff !important;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.logout-btn:hover {
  background: #dc2626 !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

.layout-aside {
  background: #164e63;
  border-right: none;
  transition: width 0.3s ease;
  overflow: hidden;
}

.sidebar-content {
  height: 100%;
  padding: 16px 0;
}

.sidebar-menu {
  border: none !important;
  background: transparent !important;
}

.menu-item {
  margin: 4px 12px;
  border-radius: 8px !important;
  transition: all 0.3s ease;
  min-height: 48px !important;
  display: flex;
  align-items: center;
}

.menu-item:hover {
  background-color: rgba(236, 254, 255, 0.1) !important;
  transform: translateX(4px);
}

.menu-item.is-active {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
}

.menu-text {
  font-weight: 500;
  font-size: 14px;
}

.layout-main {
  background: #f8fafc;
  padding: 0;
  overflow: hidden;
}

.main-content {
  height: 100%;
  padding: 24px;
  overflow: auto;
  background: #ffffff;
  margin: 16px;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

@media (max-width: 768px) {
  .layout-aside {
    position: fixed;
    z-index: 1000;
    height: calc(100vh - 64px);
    top: 64px;
    left: 0;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
  }
  
  .system-title {
    display: none;
  }
  
  .main-content {
    margin: 8px;
    padding: 16px;
  }
}

@media (max-width: 480px) {
  .layout-header {
    padding: 0 16px;
  }
  
  .logout-btn span {
    display: none;
  }
}
</style>
