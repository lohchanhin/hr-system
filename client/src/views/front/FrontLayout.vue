<template>
  <!-- 員工系統外框：桌機是左側導覽列；手機（寬度小於 768px）是上方細標題列＋底部分頁列，內容用滿整個寬度 -->
  <div class="front-layout" :class="{ 'is-mobile': isMobile }">
    <!-- 手機：上方細標題列（系統名稱、頭像選單） -->
    <header v-if="isMobile" class="mobile-topbar" data-test="mobile-topbar">
      <span class="mobile-title">員工系統</span>
      <el-dropdown trigger="click" placement="bottom-end" popper-class="front-user-popper" @command="onUserCommand">
        <button type="button" class="avatar-button" aria-label="個人選單" data-test="user-menu-trigger">
          <EmployeeAvatar :employee="profileAvatar" :size="32" :lazy="false" />
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <li class="front-user-profile" data-test="user-menu-profile">
              <span class="front-user-profile__name">{{ displayName }}</span>
              <span v-if="identityLine" class="front-user-profile__meta">{{ identityLine }}</span>
            </li>
            <el-dropdown-item command="password" :icon="Lock" divided data-test="user-menu-password">變更密碼</el-dropdown-item>
            <el-dropdown-item v-if="hasBackOffice" command="back-office" :icon="Monitor" data-test="user-menu-back-office">
              後台管理
            </el-dropdown-item>
            <el-dropdown-item command="logout" :icon="SwitchButton" divided data-test="user-menu-logout">登出</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </header>

    <!-- 桌機：左側導覽列 -->
    <aside v-else :class="['sidebar', { collapsed: isSidebarCollapsed }]">
      <div class="sidebar-top">
        <div class="logo-brand">
          <img :src="hrLogo" alt="" class="logo-image" />
          <span v-if="!isSidebarCollapsed" class="brand-title">員工系統</span>
        </div>
        <el-tooltip :content="toggleTooltip" placement="right">
          <button
            type="button"
            class="toggle-btn"
            :aria-label="toggleTooltip"
            :aria-expanded="!isSidebarCollapsed"
            data-test="sidebar-toggle"
            @click="toggleSidebar"
          >
            <el-icon :size="18"><component :is="isSidebarCollapsed ? Expand : Fold" /></el-icon>
          </button>
        </el-tooltip>
      </div>

      <!-- 登入者：頭像、姓名、一行「機構・部門・小單位」，完整內容滑鼠停留時顯示 -->
      <div class="sidebar-header identity" :title="identityTitle" data-test="identity">
        <EmployeeAvatar :employee="profileAvatar" :size="36" :lazy="false" class="identity-avatar" />
        <div v-if="!isSidebarCollapsed" class="identity-text">
          <span class="identity-name">{{ displayName }}</span>
          <span v-if="identityLine" class="identity-meta" data-test="identity-meta">{{ identityLine }}</span>
        </div>
      </div>

      <el-menu :default-active="activeMenu" class="sidebar-menu" :collapse="isSidebarCollapsed" :collapse-transition="false">
        <el-menu-item
          v-for="item in navItems"
          :key="item.name"
          :index="item.name"
          :title="isSidebarCollapsed ? item.label : undefined"
          class="menu-item"
          @click="gotoPage(item.name)"
        >
          <img
            v-if="hasMenuIconImage(item)"
            :src="resolveMenuIcon(item)"
            class="menu-icon"
            :data-icon-key="item.icon"
            alt=""
          />
          <el-icon v-else class="menu-icon menu-glyph" :size="22"><component :is="resolveMenuGlyph(item)" /></el-icon>
          <span class="menu-label">{{ item.label }}</span>
        </el-menu-item>
      </el-menu>

      <div class="sidebar-footer">
        <button
          v-if="hasBackOffice"
          type="button"
          class="footer-btn"
          :title="isSidebarCollapsed ? '後台管理' : undefined"
          aria-label="後台管理"
          data-test="manager-btn"
          @click="gotoBackOffice"
        >
          <el-icon :size="18"><Monitor /></el-icon>
          <span v-if="!isSidebarCollapsed">後台管理</span>
        </button>
        <button
          type="button"
          class="footer-btn logout-btn"
          :title="isSidebarCollapsed ? '登出' : undefined"
          aria-label="登出"
          data-test="logout-btn"
          @click="onLogout"
        >
          <el-icon :size="18"><SwitchButton /></el-icon>
          <span v-if="!isSidebarCollapsed" class="logout-text">登出</span>
        </button>
      </div>
    </aside>

    <main class="main-view">
      <div class="content-wrapper">
        <router-view />
      </div>
    </main>

    <!-- 手機：底部分頁列（最多 5 格，放不下的收進「更多」） -->
    <nav v-if="isMobile" class="mobile-tabbar" aria-label="主要功能" data-test="mobile-tabbar">
      <button
        v-for="item in visibleTabs"
        :key="item.name"
        type="button"
        class="tab"
        :class="{ 'is-active': activeMenu === item.name }"
        :aria-current="activeMenu === item.name ? 'page' : undefined"
        :data-tab="item.name"
        @click="gotoPage(item.name)"
      >
        <el-icon :size="22"><component :is="resolveMenuGlyph(item)" /></el-icon>
        <span class="tab-label">{{ item.label }}</span>
      </button>
      <button
        v-if="overflowTabs.length"
        type="button"
        class="tab"
        :class="{ 'is-active': overflowActive }"
        :aria-expanded="moreOpen"
        data-tab="more"
        @click="moreOpen = true"
      >
        <el-icon :size="22"><MoreFilled /></el-icon>
        <span class="tab-label">更多</span>
      </button>
    </nav>

    <el-drawer
      v-if="isMobile && overflowTabs.length"
      v-model="moreOpen"
      direction="btt"
      size="auto"
      :with-header="false"
      class="front-more-sheet"
    >
      <button
        v-for="item in overflowTabs"
        :key="item.name"
        type="button"
        class="front-more-item"
        :class="{ 'is-active': activeMenu === item.name }"
        :data-more="item.name"
        @click="gotoPage(item.name)"
      >
        <el-icon :size="20"><component :is="resolveMenuGlyph(item)" /></el-icon>
        <span>{{ item.label }}</span>
      </button>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, onBeforeUnmount, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { Expand, Fold, Lock, Monitor, MoreFilled, SwitchButton } from "@element-plus/icons-vue";
