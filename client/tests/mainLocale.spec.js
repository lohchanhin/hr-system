import { describe, it, expect, vi } from 'vitest'

const { use, mount, elementPlusPlugin } = vi.hoisted(() => ({
  use: vi.fn(),
  mount: vi.fn(),
  elementPlusPlugin: { install: vi.fn(), name: 'ElementPlusStub' },
}))

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, createApp: vi.fn(() => ({ use, mount })) }
})
vi.mock('pinia', () => ({ createPinia: () => ({ name: 'pinia' }) }))
vi.mock('../src/App.vue', () => ({ default: {} }))
vi.mock('../src/router', () => ({ default: { name: 'router' } }))
vi.mock('element-plus', () => ({ default: elementPlusPlugin }))

describe('main.js Element Plus 語系', () => {
  it('以繁體中文（zh-tw）語系安裝 Element Plus，日期選擇器與空資料等文字不再是英文', async () => {
    await import('../src/main.js')

    const call = use.mock.calls.find(([plugin]) => plugin === elementPlusPlugin)
    expect(call).toBeTruthy()
    const options = call[1]
    expect(options?.locale?.name).toBe('zh-tw')
    expect(options.locale.el.table.emptyText).toBe('暫無資料')
    expect(options.locale.el.datepicker.today).toBe('今天')
    expect(mount).toHaveBeenCalledWith('#app')
  })
})
