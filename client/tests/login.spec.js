import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useMenuStore } from '../src/stores/menu'
let Login

function createToken(offset = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + offset })).toString('base64')
  return `${header}.${payload}.sig`
}

const push = vi.fn()
const replace = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace })
}))
vi.mock('element-plus', async () => {
  const actual = await vi.importActual('element-plus')
  return { ...actual, ElMessage: { success: vi.fn(), error: vi.fn() } }
})

function mountLogin() {
  return mount(Login, {
    global: {
      components: {
        'el-input': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
        },
        'el-button': {
          emits: ['click'],
          template: '<button @click="$emit(\'click\')"><slot /></button>'
        }
      },
      stubs: {
        'el-form': {
          template: '<form><slot /></form>',
          methods: { validate: () => Promise.resolve(true) }
        },
        'el-form-item': { template: '<div><slot /></div>' },
        'el-card': { template: '<div><slot /></div>' },
        'el-radio-group': { template: '<div><slot /></div>' },
        'el-radio': { props: ['label'], template: '<div><slot /></div>' }
      }
    }
  })
}

describe('Login.vue', () => {
  let fetchMenuSpy
  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
    sessionStorage.clear()
    push.mockReset()
    replace.mockReset()
    const module = await import('../src/views/Login.vue')
    Login = module.default
    const { ElMessage } = await import('element-plus')
    ElMessage.success.mockClear()
    ElMessage.error.mockClear()
    const menuStore = useMenuStore()
    fetchMenuSpy = vi.spyOn(menuStore, 'fetchMenu').mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterAll(() => {
    vi.resetModules()
  })

  // 2026/11：登入頁不再讓使用者選角色（選錯只會得到看不懂的登入失敗），角色由伺服器依帳號決定
  it('has no role selector: the form only asks for username and password', () => {
    const wrapper = mountLogin()
    expect(wrapper.vm.loginForm).toEqual({ username: '', password: '' })
    expect(wrapper.text()).not.toContain('角色')
    expect(wrapper.text()).not.toContain('系統管理員')
  })

  // 2026/11 起主管預設沒有排班權限：登入回應的 scheduleAccess.canSchedule 是 true 才進排班頁
  it('redirects a supervisor who can schedule to schedule', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'supervisor', employeeId: 'e1', scheduleAccess: { canSchedule: true } } })
    })
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: async () => true }
    wrapper.vm.loginForm.username = 'u'
    wrapper.vm.loginForm.password = 'p'
    await wrapper.vm.onLogin()
    // 不送 role：伺服器以帳號本身的角色登入
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/login'),
      expect.objectContaining({
        body: JSON.stringify({ username: 'u', password: 'p' })
      })
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('role')).toBe('supervisor')
    expect(sessionStorage.getItem('employeeId')).toBe('e1')
    expect(fetchMenuSpy).toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/front/schedule')
  })

  it('redirects a supervisor without schedule access to attendance instead of the forbidden schedule page', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'supervisor', employeeId: 'e1', scheduleAccess: { canSchedule: false } } })
    })
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: async () => true }
    wrapper.vm.loginForm.username = 'u'
    wrapper.vm.loginForm.password = 'p'
    await wrapper.vm.onLogin()
    expect(replace).toHaveBeenCalledWith('/front/attendance')
  })

  it('redirects admin to manager', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'admin', employeeId: 'a1' } })
    })
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: async () => true }
    wrapper.vm.loginForm.username = 'u'
    wrapper.vm.loginForm.password = 'p'
    await wrapper.vm.onLogin()
    expect(sessionStorage.getItem('role')).toBe('admin')
    expect(sessionStorage.getItem('employeeId')).toBe('a1')
    expect(fetchMenuSpy).toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/manager/settings')
  })

  it('shows error on role mismatch', async () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '', pathname: '' }
    })
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: '角色錯誤' })
    })
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: async () => true }
    wrapper.vm.loginForm.username = 'u'
    wrapper.vm.loginForm.password = 'p'
    await wrapper.vm.onLogin()
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.error).toHaveBeenCalledWith('角色錯誤')
    expect(fetchMenuSpy).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
    window.location = originalLocation
  })

  it('does not report success when the authenticated role has no destination', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'unknown', employeeId: 'x1' } })
    })
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: async () => true }
    wrapper.vm.loginForm.username = 'u'
    wrapper.vm.loginForm.password = 'p'
    await wrapper.vm.onLogin()

    const { ElMessage } = await import('element-plus')
    expect(replace).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledWith('登入過程中發生錯誤，請稍後再試')
  })

  it('navigates to employee login when link clicked', async () => {
    const wrapper = mountLogin()
    const button = wrapper.find('.employee-login-link')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(push).toHaveBeenCalledWith('/login')
  })

  async function loginWith(response) {
    if (response instanceof Error) fetch.mockRejectedValueOnce(response)
    else fetch.mockResolvedValueOnce(response)
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: async () => true }
    wrapper.vm.loginForm.username = 'u'
    wrapper.vm.loginForm.password = 'p'
    await wrapper.vm.onLogin()
    const { ElMessage } = await import('element-plus')
    return { wrapper, ElMessage }
  }

  // 員工帳號從主管登入頁登入：不再失敗，直接進員工自己的首頁
  it('sends a staff account that signs in on the manager page to its own home', async () => {
    await loginWith({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'employee', employeeId: 'e9', scheduleAccess: { canSchedule: false } } })
    })
    expect(replace).toHaveBeenCalledWith('/front/attendance')
    expect(sessionStorage.getItem('role')).toBe('employee')
    expect(localStorage.getItem('employeeId')).toBe('e9')
    expect(fetchMenuSpy).toHaveBeenCalled()
  })

  it('does not show a success toast after signing in (the landing page is the feedback)', async () => {
    const { ElMessage } = await loginWith({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'admin', employeeId: 'a1' } })
    })
    expect(replace).toHaveBeenCalledWith('/manager/settings')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  // 伺服器對帳密錯誤與帳號停用回同一個 401（英文 error）：畫面顯示同一句中文，不洩漏是哪一種
  it('shows one clear message for wrong credentials or an inactive account', async () => {
    const { ElMessage } = await loginWith({ ok: false, status: 401, json: async () => ({ error: 'Invalid credentials' }) })
    expect(ElMessage.error).toHaveBeenCalledWith('帳號或密碼錯誤，或帳號已停用')
    expect(replace).not.toHaveBeenCalled()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('tells the user to wait when the login rate limit is hit', async () => {
    const { ElMessage } = await loginWith({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many login attempts. Please try again later.' })
    })
    expect(ElMessage.error).toHaveBeenCalledWith('登入失敗次數過多，請稍後再試')
  })

  it('shows a generic message for server errors, including non-JSON bodies', async () => {
    const { ElMessage } = await loginWith({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      }
    })
    expect(ElMessage.error).toHaveBeenCalledWith('登入失敗，請稍後再試')
  })

  it('shows a connection message when the request cannot be sent', async () => {
    const { ElMessage } = await loginWith(new TypeError('Failed to fetch'))
    expect(ElMessage.error).toHaveBeenCalledWith('無法連線到伺服器，請確認網路連線後再試')
    expect(replace).not.toHaveBeenCalled()
  })

  it('still signs in when the menu cannot be loaded (the shell loads it again)', async () => {
    fetchMenuSpy.mockRejectedValueOnce(new Error('menu down'))
    await loginWith({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'admin', employeeId: 'a1' } })
    })
    expect(replace).toHaveBeenCalledWith('/manager/settings')
  })

  it('sends only one request when submit fires twice before the first one finishes', async () => {
    let resolveFetch
    fetch.mockReturnValueOnce(new Promise(resolve => { resolveFetch = resolve }))
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: async () => true }
    wrapper.vm.loginForm.username = 'u'
    wrapper.vm.loginForm.password = 'p'
    const first = wrapper.vm.onLogin()
    const second = wrapper.vm.onLogin()
    await second
    resolveFetch({ ok: true, json: async () => ({ token: createToken(), user: { role: 'admin', employeeId: 'a1' } }) })
    await first
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledTimes(1)
  })

  // 以前表單驗證沒過（欄位空白）會落到 catch，除了欄位旁的提示還多跳一個「登入過程中發生錯誤」
  it('does not call the API or show an error toast when validation fails', async () => {
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: () => Promise.reject({ username: [{ message: '請輸入帳號' }] }) }
    await wrapper.vm.onLogin()
    const { ElMessage } = await import('element-plus')
    expect(fetch).not.toHaveBeenCalled()
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('clears the previous account data cached in this tab when another account signs in', async () => {
    const menuStore = useMenuStore()
    menuStore.setMenu([{ name: 'Attendance', label: '出勤打卡' }])
    const { useProfileStore } = await import('../src/stores/profile')
    const profileStore = useProfileStore()
    profileStore.setProfile({ id: 'old', name: '上一位' })
    await loginWith({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'admin', employeeId: 'a1' } })
    })
    expect(profileStore.profile).toBeNull()
    expect(menuStore.items).toEqual([])
  })
})
