import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import { useMenuStore } from '../src/stores/menu'
import { useProfileStore } from '../src/stores/profile'
import { useAuthStore } from '../src/stores/auth'

defineElStubs()

function defineElStubs() {
  globalThis.__EL_STUBS__ = {
    'el-menu': {
      template: '<nav class="el-menu"><slot /></nav>',
    },
    'el-menu-item': {
      props: {
        index: {
          type: String,
          required: false,
        },
      },
      emits: ['click'],
      template:
        '<div class="el-menu-item" :data-index="index" @click="$emit(\'click\')"><slot /></div>',
    },
    'el-button': {
      emits: ['click'],
      template:
        '<button type="button" class="el-button" @click="$emit(\'click\')"><slot /></button>',
    },
    'el-avatar': {
      template: '<div class="el-avatar"><slot /></div>',
    },
    'el-icon': {
      template: '<i class="el-icon"><slot /></i>',
    },
    'el-tooltip': {
      props: {
        content: {
          type: String,
          default: '',
        },
      },
      template:
        '<span class="el-tooltip" :data-content="content"><slot /></span>',
    },
    'el-descriptions': {
      template: '<div class="el-descriptions"><slot /></div>',
    },
    'el-descriptions-item': {
      props: {
        label: {
          type: String,
          default: '',
        },
      },
      template:
        '<div class="el-descriptions-item"><span class="el-descriptions-item__label">{{ label }}</span><div class="el-descriptions-item__content"><slot /></div></div>',
    },
    'router-view': {
      template: '<div class="router-view-stub"></div>',
    },
    // 手機外框的頭像選單與「更多」面板
    'el-dropdown': {
      emits: ['command'],
      provide() {
        return { dropdownCommand: (command) => this.$emit('command', command) }
      },
      template: '<div class="el-dropdown"><slot /><ul class="el-dropdown-menu"><slot name="dropdown" /></ul></div>',
    },
    'el-dropdown-menu': {
      template: '<div class="el-dropdown-menu-inner"><slot /></div>',
    },
    'el-dropdown-item': {
      props: ['command'],
      inject: ['dropdownCommand'],
      template:
        '<li class="el-dropdown-item" :data-command="command" @click="dropdownCommand(command)"><slot /></li>',
    },
    'el-drawer': {
      props: ['modelValue'],
      template: '<div v-if="modelValue" class="el-drawer"><slot /></div>',
    },
  }
}

const createProfile = () => ({
  id: '1',
  employeeId: '1',
  name: '測試員工',
  organizationName: '測試機構',
  departmentName: '測試部門',
  subDepartmentName: '測試小單位',
  employeeNumber: '',
  role: 'employee',
  username: 'tester',
})

let FrontLayout
let fetchProfileMock
let clearProfileMock
let profileData

beforeAll(async () => {
  FrontLayout = (await import('../src/views/front/FrontLayout.vue')).default
})

