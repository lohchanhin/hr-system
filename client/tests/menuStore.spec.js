import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMenuStore } from '../src/stores/menu'

describe('menu store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn())
    localStorage.setItem('token', 'tok')
    localStorage.setItem('role', 'employee')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('fetchMenu stores items', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([{ name: 'Approval' }, { name: 'OrgDepartmentSetting' }])
    })
    const store = useMenuStore()
    await store.fetchMenu()
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/menu?include=front', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' })
    }))
    expect(store.items).toEqual([{ name: 'Approval' }, { name: 'OrgDepartmentSetting' }])
    expect(store.items.find(i => i.name === 'Approval')).toBeDefined()
  })

  it('伺服器回 { items, frontItems }（?include=front）時分開存；舊版只回陣列時 frontItems 是 null', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [{ name: 'Settings' }], frontItems: [{ name: 'Attendance' }] })
    })
    const store = useMenuStore()
    await store.fetchMenu()
    expect(store.items).toEqual([{ name: 'Settings' }])
    expect(store.frontItems).toEqual([{ name: 'Attendance' }])

    store.setMenu([{ name: 'Approval' }])
    expect(store.items).toEqual([{ name: 'Approval' }])
    expect(store.frontItems).toBeNull()
  })

  it('同時要選單只送一次請求', async () => {
    let resolve
    fetch.mockReturnValueOnce(new Promise(r => { resolve = r }))
    const store = useMenuStore()
    const first = store.fetchMenu()
    const second = store.fetchMenu()
    resolve({ ok: true, json: async () => ({ items: [], frontItems: [] }) })
    await Promise.all([first, second])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
