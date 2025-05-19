import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import FrontLogin from '../src/views/front/FrontLogin.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

describe('FrontLogin.vue', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })


  it('stores role and employeeId on login', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 't', user: { role: 'employee', employeeId: 'e1' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([])
      })
    const wrapper = mount(FrontLogin)
    await wrapper.find('button').trigger('click')
    expect(localStorage.getItem('role')).toBe('employee')
    expect(localStorage.getItem('employeeId')).toBe('e1')
  })

  it('stores HR role when API returns hr', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 't', user: { role: 'hr' } })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
    const wrapper = mount(FrontLogin)
    await wrapper.find('button').trigger('click')
    expect(localStorage.getItem('role')).toBe('hr')
  })
})
