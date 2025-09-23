import { describe, it, expect, vi, afterEach } from 'vitest'

describe('API_BASE_URL', () => {
  const originalEnv = { ...import.meta.env }
  const originalLocation = window.location
  const originalAppConfig = window.__APP_CONFIG__

  afterEach(() => {
    if (originalEnv.VITE_API_BASE_URL === undefined) {
      delete import.meta.env.VITE_API_BASE_URL
    } else {
      import.meta.env.VITE_API_BASE_URL = originalEnv.VITE_API_BASE_URL
    }

    if (originalAppConfig === undefined) {
      delete window.__APP_CONFIG__
    } else {
      window.__APP_CONFIG__ = originalAppConfig
    }

    window.location = originalLocation
    vi.resetModules()
  })

  it('prefers runtime config when available', async () => {
    vi.resetModules()
    window.__APP_CONFIG__ = { apiBaseUrl: 'https://runtime.example.com' }
    import.meta.env.VITE_API_BASE_URL = 'https://api.example.com'
    const { API_BASE_URL } = await import('../src/api')
    expect(API_BASE_URL).toBe('https://runtime.example.com')
  })

  it('falls back to env variable when runtime config missing', async () => {
    vi.resetModules()
    delete window.__APP_CONFIG__
    import.meta.env.VITE_API_BASE_URL = 'https://api.example.com'
    const { API_BASE_URL } = await import('../src/api')
    expect(API_BASE_URL).toBe('https://api.example.com')
  })

  it('falls back to window.location.origin when runtime config and env missing', async () => {
    vi.resetModules()
    delete window.__APP_CONFIG__
    delete import.meta.env.VITE_API_BASE_URL
    Object.defineProperty(window, 'location', { value: { origin: 'https://app.example.com' }, writable: true })
    const { API_BASE_URL } = await import('../src/api')
    expect(API_BASE_URL).toBe('https://app.example.com')
  })
})
