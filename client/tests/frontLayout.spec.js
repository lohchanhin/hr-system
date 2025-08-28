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

  it.each(['supervisor', 'admin'])('顯示按鈕並導向 %s', async role => {
    localStorage.setItem('role', role)
    const wrapper = mountLayout()
    await wrapper.vm.$nextTick()
    const btn = wrapper.get('[data-test="manager-btn"]')
    await btn.trigger('click')
    expect(push).toHaveBeenCalledWith('/manager')
  })

  it('無權限不顯示按鈕', () => {
    localStorage.setItem('role', 'employee')
    const wrapper = mountLayout()
    // onMounted will run, but no button expected
    expect(wrapper.find('[data-test="manager-btn"]').exists()).toBe(false)
  })
})
