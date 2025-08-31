import { describe, it, expect, vi } from 'vitest'

vi.mock('vite', () => ({
  defineConfig: fn => fn,
  loadEnv: () => ({})
}))

import configFactory from '../vite.config'

describe('vite.config', () => {
  it('defaults to localhost proxy in development', () => {
    const config = configFactory({ mode: 'development' })
    expect(config.server.proxy['/api'].target).toBe('http://localhost:3000')
  })

  it('omits server proxy in production without env', () => {
    const config = configFactory({ mode: 'production' })
    expect(config.server).toBeUndefined()
  })
})
