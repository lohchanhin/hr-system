import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setToken, getToken, clearToken, setRefreshToken, getRefreshToken, clearRefreshToken, _expiryTimeout } from '../src/utils/tokenService'

function createToken(offset = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + offset })).toString('base64')
  return `${header}.${payload}.sig`
}

describe('tokenService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearToken()
  })

  it('stores and retrieves token', () => {
    const token = createToken(10)
    setToken(token)
    expect(getToken()).toBe(token)
  })

  it('clears token after expiry', () => {
    const token = createToken(1)
    setToken(token)
    vi.advanceTimersByTime(1000)
    vi.runOnlyPendingTimers()
    expect(getToken()).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('stores and clears refresh token', () => {
    setRefreshToken('ref')
    expect(getRefreshToken()).toBe('ref')
    clearRefreshToken()
    expect(getRefreshToken()).toBeNull()
  })
})
