import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import { useMenuStore } from '../src/stores/menu'
import { useProfileStore } from '../src/stores/profile'

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

  async function mountLayout() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: { template: '<div />' } },
        { path: '/attendance', name: 'attendance', component: { template: '<div />' } },
        { path: '/myschedule', name: 'MySchedule', component: { template: '<div />' } },
      ],
    })
    await router.push({ name: 'attendance' })
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

  it('管理員不顯示按鈕並可登出', async () => {
    localStorage.setItem('role', 'admin')
    localStorage.setItem('username', 'boss')
    const { wrapper, router } = await mountLayout()
    const pushSpy = vi.spyOn(router, 'push')
    expect(wrapper.find('[data-test="manager-btn"]').exists()).toBe(false)
    await wrapper.find('.logout-btn').trigger('click')
    expect(pushSpy).toHaveBeenCalledWith('/')
    expect(localStorage.getItem('role')).toBeNull()
    expect(localStorage.getItem('username')).toBeNull()
    expect(localStorage.getItem('employeeId')).toBeNull()
    expect(fetchProfileMock).toHaveBeenCalled()
    expect(clearProfileMock).toHaveBeenCalled()
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

  it('載入後顯示個人資訊欄位', async () => {
    const { wrapper } = await mountLayout()
    expect(fetchProfileMock).toHaveBeenCalled()
    const text = wrapper.text()
    expect(text).toContain('機構')
    expect(text).toContain('部門')
    expect(text).toContain('小單位')
    expect(text).toContain('姓名')
    expect(text).toContain('測試機構')
    expect(text).toContain('測試部門')
    expect(text).toContain('測試小單位')
    expect(text).toContain('測試員工')
  })
})
