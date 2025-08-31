import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mount } from '@vue/test-utils'
import FrontLayout from '../src/views/front/FrontLayout.vue'
import { ref } from 'vue'

const push = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ name: 'attendance' })
}))

vi.mock('../src/stores/menu', () => ({
  useMenuStore: () => ({ items: ref([]), fetchMenu: vi.fn() })
}))

describe('FrontLayout manager button', () => {
  beforeEach(() => {
    localStorage.clear()
    push.mockClear()
  })

  afterAll(() => {
    vi.resetModules()
  })

  function mountLayout() {
    return mount(FrontLayout, {
      global: { stubs: ['el-menu', 'el-menu-item', 'el-button', 'el-avatar', 'el-icon', 'router-view'] }
    })
  }

  it('管理員不顯示按鈕並可登出', async () => {
    localStorage.setItem('role', 'admin')
    localStorage.setItem('username', 'boss')
    const wrapper = mountLayout()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="manager-btn"]').exists()).toBe(false)
    await wrapper.find('.logout-btn').trigger('click')
    expect(push).toHaveBeenCalledWith('/')
    expect(localStorage.getItem('role')).toBeNull()
    expect(localStorage.getItem('username')).toBeNull()
  })

  it('主管不顯示按鈕', async () => {
    localStorage.setItem('role', 'supervisor')
    const wrapper = mountLayout()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="manager-btn"]').exists()).toBe(false)
  })

  it('員工不顯示按鈕', () => {
    localStorage.setItem('role', 'employee')
    const wrapper = mountLayout()
    expect(wrapper.find('[data-test="manager-btn"]').exists()).toBe(false)
  })
})
