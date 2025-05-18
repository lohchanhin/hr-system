import { describe, it, expect } from 'vitest'
import router from '../src/router/index.js'

describe('router', () => {
  it('loads routes without error', () => {
    expect(() => router.getRoutes()).not.toThrow()
  })
})
