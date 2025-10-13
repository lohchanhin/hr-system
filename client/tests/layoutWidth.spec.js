import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ModernLayout from '../src/views/ModernLayout.vue'
import Layout from '../src/views/Layout.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), currentRoute: ref({ name: '' }) })
}))

vi.mock('../src/stores/menu', () => ({
  useMenuStore: () => ({
    fetchMenu: vi.fn(),
    items: ref([])
  })
}))

describe('layout widths', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ModernLayout aside maintains sidebar width and flexible main content', async () => {
    const wrapper = mount(ModernLayout, { global: { plugins: [ElementPlus] } })
    expect(wrapper.find('.layout-aside').attributes('style')).toContain('width: 280px')
    wrapper.vm.toggleCollapse()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.layout-aside').attributes('style')).toContain('width: 64px')
    expect(wrapper.find('.layout-main').exists()).toBe(true)
  })

  it('Layout aside and main flex to 25/75', () => {
    const wrapper = mount(Layout, { global: { plugins: [ElementPlus] } })
    expect(wrapper.find('.layout-aside').attributes('style')).toContain('width: 25%')
    expect(wrapper.find('.layout-main').attributes('style')).toContain('width: 75%')
  })
})
