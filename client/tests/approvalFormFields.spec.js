import { describe, it, expect, beforeAll } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import ElementPlus from 'element-plus'
import ApprovalFormFields from '../src/components/ApprovalFormFields.vue'
import { buildInitialFormData } from '../src/utils/approvalForm'

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

// 用外層元件模擬 v-model，驗證欄位元件真的把輸入送回表單資料
function mountFields(fields, extraProps = {}) {
  const Host = defineComponent({
    setup() {
      const formData = ref(buildInitialFormData(fields))
      const files = ref({})
      return { formData, files }
    },
    render() {
      return h(ApprovalFormFields, {
        fields,
        modelValue: this.formData,
        'onUpdate:modelValue': (v) => { this.formData = v },
        files: this.files,
        'onUpdate:files': (v) => { this.files = v },
        ...extraProps,
      })
    },
  })
  return mount(Host, { global: { plugins: [ElementPlus] } })
}

describe('ApprovalFormFields', () => {
  it('數字欄位一開始是空白，不預先填 0', () => {
    const wrapper = mountFields([{ _id: 'n', label: '金額', type_1: 'number', required: true }])
    const input = wrapper.find('input')
    expect(input.exists()).toBe(true)
    expect(input.element.value).toBe('')
    expect(wrapper.vm.formData.n).toBeNull()
  })

  it('沒有選項的 checkbox 顯示一個可勾選的單一勾選框，勾選後值為布林', async () => {
    const wrapper = mountFields([{ _id: 'c', label: '是否跨日', type_1: 'checkbox', required: true }])
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(1)
    expect(wrapper.vm.formData.c).toBe(false)
    await boxes[0].setValue(true)
    expect(wrapper.vm.formData.c).toBe(true)
    await boxes[0].setValue(false)
    expect(wrapper.vm.formData.c).toBe(false)
  })

  it('有選項的 checkbox 是複選群組，選項接受字串、{label,value}、{name,code}', async () => {
    const wrapper = mountFields([
      { _id: 'g', label: '類別', type_1: 'checkbox', options: ['甲', { label: '乙', value: 'B' }, { name: '丙', code: 'C' }] },
    ])
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(3)
    expect(wrapper.text()).toContain('甲')
    expect(wrapper.text()).toContain('乙')
    expect(wrapper.text()).toContain('丙')
    await boxes[1].setValue(true)
    await boxes[2].setValue(true)
    // 值：{label,value} 用 value；{name,code} 與伺服器字典一致用名稱
    expect(wrapper.vm.formData.g).toEqual(['B', '丙'])
  })

  it('停用的欄位不顯示', () => {
    const wrapper = mountFields([
      { _id: 'a', label: '啟用欄位', type_1: 'text' },
      { _id: 'b', label: '停用欄位', type_1: 'text', is_active: false },
    ])
    expect(wrapper.text()).toContain('啟用欄位')
    expect(wrapper.text()).not.toContain('停用欄位')
  })

  it('必填欄位顯示必填標記，文字輸入會寫回表單資料', async () => {
    const wrapper = mountFields([{ _id: 't', label: '事由', type_1: 'text', required: true }])
    expect(wrapper.find('.is-required').exists()).toBe(true)
    await wrapper.find('input').setValue('家中有事')
    expect(wrapper.vm.formData.t).toBe('家中有事')
  })

  it('重新送出時顯示原本已上傳的附件名稱', () => {
    const wrapper = mountFields(
      [{ _id: 'f', label: '證明', type_1: 'file' }],
      { keptAttachments: { f: [{ name: 'proof.pdf', url: '/upload/approvals/x.pdf' }] } },
    )
    expect(wrapper.text()).toContain('proof.pdf')
    expect(wrapper.text()).toContain('未選擇新檔案時會保留')
  })

  it('選擇檔案後，檔案清單送回外層，並可再選第二個檔案', async () => {
    const wrapper = mountFields([{ _id: 'f', label: '證明', type_1: 'file' }])
    const input = wrapper.find('input[type="file"]')
    expect(input.exists()).toBe(true)
    const pick = async (name) => {
      const file = new File(['%PDF-1.7'], name, { type: 'application/pdf' })
      Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
      await input.trigger('change')
      await flushPromises()
    }
    await pick('a.pdf')
    expect(wrapper.vm.files.f).toHaveLength(1)
    expect(wrapper.vm.files.f[0].name).toBe('a.pdf')
    expect(wrapper.vm.files.f[0].raw).toBeInstanceOf(File)
    await pick('b.pdf')
    expect(wrapper.vm.files.f.map(item => item.name)).toEqual(['a.pdf', 'b.pdf'])
  })

  it('下拉、員工、部門、機構欄位用各自的選項', () => {
    const wrapper = mountFields(
      [
        { _id: 's', label: '假別', type_1: 'select', options: [{ label: '病假', value: 'sick' }] },
        { _id: 'u', label: '代理人', type_1: 'user' },
        { _id: 'd', label: '部門', type_1: 'department' },
        { _id: 'o', label: '機構', type_1: 'org' },
      ],
      {
        userOptions: [{ value: 'u1', label: '王小明' }],
        deptOptions: [{ value: 'd1', label: '護理部' }],
        orgOptions: [{ value: 'o1', label: '總院' }],
      },
    )
    expect(wrapper.findAll('.el-select')).toHaveLength(4)
  })
})
