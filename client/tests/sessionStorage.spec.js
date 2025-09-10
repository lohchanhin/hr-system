import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'

describe('sessionStorage 多視窗隔離', () => {
  it('不同視窗角色不互相覆蓋', () => {
    const win1 = new JSDOM('', { url: 'http://localhost' }).window
    const win2 = new JSDOM('', { url: 'http://localhost' }).window
    win1.sessionStorage.setItem('role', 'admin')
    win2.sessionStorage.setItem('role', 'employee')
    expect(win1.sessionStorage.getItem('role')).toBe('admin')
    expect(win2.sessionStorage.getItem('role')).toBe('employee')
  })
})
