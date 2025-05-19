import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMenuStore } from '../src/stores/menu'

describe('menu store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn())
    localStorage.setItem('token', 'tok')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('fetchMenu stores items', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([{ name: 'a' }])
    })
    const store = useMenuStore()
    await store.fetchMenu()
    expect(fetch).toHaveBeenCalledWith('/api/menu', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' })
    }))
    expect(store.items).toEqual([{ name: 'a' }])
  })
})
