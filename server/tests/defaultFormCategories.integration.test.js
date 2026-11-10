// 預設表單的分類與請假表單的「假別」欄位（新安裝）、以及既有資料的分類對齊（services/formCategoryAlignment.js）。
// 以前預設分類是「人事」，表單分類清單卻只有 人事類／總務類／請假類／其他；「假別」是自由輸入的文字。
// 需要 APPROVAL_ENGINE_TEST_MONGODB_URI（見 helpers/realAppKit.js）。
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

jest.setTimeout(60000)

const kit = createRealAppKit('default_form_categories')

kit.describe('預設表單分類與假別欄位', () => {
  let align
  let settingsStore

  beforeAll(async () => {
    await kit.start()
    ;({ alignLegacyDefaultFormCategories: align } = await import('../src/services/formCategoryAlignment.js'))
    settingsStore = await import('../src/services/otherControlSettingsStore.js')
    await kit.addPerson('admin', { role: 'admin' })
  })
  afterAll(kit.stop)

  it('a new install gets categories from the category list and a 假別 select linked to C12', async () => {
    const res = await kit.post('admin', '/api/approvals/restore-defaults')
    expect(res.status).toBe(200)
    const forms = await kit.models.FormTemplate.find().lean()
    const listed = new Set((await settingsStore.getSettings()).formCategories.map(category => category.code))
    expect(forms.length).toBeGreaterThan(0)
    expect(forms.filter(form => !listed.has(form.category)).map(form => `${form.name}:${form.category}`)).toEqual([])
    expect(forms.find(form => form.default_key === 'leave').category).toBe('請假類')
    const leave = forms.find(form => form.default_key === 'leave')
    const typeField = await kit.models.FormField.findOne({ form: leave._id, label: '假別' }).lean()
    expect(typeField).toMatchObject({ type_1: 'select', field_key: 'C12' })
    // 填寫畫面拿到的選項是字典 C12 目前的項目
    const fields = await kit.get('admin', `/api/approvals/forms/${leave._id}/fields`)
    const options = fields.body.find(field => field.label === '假別').options
    expect(options.map(option => option?.label ?? option?.name ?? option)).toEqual(['特休假', '病假', '事假'])
  })

  it('moves only the default forms still on the old 人事 category; idempotent; leaves admin choices alone', async () => {
    const leave = await kit.models.FormTemplate.findOne({ default_key: 'leave' })
    const overtime = await kit.models.FormTemplate.findOne({ default_key: 'overtime' })
    const custom = await kit.models.FormTemplate.create({ name: '自建表單', category: '人事', is_active: true })
    await kit.models.FormTemplate.updateMany({ _id: { $in: [leave._id, overtime._id] } }, { $set: { category: '人事' } })
    await kit.models.FormTemplate.updateOne({ default_key: 'bonus' }, { $set: { category: '總務類' } })

    expect(await align()).toEqual({ updated: 2 })
    expect((await kit.models.FormTemplate.findById(leave._id).lean()).category).toBe('請假類')
    expect((await kit.models.FormTemplate.findById(overtime._id).lean()).category).toBe('人事類')
    // 不是系統預設表單、或管理員已經改過分類的不動
    expect((await kit.models.FormTemplate.findById(custom._id).lean()).category).toBe('人事')
    expect((await kit.models.FormTemplate.findOne({ default_key: 'bonus' }).lean()).category).toBe('總務類')
    expect(await align()).toEqual({ updated: 0 })

    // 管理員自己建了「人事」分類：預設表單選了它就是管理員的選擇，完全不動
    await settingsStore.updateSettings((current) => {
      current.formCategories = [...current.formCategories, { id: 'cat-hr', name: '人事', code: '人事', description: '', builtin: false }]
    })
    await kit.models.FormTemplate.updateOne({ _id: overtime._id }, { $set: { category: '人事' } })
    expect(await align()).toEqual({ updated: 0, skipped: 'admin-category' })
    expect((await kit.models.FormTemplate.findById(overtime._id).lean()).category).toBe('人事')
  })
})
