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
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/login'),
      expect.objectContaining({
        body: expect.stringContaining('"role":"employee"')
      })
    )
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
})
