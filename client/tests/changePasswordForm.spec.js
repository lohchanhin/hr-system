import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ChangePasswordForm from '../src/components/ChangePasswordForm.vue'

const push = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push })
}))

vi.mock('element-plus', async () => {
  const actual = await vi.importActual('element-plus')
  return { ...actual, ElMessage: { success: vi.fn(), error: vi.fn() } }
})

function mountForm() {
  return mount(ChangePasswordForm, {
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
          methods: {
            validate: () => Promise.resolve(true),
            clearValidate: () => {}
          }
        },
        'el-form-item': { template: '<div><slot /></div>' }
      }
    }
  })
}

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.setItem('token', 'tok')
    localStorage.setItem('role', 'employee')
    localStorage.setItem('employeeId', 'e1')
    sessionStorage.setItem('role', 'employee')
    sessionStorage.setItem('employeeId', 'e1')
    push.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('calls API and clears session after successful update', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'ok' })
    })

    const wrapper = mountForm()
    wrapper.vm.formRef = { validate: async () => true, clearValidate: vi.fn() }
    wrapper.vm.form.oldPassword = 'OldPass123'
    wrapper.vm.form.newPassword = 'NewPass123'
    wrapper.vm.form.confirmPassword = 'NewPass123'

    await wrapper.vm.submit()

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/change-password'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ oldPassword: 'OldPass123', newPassword: 'NewPass123' })
      })
    )
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('role')).toBeNull()
    expect(localStorage.getItem('employeeId')).toBeNull()
    expect(sessionStorage.getItem('role')).toBeNull()
    expect(sessionStorage.getItem('employeeId')).toBeNull()
    expect(push).toHaveBeenCalledWith('/login')
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenCalled()
  })

  it('shows error message when API rejects', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: '舊密碼不正確' })
    })

    const wrapper = mountForm()
    wrapper.vm.formRef = { validate: async () => true, clearValidate: vi.fn() }
    wrapper.vm.form.oldPassword = 'OldPass123'
    wrapper.vm.form.newPassword = 'NewPass123'
    wrapper.vm.form.confirmPassword = 'NewPass123'

    await wrapper.vm.submit()

    const { ElMessage } = await import('element-plus')
    expect(ElMessage.error).toHaveBeenCalledWith('舊密碼不正確')
    expect(push).not.toHaveBeenCalled()
  })
})
