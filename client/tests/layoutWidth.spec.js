import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import ModernLayout from '../src/views/ModernLayout.vue'

const currentRoute = ref({ name: '' })
const menuItems = ref([])
const fetchMenuMock = vi.fn()
const setMenuMock = vi.fn()
const routerPushMock = vi.fn()
const routerReplaceMock = vi.fn()
const originalInnerWidth = global.innerWidth || 1024

function setViewportWidth(width) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width
  })
}

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock, currentRoute }),
  useRoute: () => currentRoute.value
}))

vi.mock('../src/stores/menu', () => ({
  useMenuStore: () => ({
    fetchMenu: fetchMenuMock,
    setMenu: setMenuMock,
    items: menuItems
  })
}))

const mountGlobal = {
  plugins: [ElementPlus],
  stubs: {
    'el-tooltip': {
      props: {
        content: {
          type: String,
          default: ''
        }
      },
      template: '<span class="el-tooltip" :data-content="content"><slot /></span>'
    },
    'router-view': {
      template: '<div class="router-view-stub" />'
    }
  }
}

// ModernLayout 的標題列會顯示登入者的頭像與姓名（個人資料 store），所以需要 pinia；選單 store 仍是上面的 mock
const modernLayoutGlobal = () => ({ ...mountGlobal, plugins: [ElementPlus, createPinia()] })

