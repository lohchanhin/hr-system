import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import Settings from '../src/views/Settings.vue'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock })
}))

describe('Settings.vue logout', () => {
  beforeEach(() => {
    localStorage.setItem('token', 't')
    sessionStorage.setItem('role', 'r')
    sessionStorage.setItem('employeeId', 'e')
    pushMock.mockClear()
    // 登出現在會請伺服器作廢 token：測試裡不發真正的網路請求
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 204 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('removes auth values and redirects', async () => {
    const wrapper = mount(Settings, {
      global: {
        components: {
          'el-button': { template: '<button><slot /></button>' }
        }
      }
    })
    await wrapper.find('button').trigger('click')
    expect(localStorage.getItem('token')).toBeNull()
    expect(sessionStorage.getItem('role')).toBeNull()
    expect(sessionStorage.getItem('employeeId')).toBeNull()
    expect(pushMock).toHaveBeenCalledWith('/')
  })

  // 以前登出只清本機，token 在到期前仍然有效
  it('asks the server to revoke the token', async () => {
    const wrapper = mount(Settings, {
      global: {
        components: {
          'el-button': { template: '<button><slot /></button>' }
        }
      }
    })
    await wrapper.find('button').trigger('click')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toContain('/api/logout')
    expect(options).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer t' } })
  })

  it('is only a loading placeholder with a way out, not a sample page', () => {
    const wrapper = mount(Settings, {
      global: {
        components: {
          'el-button': { template: '<button><slot /></button>' }
        }
      }
    })
    expect(wrapper.text()).not.toContain('範例')
    expect(wrapper.text()).toContain('正在載入選單')
    expect(wrapper.find('button').text()).toBe('登出')
  })
})
