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
    localStorage.setItem('role', 'r')
    localStorage.setItem('employeeId', 'e')
    pushMock.mockClear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('removes auth values and redirects', async () => {
    const wrapper = mount(Settings)
    await wrapper.find('button').trigger('click')
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('role')).toBeNull()
    expect(localStorage.getItem('employeeId')).toBeNull()
    expect(pushMock).toHaveBeenCalledWith({ name: 'Login' })
  })
})