describe('FrontLayout manager button', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1440,
    })
    fetchProfileMock = undefined
    clearProfileMock = undefined
    profileData = createProfile()
    localStorage.setItem('employeeId', profileData.employeeId)

    setActivePinia(createPinia())
    const menuStore = useMenuStore()
    menuStore.setMenu([
      { name: 'MySchedule', label: '我的排班', icon: 'el-icon-calendar' },
    ])
    vi.spyOn(menuStore, 'fetchMenu').mockResolvedValue()

    const profileStore = useProfileStore()
    profileStore.setProfile(profileData)
    fetchProfileMock = vi
      .spyOn(profileStore, 'fetchProfile')
      .mockImplementation(async () => {
        profileStore.setProfile(profileData)
        return profileData
      })
    clearProfileMock = vi
      .spyOn(profileStore, 'clearProfile')
      .mockImplementation(() => {
        profileStore.setProfile(null)
      })
  })

  afterAll(() => {
    vi.resetModules()
  })

  async function mountLayout({ startAt = 'attendance' } = {}) {
    const page = { template: '<div />' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: page },
        { path: '/attendance', name: 'attendance', component: page },
        { path: '/myschedule', name: 'MySchedule', component: page },
        { path: '/front/attendance', name: 'Attendance', component: page },
        { path: '/front/schedule', name: 'Schedule', component: page },
        { path: '/front/preview-week', name: 'PreviewWeek', component: page },
        { path: '/front/preview-month', name: 'PreviewMonth', component: page },
        { path: '/front/approval', name: 'Approval', component: page },
        { path: '/front/department-reports', name: 'FrontDepartmentReports', component: page },
        { path: '/front/change-password', name: 'FrontChangePassword', component: page },
        { path: '/manager', name: 'ManagerLayout', component: page },
      ],
    })
    await router.push({ name: startAt })
    await router.isReady()
    const wrapper = mount(FrontLayout, {
      global: {
        plugins: [router],
        stubs: globalThis.__EL_STUBS__,
      },
    })
    await flushPromises()
    return { wrapper, router }
  }

  // 2026/11：管理員同時能用後台與前台，員工系統的外框要有明顯的「後台管理」切換鈕（主管、員工沒有後台，不顯示）
  it('管理員顯示後台管理切換鈕並可登出', async () => {
    localStorage.setItem('role', 'admin')
    localStorage.setItem('username', 'boss')
    const { wrapper, router } = await mountLayout()
    const pushSpy = vi.spyOn(router, 'push')
    const managerButton = wrapper.find('[data-test="manager-btn"]')
    expect(managerButton.exists()).toBe(true)
    expect(managerButton.text()).toContain('後台管理')
    await managerButton.trigger('click')
    expect(pushSpy).toHaveBeenCalledWith('/manager')
    await wrapper.find('.logout-btn').trigger('click')
    expect(pushSpy).toHaveBeenCalledWith('/')
    expect(localStorage.getItem('role')).toBeNull()
    expect(localStorage.getItem('username')).toBeNull()
    expect(localStorage.getItem('employeeId')).toBeNull()
    expect(fetchProfileMock).toHaveBeenCalled()
    expect(clearProfileMock).toHaveBeenCalled()
  })

  // 開頁時角色由預設的 employee 換成主管：以前角色監看把它當成「換了角色」，每次進前台都讀兩次 /api/menu
  it('開頁只讀一次選單；之後角色真的改變才重新讀', async () => {
    const menuStore = useMenuStore()
    menuStore.setMenu([])
    localStorage.setItem('role', 'supervisor')
    await mountLayout()
    expect(menuStore.fetchMenu).toHaveBeenCalledTimes(1)

    // 例如另一個分頁換了帳號（storage 事件會重新判斷角色）
    useAuthStore().role = 'admin'
    await flushPromises()
    expect(menuStore.fetchMenu).toHaveBeenCalledTimes(2)
  })

  it('主管不顯示按鈕', async () => {
    localStorage.setItem('role', 'supervisor')
    const { wrapper } = await mountLayout()
    expect(wrapper.find('[data-test="manager-btn"]').exists()).toBe(false)
  })

  it('員工不顯示按鈕', async () => {
    localStorage.setItem('role', 'employee')
    const { wrapper } = await mountLayout()
    expect(wrapper.find('[data-test="manager-btn"]').exists()).toBe(false)
  })

  it('點選我的排班導向 MySchedule', async () => {
    const { wrapper, router } = await mountLayout()
    const pushSpy = vi.spyOn(router, 'push')
    await wrapper.find('[data-index="MySchedule"]').trigger('click')
    expect(pushSpy).toHaveBeenCalledWith({ name: 'MySchedule' })
  })

  it('點擊切換按鈕後 aside 會切換 collapsed 類別', async () => {
    const { wrapper } = await mountLayout()
    const sidebar = () => wrapper.find('aside.sidebar')
    expect(sidebar().classes()).not.toContain('collapsed')

    await wrapper.find('[data-test="sidebar-toggle"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(sidebar().classes()).toContain('collapsed')

    await wrapper.find('[data-test="sidebar-toggle"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(sidebar().classes()).not.toContain('collapsed')
  })

  // 2026/11：個人資訊從白底的表格（姓名／機構／部門／小單位各一列）改成精簡的一塊：
  // 頭像、姓名、一行「機構・部門・小單位」，完整內容（含欄位名稱）在滑鼠停留的提示裡
  it('載入後顯示個人資訊欄位', async () => {
    const { wrapper } = await mountLayout()
    expect(fetchProfileMock).toHaveBeenCalled()
    const text = wrapper.text()
    expect(text).toContain('機構')
    expect(text).toContain('部門')
    expect(text).toContain('小單位')
    expect(text).toContain('測試機構')
    expect(text).toContain('測試部門')
    expect(text).toContain('測試小單位')
    expect(text).toContain('測試員工')

    const identity = wrapper.find('[data-test="identity"]')
    expect(identity.find('.identity-name').text()).toBe('測試員工')
    expect(identity.find('[data-test="identity-meta"]').text()).toBe('測試機構・測試部門・測試小單位')
    expect(identity.attributes('title')).toBe('測試員工\n機構：測試機構\n部門：測試部門\n小單位：測試小單位')
    expect(wrapper.find('.el-descriptions').exists()).toBe(false)
  })

  it('個人資訊缺少的欄位不顯示，全部沒有時不留空行', async () => {
    profileData = { ...createProfile(), organizationName: '', departmentName: '  ', subDepartmentName: '甲單位' }
    useProfileStore().setProfile(profileData)
    const { wrapper } = await mountLayout()
    expect(wrapper.find('[data-test="identity-meta"]').text()).toBe('甲單位')
    expect(wrapper.text()).not.toContain('未提供')

    profileData = { ...createProfile(), organizationName: '', departmentName: '', subDepartmentName: '' }
    useProfileStore().setProfile(profileData)
    const { wrapper: bare } = await mountLayout()
    expect(bare.find('[data-test="identity-meta"]').exists()).toBe(false)
    expect(bare.find('.identity-name').text()).toBe('測試員工')
  })

  it('快取的個人資料是別的帳號時重新讀取，不顯示上一個人的姓名', async () => {
    localStorage.setItem('employeeId', 'someone-else')
    await mountLayout()
    expect(fetchProfileMock).toHaveBeenCalledWith({ force: true })
  })

  it('個人資料就是目前帳號時沿用快取', async () => {
    await mountLayout()
    expect(fetchProfileMock).toHaveBeenCalledWith({ force: false })
  })

  it('收合鈕是只有圖示的小按鈕，說明文字放在 aria-label', async () => {
    const { wrapper } = await mountLayout()
    const toggle = wrapper.find('[data-test="sidebar-toggle"]')
    expect(toggle.text()).toBe('')
    expect(toggle.attributes('aria-label')).toBe('收合側欄')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-label')).toBe('展開側欄')
    expect(toggle.attributes('aria-expanded')).toBe('false')
  })

  // 管理員的選單（/api/menu）只有後台項目：員工系統的外框不能把它們列出來
  it('管理員在員工系統只看到前台頁面，不混入後台選單', async () => {
    localStorage.setItem('role', 'admin')
    useMenuStore().setMenu([
      { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
      { name: 'HRManagementSystemSetting', label: '人資管理', icon: 'el-icon-user-solid' },
      { name: 'ManagerChangePassword', label: '變更密碼', icon: 'el-icon-lock' },
    ])
    const { wrapper, router } = await mountLayout()
    const names = wrapper.findAll('.el-menu-item').map((item) => item.attributes('data-index'))
    expect(names).toEqual(['Attendance', 'Schedule', 'Approval', 'FrontChangePassword'])
    expect(wrapper.text()).not.toContain('出勤設定')
    expect(wrapper.text()).not.toContain('人資管理')

    const pushSpy = vi.spyOn(router, 'push')
    await wrapper.find('[data-index="Approval"]').trigger('click')
    expect(pushSpy).toHaveBeenCalledWith({ name: 'Approval' })
  })

  // /api/menu?include=front 的 frontItems：前台選單由伺服器決定（管理員也有），不再用前端寫死的備援清單
  it('伺服器有回 frontItems 時照它列出前台選單（後台項目與不認得的名稱不列）', async () => {
    localStorage.setItem('role', 'admin')
    const menuStore = useMenuStore()
    menuStore.setMenu([
      { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
      { name: 'ManagerChangePassword', label: '變更密碼', icon: 'el-icon-lock' },
    ])
    menuStore.frontItems = [
      { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' },
      { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
    ]
    const { wrapper } = await mountLayout()
    const names = wrapper.findAll('.el-menu-item').map((item) => item.attributes('data-index'))
    expect(names).toEqual(['Attendance', 'Approval'])
    // 選單已經在 store 裡：開頁不再讀一次
    expect(menuStore.fetchMenu).not.toHaveBeenCalled()
  })

  it('主管、員工的選單裡若混有後台項目也不會出現在員工系統', async () => {
    localStorage.setItem('role', 'supervisor')
    useMenuStore().setMenu([
      { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
    ])
    const { wrapper } = await mountLayout()
    const names = wrapper.findAll('.el-menu-item').map((item) => item.attributes('data-index'))
    expect(names).toEqual(['Attendance'])
  })

  it('選單項目沒有對應的 png 時改用向量圖示，不再一律顯示系統標誌', async () => {
    useMenuStore().setMenu([
      { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'FrontChangePassword', label: '變更密碼', icon: 'el-icon-lock' },
    ])
    const { wrapper } = await mountLayout()
    const attendance = wrapper.find('[data-index="Attendance"]')
    expect(attendance.find('img.menu-icon').attributes('src')).toBe('/出勤管理打卡.png')
    const password = wrapper.find('[data-index="FrontChangePassword"]')
    expect(password.find('img.menu-icon').exists()).toBe(false)
    expect(password.find('.menu-glyph').exists()).toBe(true)
  })

  // 以前登出只清本機，token 在到期前仍然有效（共用電腦上登出後還能拿來呼叫 API）
  it('登出時請伺服器作廢 token，並清掉本機登入狀態', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      localStorage.setItem('token', 'tok-123')
      localStorage.setItem('role', 'employee')
      const { wrapper, router } = await mountLayout()
      const pushSpy = vi.spyOn(router, 'push')
      await wrapper.find('.logout-btn').trigger('click')

      const logoutCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/logout'))
      expect(logoutCall).toBeTruthy()
      expect(logoutCall[1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer tok-123' } })
      expect(localStorage.getItem('token')).toBeNull()
      expect(localStorage.getItem('role')).toBeNull()
      expect(localStorage.getItem('employeeId')).toBeNull()
      expect(useMenuStore().items).toEqual([])
      expect(clearProfileMock).toHaveBeenCalled()
      expect(pushSpy).toHaveBeenCalledWith('/')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('作廢 token 的請求失敗（斷線）也照樣登出', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    try {
      localStorage.setItem('token', 'tok-123')
      const { wrapper, router } = await mountLayout()
      const pushSpy = vi.spyOn(router, 'push')
      await wrapper.find('.logout-btn').trigger('click')
      await flushPromises()
      expect(localStorage.getItem('token')).toBeNull()
      expect(pushSpy).toHaveBeenCalledWith('/')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  describe('手機（寬度小於 768px）', () => {
    const supervisorMenu = () => [
      { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' },
      { name: 'FrontDepartmentReports', label: '部門報表', icon: 'el-icon-data-analysis' },
      { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' },
      { name: 'FrontChangePassword', label: '變更密碼', icon: 'el-icon-lock' },
    ]

    beforeEach(() => {
      window.innerWidth = 375
      useMenuStore().setMenu(supervisorMenu())
    })

    const tabNames = (wrapper) =>
      wrapper.findAll('[data-test="mobile-tabbar"] .tab').map((tab) => tab.attributes('data-tab'))

    it('顯示上方標題列與底部分頁列，不顯示側欄', async () => {
      const { wrapper } = await mountLayout({ startAt: 'Attendance' })
      expect(wrapper.find('aside.sidebar').exists()).toBe(false)
      expect(wrapper.find('[data-test="mobile-topbar"]').text()).toContain('員工系統')
      expect(wrapper.find('.front-layout').classes()).toContain('is-mobile')
      // 變更密碼收在頭像選單，不佔分頁
      expect(tabNames(wrapper)).toEqual(['Attendance', 'Schedule', 'FrontDepartmentReports', 'Approval'])
      const labels = wrapper.findAll('[data-test="mobile-tabbar"] .tab-label').map((label) => label.text())
      expect(labels).toEqual(['出勤打卡', '排班管理', '部門報表', '簽核流程'])
    })

    it('目前的頁面標成選取中，點分頁會換頁', async () => {
      const { wrapper, router } = await mountLayout({ startAt: 'Attendance' })
      const tab = (name) => wrapper.find('[data-tab="' + name + '"]')
      expect(tab('Attendance').classes()).toContain('is-active')
      expect(tab('Attendance').attributes('aria-current')).toBe('page')
      expect(tab('Approval').attributes('aria-current')).toBeUndefined()

      const pushSpy = vi.spyOn(router, 'push')
      await tab('Approval').trigger('click')
      expect(pushSpy).toHaveBeenCalledWith({ name: 'Approval' })
      await flushPromises()
      expect(tab('Approval').classes()).toContain('is-active')
      expect(tab('Attendance').classes()).not.toContain('is-active')
    })

    it('排班預覽頁算在「排班管理」分頁', async () => {
      const { wrapper } = await mountLayout({ startAt: 'PreviewWeek' })
      expect(wrapper.find('[data-tab="Schedule"]').classes()).toContain('is-active')
    })

    it('分頁超過 5 個時留 4 個，其餘收進「更多」', async () => {
      useMenuStore().setMenu([
        ...supervisorMenu().slice(0, 4),
        { name: 'MySchedule', label: '我的排班', icon: 'el-icon-timer' },
        { name: 'PreviewMonth', label: '月預覽', icon: 'el-icon-date' },
        { name: 'FrontChangePassword', label: '變更密碼', icon: 'el-icon-lock' },
      ])
      const { wrapper, router } = await mountLayout({ startAt: 'MySchedule' })
      expect(tabNames(wrapper)).toEqual(['Attendance', 'Schedule', 'FrontDepartmentReports', 'Approval', 'more'])
      // 目前頁面在「更多」裡時，「更多」標成選取中
      expect(wrapper.find('[data-tab="more"]').classes()).toContain('is-active')
      expect(wrapper.find('.el-drawer').exists()).toBe(false)

      await wrapper.find('[data-tab="more"]').trigger('click')
      const more = wrapper.findAll('.el-drawer .front-more-item').map((item) => item.attributes('data-more'))
      expect(more).toEqual(['MySchedule', 'PreviewMonth'])

      const pushSpy = vi.spyOn(router, 'push')
      await wrapper.find('[data-more="PreviewMonth"]').trigger('click')
      expect(pushSpy).toHaveBeenCalledWith({ name: 'PreviewMonth' })
      expect(wrapper.find('.el-drawer').exists()).toBe(false)
    })

    it('剛好 5 個分頁時全部顯示，沒有「更多」', async () => {
      useMenuStore().setMenu([...supervisorMenu(), { name: 'MySchedule', label: '我的排班', icon: 'el-icon-timer' }])
      const { wrapper } = await mountLayout({ startAt: 'Attendance' })
      expect(tabNames(wrapper)).toEqual(['Attendance', 'Schedule', 'FrontDepartmentReports', 'Approval', 'MySchedule'])
    })

    it('頭像選單顯示個人資訊，可以變更密碼與登出', async () => {
      localStorage.setItem('role', 'supervisor')
      const { wrapper, router } = await mountLayout({ startAt: 'Attendance' })
      const profile = wrapper.find('[data-test="user-menu-profile"]')
      expect(profile.text()).toContain('測試員工')
      expect(profile.text()).toContain('測試機構・測試部門・測試小單位')
      expect(wrapper.find('[data-test="user-menu-trigger"]').attributes('aria-label')).toBe('個人選單')
      // 主管沒有後台
      expect(wrapper.find('[data-command="back-office"]').exists()).toBe(false)

      const pushSpy = vi.spyOn(router, 'push')
      await wrapper.find('[data-command="password"]').trigger('click')
      expect(pushSpy).toHaveBeenCalledWith({ name: 'FrontChangePassword' })

      await wrapper.find('[data-command="logout"]').trigger('click')
      expect(pushSpy).toHaveBeenCalledWith('/')
      expect(localStorage.getItem('role')).toBeNull()
      expect(localStorage.getItem('employeeId')).toBeNull()
      expect(clearProfileMock).toHaveBeenCalled()
    })

    it('管理員的頭像選單可以切換到後台', async () => {
      localStorage.setItem('role', 'admin')
      const { wrapper, router } = await mountLayout({ startAt: 'Attendance' })
      const pushSpy = vi.spyOn(router, 'push')
      await wrapper.find('[data-command="back-office"]').trigger('click')
      expect(pushSpy).toHaveBeenCalledWith('/manager')
    })

    it('視窗放大到桌機寬度時換回側欄', async () => {
      const { wrapper } = await mountLayout({ startAt: 'Attendance' })
      expect(wrapper.find('[data-test="mobile-tabbar"]').exists()).toBe(true)
      window.innerWidth = 1440
      window.dispatchEvent(new Event('resize'))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test="mobile-tabbar"]').exists()).toBe(false)
      expect(wrapper.find('aside.sidebar').exists()).toBe(true)
      wrapper.unmount()
    })
  })
})
