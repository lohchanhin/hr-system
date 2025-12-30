<template>
  <el-container class="modern-layout">
    <el-header class="layout-header">
      <div class="header-left">
        <el-button link @click="toggleCollapse" class="collapse-btn">
          <el-icon size="20"><i :class="isSidebarCollapsed ? 'el-icon-menu' : 'el-icon-close'" /></el-icon>
        </el-button>
        <h1 class="system-title">HR 管理系統</h1>
      </div>
      <div class="header-right">
        <GlobalHelpButton :help="currentHelp" />
        <el-button type="primary" @click="logout" class="logout-btn">
          <el-icon><i class="el-icon-switch-button" /></el-icon>
          登出
        </el-button>
      </div>
    </el-header>
    <el-container>
      <el-aside
        class="layout-aside"
        :class="{
          collapsed: !isMobile && isSidebarCollapsed,
          'is-open': !isSidebarCollapsed,
          'is-hidden': !isMobile && isSidebarCollapsed
        }"
        :width="asideWidth"
      >
        <div class="sidebar-content">
          <div class="sidebar-logo" :class="{ collapsed: isSidebarCollapsed }">
            <img src="/HR.png" alt="HR 管理系統" class="sidebar-logo-image" />
            <span v-if="!isSidebarCollapsed" class="sidebar-logo-text">HR 管理系統</span>
          </div>
          <el-menu
            :default-active="active"
            :collapse="isSidebarCollapsed"
            class="sidebar-menu"
            background-color="transparent"
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
                <span v-if="!isSidebarCollapsed" class="menu-text">{{ item.label }}</span>
              </div>
            </el-menu-item>
          </el-menu>
        </div>
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
import { useRouter } from 'vue-router'
import { useMenuStore } from '../stores/menu'
import { clearToken } from '../utils/tokenService'
import { storeToRefs } from 'pinia'
import { iconMap as availableMenuIcons, resolveMenuIcon } from '../constants/menuIcons'
import GlobalHelpButton from '@/components/GlobalHelpButton.vue'

const router = useRouter()
const menuStore = useMenuStore()
const { items: menuItems } = storeToRefs(menuStore)

const active = ref('')
const isCollapse = ref(false)
const isMobile = ref(false)
const isMobileMenuOpen = ref(false)

const helpContentMap = {
  AttendanceSetting: {
    title: '出勤設定操作提示',
    description: '使用說明按鈕檢視異常判定、遲到容忍與補卡規則的設定步驟。',
    tips: ['確認修改後按下儲存', '套用設定前先檢查必要欄位與預設值']
  },
  AttendanceManagementSetting: {
    title: '出勤管理說明',
    description: '用說明按鈕查看打卡與補卡流程，避免直接修改按鈕或樣式。',
    tips: ['變更前先檢視目前規則', '完成後重新整理確認設定已生效']
  },
  LeaveOvertimeSetting: {
    title: '加班倍率與簽核說明',
    description: '透過說明按鈕檢視各時段倍率與簽核套用提醒，不需變更按鈕本身。',
    tips: ['調整倍率後記得儲存', '套用簽核時依表單類型使用相同倍率']
  },
  ShiftScheduleSetting: {
    title: '班別設定說明',
    description: '使用說明按鈕查看班別、夜班與休息時段的設定要點。',
    tips: ['新增班別後重新載入列表', '設定夜班時確認津貼與時長']
  },
  ApprovalFlowSetting: {
    title: '簽核流程設定說明',
    description: '說明按鈕提供樣板與關卡設定提醒，避免直接修改按鈕或樣式。',
    tips: ['流程變更後請保存並重新整理確認', '確認每關簽核人與條件完整']
  },
  SalaryManagementSetting: {
    title: '薪資管理說明',
    description: '用說明按鈕查看薪資計算注意事項與欄位來源，不需調整按鈕本身。',
    tips: ['薪資公式變更後檢查預覽', '銀行與夜班說明可在此快速瀏覽']
  },
  SocialInsuranceRetirementSetting: {
    title: '勞健保/勞退說明',
    description: '透過說明按鈕了解手動更新級距與套用方式。',
    tips: ['同步最新級距後檢查套用時間', '可隨時隱藏或顯示級距表']
  },
  HRManagementSystemSetting: {
    title: '人事與系統設定說明',
    description: '使用說明按鈕查看員工欄位、導入與角色設定的流程重點。',
    tips: ['批次匯入前先確認欄位格式', '角色與部門設定需保持一致']
  },
  OrgDepartmentSetting: {
    title: '組織與部門設定說明',
    description: '說明按鈕提供新增機構、部門與小單位的快速步驟。',
    tips: ['新增或刪除後重新載入清單', '維持系統代碼與名稱的一致性']
  },
  OtherControlSetting: {
    title: '其他控制設定說明',
    description: '使用說明按鈕查看字典項目、表單欄位與自訂欄位的調整方式。',
    tips: ['修改後儲存並檢查列表更新', '自訂欄位可搭配內建類型使用']
  },
  ScheduleOverview: {
    title: '班表總覽說明',
    description: '說明按鈕協助確認篩選條件與班表載入方式，避免誤觸其他控制。',
    tips: ['切換月份會重新載入資料', '篩選條件修改後再次取得總覽']
  },
  DepartmentReports: {
    title: '報表與匯出說明',
    description: '使用說明按鈕檢視預覽、匯出與權限控制的操作順序。',
    tips: ['匯出前先預覽內容', '未填月份或部門時需補齊條件']
  }
}

