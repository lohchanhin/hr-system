import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiFetch } from '../src/api'
import { clearToken } from '../src/utils/tokenService'

vi.mock('../src/utils/tokenService', () => ({
  getToken: vi.fn(() => 't'),
  clearToken: vi.fn()
}))

describe('apiFetch', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.location = originalLocation
  })

  it('redirects to login on 401', async () => {
    fetch.mockResolvedValueOnce({ status: 401 })
    await apiFetch('/test')
    expect(clearToken).toHaveBeenCalled()
    expect(window.location.href).toBe('/login')
  })

  it('returns response on success', async () => {
    const response = { status: 200 }
    fetch.mockResolvedValueOnce(response)
    const res = await apiFetch('/ok')
    expect(res).toBe(response)
    expect(clearToken).not.toHaveBeenCalled()
  })
})
