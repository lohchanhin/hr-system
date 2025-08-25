import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/utils/tokenService', () => ({
  getToken: vi.fn(() => 'old'),
  getRefreshToken: vi.fn(() => 'ref'),
  setToken: vi.fn(),
  clearToken: vi.fn(),
  clearRefreshToken: vi.fn()
}))

import { getToken, getRefreshToken, setToken } from '../src/utils/tokenService'
import { apiFetch } from '../src/api'

describe('apiFetch', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('refreshes token on 401 and retries request', async () => {
    global.fetch
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'new' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })

    const res = await apiFetch('/api/protected')

    expect(global.fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/protected'), expect.anything())
    expect(global.fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/refresh'), expect.anything())
    expect(global.fetch).toHaveBeenNthCalledWith(3, expect.stringContaining('/api/protected'), expect.anything())
    expect(setToken).toHaveBeenCalledWith('new')
    expect(res.ok).toBe(true)
  })
})
