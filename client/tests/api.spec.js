import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiFetch, refreshAccessToken } from '../src/api'
import { clearToken, getToken, setToken, isTokenExpiring } from '../src/utils/tokenService'

vi.mock('../src/utils/tokenService', () => ({
  getToken: vi.fn(() => 't'),
  setToken: vi.fn(),
  clearToken: vi.fn(),
  isTokenExpiring: vi.fn(() => false)
}))

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const refreshCalls = () => fetch.mock.calls.filter(([url]) => String(url).includes('/api/auth/refresh'))

describe('apiFetch', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    getToken.mockImplementation(() => 't')
    isTokenExpiring.mockImplementation(() => false)
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '', pathname: '' }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.location = originalLocation
  })

  it('redirects to login on 401 for frontend path', async () => {
    window.location.pathname = '/profile'
    fetch.mockResolvedValueOnce({ status: 401 }).mockResolvedValueOnce(json(401, { error: 'Unauthorized' }))
    await apiFetch('/test')
    expect(fetch.mock.calls[1][0]).toContain('/api/auth/refresh')
    expect(clearToken).toHaveBeenCalled()
    expect(window.location.href).toBe('/login')
  })

  it('redirects to manager login on 401 for backend path', async () => {
    window.location.pathname = '/manager/dashboard'
    fetch.mockResolvedValueOnce({ status: 401 }).mockResolvedValueOnce(json(401, {}))
    await apiFetch('/test')
    expect(clearToken).toHaveBeenCalled()
    expect(window.location.href).toBe('/manager/login')
  })

  it('returns response on success', async () => {
    const response = { status: 200 }
    fetch.mockResolvedValueOnce(response)
    const res = await apiFetch('/ok')
    expect(res).toBe(response)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(clearToken).not.toHaveBeenCalled()
  })

  it('does not redirect when autoRedirect is false', async () => {
    window.location.pathname = '/profile'
    fetch.mockResolvedValueOnce({ status: 401 })
    await apiFetch('/test', {}, { autoRedirect: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(clearToken).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  // 以前 token 到期就被刪掉、401 也不續期：操作到一半被踢回登入頁
  it('refreshes on 401 and retries the request with the new token', async () => {
    const ok = { status: 200 }
    fetch
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce(json(200, { token: 'new' }))
      .mockResolvedValueOnce(ok)
    const res = await apiFetch('/api/save', { method: 'POST', body: '{}' })
    expect(res).toBe(ok)
    expect(setToken).toHaveBeenCalledWith('new')
    expect(fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer new')
    expect(fetch.mock.calls[2][1].method).toBe('POST')
    expect(clearToken).not.toHaveBeenCalled()
  })

  it('refreshes before sending when the token is about to expire', async () => {
    isTokenExpiring.mockImplementation(() => true)
    const ok = { status: 200 }
    fetch.mockResolvedValueOnce(json(200, { token: 'fresh' })).mockResolvedValueOnce(ok)
    const res = await apiFetch('/api/save', { method: 'POST' })
    expect(res).toBe(ok)
    expect(fetch.mock.calls[0][0]).toContain('/api/auth/refresh')
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh')
  })

  it('still tries the refresh cookie on 401 when no token is stored', async () => {
    getToken.mockImplementation(() => null)
    const ok = { status: 200 }
    fetch
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce(json(200, { token: 'again' }))
      .mockResolvedValueOnce(ok)
    expect(await apiFetch('/api/x')).toBe(ok)
    expect(window.location.href).toBe('')
  })

  it('keeps the user on the page when the refresh fails because of the network', async () => {
    window.location.pathname = '/front/approval'
    const unauthorized = { status: 401 }
    fetch.mockResolvedValueOnce(unauthorized).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const res = await apiFetch('/api/x')
    expect(res).toBe(unauthorized)
    expect(clearToken).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  it('does not refresh or redirect for the logout call itself', async () => {
    window.location.pathname = '/profile'
    fetch.mockResolvedValueOnce({ status: 401 })
    await apiFetch('/api/logout', { method: 'POST' })
    expect(refreshCalls()).toHaveLength(0)
  })

  it('sends concurrent 401s through a single refresh', async () => {
    let resolveRefresh
    fetch.mockImplementation((url) => {
      if (String(url).includes('/api/auth/refresh')) {
        return new Promise((resolve) => {
          resolveRefresh = () => resolve(json(200, { token: 'shared' }))
        })
      }
      return Promise.resolve(refreshCalls().length ? { status: 200 } : { status: 401 })
    })
    const first = apiFetch('/api/a')
    const second = apiFetch('/api/b')
    await vi.waitFor(() => expect(resolveRefresh).toBeTypeOf('function'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    resolveRefresh()
    const results = await Promise.all([first, second])
    expect(results.map((res) => res.status)).toEqual([200, 200])
    expect(refreshCalls()).toHaveLength(1)
  })

  // 另一個分頁剛換過續期 token：伺服器回 REFRESH_ROTATED，改用另一個分頁寫進 localStorage 的新 token
  it('uses the token another tab just stored when the refresh was already rotated', async () => {
    vi.useFakeTimers()
    try {
      let stored = 'old'
      getToken.mockImplementation(() => stored)
      isTokenExpiring.mockImplementation(() => stored === 'old')
      fetch.mockResolvedValueOnce(json(401, { code: 'REFRESH_ROTATED' }))
      const pending = refreshAccessToken('old')
      await vi.advanceTimersByTimeAsync(0)
      stored = 'from-other-tab'
      await vi.advanceTimersByTimeAsync(250)
      expect(await pending).toEqual({ token: 'from-other-tab' })
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