const currentHelp = computed(() => {
  const routeName = router.currentRoute?.value?.name
  return helpContentMap[routeName] || {
    title: '後台操作說明',
    description: '使用「說明」按鈕快速查看此頁的操作重點，無需修改按鈕本身。',
    tips: ['完成設定後記得儲存或套用', '若有表單說明，先閱讀再進行修改']
  }
})

const isSidebarCollapsed = computed(() => {
  if (isMobile.value) {
    return !isMobileMenuOpen.value
  }
  return isCollapse.value
})

const asideWidth = computed(() => {
  if (isMobile.value) {
    return '280px'
  }
  return isCollapse.value ? '88px' : '280px'
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

onMounted(async () => {
  if (typeof window !== 'undefined') {
    updateIsMobile()
    window.addEventListener('resize', updateIsMobile)
  }
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
    const firstName = items[0]?.name
    if (!firstName) return
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
function toggleCollapse() {
  if (isMobile.value) {
    isMobileMenuOpen.value = !isMobileMenuOpen.value
    return
  }
  isCollapse.value = !isCollapse.value
}

function resolveIcon(item) {
  return resolveMenuIcon(item)
}

function logout() {
  clearToken()
  menuStore.setMenu([])
  sessionStorage.removeItem('role')
  sessionStorage.removeItem('employeeId')
  localStorage.removeItem('role')
  localStorage.removeItem('employeeId')
  router.push('/')
}
</script>

<style scoped>
.modern-layout {
  --header-height: 64px;
  height: 100vh;
  background: #f8fafc;
  padding-top: var(--header-height);
}

.layout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--header-height);
  background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
  border-bottom: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  padding: 0 24px;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
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
  background: linear-gradient(180deg, #0f4c75 0%, #164e63 100%);
  border-right: none;
  position: fixed;
  top: var(--header-height);
  left: -100%;
  height: calc(100vh - var(--header-height));
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
  transition: left 0.3s ease, width 0.3s ease;
  overflow: hidden;
  z-index: 900;
}

.layout-aside.is-open {
  left: 0;
}

.layout-aside.is-hidden {
  left: -100%;
}

.layout-aside.collapsed {
  align-items: center;
}

.sidebar-content {
  height: 100%;
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 16px;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 0 20px;
  transition: all 0.3s ease;
}

.sidebar-logo.collapsed {
  flex-direction: column;
  padding: 0;
}

.sidebar-logo-image {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  object-fit: contain;
  box-shadow: 0 4px 12px rgba(15, 76, 117, 0.35);
  background: rgba(255, 255, 255, 0.15);
  padding: 6px;
}

.sidebar-logo-text {
  color: #ecfeff;
  font-weight: 600;
  font-size: 16px;
  letter-spacing: 0.5px;
}

.sidebar-menu {
  border: none !important;
  background: transparent !important;
  flex: 1;
}

.menu-item {
  margin: 4px 12px;
  border-radius: 12px !important;
  transition: all 0.3s ease;
  min-height: 52px !important;
  display: flex;
  align-items: center;
}

.menu-item-inner {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  justify-content: flex-start;
}

.menu-item-inner.is-collapsed {
  justify-content: center;
  gap: 0;
}

.menu-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  transition: transform 0.3s ease, filter 0.3s ease;
}

.menu-item:hover .menu-icon {
  transform: scale(1.05);
  filter: drop-shadow(0 4px 6px rgba(15, 76, 117, 0.35));
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
  color: #ecfeff;
}

.layout-main {
  background: #f8fafc;
  padding: 0;
  overflow: hidden;
  margin-left: 0;
  transition: margin-left 0.3s ease;
}

.layout-main.with-sidebar {
  margin-left: 280px;
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

.main-content h1,
.main-content h2,
.main-content h3,
.main-content h4,
.main-content h5,
.main-content h6 {
  color: var(--hr-text-primary);
}

@media (max-width: 768px) {
  .layout-aside {
    z-index: 1001;
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
