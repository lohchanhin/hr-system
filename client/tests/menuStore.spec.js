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

  it('fetchMenu stores nested items', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        {
          group: '簽核作業',
          children: [{ name: 'Approval' }, { name: 'OrgDepartmentSetting' }]
        }
      ])
    })
    const store = useMenuStore()
    await store.fetchMenu()
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/menu', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' })
    }))
    expect(store.items).toEqual([
      {
        group: '簽核作業',
        children: [{ name: 'Approval' }, { name: 'OrgDepartmentSetting' }]
      }
    ])
    expect(store.flattenedItems).toEqual([
      { name: 'Approval' },
      { name: 'OrgDepartmentSetting' }
    ])
    expect(store.flattenedItems.find(i => i.name === 'Approval')).toBeDefined()
  })

  it('setMenu gracefully handles invalid values', () => {
    const store = useMenuStore()
    store.setMenu(null)
    expect(store.items).toEqual([])
    store.setMenu([
      { group: 'test', children: [{ name: 'Attendance' }] }
    ])
    expect(store.items.length).toBe(1)
    expect(store.flattenedItems[0].name).toBe('Attendance')
  })
})
