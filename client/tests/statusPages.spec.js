import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import Forbidden from '../src/views/Forbidden.vue'
import NotFound from '../src/views/NotFound.vue'
import { useProfileStore } from '../src/stores/profile'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push })
}))

const tokenFor = role => `h.${btoa(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`

function signInAs(role) {
  localStorage.setItem('token', tokenFor(role))
  localStorage.setItem('employeeId', 'u1')
}

function mountPage(component) {
  return mount(component, {
    global: {
      stubs: {
        'el-button': { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' }
      }
    }
  })
}

// 以前 403 / 404 只有一行字，沒有任何連結：被擋下的人只能自己改網址或關掉分頁
describe.each([
  ['Forbidden', Forbidden, '沒有權限'],
  ['NotFound', NotFound, '找不到頁面']
])('%s 頁面', (_name, component, title) => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
    push.mockReset()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 204 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('顯示中文說明', () => {
    expect(mountPage(component).text()).toContain(title)
  })

  it.each([
    ['employee', '/front/attendance'],
    ['admin', '/manager/settings'],
    // 主管沒有（或讀不到）排班權限時進出勤打卡，不會又被排班頁擋回 403
    ['supervisor', '/front/attendance']
  ])('已登入的 %s 可以回自己的首頁', async (role, home) => {
    signInAs(role)
    const wrapper = mountPage(component)
    const button = wrapper.find('[data-test="go-home"]')
    expect(button.text()).toBe('回首頁')
    await button.trigger('click')
    expect(push).toHaveBeenCalledWith(home)
  })

  it('有排班權限的主管回排班頁', async () => {
    signInAs('supervisor')
    useProfileStore().setProfile({ id: 'u1', scheduleAccess: { canSchedule: true } })
    const wrapper = mountPage(component)
    await wrapper.find('[data-test="go-home"]').trigger('click')
    expect(push).toHaveBeenCalledWith('/front/schedule')
  })

  it('已登入時可以登出：作廢 token、清掉登入狀態、回登入頁', async () => {
    signInAs('employee')
    const token = localStorage.getItem('token')
    const wrapper = mountPage(component)
    await wrapper.find('[data-test="logout"]').trigger('click')
    expect(fetch.mock.calls[0][0]).toContain('/api/logout')
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${token}`)
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('employeeId')).toBeNull()
    expect(push).toHaveBeenCalledWith('/login')
  })

  it('沒登入時只有「前往登入」', async () => {
    const wrapper = mountPage(component)
    expect(wrapper.find('[data-test="logout"]').exists()).toBe(false)
    const button = wrapper.find('[data-test="go-home"]')
    expect(button.text()).toBe('前往登入')
    await button.trigger('click')
    expect(push).toHaveBeenCalledWith('/login')
  })

  it('沒有 pinia 時也能回首頁', async () => {
    setActivePinia(undefined)
    signInAs('admin')
    const wrapper = mountPage(component)
    await wrapper.find('[data-test="go-home"]').trigger('click')
    expect(push).toHaveBeenCalledWith('/manager/settings')
  })
})