describe('layout widths', () => {
  beforeEach(() => {
    menuItems.value = []
    currentRoute.value = { name: '' }
    fetchMenuMock.mockReset()
    setMenuMock.mockReset()
    routerPushMock.mockReset()
    routerReplaceMock.mockReset()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })))
    setViewportWidth(1440)
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    setViewportWidth(originalInnerWidth)
    localStorage.clear()
    sessionStorage.clear()
  })

  // 2026/11：側欄改窄（280 → 240px），桌機收合後留下只有圖示的窄欄（64px，class 是 collapsed），
  // 不再整個滑出畫面（以前的 is-hidden：寬度 88px 但 left: -100%，收合後要再按一次才找得到選單）
  it('ModernLayout aside maintains sidebar width and flexible main content', async () => {
    const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
    const aside = wrapper.find('.layout-aside')
    const main = wrapper.find('.layout-main')

    expect(aside.attributes('style')).toContain('width: 240px')
    expect(aside.classes()).toContain('is-open')
    expect(aside.classes()).not.toContain('collapsed')
    expect(main.classes()).toContain('with-sidebar')

    wrapper.vm.toggleCollapse()
    await wrapper.vm.$nextTick()

    expect(aside.attributes('style')).toContain('width: 64px')
    expect(aside.classes()).toContain('collapsed')
    expect(aside.classes()).not.toContain('is-open')
    expect(main.classes()).not.toContain('with-sidebar')
    expect(main.exists()).toBe(true)
  })

  // 2026/11：後台外框只列後台的頁面，所以範例選單改用後台的項目（圖示對應不變）
  it('renders mapped menu icons and tooltip when collapsed', async () => {
    menuItems.value = [
      { name: 'AttendanceManagementSetting', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'ApprovalFlowSetting', label: '簽核流程', icon: 'el-icon-s-operation' }
    ]

    const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
    await wrapper.vm.$nextTick()

    const icons = wrapper.findAll('img.menu-icon')
    expect(icons).toHaveLength(2)
    expect(icons[0].attributes('src')).toBe('/出勤管理打卡.png')
    expect(icons[0].attributes('data-icon-key')).toBe('el-icon-postcard')

    wrapper.vm.toggleCollapse()
    await wrapper.vm.$nextTick()

    const collapsedInner = wrapper.find('.menu-item-inner.is-collapsed')
    expect(collapsedInner.exists()).toBe(true)
    expect(collapsedInner.find('.menu-text').exists()).toBe(false)

    const tooltip = collapsedInner.find('.el-tooltip')
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.attributes('data-content')).toBe('出勤打卡')
  })

  it('opens and closes the mobile drawer via toggle button', async () => {
    setViewportWidth(640)
    const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
    await wrapper.vm.$nextTick()

    const aside = wrapper.find('.layout-aside')
    expect(aside.classes()).not.toContain('collapsed')
    expect(aside.classes()).not.toContain('is-open')

    await wrapper.find('.collapse-btn').trigger('click')
    await wrapper.vm.$nextTick()

    expect(aside.classes()).toContain('is-open')
    expect(wrapper.find('.hr-mobile-overlay').classes()).toContain('is-open')

    await wrapper.find('.collapse-btn').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.hr-mobile-overlay').classes()).not.toContain('is-open')
    expect(wrapper.find('.layout-aside').classes()).not.toContain('is-open')
  })

  it('窄螢幕的抽屜：點遮罩或選了頁面就關上，選單顯示文字', async () => {
    setViewportWidth(375)
    menuItems.value = [
      { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
      { name: 'HRManagementSystemSetting', label: '人資管理', icon: 'el-icon-user-solid' }
    ]
    const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.modern-layout').classes()).toContain('is-mobile')
    const toggle = wrapper.find('.collapse-btn')
    expect(toggle.attributes('aria-label')).toBe('開啟選單')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-label')).toBe('關閉選單')
    expect(wrapper.findAll('.menu-text').map(node => node.text())).toEqual(['出勤設定', '人資管理'])

    await wrapper.find('.hr-mobile-overlay').trigger('click')
    expect(wrapper.find('.layout-aside').classes()).not.toContain('is-open')

    await toggle.trigger('click')
    await wrapper.findAll('.menu-item')[1].trigger('click')
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'HRManagementSystemSetting' })
    expect(wrapper.find('.layout-aside').classes()).not.toContain('is-open')
  })

  it('系統名稱只出現一次（標題列），側欄不再重複', () => {
    const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
    expect(wrapper.text().split('HR 管理系統').length - 1).toBe(1)
    expect(wrapper.find('.layout-header').text()).toContain('HR 管理系統')
    expect(wrapper.find('.layout-aside').text()).not.toContain('HR 管理系統')
  })

  // 以前每一頁最上面都有一整列「本頁操作說明」橫幅；現在是標題列的小「？」按鈕，內容相同
  it('操作說明是標題列的小按鈕，不再佔用內容區', async () => {
    currentRoute.value = { name: 'AttendanceSetting' }
    const wrapper = mount(ModernLayout, { global: modernLayoutGlobal(), attachTo: document.body })
    try {
      expect(wrapper.find('.page-help-bar').exists()).toBe(false)
      expect(wrapper.find('.main-content').text()).not.toContain('本頁操作說明')
      const help = wrapper.find('.layout-header [data-testid="global-help-button"]')
      expect(help.exists()).toBe(true)
      expect(help.attributes('aria-label')).toBe('本頁操作說明')

      await help.trigger('click')
      await wrapper.vm.$nextTick()
      expect(document.body.textContent).toContain('出勤設定操作說明')
      expect(document.body.textContent).toContain('適用情境')
    } finally {
      wrapper.unmount()
      document.body.innerHTML = ''
    }
  })

  it('沒有寫操作說明的頁面不顯示說明按鈕', () => {
    currentRoute.value = { name: 'Settings' }
    const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
    expect(wrapper.find('[data-testid="global-help-button"]').exists()).toBe(false)
  })

  describe('前台／後台不混在一起', () => {
    const adminToken = () => `h.${btoa(JSON.stringify({ role: 'admin' }))}.s`
    const supervisorToken = () => `h.${btoa(JSON.stringify({ role: 'supervisor' }))}.s`

    it('後台側欄只列後台的頁面', async () => {
      menuItems.value = [
        { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
        { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
        { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' },
        { name: 'ManagerChangePassword', label: '變更密碼', icon: 'el-icon-lock' }
      ]
      const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.menu-text').map(node => node.text())).toEqual(['出勤設定', '變更密碼'])
      // 進後台首頁時帶到第一個「後台」頁面，而不是選單裡排第一個的前台頁面
      expect(routerReplaceMock).toHaveBeenCalledWith({ name: 'AttendanceSetting' })
    })

    it('管理員在標題列有「員工前台」切換鈕', async () => {
      localStorage.setItem('token', adminToken())
      menuItems.value = [{ name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' }]
      const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
      await wrapper.vm.$nextTick()
      const button = wrapper.find('[data-test="switch-to-front"]')
      expect(button.exists()).toBe(true)
      expect(button.text()).toContain('員工前台')
      await button.trigger('click')
      expect(routerPushMock).toHaveBeenCalledWith('/front/attendance')
    })

    it('選單沒有前台頁面、也不是管理員時不顯示切換鈕', async () => {
      menuItems.value = [{ name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' }]
      const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test="switch-to-front"]').exists()).toBe(false)
    })

    // 主管的選單只有前台頁面：以前打後台網址會看到後台外框配上前台選單；現在不管哪個後台網址都帶回他的第一個頁面
    it.each(['Settings', 'AttendanceSetting', 'SalaryManagementSetting'])(
      '主管（選單沒有後台頁面）打開後台的 %s 時帶回他的第一個頁面，側欄不列前台頁面',
      async routeName => {
        localStorage.setItem('token', supervisorToken())
        currentRoute.value = { name: routeName }
        menuItems.value = [
          { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
          { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' }
        ]
        const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
        await wrapper.vm.$nextTick()
        expect(routerReplaceMock).toHaveBeenCalledWith({ name: 'Attendance' })
        expect(wrapper.findAll('.menu-item')).toHaveLength(0)
        expect(wrapper.find('[data-test="switch-to-front"]').exists()).toBe(true)
      }
    )

    it('管理員重新整理後台的內頁時留在原頁，不被帶回第一個頁面', async () => {
      localStorage.setItem('token', adminToken())
      currentRoute.value = { name: 'HRManagementSystemSetting' }
      menuItems.value = [
        { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
        { name: 'HRManagementSystemSetting', label: '人資管理', icon: 'el-icon-user-solid' }
      ]
      const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
      await wrapper.vm.$nextTick()
      expect(routerReplaceMock).not.toHaveBeenCalled()
      expect(routerPushMock).not.toHaveBeenCalled()
      expect(wrapper.find('.menu-item.is-active').text()).toContain('人資管理')
    })
  })

  // 以前登出只清本機，token 在到期前仍然有效
  it('登出時請伺服器作廢 token 並回到登入頁', async () => {
    localStorage.setItem('token', 'tok-admin')
    localStorage.setItem('employeeId', 'a1')
    const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
    await wrapper.vm.$nextTick()
    fetch.mockClear()

    await wrapper.find('[data-test="logout-btn"]').trigger('click')

    const logoutCall = fetch.mock.calls.find(([url]) => String(url).endsWith('/api/logout'))
    expect(logoutCall).toBeTruthy()
    expect(logoutCall[1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer tok-admin' } })
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('employeeId')).toBeNull()
    expect(setMenuMock).toHaveBeenCalledWith([])
    expect(routerPushMock).toHaveBeenCalledWith('/')
  })

  // 舊的 views/Layout.vue（路由沒有使用）已刪除；它的測試檢查的是「按收合按鈕，側欄與選單一起收合」，改在實際使用的 ModernLayout 上檢查
  it('桌機按標題列的收合按鈕：側欄收成圖示欄、選單文字收起，再按一次展開', async () => {
    menuItems.value = [
      { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
      { name: 'HRManagementSystemSetting', label: '人資管理', icon: 'el-icon-user-solid' }
    ]
    const wrapper = mount(ModernLayout, { global: modernLayoutGlobal() })
    await wrapper.vm.$nextTick()
    const aside = wrapper.find('.layout-aside')
    const toggle = wrapper.find('.collapse-btn')
    expect(aside.classes()).not.toContain('collapsed')
    expect(aside.attributes('style')).toContain('width: 240px')
    expect(wrapper.findAll('.menu-text')).toHaveLength(2)

    await toggle.trigger('click')
    await wrapper.vm.$nextTick()

    expect(aside.classes()).toContain('collapsed')
    expect(aside.attributes('style')).toContain('width: 64px')
    expect(wrapper.findAll('.menu-text')).toHaveLength(0)
    expect(wrapper.findAll('.menu-item-inner.is-collapsed')).toHaveLength(2)

    await toggle.trigger('click')
    await wrapper.vm.$nextTick()

    expect(aside.classes()).not.toContain('collapsed')
    expect(aside.attributes('style')).toContain('width: 240px')
    expect(wrapper.findAll('.menu-text')).toHaveLength(2)
  })
})
