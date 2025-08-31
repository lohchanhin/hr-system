import { describe, it, expect, vi, afterEach } from 'vitest'

describe('API_BASE_URL', () => {
  const originalEnv = { ...import.meta.env }
  const originalLocation = window.location

  afterEach(() => {
    import.meta.env.VITE_API_BASE_URL = originalEnv.VITE_API_BASE_URL
    window.location = originalLocation
    vi.resetModules()
  })

  it('uses env variable when provided', async () => {
    vi.resetModules()
    import.meta.env.VITE_API_BASE_URL = 'https://api.example.com'
    const { API_BASE_URL } = await import('../src/api')
    expect(API_BASE_URL).toBe('https://api.example.com')
  })

  it('falls back to window.location.origin', async () => {
    vi.resetModules()
    delete import.meta.env.VITE_API_BASE_URL
    Object.defineProperty(window, 'location', { value: { origin: 'https://app.example.com' }, writable: true })
    const { API_BASE_URL } = await import('../src/api')
    expect(API_BASE_URL).toBe('https://app.example.com')
  })
})
