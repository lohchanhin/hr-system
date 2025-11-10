<template>
  <!-- 美化前台員工系統布局 -->
  <div class="front-layout">
    <!-- 左側導覽列 -->
    <aside :class="['sidebar', { collapsed: isSidebarCollapsed }]">
      <div class="logo-area">
        <img :src="hrLogo" alt="HR 品牌" class="logo-image" />
        <span class="brand-title" v-if="!isSidebarCollapsed">員工系統</span>
      </div>
      <div v-if="!isSidebarCollapsed" class="sidebar-header">
        <div class="user-info">
          <el-avatar :size="40" class="user-avatar">
            <i class="el-icon-user"></i>
          </el-avatar>
          <span class="user-name">{{ displayName }}</span>
          <el-descriptions
            class="profile-descriptions"
            size="small"
            :column="1"
            border
            :label-style="{ width: '72px' }"
          >
            <el-descriptions-item label="姓名">
              <el-tooltip :content="displayName" placement="top">
                <span class="info-text">{{ displayName }}</span>
              </el-tooltip>
            </el-descriptions-item>
            <el-descriptions-item label="機構">
              <el-tooltip :content="displayOrganization" placement="top">
                <span class="info-text">{{ displayOrganization }}</span>
              </el-tooltip>
            </el-descriptions-item>
            <el-descriptions-item label="部門">
              <el-tooltip :content="displayDepartment" placement="top">
                <span class="info-text">{{ displayDepartment }}</span>
              </el-tooltip>
            </el-descriptions-item>
            <el-descriptions-item label="小單位">
              <el-tooltip :content="displaySubDepartment" placement="top">
                <span class="info-text">{{ displaySubDepartment }}</span>
              </el-tooltip>
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </div>

      <el-menu
        :default-active="activeMenu"
        class="sidebar-menu"
        background-color="#0f172a"
        text-color="#cbd5e1"
        active-text-color="#ffffff"
        :collapse="isSidebarCollapsed"
        :default-openeds="expandedGroups"
        @open="handleGroupOpen"
        @close="handleGroupClose"
      >
        <el-sub-menu
          v-for="group in menuItems"
          :key="group.group"
          :index="group.group"
          class="menu-group"
        >
          <template #title>
            <div class="menu-group-title" :class="{ 'is-collapsed': isSidebarCollapsed }">
              <el-tooltip
                v-if="isSidebarCollapsed"
                :content="group.group"
                placement="right"
                effect="dark"
              >
                <img
                  :src="resolveIcon(group.children?.[0])"
                  class="menu-icon"
                  :data-icon-key="availableMenuIcons[group.children?.[0]?.icon] ? group.children?.[0]?.icon : 'default'"
                  alt=""
                />
              </el-tooltip>
              <img
                v-else
                :src="resolveIcon(group.children?.[0])"
                class="menu-icon"
                :data-icon-key="availableMenuIcons[group.children?.[0]?.icon] ? group.children?.[0]?.icon : 'default'"
                alt=""
              />
              <span v-if="!isSidebarCollapsed" class="menu-label">{{ group.group }}</span>
            </div>
          </template>
          <el-menu-item
            v-for="item in group.children"
            :key="item.name"
            :index="item.name"
            @click="gotoPage(item.name, group.group)"
            :class="['menu-item', { 'is-active': activeMenu === item.name }]"
          >
            <div class="menu-item-inner" :class="{ 'is-collapsed': isSidebarCollapsed }">
              <el-tooltip
                v-if="isSidebarCollapsed"
                :content="item.label"
                placement="right"
                effect="dark"
              >
                <img
                  :src="resolveIcon(item)"
                  class="menu-icon"
                  :data-icon-key="availableMenuIcons[item.icon] ? item.icon : 'default'"
                  alt=""
                />
              </el-tooltip>
              <img
                v-else
                :src="resolveIcon(item)"
                class="menu-icon"
                :data-icon-key="availableMenuIcons[item.icon] ? item.icon : 'default'"
                alt=""
              />
              <span v-if="!isSidebarCollapsed" class="menu-label">{{ item.label }}</span>
            </div>
          </el-menu-item>
        </el-sub-menu>
      </el-menu>
      <!-- 登出按鈕 -->
      <div class="logout-section">
        <el-button type="danger" @click="onLogout" class="logout-btn" block>
          <el-icon><i class="el-icon-switch-button" /></el-icon>
          <span class="logout-text" v-if="!isSidebarCollapsed">登出系統</span>
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
import { ref, onMounted, computed, onBeforeUnmount, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useMenuStore } from "../../stores/menu";
import { useProfileStore } from "../../stores/profile";
import { clearToken } from "../../utils/tokenService";
import { storeToRefs } from "pinia";
import { iconMap as availableMenuIcons, resolveMenuIcon } from "../../constants/menuIcons";

const router = useRouter();
const route = useRoute();
const menuStore = useMenuStore();
const { items: menuItems, flattenedItems } = storeToRefs(menuStore);
const profileStore = useProfileStore();
const { profile } = storeToRefs(profileStore);

const username = ref("");
const activeMenu = ref(typeof route.name === "string" ? route.name : "");
const isSidebarCollapsed = ref(false);
const expandedGroups = ref([]);

const fallbackText = "未提供";

function formatText(value, fallback = fallbackText) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : fallback;
  }
  if (value) {
    return `${value}`;
  }
  return fallback;
}

const displayName = computed(() => {
  const fromProfile = profile.value?.name;
  if (typeof fromProfile === "string" && fromProfile.trim().length) {
    return fromProfile.trim();
  }
  return username.value || "員工";
});

const displayOrganization = computed(() =>
  formatText(profile.value?.organizationName)
);