import { useMenuStore } from "../../stores/menu";
import { useProfileStore } from "../../stores/profile";
import { useAuthStore } from "../../stores/auth";
import { hasMenuIconImage, resolveMenuGlyph, resolveMenuIcon } from "../../constants/menuIcons";
import {
  BACK_OFFICE_HOME,
  endSession,
  frontMenuItems,
  isChangePasswordMenuName,
} from "../../utils/authNavigation";
import EmployeeAvatar from "../../components/EmployeeAvatar.vue";

const MOBILE_MAX_WIDTH = 768;
const AUTO_COLLAPSE_MAX_WIDTH = 1024;
const MAX_TABS = 5;
// 排班預覽是排班管理的子頁，導覽上仍算在「排班管理」
const PARENT_MENU = { PreviewWeek: "Schedule", PreviewMonth: "Schedule" };

const router = useRouter();
const route = useRoute();
const menuStore = useMenuStore();
const { items: menuItems } = storeToRefs(menuStore);
const profileStore = useProfileStore();
const { profile } = storeToRefs(profileStore);
const authStore = useAuthStore();

const hrLogo = "/HR.png";
// 第一次畫就要知道螢幕寬度：等到 mounted 才判斷的話，手機上每次載入都會先閃一下桌機的側欄
const initialWidth = typeof window !== "undefined" ? window.innerWidth : AUTO_COLLAPSE_MAX_WIDTH + 1;
const isMobile = ref(initialWidth < MOBILE_MAX_WIDTH);
const isSidebarCollapsed = ref(initialWidth <= AUTO_COLLAPSE_MAX_WIDTH);
const hasManualSidebarOverride = ref(false);
const moreOpen = ref(false);
const toggleTooltip = computed(() =>
  isSidebarCollapsed.value ? "展開側欄" : "收合側欄"
);

// 只列前台的頁面：管理員的選單（後台項目）不會混進員工系統。
// 伺服器有回前台選單（/api/menu?include=front 的 frontItems，管理員也有）就照它列；
// 舊版伺服器沒有 frontItems 時才從 items 挑出前台頁面
const navItems = computed(() => frontMenuItems(menuItems.value, authStore.role, menuStore.frontItems));
const hasBackOffice = computed(() => authStore.role === "admin");

const activeMenu = computed(() => {
  const name = typeof route.name === "string" ? route.name : "";
  const parent = PARENT_MENU[name];
  if (parent && navItems.value.some((item) => item.name === parent)) return parent;
  return name;
});

// 手機底部分頁：變更密碼收在頭像選單，其餘超過 5 個時留 4 個＋「更多」
const tabItems = computed(() =>
  navItems.value.filter((item) => !isChangePasswordMenuName(item.name))
);
const visibleTabs = computed(() =>
  tabItems.value.length > MAX_TABS ? tabItems.value.slice(0, MAX_TABS - 1) : tabItems.value
);
const overflowTabs = computed(() =>
  tabItems.value.length > MAX_TABS ? tabItems.value.slice(MAX_TABS - 1) : []
);
const overflowActive = computed(() =>
  overflowTabs.value.some((item) => item.name === activeMenu.value)
);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

