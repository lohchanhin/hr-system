import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ModernLayout from '../src/views/ModernLayout.vue'
import Layout from '../src/views/Layout.vue'

const currentRoute = ref({ name: '' })
const menuItems = ref([])
const fetchMenuMock = vi.fn()
const setMenuMock = vi.fn()
const routerPushMock = vi.fn()
const routerReplaceMock = vi.fn()
const originalInnerWidth = global.innerWidth || 1024

function setViewportWidth(width) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width
  })
}

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock, currentRoute })
}))

vi.mock('../src/stores/menu', () => ({
  useMenuStore: () => ({
    fetchMenu: fetchMenuMock,
    setMenu: setMenuMock,
    items: menuItems
  })
}))

const mountGlobal = {
  plugins: [ElementPlus],
  stubs: {
    'el-tooltip': {
      props: {
        content: {
          type: String,
          default: ''
        }
      },
      template: '<span class="el-tooltip" :data-content="content"><slot /></span>'
    },
    'router-view': {
      template: '<div class="router-view-stub" />'
    }
  }
}

describe('layout widths', () => {
  beforeEach(() => {
    menuItems.value = []
    currentRoute.value = { name: '' }
    fetchMenuMock.mockReset()
    setMenuMock.mockReset()
    routerPushMock.mockReset()
    routerReplaceMock.mockReset()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })))
    setViewportWidth(1440)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    setViewportWidth(originalInnerWidth)
  })

  it('ModernLayout aside maintains sidebar width and flexible main content', async () => {
    const wrapper = mount(ModernLayout, { global: mountGlobal })
    const aside = wrapper.find('.layout-aside')
    const main = wrapper.find('.layout-main')

    expect(aside.attributes('style')).toContain('width: 280px')
    expect(aside.classes()).toContain('is-open')
    expect(main.classes()).toContain('with-sidebar')

    wrapper.vm.toggleCollapse()
    await wrapper.vm.$nextTick()

    expect(aside.attributes('style')).toContain('width: 88px')
    expect(aside.classes()).toContain('is-hidden')
    expect(aside.classes()).not.toContain('is-open')
    expect(main.classes()).not.toContain('with-sidebar')
    expect(main.exists()).toBe(true)
  })

  it('renders mapped menu icons and tooltip when collapsed', async () => {
    menuItems.value = [
      { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' }
    ]

    const wrapper = mount(ModernLayout, { global: mountGlobal })
    await wrapper.vm.$nextTick()

    const icons = wrapper.findAll('img.menu-icon')
    expect(icons).toHaveLength(2)
    expect(icons[0].attributes('src')).toBe('/出勤管理打卡.png')
    expect(icons[0].attributes('data-icon-key')).toBe('el-icon-postcard')

    wrapper.vm.toggleCollapse()
    await wrapper.vm.$nextTick()

    const collapsedInner = wrapper.find('.menu-item-inner.is-collapsed')
    expect(collapsedInner.exists()).toBe(true)
    expect(collapsedInner.find('.menu-text').exists()).toBe(false)

    const tooltip = collapsedInner.find('.el-tooltip')
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.attributes('data-content')).toBe('出勤打卡')
  })

  it('opens and closes the mobile drawer via toggle button', async () => {
    setViewportWidth(640)
    const wrapper = mount(ModernLayout, { global: mountGlobal })
    await wrapper.vm.$nextTick()

    const aside = wrapper.find('.layout-aside')
    expect(aside.classes()).not.toContain('collapsed')
    expect(aside.classes()).not.toContain('is-open')

    await wrapper.find('.collapse-btn').trigger('click')
    await wrapper.vm.$nextTick()

    expect(aside.classes()).toContain('is-open')
    expect(wrapper.find('.hr-mobile-overlay').classes()).toContain('is-open')

    await wrapper.find('.collapse-btn').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.hr-mobile-overlay').classes()).not.toContain('is-open')
    expect(wrapper.find('.layout-aside').classes()).not.toContain('is-open')
  })

  it('Layout toggles sidebar collapse state with matching menu', async () => {
    const wrapper = mount(Layout, { global: mountGlobal })
    const aside = wrapper.find('.layout-aside')
    const menu = wrapper.find('.layout-menu')
    const menuComponent = wrapper.findComponent({ name: 'ElMenu' })
    expect(aside.classes()).not.toContain('collapsed')
    expect(aside.attributes('style')).toContain('width: 25%')
    expect(menu.classes()).not.toContain('collapsed')
    expect(menuComponent.props('collapse')).toBe(false)

    await wrapper.find('.collapse-button').trigger('click')
    await wrapper.vm.$nextTick()

    expect(aside.classes()).toContain('collapsed')
    expect(aside.attributes('style')).toContain('width: 80px')
    expect(menu.classes()).toContain('collapsed')
    expect(menuComponent.props('collapse')).toBe(true)
  })
})
