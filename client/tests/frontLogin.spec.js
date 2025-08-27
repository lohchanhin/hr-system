import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import FrontLogin from '../src/views/front/FrontLogin.vue'

function createToken(offset = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + offset })).toString('base64')
  return `${header}.${payload}.sig`
}

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push })
}))

describe('FrontLogin.vue', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    push.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores role and employeeId and redirects to attendance on login', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: createToken(), user: { role: 'employee', employeeId: 'e1' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([])
      })
    const wrapper = mount(FrontLogin)
    await wrapper.find('input[placeholder="請輸入員工帳號"]').setValue('u1')
    await wrapper.find('input[placeholder="請輸入密碼"]').setValue('p1p1p1')
    await wrapper.find('button').trigger('click')
    expect(localStorage.getItem('role')).toBe('employee')
    expect(localStorage.getItem('employeeId')).toBe('e1')
    expect(push).toHaveBeenCalledWith('/front/attendance')
  })
})