const displayName = computed(() => cleanText(profile.value?.name) || "員工");

// 頭像：個人資料裡的 id 是員工的 _id；照片由 EmployeeAvatar 經共用快取下載，
// 在後台改了自己的照片之後（個人資料重新讀取、照片快取作廢）會自動換成新的
const profileAvatar = computed(() => ({
  _id: profile.value?._id || profile.value?.id || profile.value?.employeeId || "",
  name: displayName.value,
  photo: profile.value?.photo,
  hasPhoto: profile.value?.hasPhoto,
}));

const identityParts = computed(() => [
  ["機構", cleanText(profile.value?.organizationName)],
  ["部門", cleanText(profile.value?.departmentName)],
  ["小單位", cleanText(profile.value?.subDepartmentName)],
]);

const identityLine = computed(() =>
  identityParts.value
    .map(([, value]) => value)
    .filter(Boolean)
    .join("・")
);

const identityTitle = computed(() =>
  [displayName.value, ...identityParts.value.filter(([, value]) => value).map(([label, value]) => `${label}：${value}`)].join("\n")
);

function updateViewport() {
  if (typeof window === "undefined") {
    return;
  }
  isMobile.value = window.innerWidth < MOBILE_MAX_WIDTH;
  if (!isMobile.value) {
    moreOpen.value = false;
  }
  if (!hasManualSidebarOverride.value) {
    isSidebarCollapsed.value = window.innerWidth <= AUTO_COLLAPSE_MAX_WIDTH;
  }
}

function storedEmployeeId() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage?.getItem("employeeId") || window.localStorage?.getItem("employeeId") || "";
}

onMounted(() => {
  authStore.loadUser({ forceRefresh: true });

  if (menuItems.value.length === 0) {
    menuStore.fetchMenu();
  }

  // 角色之後才改變（例如另一個分頁換了帳號）時重新讀選單。開頁時 loadUser 把預設的 employee 換成
  // 主管／管理員也是一次「改變」：以前在這之前就開始監看，每次進前台都多讀一次 /api/menu
  watch(
    () => authStore.role,
    (newRole, oldRole) => {
      if (newRole !== oldRole) {
        menuStore.fetchMenu();
      }
    }
  );

  // 快取的個人資料是別人的（同一個分頁換了帳號）時重新讀取，不顯示上一個人的姓名與頭像
  const cached = profile.value;
  const employeeId = storedEmployeeId();
  const stale = Boolean(cached && employeeId && String(cached.id || cached.employeeId || "") !== employeeId);
  profileStore
    .fetchProfile({ force: stale })
    .catch(() => {
      // 取得個人資料失敗時不阻擋主畫面載入，於此靜默處理
    });

  updateViewport();
  if (typeof window !== "undefined") {
    window.addEventListener("resize", updateViewport);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", updateViewport);
  }
});

function gotoPage(pageName) {
  moreOpen.value = false;
  router.push({ name: pageName });
}

function gotoBackOffice() {
  router.push(BACK_OFFICE_HOME);
}

function toggleSidebar() {
  hasManualSidebarOverride.value = true;
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
}

function onLogout() {
  endSession();
  router.push(`/`);
}

function onUserCommand(command) {
  if (command === "password") {
    gotoPage("FrontChangePassword");
  } else if (command === "back-office") {
    gotoBackOffice();
  } else if (command === "logout") {
    onLogout();
  }
}
</script>

<style scoped>
.front-layout {
  --front-sidebar-width: 240px;
  --front-sidebar-collapsed-width: 64px;
  display: flex;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--hr-white);
}

/* ---------- 桌機：左側導覽列 ---------- */
.sidebar {
  flex: 0 0 var(--front-sidebar-width);
  width: var(--front-sidebar-width);
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--hr-gray-900);
  color: var(--hr-gray-300);
}

.sidebar.collapsed {
  flex-basis: var(--front-sidebar-collapsed-width);
  width: var(--front-sidebar-collapsed-width);
}

.sidebar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 56px;
  padding: 0 12px 0 16px;
}

.logo-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.logo-image {
  width: 28px;
  height: 28px;
  object-fit: contain;
}

.brand-title {
  color: var(--hr-white);
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
}

.toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--hr-gray-400);
  cursor: pointer;
}

.toggle-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--hr-white);
}

.sidebar.collapsed .sidebar-top {
  justify-content: center;
  padding: 0;
}

.sidebar.collapsed .logo-brand {
  display: none;
}

