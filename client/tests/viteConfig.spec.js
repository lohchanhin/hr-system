import { describe, it, expect, vi } from 'vitest'

vi.mock('vite', () => ({
  defineConfig: fn => fn,
  loadEnv: () => ({})
}))

vi.mock('vite-plugin-vue-devtools', () => ({
  default: () => ({ name: 'mock-devtools' })
}))

vi.mock('@vitejs/plugin-vue', () => ({
  default: () => ({ name: 'mock-vue' })
}))

vi.mock('node:url', async () => {
  const actual = await vi.importActual('node:url')
  return {
    ...actual,
    fileURLToPath: () => '/mock-path'
  }
})

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
