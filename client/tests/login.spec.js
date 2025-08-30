import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
        'el-card': { template: '<div><slot /></div>' }
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
    await wrapper.vm.onLogin()
    expect(localStorage.getItem('role')).toBe('supervisor')
    expect(localStorage.getItem('employeeId')).toBe('e1')
    expect(push).toHaveBeenCalledWith('/front/schedule')
  })

  it('redirects admin to first menu item', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: createToken(), user: { role: 'admin', employeeId: 'a1' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ name: 'Settings' }])
      })
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: async () => true }
    wrapper.vm.loginForm.username = 'u'
    wrapper.vm.loginForm.password = 'p'
    await wrapper.vm.onLogin()
    expect(localStorage.getItem('employeeId')).toBe('a1')
    expect(push).toHaveBeenCalledWith({ name: 'Settings' })
  })

  it('redirects admin to /manager when menu empty', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: createToken(), user: { role: 'admin', employeeId: 'a1' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([])
      })
    const wrapper = mountLogin()
    wrapper.vm.loginFormRef = { validate: async () => true }
    wrapper.vm.loginForm.username = 'u'
    wrapper.vm.loginForm.password = 'p'
    await wrapper.vm.onLogin()
    expect(localStorage.getItem('employeeId')).toBe('a1')
    expect(push).toHaveBeenCalledWith('/manager')
  })

  it('navigates to employee login when link clicked', async () => {
    const wrapper = mountLogin()
    const button = wrapper.find('.employee-login-link')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(push).toHaveBeenCalledWith('/login')
  })
})