const displayDepartment = computed(() =>
  formatText(profile.value?.departmentName)
);

const displaySubDepartment = computed(() =>
  formatText(profile.value?.subDepartmentName)
);

function updateSidebarCollapse() {
  if (typeof window === "undefined") {
    return;
  }
  isSidebarCollapsed.value = window.innerWidth <= 1024;
}

onMounted(() => {
  const savedUsername = localStorage.getItem("username");
  if (savedUsername) {
    username.value = savedUsername;
  }

  if (menuItems.value.length === 0) {
    menuStore.fetchMenu();
  }

  profileStore
    .fetchProfile()
    .catch(() => {
      // 取得個人資料失敗時不阻擋主畫面載入，於此靜默處理
    });

  updateSidebarCollapse();
  if (typeof window !== "undefined") {
    window.addEventListener("resize", updateSidebarCollapse);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", updateSidebarCollapse);
  }
});

function resolveIcon(item) {
  return resolveMenuIcon(item);
}

function gotoPage(pageName, groupName) {
  if (groupName && !expandedGroups.value.includes(groupName)) {
    expandedGroups.value = [...expandedGroups.value, groupName];
  }
  activeMenu.value = pageName;
  router.push({ name: pageName });
}

function onLogout() {
  localStorage.removeItem("role");
  localStorage.removeItem("username");
  localStorage.removeItem("employeeId");
  sessionStorage.removeItem("role");
  sessionStorage.removeItem("employeeId");
  clearToken();
  menuStore.setMenu([]);
  profileStore.clearProfile();
  router.push(`/`);
}

watch(
  () => menuItems.value,
  groups => {
    if (!Array.isArray(groups) || groups.length === 0) {
      expandedGroups.value = [];
      return;
    }
    const groupNames = groups.map(group => group?.group).filter(Boolean);
    if (expandedGroups.value.length === 0) {
      expandedGroups.value = groupNames.slice(0, 1);
    } else {
      const retained = expandedGroups.value.filter(name => groupNames.includes(name));
      expandedGroups.value = retained.length > 0 ? retained : groupNames.slice(0, 1);
    }
  },
  { immediate: true }
);

watch(
  () => flattenedItems.value,
  items => {
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }
    const firstName = items[0]?.name;
    if (!firstName) {
      return;
    }
    if (!items.some(item => item?.name === activeMenu.value)) {
      activeMenu.value = firstName;
      const currentName = router.currentRoute?.value?.name;
      if (currentName !== firstName) {
        router.replace({ name: firstName }).catch(() => {});
      }
    }
  },
  { immediate: true }
);

watch(
  () => route.name,
  name => {
    if (typeof name === "string" && flattenedItems.value.some(item => item?.name === name)) {
      activeMenu.value = name;
    }
  },
  { immediate: true }
);

function handleGroupOpen(index) {
  if (!expandedGroups.value.includes(index)) {
    expandedGroups.value = [...expandedGroups.value, index];
  }
}

function handleGroupClose(index) {
  expandedGroups.value = expandedGroups.value.filter(name => name !== index);
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
  transition: flex-basis 0.3s ease, width 0.3s ease;
}

.sidebar.collapsed {
  flex: 0 0 88px;
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 20px 16px 20px;
  border-bottom: 1px solid rgba(203, 213, 225, 0.12);
}

.logo-image {
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.35);
  transition: transform 0.3s ease;
}

.sidebar.collapsed .logo-area {
  justify-content: center;
  padding: 20px 12px;
}

.sidebar.collapsed .logo-image {
  transform: scale(0.9);
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

.profile-descriptions {
  width: 100%;
  margin-top: 12px;
  background-color: rgba(0, 0, 0, 0.35);
  border-color: rgba(0, 0, 0, 0.2);
  --el-descriptions-table-row-bg-color: transparent;
  --el-descriptions-table-border: 1px solid rgba(148, 163, 184, 0.2);
}

.profile-descriptions ::v-deep(.el-descriptions__label) {
  color: #000000;
}

.profile-descriptions ::v-deep(.el-descriptions__content) {
  color: #000000;
}

.info-text {
  display: inline-block;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-menu {
  flex: 1;
  border: none !important;
  background: transparent !important;
  padding: 16px 12px;
}

.sidebar-menu.el-menu--collapse {
  padding: 16px 8px;
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

.menu-group-title {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 16px;
  border-radius: 10px;
  color: #e2e8f0;
  font-weight: 600;
  transition: background-color 0.3s ease;
}

.menu-group-title.is-collapsed {
  justify-content: center;
  gap: 0;
  padding: 10px;
}

.menu-item-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.menu-item-inner.is-collapsed {
  justify-content: center;
  gap: 0;
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
  width: 28px;
  height: 28px;
  margin-right: 12px;
  object-fit: contain;
  transition: transform 0.3s ease, filter 0.3s ease;
}

.menu-item:hover .menu-icon {
  transform: scale(1.05);
  filter: drop-shadow(0 4px 6px rgba(15, 76, 117, 0.35));
}

.menu-label {
  font-weight: 500;
  font-size: 14px;
}

.menu-group :deep(.el-sub-menu__title) {
  padding: 0 !important;
}

.menu-group :deep(.el-menu-item) {
  background: transparent !important;
}

.sidebar.collapsed .menu-item {
  justify-content: center;
  padding: 0 8px !important;
}

.sidebar.collapsed .menu-icon {
  margin-right: 0;
}

.sidebar.collapsed .menu-label {
  display: none;
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

.sidebar.collapsed .logout-section {
  padding: 16px 12px;
}

.sidebar.collapsed .logout-btn {
  gap: 0;
}

.logout-text {
  display: inline-flex;
  align-items: center;
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
}
</style>
