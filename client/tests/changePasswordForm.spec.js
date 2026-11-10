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

  async function submitWith(response) {
    if (response instanceof Error) fetch.mockRejectedValueOnce(response)
    else fetch.mockResolvedValueOnce(response)
    const wrapper = mountForm()
    wrapper.vm.formRef = { validate: async () => true, clearValidate: vi.fn() }
    wrapper.vm.form.oldPassword = 'OldPass123'
    wrapper.vm.form.newPassword = 'NewPass123'
    wrapper.vm.form.confirmPassword = 'NewPass123'
    await wrapper.vm.submit()
    const { ElMessage } = await import('element-plus')
    return { wrapper, ElMessage }
  }

  // 變更成功時伺服器已經作廢 token：不需要再打登出 API
  it('does not call the logout API after a successful change', async () => {
    await submitWith({ ok: true, json: async () => ({ message: 'ok' }) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toContain('/api/change-password')
  })

  // 以前變更密碼只清 localStorage，同一個分頁換人登入時外框還顯示上一個人的姓名與選單
  it('clears the cached menu and profile of the signed-out account', async () => {
    const { setActivePinia, createPinia } = await import('pinia')
    const { useMenuStore } = await import('../src/stores/menu')
    const { useProfileStore } = await import('../src/stores/profile')
    setActivePinia(createPinia())
    const menuStore = useMenuStore()
    const profileStore = useProfileStore()
    menuStore.setMenu([{ name: 'Attendance', label: '出勤打卡' }])
    profileStore.setProfile({ id: 'e1', name: '上一位' })

    await submitWith({ ok: true, json: async () => ({ message: 'ok' }) })

    expect(menuStore.items).toEqual([])
    expect(profileStore.profile).toBeNull()
    setActivePinia(undefined)
  })

  it('sends the user back to the login page when the session has expired', async () => {
    const { ElMessage } = await submitWith({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) })
    expect(ElMessage.error).toHaveBeenCalledWith('登入已逾時，請重新登入後再變更密碼')
    expect(ElMessage.error).not.toHaveBeenCalledWith('Unauthorized')
    expect(localStorage.getItem('token')).toBeNull()
    expect(push).toHaveBeenCalledWith('/login')
  })

  it('shows the server reason when the change is rejected or rate limited, and keeps the session', async () => {
    const { ElMessage } = await submitWith({ ok: false, status: 429, json: async () => ({ error: '舊密碼錯誤次數過多，請稍後再試' }) })
    expect(ElMessage.error).toHaveBeenCalledWith('舊密碼錯誤次數過多，請稍後再試')
    expect(localStorage.getItem('token')).toBe('tok')
    expect(push).not.toHaveBeenCalled()
  })

  // 畫面的檢查通常會先擋下；伺服器自己也檢查，它拒絕時（400）要顯示同一句話，登入狀態不動
  it('shows the server message when it rejects a new password equal to the old one', async () => {
    const { ElMessage } = await submitWith({ ok: false, status: 400, json: async () => ({ error: '新密碼不可與舊密碼相同' }) })
    expect(ElMessage.error).toHaveBeenCalledWith('新密碼不可與舊密碼相同')
    expect(localStorage.getItem('token')).toBe('tok')
    expect(push).not.toHaveBeenCalled()
  })

  it('shows a connection message when the request cannot be sent', async () => {
    const { ElMessage, wrapper } = await submitWith(new TypeError('Failed to fetch'))
    expect(ElMessage.error).toHaveBeenCalledWith('無法連線到伺服器，請確認網路連線後再試')
    expect(localStorage.getItem('token')).toBe('tok')
    expect(wrapper.vm.loading).toBe(false)
  })

  it('does not send the request twice when submit fires again while saving', async () => {
    let resolveFetch
    fetch.mockReturnValueOnce(new Promise(resolve => { resolveFetch = resolve }))
    const wrapper = mountForm()
    wrapper.vm.formRef = { validate: async () => true, clearValidate: vi.fn() }
    wrapper.vm.form.oldPassword = 'OldPass123'
    wrapper.vm.form.newPassword = 'NewPass123'
    wrapper.vm.form.confirmPassword = 'NewPass123'
    const first = wrapper.vm.submit()
    await wrapper.vm.submit()
    resolveFetch({ ok: true, json: async () => ({ message: 'ok' }) })
    await first
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('does not call the API when validation fails', async () => {
    const wrapper = mountForm()
    wrapper.vm.formRef = { validate: () => Promise.reject({ newPassword: [{ message: 'x' }] }), clearValidate: vi.fn() }
    await wrapper.vm.submit()
    expect(fetch).not.toHaveBeenCalled()
    expect(wrapper.vm.loading).toBe(false)
  })

  const runRule = (rule, value) => new Promise(resolve => rule.validator({}, value, error => resolve(error?.message || '')))

  it('rejects a new password that equals the old one before calling the server', async () => {
    const wrapper = mountForm()
    wrapper.vm.form.oldPassword = 'SamePass123'
    const strength = wrapper.vm.rules.newPassword.find(rule => typeof rule.validator === 'function')
    expect(await runRule(strength, 'SamePass123')).toBe('新密碼不可與舊密碼相同')
    expect(await runRule(strength, 'OtherPass123')).toBe('')
    expect(await runRule(strength, 'alllowercase1')).toBe('需包含大小寫字母與數字')
  })

  it('uses the shared page header and the standard 儲存 button', () => {
    const wrapper = mount(ChangePasswordForm, {
      props: { title: '變更密碼', description: '密碼更新後會自動登出，請使用新密碼重新登入' },
      global: {
        stubs: {
          'el-form': { template: '<form><slot /></form>' },
          'el-form-item': { template: '<div><slot /></div>' },
          'el-input': { template: '<input />' },
          'el-button': { template: '<button><slot /></button>' }
        }
      }
    })
    const header = wrapper.find('[data-test="page-header"]')
    expect(header.text()).toContain('變更密碼')
    expect(header.text()).toContain('密碼更新後會自動登出')
    expect(wrapper.find('[data-test="submit-btn"]').text()).toBe('儲存')
  })
})
