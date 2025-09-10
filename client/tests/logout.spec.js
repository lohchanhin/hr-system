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
  })

  afterEach(() => {
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
})
