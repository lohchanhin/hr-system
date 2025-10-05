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

  it('ModernLayout aside and main flex to 25/75', () => {
    const wrapper = mount(ModernLayout, { global: { plugins: [ElementPlus] } })
    const asideStyle = getComputedStyle(wrapper.find('.layout-aside').element)
    const mainStyle = getComputedStyle(wrapper.find('.layout-main').element)
    expect(asideStyle.flexBasis || asideStyle.width).toBe('25%')
    expect(mainStyle.flexBasis || mainStyle.width).toBe('75%')
  })

  it('Layout aside and main flex to 25/75', () => {
    const wrapper = mount(Layout, { global: { plugins: [ElementPlus] } })
    const asideStyle = getComputedStyle(wrapper.find('.layout-aside').element)
    const mainStyle = getComputedStyle(wrapper.find('.layout-main').element)
    expect(asideStyle.flexBasis || asideStyle.width).toBe('25%')
    expect(mainStyle.flexBasis || mainStyle.width).toBe('75%')
  })
})
