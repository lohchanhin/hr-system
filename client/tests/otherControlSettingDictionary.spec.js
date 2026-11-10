import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import OtherControlSetting from '../src/components/backComponents/OtherControlSetting.vue'

// 其他控制設定：字典項目只儲存改到的那一個字典、顯示伺服器的錯誤原因、不弄丟選項原本的屬性；
// 表單分類顯示使用中的表單數，使用中的分類不能改識別碼，刪除前說明後果

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'

const json = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
})

let settings
let categories
let forms
let writeResponse

function installApi() {
  apiFetch.mockImplementation((url, options = {}) => {
    const method = options.method || 'GET'
    if (method !== 'GET') return Promise.resolve(writeResponse(url, options))
    if (url === '/api/other-control-settings') return Promise.resolve(json(settings))
    if (url === '/api/other-control-settings/form-categories') return Promise.resolve(json(categories))
    if (url === '/api/approvals/forms') return Promise.resolve(json(forms))
    return Promise.resolve(json({}, 404))
  })
}

const writes = () => apiFetch.mock.calls
  .filter(([, options]) => options?.method && options.method !== 'GET')
  .map(([url, options]) => ({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined }))

beforeEach(() => {
  settings = {
    customFields: [{ label: '制服尺寸', fieldKey: 'uniformSize', type: 'select', required: false }],
    itemSettings: {
      C03: ['助理', '專員'],
      C05: [{ label: '英文', levels: ['A1', 'B2'] }, { label: '日文', levels: ['N3'] }],
      C12: ['特休假', '病假'],
    },
  }
  categories = [
    { id: 'cat-hr', name: '人事類', code: '人事', description: '', builtin: true },
    { id: 'cat-extra', name: '行政', code: 'admin', description: '', builtin: false },
    { id: 'cat-free', name: '沒人用', code: 'unused', description: '', builtin: false },
  ]
  forms = [
    { _id: 'f1', name: '請假', category: '人事' },
    { _id: 'f2', name: '用印申請', category: 'admin' },
    { _id: 'f3', name: '採購申請', category: 'admin' },
  ]
  writeResponse = (url, options) => json(options.body ? JSON.parse(options.body) : { success: true })
  apiFetch.mockReset()
  installApi()
  vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
  vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
  vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function mountPage() {
  const wrapper = mount(OtherControlSetting, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}

describe('字典項目', () => {
  it('新增選項只送出這一個字典，其他字典（包含伺服器沒有、畫面上是預設內容的）不會被寫回去', async () => {
    const wrapper = await mountPage()
    // 伺服器沒有 C04：畫面顯示預設內容，但不能因為改了職稱就把它存進資料庫
    expect(wrapper.vm.itemSettings.C04.length).toBeGreaterThan(0)

    wrapper.vm.openOptionDialog('C03')
    wrapper.vm.optionForm.name = ' 經理 '
    await wrapper.vm.saveOption()

    expect(writes()).toEqual([
      { url: '/api/other-control-settings/item-settings', method: 'PUT', body: { C03: ['助理', '專員', '經理'] } },
    ])
    expect(wrapper.vm.itemSettings.C03.map((option) => option.name)).toEqual(['助理', '專員', '經理'])
    expect(wrapper.vm.optionDialogVisible).toBe(false)
    expect(ElMessage.success).toHaveBeenCalledWith('已新增字典選項')
  })

  it('代碼沒填就和名稱相同；有另外填代碼的選項存成 { name, code }', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openOptionDialog('C12')
    Object.assign(wrapper.vm.optionForm, { name: '公假', code: 'PUBLIC' })
    await wrapper.vm.saveOption()

    expect(writes()[0].body).toEqual({ C12: ['特休假', '病假', { name: '公假', code: 'PUBLIC' }] })
  })

  it('同一個字典裡名稱或代碼重複時不送出，並說明是哪一個選項', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openOptionDialog('C03')
    wrapper.vm.optionForm.name = '助理'
    await wrapper.vm.saveOption()

    expect(writes()).toEqual([])
    expect(ElMessage.warning).toHaveBeenCalledWith('「職稱」已經有名稱或代碼相同的選項「助理」')
    expect(wrapper.vm.optionDialogVisible).toBe(true)

    // 編輯自己、名稱沒改：不算重複
    wrapper.vm.openOptionDialog('C03', 0)
    await wrapper.vm.saveOption()
    expect(writes()).toHaveLength(1)
  })

  it('編輯選項時保留它原本的其他屬性（語言能力的等級清單），只換名稱與代碼', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openOptionDialog('C05', 0)
    expect(wrapper.vm.optionForm).toMatchObject({ dictionaryKey: 'C05', name: '英文', code: '英文' })
    Object.assign(wrapper.vm.optionForm, { name: '英語', code: 'EN' })
    await wrapper.vm.saveOption()

    expect(writes()[0].body).toEqual({
      C05: [
        { label: '英語', levels: ['A1', 'B2'], name: '英語', code: 'EN' },
        { label: '日文', levels: ['N3'], name: '日文', code: '日文' },
      ],
    })
    expect(ElMessage.success).toHaveBeenCalledWith('已更新字典選項')
  })

  it('儲存失敗時顯示伺服器回的原因（{ error }），畫面回到原本的內容，對話框保持開啟', async () => {
    writeResponse = () => json({ error: '無法儲存其他控制設定，請稍後再試' }, 500)
    const wrapper = await mountPage()
    wrapper.vm.openOptionDialog('C03')
    wrapper.vm.optionForm.name = '經理'
    await wrapper.vm.saveOption()

    expect(ElMessage.error).toHaveBeenCalledWith('無法儲存其他控制設定，請稍後再試')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(wrapper.vm.itemSettings.C03.map((option) => option.name)).toEqual(['助理', '專員'])
    expect(wrapper.vm.optionDialogVisible).toBe(true)
  })

  it('刪除前說明是哪個字典的哪個選項、已經選用的資料不會被改；取消就不送出', async () => {
    const wrapper = await mountPage()
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await wrapper.vm.removeOption('C12', 1)
    expect(writes()).toEqual([])
    expect(ElMessageBox.confirm.mock.calls[0][0]).toBe(
      '確定要刪除「假別類別」的選項「病假」嗎？刪除後選單不再出現這個選項；已經選用它的員工資料或申請單不會被修改，仍保留原本的文字。'
    )

    await wrapper.vm.removeOption('C12', 1)
    expect(writes()).toEqual([
      { url: '/api/other-control-settings/item-settings', method: 'PUT', body: { C12: ['特休假'] } },
    ])
    expect(ElMessage.success).toHaveBeenCalledWith('已刪除字典選項')
  })

  it('可以調整選項順序，只儲存這個字典；儲存中不接受下一次', async () => {
    const wrapper = await mountPage()
    const first = wrapper.vm.moveOption('C03', 1, -1)
    const second = wrapper.vm.moveOption('C03', 1, -1)
    await Promise.all([first, second])

    expect(writes()).toEqual([
      { url: '/api/other-control-settings/item-settings', method: 'PUT', body: { C03: ['專員', '助理'] } },
    ])
    expect(wrapper.vm.itemSettings.C03.map((option) => option.name)).toEqual(['專員', '助理'])
    // 已經在最上面：不動也不送
    await wrapper.vm.moveOption('C03', 0, -1)
    expect(writes()).toHaveLength(1)
  })

  it('連按兩下儲存只送一次', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openOptionDialog('C03')
    wrapper.vm.optionForm.name = '經理'
    const first = wrapper.vm.saveOption()
    const second = wrapper.vm.saveOption()
    await Promise.all([first, second])
    expect(writes()).toHaveLength(1)
  })
})

