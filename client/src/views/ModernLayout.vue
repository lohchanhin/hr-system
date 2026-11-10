<template>
  <!-- 後台外框：上方標題列（系統名稱只出現在這裡）＋左側選單；窄螢幕（寬度小於 768px）選單改成抽屜 -->
  <el-container class="modern-layout" :class="{ 'is-mobile': isMobile }">
    <el-header class="layout-header">
      <div class="header-left">
        <button
          type="button"
          class="collapse-btn header-icon-btn"
          :aria-label="toggleLabel"
          :aria-expanded="!isSidebarCollapsed"
          :title="toggleLabel"
          @click="toggleCollapse"
        >
          <el-icon :size="20"><component :is="toggleIcon" /></el-icon>
        </button>
        <span class="system-title">HR 管理系統</span>
      </div>
      <div class="header-right">
        <GlobalHelpButton v-if="currentHelp" :help="currentHelp" />
        <button
          v-if="hasFront"
          type="button"
          class="header-action"
          aria-label="員工前台"
          title="切換到員工前台"
          data-test="switch-to-front"
          @click="gotoFront"
        >
          <el-icon :size="18"><User /></el-icon>
          <span class="header-action-text">員工前台</span>
        </button>
        <div v-if="headerUser.name" class="header-user" data-test="header-user">
          <EmployeeAvatar :employee="headerUser" :size="32" :lazy="false" />
          <span class="header-user-name">{{ headerUser.name }}</span>
        </div>
        <button type="button" class="header-action logout-btn" aria-label="登出" title="登出" data-test="logout-btn" @click="logout">
          <el-icon :size="18"><SwitchButton /></el-icon>
          <span class="header-action-text">登出</span>
        </button>
      </div>
    </el-header>
    <el-container class="layout-body">
      <el-aside
        class="layout-aside"
        :class="{
          collapsed: !isMobile && isSidebarCollapsed,
          'is-open': !isSidebarCollapsed
        }"
        :width="asideWidth"
      >
        <el-menu
          :default-active="active"
          :collapse="isSidebarCollapsed"
          :collapse-transition="false"
          class="sidebar-menu"
        >
          <el-menu-item
            v-for="item in navItems"
            :key="item.name"
            :index="item.name"
            @click="gotoPage(item.name)"
            class="menu-item"
          >
            <div class="menu-item-inner" :class="{ 'is-collapsed': isSidebarCollapsed }">
              <el-tooltip
                :disabled="!isSidebarCollapsed"
                :content="item.label"
                placement="right"
                effect="dark"
              >
                <img
                  v-if="hasMenuIconImage(item)"
                  :src="resolveMenuIcon(item)"
                  class="menu-icon"
                  :data-icon-key="item.icon"
                  alt=""
                />
                <el-icon v-else class="menu-icon menu-glyph" :size="22"><component :is="resolveMenuGlyph(item)" /></el-icon>
              </el-tooltip>
              <span v-if="!isSidebarCollapsed" class="menu-text">{{ item.label }}</span>
            </div>
          </el-menu-item>
        </el-menu>
      </el-aside>
      <div
        v-if="isMobile"
        class="hr-mobile-overlay"
        :class="{ 'is-open': isMobileMenuOpen }"
        @click="closeMobileMenu"
      />
      <el-main
        class="layout-main"
        :class="{ 'with-sidebar': !isMobile && !isSidebarCollapsed }"
      >
        <div class="main-content">
          <router-view />
        </div>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Close, Expand, Fold, SwitchButton, User } from '@element-plus/icons-vue'
import { useMenuStore } from '../stores/menu'
import { useProfileStore } from '../stores/profile'
import { useAuthStore } from '../stores/auth'
import { hasMenuIconImage, resolveMenuGlyph, resolveMenuIcon } from '../constants/menuIcons'
import { backendHelpContent } from '../constants/backendHelpContent'
import { backOfficeMenuItems, endSession, frontMenuItems, FRONT_HOME } from '../utils/authNavigation'
import GlobalHelpButton from '@/components/GlobalHelpButton.vue'
import EmployeeAvatar from '@/components/EmployeeAvatar.vue'

const SIDEBAR_WIDTH = '240px'
const SIDEBAR_COLLAPSED_WIDTH = '64px'

const router = useRouter()
const route = useRoute()
const menuStore = useMenuStore()
const { items: menuItems } = storeToRefs(menuStore)
const profileStore = useProfileStore()
const { profile } = storeToRefs(profileStore)
const authStore = useAuthStore()

