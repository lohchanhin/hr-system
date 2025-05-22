import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Schedule from '../src/views/front/Schedule.vue'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
}))
vi.mock('../src/utils/tokenService', () => ({ getToken: () => 'tok' }))

describe('Schedule.vue', () => {
  it('fetches schedule on mount', () => {
    const { apiFetch } = require('../src/api')
    mount(Schedule)
    expect(apiFetch).toHaveBeenCalled()
  })
})