describe('表單分類', () => {
  it('顯示每個分類有幾張表單在用；內建分類沒有刪除按鈕', async () => {
    const wrapper = await mountPage()
    wrapper.vm.activeTab = 'form-category'
    await flushPromises()

    expect(wrapper.findAll('[data-test="category-usage"]').map((cell) => cell.text())).toEqual(['1 張', '2 張', '沒有表單使用'])
    expect(wrapper.text()).toContain('內建，不能刪除')
  })

  it('有表單在用的分類不能改識別碼（表單用識別碼對應分類），沒有表單在用的可以改', async () => {
    const wrapper = await mountPage()
    wrapper.vm.activeTab = 'form-category'
    await flushPromises()

    wrapper.vm.openCategoryDialog('edit', categories[1])
    await flushPromises()
    expect(wrapper.vm.categoryCodeLocked).toBe(true)
    expect(wrapper.find('[data-test="category-code-locked"]').text()).toBe('有 2 張表單使用這個分類；表單是用識別碼對應分類，所以識別碼不能修改。')

    wrapper.vm.openCategoryDialog('edit', categories[2])
    await flushPromises()
    expect(wrapper.vm.categoryCodeLocked).toBe(false)
    expect(wrapper.find('[data-test="category-code-locked"]').exists()).toBe(false)
  })

  it('刪除前說明後果（有幾張表單在用）；伺服器只回英文欄位名稱的訊息換成畫面上的說法', async () => {
    const wrapper = await mountPage()
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await wrapper.vm.removeCategory(wrapper.vm.formCategories[1])
    expect(writes()).toEqual([])
    expect(ElMessageBox.confirm.mock.calls[0][0]).toBe(
      '確定要刪除分類「行政」嗎？目前有 2 張表單使用這個分類；刪除後這些表單不會被刪除，但分類會顯示成識別碼「admin」，需要到「簽核流程設定」改選其他分類。'
    )

    await wrapper.vm.removeCategory(wrapper.vm.formCategories[2])
    expect(ElMessageBox.confirm.mock.calls[1][0]).toBe('確定要刪除分類「沒人用」嗎？刪除後新增或編輯表單時就不能再選這個分類。')
    expect(writes()).toEqual([{ url: '/api/other-control-settings/form-categories/cat-free', method: 'DELETE', body: undefined }])

    writeResponse = () => json({ error: 'code 已存在' }, 409)
    wrapper.vm.openCategoryDialog()
    Object.assign(wrapper.vm.categoryForm, { name: '行政二', code: 'admin' })
    await wrapper.vm.saveCategory()
    expect(ElMessage.error).toHaveBeenLastCalledWith('識別碼已經被其他分類使用，請換一個')
    expect(wrapper.vm.categoryDialogVisible).toBe(true)
  })
})

describe('自訂欄位', () => {
  it('識別代碼重複時不送出；儲存失敗時顯示伺服器回的原因（{ error }）', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openFieldDialog()
    Object.assign(wrapper.vm.fieldForm, { label: '另一個尺寸', fieldKey: 'uniformSize', type: 'text' })
    await wrapper.vm.saveField()
    expect(writes()).toEqual([])
    expect(ElMessage.warning).toHaveBeenCalledWith('識別代碼「uniformSize」已經被「制服尺寸」使用，請換一個')

    writeResponse = () => json({ error: 'customFields 必須為陣列' }, 400)
    wrapper.vm.fieldForm.fieldKey = 'shoeSize'
    await wrapper.vm.saveField()
    expect(ElMessage.error).toHaveBeenCalledWith('customFields 必須為陣列')
    expect(wrapper.vm.customFields.map((field) => field.fieldKey)).toEqual(['uniformSize'])
  })
})
