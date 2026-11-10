import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FrontLogin from '../src/views/front/FrontLogin.vue'
vi.mock('../src/stores/menu', () => ({ useMenuStore: () => ({ fetchMenu: vi.fn() }) }))
vi.mock('element-plus', async () => {
  const actual = await vi.importActual('element-plus')
  return { ...actual, ElMessage: { success: vi.fn(), error: vi.fn() } }
})

function createToken(offset = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + offset })).toString('base64')
  return `${header}.${payload}.sig`
}

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push })
}))

function mountLogin() {
  return mount(FrontLogin, {
    global: {
      components: {
        'el-input': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
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
        'el-card': { template: '<div><slot /></div>' }
      }
    }
  })
}

describe('FrontLogin.vue', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    push.mockReset()
    const { ElMessage } = await import('element-plus')
    ElMessage.success.mockReset()
    ElMessage.error.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('stores role and employeeId and redirects to attendance on login', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: createToken(), user: { role: 'employee', employeeId: 'e1' } })
      })
    const wrapper = mountLogin()
    await wrapper.find('input[placeholder="請輸入員工帳號"]').setValue('u1')
    await wrapper.find('input[placeholder="請輸入密碼"]').setValue('p1p1p1')
    await wrapper.find('.login-button').trigger('click')
    await flushPromises()
    // 2026/11：不再送 role（以前固定送 employee，主管或管理員從這一頁登入一律失敗）；角色由伺服器依帳號決定
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/login'),
      expect.objectContaining({
        body: JSON.stringify({ username: 'u1', password: 'p1p1p1' })
      })
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('role')).toBe('employee')
    expect(localStorage.getItem('employeeId')).toBe('e1')
    expect(push).toHaveBeenCalledWith('/front/attendance')
  })

  it('navigates to manager login when link clicked', async () => {
    const wrapper = mountLogin()
    const button = wrapper.find('.manager-login-link')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(push).toHaveBeenCalledWith('/manager/login')
  })

  it('shows error message on login failure', async () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '', pathname: '' }
    })
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: '登入失敗' })
    })
    const wrapper = mountLogin()
    await wrapper.find('input[placeholder="請輸入員工帳號"]').setValue('u1')
    await wrapper.find('input[placeholder="請輸入密碼"]').setValue('p1p1p1')
    await wrapper.find('.login-button').trigger('click')
    await flushPromises()
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.error).toHaveBeenCalledWith('登入失敗')
    expect(push).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
    window.location = originalLocation
  })

  async function loginWith(response) {
    fetch.mockResolvedValueOnce(response)
    const wrapper = mountLogin()
    await wrapper.find('input[placeholder="請輸入員工帳號"]').setValue('u1')
    await wrapper.find('input[placeholder="請輸入密碼"]').setValue('p1p1p1')
    await wrapper.find('.login-button').trigger('click')
    await flushPromises()
    const { ElMessage } = await import('element-plus')
    return { wrapper, ElMessage }
  }

  // 主管／管理員帳號從員工登入頁登入：不再失敗，依伺服器回應的角色進各自的首頁
  it('sends a supervisor who can schedule to the schedule page', async () => {
    await loginWith({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'supervisor', employeeId: 's1', scheduleAccess: { canSchedule: true } } })
    })
    expect(push).toHaveBeenCalledWith('/front/schedule')
    expect(localStorage.getItem('role')).toBe('supervisor')
    expect(sessionStorage.getItem('employeeId')).toBe('s1')
  })

  it('sends a supervisor without schedule access to attendance', async () => {
    await loginWith({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'supervisor', employeeId: 's1', scheduleAccess: { canSchedule: false } } })
    })
    expect(push).toHaveBeenCalledWith('/front/attendance')
  })

  it('sends an administrator to the back office', async () => {
    const { ElMessage } = await loginWith({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'admin', employeeId: 'a1' } })
    })
    expect(push).toHaveBeenCalledWith('/manager/settings')
    expect(localStorage.getItem('role')).toBe('admin')
    // 不再跳「歡迎回來，一般員工！」（對主管、管理員是錯的，手機上還會蓋住標題列）
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('shows one clear message for wrong credentials or an inactive account', async () => {
    const { ElMessage } = await loginWith({ ok: false, status: 401, json: async () => ({ error: 'Invalid credentials' }) })
    expect(ElMessage.error).toHaveBeenCalledWith('帳號或密碼錯誤，或帳號已停用')
    expect(push).not.toHaveBeenCalled()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('tells the user to wait when the login rate limit is hit', async () => {
    const { ElMessage } = await loginWith({ ok: false, status: 429, json: async () => ({ error: 'Too many login attempts.' }) })
    expect(ElMessage.error).toHaveBeenCalledWith('登入失敗次數過多，請稍後再試')
  })

  it('does not leave a session behind when the response has no usable role', async () => {
    const { ElMessage } = await loginWith({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'unknown', employeeId: 'x1' } })
    })
    expect(ElMessage.error).toHaveBeenCalledWith('登入過程中發生錯誤，請稍後再試')
    expect(push).not.toHaveBeenCalled()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('employeeId')).toBeNull()
  })

  // 以前表單驗證沒過（欄位空白）會落到 catch，除了欄位旁的提示還多跳一個「登入失敗」的訊息
  it('does not call the API or show an error toast when validation fails', async () => {
    const wrapper = mount(FrontLogin, {
      global: {
        stubs: {
          'el-form': {
            template: '<form><slot /></form>',
            methods: { validate: () => Promise.reject({ username: [{ message: '請輸入員工帳號' }] }) }
          },
          'el-form-item': { template: '<div><slot /></div>' },
          'el-card': { template: '<div><slot /></div>' },
          'el-input': { template: '<input />' },
          'el-button': { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' }
        }
      }
    })
    await wrapper.find('.login-button').trigger('click')
    await flushPromises()
    const { ElMessage } = await import('element-plus')
    expect(fetch).not.toHaveBeenCalled()
    expect(ElMessage.error).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('has no filler badges or decorative copy', () => {
    const text = mountLogin().text()
    expect(text).not.toContain('24小時')
    expect(text).not.toContain('安全加密')
    expect(text).not.toContain('Human Resources Portal')
    expect(text).toContain('員工登入')
  })
})

// 用真正的 Element Plus 元件掛載：按鈕是 submit 按鈕，以前同時綁了 click 與表單的 submit，
// 按一次會送出兩次登入請求——密碼打錯一次就被算成兩次失敗（同一帳號 15 分鐘內失敗 5 次會被暫時鎖住）
describe('FrontLogin.vue with real Element Plus form', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    push.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  async function mountReal() {
    const { default: ElementPlus, ElMessage } = await import('element-plus')
    ElMessage.success.mockReset()
    ElMessage.error.mockReset()
    const wrapper = mount(FrontLogin, { global: { plugins: [ElementPlus] }, attachTo: document.body })
    return { wrapper, ElMessage }
  }

  it('sends exactly one login request per click on the submit button', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 401, json: async () => ({ error: 'Invalid credentials' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper, ElMessage } = await mountReal()
    await wrapper.find('input[name="username"]').setValue('someone')
    await wrapper.find('input[name="password"]').setValue('wrong-password')

    await wrapper.find('button.login-button').trigger('click')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    await vi.waitFor(() => expect(ElMessage.error).toHaveBeenCalled())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ElMessage.error).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })


  it('marks the inputs so phones do not capitalise the account and password managers can fill them', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { wrapper } = await mountReal()
    const username = wrapper.find('input[name="username"]')
    expect(username.attributes('autocomplete')).toBe('username')
    expect(username.attributes('autocapitalize')).toBe('off')
    expect(wrapper.find('input[name="password"]').attributes('autocomplete')).toBe('current-password')
    expect(wrapper.find('button.login-button').attributes('type')).toBe('submit')
    wrapper.unmount()
  })
})
