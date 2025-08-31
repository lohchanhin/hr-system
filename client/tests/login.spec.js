import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import Login from '../src/views/Login.vue'

function createToken(offset = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + offset })).toString('base64')
  return `${header}.${payload}.sig`
}

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push })
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
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
    push.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  afterAll(() => {
    vi.resetModules()
  })

  it('redirects supervisor to schedule', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: createToken(), user: { role: 'supervisor', employeeId: 'e1' } })
    })
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: async () => true }
    wrapper.vm.loginForm.username = 'u'
    wrapper.vm.loginForm.password = 'p'
    wrapper.vm.loginForm.role = 'supervisor'
    await wrapper.vm.onLogin()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/login'),
      expect.objectContaining({
        body: JSON.stringify({ username: 'u', password: 'p', role: 'supervisor' })
      })
    )
    expect(localStorage.getItem('role')).toBe('supervisor')
    expect(localStorage.getItem('employeeId')).toBe('e1')
    expect(push).toHaveBeenCalledWith('/front/schedule')
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
    wrapper.vm.loginForm.role = 'admin'
    await wrapper.vm.onLogin()
    expect(localStorage.getItem('employeeId')).toBe('a1')
    expect(push).toHaveBeenCalledWith('/manager/settings')
  })

  it('shows error on role mismatch', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: '角色錯誤' })
    })
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: async () => true }
    wrapper.vm.loginForm.username = 'u'
    wrapper.vm.loginForm.password = 'p'
    wrapper.vm.loginForm.role = 'admin'
    await wrapper.vm.onLogin()
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.error).toHaveBeenCalledWith('角色錯誤')
    expect(push).not.toHaveBeenCalled()
  })

  it('navigates to employee login when link clicked', async () => {
    const wrapper = mountLogin()
    const button = wrapper.find('.employee-login-link')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(push).toHaveBeenCalledWith('/login')
  })
})