// 標題列顯示目前登入者的頭像與姓名（個人資料的 id 就是員工的 _id）
const headerUser = computed(() => ({
  _id: profile.value?._id || profile.value?.id || profile.value?.employeeId || '',
  name: typeof profile.value?.name === 'string' ? profile.value.name.trim() : '',
  photo: profile.value?.photo,
  hasPhoto: profile.value?.hasPhoto
}))

const active = ref('')
const isCollapse = ref(false)
// 第一次畫就要知道是不是窄螢幕：等到 mounted 才判斷的話，手機上每次載入都會看到側欄先出現再滑出去
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768)
const isMobileMenuOpen = ref(false)

// 後台只列後台的頁面；能使用前台的人（管理員）用標題列的「員工前台」切換，兩邊的選單不混在一起
const navItems = computed(() => backOfficeMenuItems(menuItems.value))
const hasFront = computed(() => frontMenuItems(menuItems.value, authStore.role, menuStore.frontItems).length > 0)

// 標題列的「？」：有寫操作說明的頁面才顯示
const currentHelp = computed(() => backendHelpContent[route?.name] || null)

const isSidebarCollapsed = computed(() => {
  if (isMobile.value) {
    return !isMobileMenuOpen.value
  }
  return isCollapse.value
})

const asideWidth = computed(() => {
  if (isMobile.value) {
    return SIDEBAR_WIDTH
  }
  return isCollapse.value ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH
})

const toggleLabel = computed(() => {
  if (isMobile.value) return isMobileMenuOpen.value ? '關閉選單' : '開啟選單'
  return isCollapse.value ? '展開側欄' : '收合側欄'
})

const toggleIcon = computed(() => {
  if (isMobile.value) return isMobileMenuOpen.value ? Close : Expand
  return isCollapse.value ? Expand : Fold
})

function updateIsMobile() {
  if (typeof window === 'undefined') return
  const mobile = window.innerWidth < 768
  isMobile.value = mobile
  if (!mobile) {
    isMobileMenuOpen.value = false
  }
}

function closeMobileMenu() {
  isMobileMenuOpen.value = false
}

function storedEmployeeId() {
  if (typeof window === 'undefined') return ''
  return window.sessionStorage?.getItem('employeeId') || window.localStorage?.getItem('employeeId') || ''
}

onMounted(async () => {
  if (typeof window !== 'undefined') {
    updateIsMobile()
    window.addEventListener('resize', updateIsMobile)
  }
  authStore.loadUser({ forceRefresh: true })
  // 個人資料只用來顯示標題列的頭像與姓名，讀不到不影響後台使用；
  // 快取的是別人的（同一個分頁換了帳號）時重新讀取
  const cached = profile.value
  const employeeId = storedEmployeeId()
  const stale = Boolean(cached && employeeId && String(cached.id || cached.employeeId || '') !== employeeId)
  profileStore.fetchProfile({ force: stale }).catch(() => {})
  if (menuItems.value.length === 0) {
    await menuStore.fetchMenu()
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
  }
})

function redirectToFirstMenu(firstName) {
  if (!firstName) return
  const currentName = router.currentRoute?.value?.name
  if (currentName === firstName) return
  if (typeof router.replace === 'function') {
    router.replace({ name: firstName })
  } else {
    router.push({ name: firstName })
  }
}

watch(
  () => menuItems.value,
  items => {
    if (!Array.isArray(items) || items.length === 0) return
    const firstBackOffice = navItems.value[0]?.name
    if (!firstBackOffice) {
      // 選單沒有後台頁面的人（主管、員工）不屬於後台：不管打的是哪個後台網址，都帶回他自己的第一個頁面，
      // 不停在側欄空白、每個儲存都會被伺服器拒絕的後台畫面
      redirectToFirstMenu(items[0]?.name)
      return
    }
    // 進後台首頁時帶到第一個後台頁面
    const firstName = firstBackOffice
    const currentName = router.currentRoute?.value?.name
    if (!currentName || currentName === 'Settings' || currentName === 'ManagerLayout') {
      redirectToFirstMenu(firstName)
    }
    if (!active.value) {
      active.value = currentName && currentName !== 'Settings' ? currentName : firstName
    }
  },
  { immediate: true }
)

watch(
  () => router.currentRoute?.value?.name,
  name => {
    active.value = typeof name === 'string' ? name : ''
    if (isMobile.value) {
      closeMobileMenu()
    }
  },
  { immediate: true }
)

function gotoPage(name) {
  active.value = name
  router.push({ name })
  if (isMobile.value) {
    closeMobileMenu()
  }
}

function gotoFront() {
  router.push(FRONT_HOME)
}

