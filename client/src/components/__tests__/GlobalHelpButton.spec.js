import { describe, it, expect } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import GlobalHelpButton from '../GlobalHelpButton.vue'

const stubs = {
  'el-button': { template: '<button type="button" @click="$emit(\'click\')"><slot /></button>' },
  'el-dialog': {
    props: ['modelValue', 'title'],
    emits: ['update:modelValue'],
    template:
      '<div class="dialog" v-if="modelValue"><div class="dialog-title">{{ title }}</div><slot /><slot name="footer" /></div>'
  }
}

describe('GlobalHelpButton', () => {
  it('opens dialog and renders help content when clicked', async () => {
    const wrapper = shallowMount(GlobalHelpButton, {
      props: {
        help: {
          title: '測試說明',
          description: '這是測試用的說明內容',
          tips: ['第一步驟', '第二步驟']
        }
      },
      global: { stubs }
    })

    expect(wrapper.find('.dialog').exists()).toBe(false)
    await wrapper.find('[data-testid="global-help-button"]').trigger('click')

    const dialog = wrapper.find('.dialog')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('測試說明')
    expect(dialog.text()).toContain('這是測試用的說明內容')
    expect(dialog.text()).toContain('第一步驟')
    expect(dialog.text()).toContain('第二步驟')
  })

  it('falls back to default help copy when no props are provided', async () => {
    const wrapper = shallowMount(GlobalHelpButton, {
      global: { stubs }
    })

    await wrapper.find('[data-testid="global-help-button"]').trigger('click')

    expect(wrapper.text()).toContain('操作說明')
    expect(wrapper.find('[data-testid="help-description"]').text()).toContain('使用「說明」按鈕')
  })
})
