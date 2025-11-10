import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, computed, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ModernLayout from '../src/views/ModernLayout.vue'
import Layout from '../src/views/Layout.vue'

const currentRoute = ref({ name: '' })
const menuItems = ref([])
const flattenedItems = computed(() =>
  menuItems.value.flatMap(group => (group?.children ? group.children : []))
)
const fetchMenuMock = vi.fn()
const setMenuMock = vi.fn()
const routerPushMock = vi.fn()
const routerReplaceMock = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock, currentRoute })
}))

vi.mock('../src/stores/menu', () => ({
  useMenuStore: () => ({
    fetchMenu: fetchMenuMock,
    setMenu: setMenuMock,
    items: menuItems,
    flattenedItems
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
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('toggles group expansion when clicking sub menu title', async () => {
    menuItems.value = [
      {
        group: '常用功能',
        children: [
          { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' }
        ]
      }
    ]

    const wrapper = mount(ModernLayout, { global: mountGlobal })
    await nextTick()

    const subMenu = wrapper.find('.el-sub-menu')
    expect(subMenu.classes()).toContain('is-opened')
    await subMenu.find('.el-sub-menu__title').trigger('click')
    await nextTick()
    expect(subMenu.classes()).not.toContain('is-opened')
    await subMenu.find('.el-sub-menu__title').trigger('click')
    await nextTick()
    expect(subMenu.classes()).toContain('is-opened')
  })

  it('ModernLayout aside maintains sidebar width and flexible main content', async () => {
    const wrapper = mount(ModernLayout, { global: mountGlobal })
    expect(wrapper.find('.layout-aside').attributes('style')).toContain('width: 280px')
    wrapper.vm.toggleCollapse()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.layout-aside').attributes('style')).toContain('width: 88px')
    expect(wrapper.find('.layout-main').exists()).toBe(true)
  })

  it('renders mapped menu icons and tooltip when collapsed', async () => {
    menuItems.value = [
      {
        group: '常用功能',
        children: [
          { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
          { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' }
        ]
      }
    ]

    const wrapper = mount(ModernLayout, { global: mountGlobal })
    await wrapper.vm.$nextTick()

    const icons = wrapper.findAll('img.menu-icon')
    expect(icons.length).toBeGreaterThanOrEqual(2)
    const firstChildIcon = icons.find(icon => icon.attributes('data-icon-key') === 'el-icon-postcard')
    expect(firstChildIcon?.attributes('src')).toBe('/出勤管理打卡.png')

    wrapper.vm.toggleCollapse()
    await wrapper.vm.$nextTick()

    const collapsedInner = wrapper.findAll('.menu-item-inner.is-collapsed')
    expect(collapsedInner.length).toBeGreaterThan(0)
    const tooltip = collapsedInner[0].find('.el-tooltip')
    expect(tooltip.exists()).toBe(true)
  })

  it('Layout aside and main flex to 25/75', () => {
    const wrapper = mount(Layout, { global: { plugins: [ElementPlus] } })
    expect(wrapper.find('.layout-aside').attributes('style')).toContain('width: 25%')
    expect(wrapper.find('.layout-main').attributes('style')).toContain('width: 75%')
  })
})