.identity {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 12px 8px;
  padding: 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
}

.identity-avatar {
  flex: 0 0 auto;
}

.identity-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.35;
}

.identity-name {
  color: var(--hr-white);
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-meta {
  color: var(--hr-gray-400);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar.collapsed .identity {
  justify-content: center;
  margin: 4px 0 8px;
  padding: 0;
  background: transparent;
}

.sidebar-menu {
  --el-menu-bg-color: transparent;
  --el-menu-text-color: var(--hr-gray-300);
  --el-menu-active-color: var(--hr-white);
  --el-menu-hover-bg-color: rgba(255, 255, 255, 0.08);
  --el-menu-item-height: 44px;
  flex: 1;
  min-height: 0;
  padding: 4px 12px;
  border: none;
  overflow-x: hidden;
  overflow-y: auto;
}

.sidebar-menu.el-menu--collapse {
  width: 100%;
  padding: 4px 8px;
}

.menu-item {
  position: relative;
  gap: 12px;
  margin-bottom: 2px;
  padding: 0 12px !important;
  border-radius: 8px;
}

.menu-item.is-active {
  background: rgba(255, 255, 255, 0.12);
  font-weight: 600;
}

/* 目前頁面：左側一小段白色標記（導覽的強調色全站一致：深色側欄用白色，淺色底的底部分頁列用主色） */
.menu-item.is-active::before {
  content: "";
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 0;
  width: 3px;
  border-radius: 2px;
  background: var(--hr-white);
}

.menu-icon {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.menu-glyph {
  margin: 0;
  color: var(--hr-gray-300);
}

.menu-label {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar.collapsed .menu-item {
  justify-content: center;
  padding: 0 !important;
}

.sidebar.collapsed .menu-label {
  display: none;
}

.sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.footer-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--hr-gray-300);
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.footer-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--hr-white);
}

.sidebar.collapsed .sidebar-footer {
  padding: 8px;
}

.sidebar.collapsed .footer-btn {
  justify-content: center;
  padding: 0;
}

/* ---------- 內容區 ---------- */
.main-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* --hr-shell-padding：內容區的留白，共用樣式 .hr-sticky-bar（固定在頂端的頁首／工具列）靠它算位置 */
.content-wrapper {
  --hr-shell-padding: 24px;
  flex: 1;
  min-height: 0;
  padding: var(--hr-shell-padding);
  overflow: auto;
  background: var(--hr-white);
}

/* ---------- 手機：上方標題列＋底部分頁列 ---------- */
.front-layout.is-mobile {
  flex-direction: column;
}

.mobile-topbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: calc(48px + env(safe-area-inset-top, 0px));
  padding: env(safe-area-inset-top, 0px) calc(8px + env(safe-area-inset-right, 0px)) 0
    calc(16px + env(safe-area-inset-left, 0px));
  border-bottom: 1px solid var(--hr-gray-200);
  background: var(--hr-white);
}

.mobile-title {
  color: var(--hr-gray-900);
  font-size: 16px;
  font-weight: 600;
}

.avatar-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.front-layout.is-mobile .content-wrapper {
  --hr-shell-padding: 12px;
}

.mobile-tabbar {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  border-top: 1px solid var(--hr-gray-200);
  background: var(--hr-white);
}

.tab {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 56px;
  padding: 0 2px;
  border: none;
  background: transparent;
  color: var(--hr-gray-500);
  font-family: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.tab-label {
  max-width: 100%;
  font-size: 11px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 目前的分頁：用系統主色（和按鈕、連結、頁籤同一個顏色；以前是綠色） */
.tab.is-active {
  color: var(--el-color-primary);
  font-weight: 600;
}
</style>

<style>
/* 頭像選單與「更多」面板會被 Element Plus 搬到 body 底下，scoped 樣式套不到，所以放在這裡並加上專用的 class */
.front-user-popper .el-dropdown-menu {
  min-width: 200px;
  max-width: calc(100vw - 24px);
}

.front-user-popper .el-dropdown-menu__item {
  min-height: 44px;
  font-size: 15px;
}

.front-user-profile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 16px 10px;
  line-height: 1.4;
  list-style: none;
}

.front-user-profile__name {
  color: var(--hr-gray-900);
  font-size: 15px;
  font-weight: 600;
}

.front-user-profile__meta {
  color: var(--hr-gray-500);
  font-size: 12px;
  word-break: break-all;
}

.front-more-sheet .el-drawer__body {
  display: flex;
  flex-direction: column;
  padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px));
}

.front-more-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--hr-gray-700);
  font-family: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}

.front-more-item.is-active {
  color: var(--el-color-primary);
  font-weight: 600;
}
</style>