function toggleCollapse() {
  if (isMobile.value) {
    isMobileMenuOpen.value = !isMobileMenuOpen.value
    return
  }
  isCollapse.value = !isCollapse.value
}

function logout() {
  endSession()
  router.push('/')
}
</script>

<style scoped>
.modern-layout {
  --header-height: 56px;
  --shell-bg: var(--hr-primary);
  --shell-text: #ecfeff;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--hr-white);
}

/* ---------- 標題列 ---------- */
.layout-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: calc(var(--header-height) + env(safe-area-inset-top, 0px));
  padding: env(safe-area-inset-top, 0px) 16px 0 12px;
  background: var(--shell-bg);
  color: var(--shell-text);
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  min-width: 0;
}

.header-left {
  gap: 8px;
}

.header-right {
  gap: 4px;
}

.system-title {
  color: var(--hr-white);
  font-size: 18px;
  font-weight: 600;
  white-space: nowrap;
}

.header-icon-btn,
.header-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--shell-text);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.header-icon-btn {
  width: 36px;
  padding: 0;
}

.header-action {
  padding: 0 10px;
}

.header-icon-btn:hover,
.header-action:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--hr-white);
}

.header-user {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 4px 0 8px;
  color: var(--shell-text);
  font-size: 14px;
  font-weight: 500;
}

.header-user-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 側欄 ---------- */
.layout-body {
  flex: 1;
  min-height: 0;
}

.layout-aside {
  flex: 0 0 auto;
  background: var(--shell-bg);
  overflow: hidden;
  transition: width 0.2s ease;
}

.sidebar-menu {
  --el-menu-bg-color: transparent;
  --el-menu-text-color: var(--shell-text);
  --el-menu-active-color: var(--hr-white);
  --el-menu-hover-bg-color: rgba(255, 255, 255, 0.1);
  --el-menu-item-height: 44px;
  height: 100%;
  padding: 8px 12px 16px;
  border: none;
  overflow-x: hidden;
  overflow-y: auto;
}

.sidebar-menu.el-menu--collapse {
  width: 100%;
  padding: 8px;
}

.menu-item {
  position: relative;
  margin-bottom: 2px;
  padding: 0 12px !important;
  border-radius: 8px;
}

.menu-item.is-active {
  background: rgba(255, 255, 255, 0.14);
  font-weight: 600;
}

/* 目前頁面：左側一小段白色標記（導覽的強調色全站一致：深色側欄用白色，淺色底用主色；和前台外框相同） */
.menu-item.is-active::before {
  content: '';
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 0;
  width: 3px;
  border-radius: 2px;
  background: var(--hr-white);
}

.menu-item-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.menu-item-inner.is-collapsed {
  justify-content: center;
  gap: 0;
}

.layout-aside.collapsed .menu-item {
  padding: 0 !important;
}

.menu-icon {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.menu-glyph {
  margin: 0;
  color: var(--shell-text);
}

.menu-text {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 內容區：每一頁的留白都由這裡決定 ---------- */
.layout-main {
  min-width: 0;
  padding: 0;
  overflow: hidden;
  background: var(--hr-white);
}

/* --hr-shell-padding：內容區的留白，共用樣式 .hr-sticky-bar（固定在頂端的頁首／工具列）靠它算位置 */
.main-content {
  --hr-shell-padding: 24px;
  height: 100%;
  padding: var(--hr-shell-padding);
  overflow: auto;
}

/* ---------- 窄螢幕：側欄改成從左邊滑出的抽屜 ---------- */
.modern-layout.is-mobile .layout-aside {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 1001;
  max-width: 85vw;
  padding-top: env(safe-area-inset-top, 0px);
  transform: translateX(-100%);
  transition: transform 0.2s ease;
}

.modern-layout.is-mobile .layout-aside.is-open {
  transform: translateX(0);
  box-shadow: var(--hr-shadow-xl);
}

.hr-mobile-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease;
}

.hr-mobile-overlay.is-open {
  opacity: 1;
  visibility: visible;
}

.modern-layout.is-mobile .main-content {
  --hr-shell-padding: 12px;
}

.modern-layout.is-mobile .layout-header {
  padding-right: 8px;
  padding-left: 8px;
}

.modern-layout.is-mobile .system-title {
  font-size: 16px;
}

.modern-layout.is-mobile .header-action-text,
.modern-layout.is-mobile .header-user-name {
  display: none;
}

.modern-layout.is-mobile .header-action {
  width: 40px;
  height: 40px;
  padding: 0;
}

.modern-layout.is-mobile .header-icon-btn {
  width: 40px;
  height: 40px;
}

.modern-layout.is-mobile .header-user {
  margin: 0 2px;
}
</style>
