import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setToken, getToken, clearToken, isTokenExpiring, getTokenExpiresAt } from '../src/utils/tokenService'

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
    expect(getTokenExpiresAt()).toBeGreaterThan(Date.now())
  })

  // 到期不刪 token：由 api.js 用續期 cookie 換新的（以前到期就清掉，15 分鐘就被登出）
  it('keeps an expired token so api.js can refresh it', () => {
    const token = createToken(1)
    setToken(token)
    expect(isTokenExpiring(0)).toBe(false)
    vi.advanceTimersByTime(2000)
    vi.runOnlyPendingTimers()
    expect(getToken()).toBe(token)
    expect(isTokenExpiring(0)).toBe(true)
  })

  it('reports a token that expires within the margin', () => {
    setToken(createToken(30))
    expect(isTokenExpiring(0)).toBe(false)
    expect(isTokenExpiring(60 * 1000)).toBe(true)
  })

  it('clearToken removes the token and its expiry', () => {
    setToken(createToken(30))
    clearToken()
    expect(getToken()).toBeNull()
    expect(localStorage.getItem('token_expires')).toBeNull()
    expect(isTokenExpiring(0)).toBe(false)
  })
})
