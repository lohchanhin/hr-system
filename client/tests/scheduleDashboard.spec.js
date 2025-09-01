import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ScheduleDashboard from '../src/views/front/ScheduleDashboard.vue'

describe('ScheduleDashboard.vue', () => {
  it('renders metrics', () => {
    const wrapper = mount(ScheduleDashboard, {
      props: { summary: { direct: 3, unscheduled: 1, onLeave: 2 } },
      global: {
        stubs: { 'el-card': { template: '<div><slot></slot></div>' } }
      }
    })
    expect(wrapper.text()).toContain('直屬員工數')
    expect(wrapper.text()).toContain('3')
    expect(wrapper.text()).toContain('未排班員工')
    expect(wrapper.text()).toContain('1')
    expect(wrapper.text()).toContain('請假中員工')
    expect(wrapper.text()).toContain('2')
  })
})
