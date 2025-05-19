import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import FrontLogin from '../src/views/front/FrontLogin.vue'
import { useAuthStore } from '../src/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

describe('FrontLogin.vue', () => {
  let pinia
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    pinia = createPinia()
    setActivePinia(pinia)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })


  it('stores role on login', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 't', user: { role: 'employee' } })
    })
    const wrapper = mount(FrontLogin, { global: { plugins: [pinia] } })
    const store = useAuthStore()
    await wrapper.find('button').trigger('click')
    expect(store.role).toBe('employee')
    expect(localStorage.getItem('employeeId')).toBeDefined()
  })

  it('stores HR role when API returns hr', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 't', user: { role: 'hr' } })
    })
    const wrapper = mount(FrontLogin, { global: { plugins: [pinia] } })
    const store = useAuthStore()
    await wrapper.find('button').trigger('click')
    expect(store.role).toBe('hr')
  })
})
