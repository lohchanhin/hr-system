import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import FrontLogin from '../src/views/front/FrontLogin.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

describe('FrontLogin.vue', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores role and employeeId on login', async () => {
    const wrapper = mount(FrontLogin)
    await wrapper.find('button').trigger('click')
    expect(localStorage.getItem('role')).toBe('employee')
    expect(localStorage.getItem('employeeId')).toBeDefined()
  })
})
