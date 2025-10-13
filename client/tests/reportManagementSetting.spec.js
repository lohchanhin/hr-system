import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReportManagementSetting from '../src/components/backComponents/ReportManagementSetting.vue'

describe('ReportManagementSetting.vue', () => {
  it('顯示功能下架訊息', () => {
    const wrapper = mount(ReportManagementSetting)
    expect(wrapper.text()).toContain('報表管理功能已下架')
  })
})
