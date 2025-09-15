import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('../src/components/backComponents/EmployeeManagement.vue', () => ({
  default: {
    name: 'EmployeeManagement',
    template:
      '<el-tab-pane label="員工管理" name="employeeMgmt"><div class="employee-tab">員工管理內容</div></el-tab-pane>'
  }
}))

import HRManagementSystemSetting from '../src/components/backComponents/HRManagementSystemSetting.vue'

const stubs = {
  'el-tabs': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div class="el-tabs"><slot /></div>'
  },
  'el-tab-pane': {
    props: ['label', 'name'],
    template:
      '<div class="el-tab-pane" :data-name="name"><span class="tab-label">{{ label }}</span><slot /></div>'
  }
}

describe('HRManagementSystemSetting.vue', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem('role', 'admin')
  })

  it('登入後不顯示系統基本資料分頁', () => {
    const wrapper = mount(HRManagementSystemSetting, {
      global: { stubs }
    })

    expect(wrapper.text()).toContain('員工管理')
    expect(wrapper.text()).not.toContain('系統基本資料')
  })
})
