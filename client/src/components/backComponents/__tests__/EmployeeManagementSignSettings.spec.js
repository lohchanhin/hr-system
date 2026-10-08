import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, inject, onBeforeUnmount, onMounted, provide, reactive } from 'vue'
import Schema from 'async-validator'
import * as apiModule from '../../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  ElMessageBox: {
    confirm: vi.fn(() => Promise.resolve()),
    prompt: vi.fn(() => Promise.resolve()),
    alert: vi.fn(() => Promise.resolve())
  }
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

import EmployeeManagement from '../EmployeeManagement.vue'

const flushPromises = () => new Promise(resolve => setTimeout(resolve))

const elementStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<div><slot /></div>' },
  'el-button': {
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>'
  },
  'el-dialog': {
    template: '<div class="el-dialog-stub"><slot /><slot name="footer" /></div>',
    props: ['modelValue']
  },
  'el-select': { template: '<select><slot /></select>', props: ['modelValue'] },
  'el-option': { template: '<option><slot /></option>' },
  'el-upload': { template: '<div class="el-upload-stub"><slot /><slot name="tip" /></div>' },
  'el-alert': { template: '<div class="el-alert-stub"><slot name="title" /><slot /></div>' },
  'el-switch': { template: '<input type="checkbox" />', props: ['modelValue'] },
  'el-avatar': { template: '<div class="el-avatar-stub"><slot /></div>' },
  'el-tag': { template: '<span><slot /></span>' },
  'el-radio-group': { template: '<div class="el-radio-group-stub"><slot /></div>' },
  'el-radio': { template: '<label class="el-radio-stub"><slot /></label>' },
  'el-date-picker': { template: '<input type="date" />', props: ['modelValue'] },
  'el-input-number': { template: '<input type="number" />', props: ['modelValue'] },
  'el-pagination': { template: '<div class="el-pagination-stub" />' },
  'el-table': { template: '<div class="el-table-stub"><slot :row="{}" :$index="0" /></div>' },
  'el-table-column': { template: '<div class="el-table-column-stub"><slot :row="{}" :$index="0" /></div>' }
}

/**
 * el-form / el-form-item / el-input 的「會真的驗證」替身。
 * Element Plus 的 el-form 在 vitest 底下跑不起來（它載入的 async-validator 是 CommonJS，沒有經過轉譯就
 * 找不到建構子，validate() 會直接 reject undefined），所以這裡用與 Element Plus 相同的流程重做：
 * 登記有 prop 的欄位、取 model 的值、套用 :rules 並以 async-validator 驗證，失敗時 reject
 * { 欄位: [{ message, field }] }。和以前「validate 永遠成功」的替身不同，必填規則與必填標記都是真的。
 */
const getByPath = (target, path) => String(path).split('.').reduce((acc, key) => acc?.[key], target)

// 和 Element Plus 一樣，validate() 失敗後欄位會留著紅字（is-error），直到 clearValidate() 才清掉
const clearValidateCalls = { count: 0 }

const ValidatingForm = defineComponent({
  name: 'ValidatingForm',
  props: { model: { type: Object, default: () => ({}) }, rules: { type: Object, default: () => ({}) } },
  setup(props, { slots, expose }) {
    const fields = new Set()
    const errors = reactive({})
    provide('validatingForm', {
      get rules() { return props.rules },
      errors,
      register: prop => fields.add(prop),
      unregister: prop => fields.delete(prop)
    })
    async function validate() {
      const invalid = {}
      for (const prop of fields) {
        const rules = props.rules?.[prop]
        delete errors[prop]
        if (!rules?.length) continue
        try {
          await new Schema({ [prop]: rules }).validate({ [prop]: getByPath(props.model, prop) }, { firstFields: true })
        } catch (error) {
          invalid[prop] = (error.errors || []).map(item => ({ message: item.message, field: prop }))
          errors[prop] = invalid[prop][0]?.message || ''
        }
      }
      return Object.keys(invalid).length ? Promise.reject(invalid) : true
    }
    function clearValidate() {
      clearValidateCalls.count += 1
      Object.keys(errors).forEach(prop => delete errors[prop])
    }
    expose({ validate, clearValidate })
    return () => h('form', { class: 'el-form' }, slots.default?.())
  }
})

const ValidatingFormItem = defineComponent({
  name: 'ValidatingFormItem',
  props: { prop: { type: String, default: '' }, label: { type: String, default: '' }, required: { type: Boolean, default: false } },
  setup(props, { slots }) {
    const form = inject('validatingForm', null)
    onMounted(() => props.prop && form?.register(props.prop))
    onBeforeUnmount(() => props.prop && form?.unregister(props.prop))
    return () => {
      const ruleRequired = (form?.rules?.[props.prop] ?? []).some(rule => rule.required)
      const error = props.prop ? form?.errors?.[props.prop] : ''
      return h('div', { class: ['el-form-item', { 'is-required': ruleRequired || props.required, 'is-error': Boolean(error) }] }, [
        h('label', { class: 'el-form-item__label' }, props.label),
        h('div', { class: 'el-form-item__content' }, [
          ...(slots.default?.() ?? []),
          error ? h('div', { class: 'el-form-item__error' }, error) : null
        ])
      ])
    }
  }
})

const InputStub = defineComponent({
  name: 'InputStub',
  inheritAttrs: false,
  props: { modelValue: { type: [String, Number], default: '' } },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () => h('input', {
      ...attrs,
      value: props.modelValue,
      onInput: event => emit('update:modelValue', event.target.value)
    })
  }
})

function createApiResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

const EXISTING_EMPLOYEE = {
  _id: 'e1',
  name: '王大明',
  employeeId: 'E001',
  username: 'wang',
  email: 'wang@example.com',
  gender: 'M',
  role: 'employee',
  organization: 'org1',
  department: 'dep1',
  signTags: [],
  status: '正職員工'
}

const SIGN_TAGS_RESPONSE = {
  tags: [
    { name: '人資', count: 2, requiredByWorkflows: 3 },
    { name: '排班負責人', count: 0, requiredByWorkflows: 1 },
    { name: '財務覆核', count: 1, requiredByWorkflows: 0 }
  ]
}

describe('EmployeeManagement - 簽核設定與登入密碼（會真的驗證的表單）', () => {
  let apiFetchMock
  let signTagsResponse
  let wrapper

  const mountComponent = async () => {
    wrapper = mount(EmployeeManagement, {
      global: {
        stubs: {
          transition: false,
          teleport: false,
          ...elementStubs,
          'el-form': ValidatingForm,
          'el-form-item': ValidatingFormItem,
          'el-input': InputStub
        }
      }
    })
    await flushPromises()
    return wrapper
  }

  const apiCalls = (matcher) => apiFetchMock.mock.calls.filter(([path, options]) => matcher(path, options))
  const putCalls = () => apiCalls((path, options) => options?.method === 'PUT')
  const putBody = () => JSON.parse(putCalls()[0][1].body)

  beforeEach(() => {
    signTagsResponse = () => createApiResponse(SIGN_TAGS_RESPONSE)
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (path, options) => {
      const cleanPath = typeof path === 'string' ? path.split('?')[0] : path
      if (cleanPath === '/api/employees/sign-tags') return signTagsResponse()
      if (cleanPath === '/api/employees/e1') {
        if (options?.method === 'PUT') return createApiResponse({ ...EXISTING_EMPLOYEE })
        return createApiResponse({ ...EXISTING_EMPLOYEE })
      }
      if (cleanPath === '/api/employees') {
        if (options?.method === 'POST') return createApiResponse({ _id: 'new1' }, 201)
        return createApiResponse({
          employees: [{ ...EXISTING_EMPLOYEE }],
          pagination: { total: 1, page: 1, pageSize: 20, totalPages: 1 }
        })
      }
      if (cleanPath === '/api/other-control-settings/item-settings') {
        return createApiResponse({ itemSettings: {} })
      }
      return createApiResponse([])
    })
    ;[ElMessage.success, ElMessage.error, ElMessage.warning, ElMessage.info].forEach(fn => fn.mockClear())
    ElMessageBox.alert.mockClear()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    apiFetchMock.mockRestore()
  })

  describe('編輯既有員工不需要輸入登入密碼', () => {
    it('只新增員工標籤、不填密碼就能儲存；PUT 不帶 password，標籤已整理', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()

      wrapper.vm.employeeForm.signTags = [' 人資 ', '排班負責人', '人資', '']
      await wrapper.vm.saveEmployee()
      await flushPromises()

      expect(ElMessageBox.alert).not.toHaveBeenCalled()
      expect(putCalls()).toHaveLength(1)
      expect(putCalls()[0][0]).toBe('/api/employees/e1')
      const body = putBody()
      expect(body.signTags).toEqual(['人資', '排班負責人'])
      expect(Object.prototype.hasOwnProperty.call(body, 'password')).toBe(false)
      expect(ElMessage.success).toHaveBeenCalledWith('儲存成功')
    })

    it.each([
      ['空字串', ''],
      ['只有空白', '   ']
    ])('密碼欄位是%s時不會送出密碼', async (_label, password) => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      wrapper.vm.employeeForm.password = password

      await wrapper.vm.saveEmployee()
      await flushPromises()

      expect(putCalls()).toHaveLength(1)
      expect(Object.prototype.hasOwnProperty.call(putBody(), 'password')).toBe(false)
    })

    it('有輸入新密碼才會送出（重設密碼是管理員明確的動作）', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      wrapper.vm.employeeForm.password = 'new-secret'

      await wrapper.vm.saveEmployee()
      await flushPromises()

      expect(putBody().password).toBe('new-secret')
    })

    it('編輯時登入密碼不是必填（沒有必填標記與驗證規則），新增員工才是', async () => {
      await mountComponent()
      const passwordItem = () => wrapper.findAll('.el-form-item').find(item => item.text().includes('登入密碼'))

      await wrapper.vm.openEmployeeDialog()
      await flushPromises()
      expect(wrapper.vm.isEditingEmployee).toBe(false)
      expect(wrapper.vm.rules.password[0].required).toBe(true)
      expect(passwordItem().classes()).toContain('is-required')

      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      expect(wrapper.vm.isEditingEmployee).toBe(true)
      expect(wrapper.vm.rules.password).toEqual([])
      expect(passwordItem().classes()).not.toContain('is-required')
      expect(passwordItem().find('input').attributes('placeholder')).toBe('不修改請留空')
      expect(passwordItem().text()).toContain('留空表示沿用原本的密碼')

      // 再回到新增模式，必填規則要回來
      await wrapper.vm.openEmployeeDialog()
      await flushPromises()
      expect(wrapper.vm.rules.password[0].required).toBe(true)
    })

    it('新增與編輯之間切換、規則改變時，不會自動對整個表單重新驗證（否則打開新增視窗就滿是紅字）', async () => {
      await mountComponent()
      // Element Plus 預設 validate-on-rule-change 為 true：規則一改就對全部欄位重新驗證
      expect(wrapper.find('form.el-form').attributes('validate-on-rule-change')).toBe('false')
    })

    it('新增員工沒填密碼：提示補齊登入密碼並切到「帳號權限」分頁，不送出任何請求', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog()
      await flushPromises()
      wrapper.vm.employeeDialogTab = 'salary'
      Object.assign(wrapper.vm.employeeForm, {
        username: 'new-user',
        password: '',
        name: '新員工',
        email: 'new@example.com',
        gender: 'F',
        organization: 'org1',
        department: 'dep1'
      })
      apiFetchMock.mockClear()

      await wrapper.vm.saveEmployee()

      expect(ElMessageBox.alert).toHaveBeenCalledTimes(1)
      const message = ElMessageBox.alert.mock.calls[0][0]
      expect(message).toContain('登入密碼（帳號權限）')
      expect(message).toContain('已切換到「帳號權限」分頁')
      expect(wrapper.vm.employeeDialogTab).toBe('account')
      expect(apiCalls((path, options) => ['POST', 'PUT'].includes(options?.method))).toHaveLength(0)
    })

    it('其他分頁的必填欄位沒填時，提示欄位與分頁並切過去', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      wrapper.vm.employeeDialogTab = 'approval'
      wrapper.vm.employeeForm.name = ''
      wrapper.vm.employeeForm.department = ''
      apiFetchMock.mockClear()

      await wrapper.vm.saveEmployee()

      const message = ElMessageBox.alert.mock.calls[0][0]
      expect(message).toContain('員工姓名（個人資訊）')
      expect(message).toContain('所屬部門（任職資訊）')
      expect(message).not.toContain('登入密碼')
      expect(wrapper.vm.employeeDialogTab).toBe('personal')
      expect(putCalls()).toHaveLength(0)
    })

    it('儲存失敗時顯示伺服器回的中文原因，英文或空白原因則用通用訊息', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      apiFetchMock.mockImplementation(async () =>
        createApiResponse({ error: '簽核角色「banana」不正確，請使用 R001～R007' }, 400)
      )
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(ElMessage.error).toHaveBeenLastCalledWith('簽核角色「banana」不正確，請使用 R001～R007')

      apiFetchMock.mockImplementation(async () => createApiResponse({ error: 'E11000 duplicate key' }, 400))
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(ElMessage.error).toHaveBeenLastCalledWith('儲存失敗')
    })
  })

  describe('重新打開員工對話框時清掉殘留的驗證紅字', () => {
    const errorItems = () => wrapper.findAll('.el-form-item.is-error')
    const passwordItem = () => wrapper.findAll('.el-form-item').find(item => item.text().includes('登入密碼'))

    it('新增員工按儲存出現紅字後再開編輯：選填的登入密碼、帳號、姓名都不再是紅字', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog()
      await flushPromises()
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(passwordItem().classes()).toContain('is-error')
      expect(passwordItem().text()).toContain('請輸入登入密碼')
      expect(errorItems().length).toBeGreaterThan(1)

      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      expect(wrapper.vm.isEditingEmployee).toBe(true)
      expect(errorItems()).toHaveLength(0)
      expect(passwordItem().text()).not.toContain('請輸入登入密碼')
      expect(passwordItem().classes()).not.toContain('is-required')
    })

    it('編輯時驗證失敗後再開新增：不是一打開就滿是紅字', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      wrapper.vm.employeeForm.name = ''
      wrapper.vm.employeeForm.department = ''
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(errorItems().length).toBeGreaterThan(0)

      await wrapper.vm.openEmployeeDialog()
      await flushPromises()
      expect(wrapper.vm.isEditingEmployee).toBe(false)
      expect(errorItems()).toHaveLength(0)
    })

    it('每次打開（新增或編輯）都會呼叫 clearValidate，而且是在對話框顯示之後', async () => {
      await mountComponent()
      const before = clearValidateCalls.count
      await wrapper.vm.openEmployeeDialog()
      expect(wrapper.vm.employeeDialogVisible).toBe(true)
      expect(clearValidateCalls.count).toBe(before + 1)

      await wrapper.vm.openEmployeeDialog('e1')
      expect(clearValidateCalls.count).toBe(before + 2)
    })

    it('找不到員工或載入失敗而沒有打開對話框時，不會去清驗證狀態', async () => {
      await mountComponent()
      const before = clearValidateCalls.count
      await wrapper.vm.openEmployeeDialog('not-in-list')
      expect(clearValidateCalls.count).toBe(before)
      expect(wrapper.vm.employeeDialogVisible).toBe(false)
    })
  })

  describe('直屬主管可以清空', () => {
    const SUPERVISOR = { _id: 'sup1', name: '主管甲', employeeId: 'S001' }
    const withSupervisor = async (run) => {
      EXISTING_EMPLOYEE.supervisor = SUPERVISOR
      try {
        await run()
      } finally {
        delete EXISTING_EMPLOYEE.supervisor
      }
    }
    const supervisorItem = () => wrapper.findAll('.el-form-item').find(item => item.text().includes('直屬主管'))

    it('直屬主管欄位可以清除', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      expect(supervisorItem().find('select').attributes('clearable')).toBeDefined()
    })

    it('編輯時把直屬主管清空：PUT 明確送 supervisor: null（不送會沿用原本的主管）', async () => {
      await withSupervisor(async () => {
        await mountComponent()
        await wrapper.vm.openEmployeeDialog('e1')
        await flushPromises()
        expect(wrapper.vm.employeeForm.supervisor).toBe('sup1')

        wrapper.vm.employeeForm.supervisor = ''
        await wrapper.vm.saveEmployee()
        await flushPromises()

        expect(putCalls()).toHaveLength(1)
        expect(putBody()).toHaveProperty('supervisor', null)
      })
    })

    it.each([[null], [undefined]])('清空後的值是 %s 也一樣送 null', async (blank) => {
      await withSupervisor(async () => {
        await mountComponent()
        await wrapper.vm.openEmployeeDialog('e1')
        await flushPromises()
        wrapper.vm.employeeForm.supervisor = blank
        await wrapper.vm.saveEmployee()
        await flushPromises()
        expect(putBody()).toHaveProperty('supervisor', null)
      })
    })

    it('沒動直屬主管就照舊送原本的主管編號', async () => {
      await withSupervisor(async () => {
        await mountComponent()
        await wrapper.vm.openEmployeeDialog('e1')
        await flushPromises()
        await wrapper.vm.saveEmployee()
        await flushPromises()
        expect(putBody().supervisor).toBe('sup1')
      })
    })

    it('新增員工沒選直屬主管就不送 supervisor', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog()
      await flushPromises()
      Object.assign(wrapper.vm.employeeForm, {
        username: 'new-user',
        password: 'secret',
        name: '新員工',
        email: 'new@example.com',
        gender: 'F',
        organization: 'org1',
        department: 'dep1',
        supervisor: ''
      })
      await wrapper.vm.saveEmployee()
      await flushPromises()
      const [post] = apiCalls((path, options) => options?.method === 'POST' && path === '/api/employees')
      expect(post).toBeTruthy()
      expect(JSON.parse(post[1].body)).not.toHaveProperty('supervisor')
    })

    it('同時上傳新照片（multipart）時，清空的直屬主管送空字串', async () => {
      await withSupervisor(async () => {
        await mountComponent()
        await wrapper.vm.openEmployeeDialog('e1')
        await flushPromises()
        wrapper.vm.employeeForm.supervisor = ''
        wrapper.vm.employeeForm.photoList = [{ name: 'p.png', raw: new File(['x'], 'p.png', { type: 'image/png' }) }]
        await wrapper.vm.saveEmployee()
        await flushPromises()

        const body = putCalls()[0][1].body
        expect(body).toBeInstanceOf(FormData)
        expect(body.get('supervisor')).toBe('')
        expect(body.get('photo')).toBeInstanceOf(File)
      })
    })
  })

  describe('員工標籤選單', () => {
    it('開啟員工表單時載入標籤清單，顯示每個標籤的持有人數與流程使用數', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()

      expect(apiCalls(path => path === '/api/employees/sign-tags')).toHaveLength(1)
      expect(wrapper.vm.signTagOptions).toEqual(SIGN_TAGS_RESPONSE.tags)
      expect(wrapper.vm.formatSignTagMeta(SIGN_TAGS_RESPONSE.tags[0])).toBe('2 人持有・3 個流程關卡使用')
      expect(wrapper.vm.formatSignTagMeta(SIGN_TAGS_RESPONSE.tags[1])).toBe('0 人持有・1 個流程關卡使用')
      expect(wrapper.vm.formatSignTagMeta(SIGN_TAGS_RESPONSE.tags[2])).toBe('1 人持有')
      expect(wrapper.vm.formatSignTagMeta({ name: '人資', count: null, requiredByWorkflows: null })).toBe('')

      const labels = wrapper.findAll('.tag-option-name').map(node => node.text())
      expect(labels).toEqual(['人資', '排班負責人', '財務覆核'])
      expect(wrapper.text()).toContain('2 人持有・3 個流程關卡使用')
    })

    it('清單載入失敗時改用流程預設標籤，而且不擋住員工表單', async () => {
      signTagsResponse = () => createApiResponse({ error: 'boom' }, 500)
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()

      expect(wrapper.vm.employeeDialogVisible).toBe(true)
      const names = wrapper.vm.signTagOptions.map(tag => tag.name)
      expect(names).toEqual(['人資', '支援單位主管', '排班負責人', '財務覆核', '業務主管', '業務負責人'])
      ;['資深', '新人', '外聘', '志工'].forEach(name => expect(names).not.toContain(name))
      expect(wrapper.vm.formatSignTagMeta(wrapper.vm.signTagOptions[0])).toBe('')
    })

    it('連線錯誤也只退回預設標籤', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      signTagsResponse = () => {
        throw new Error('network down')
      }
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()

      expect(wrapper.vm.employeeDialogVisible).toBe(true)
      expect(wrapper.vm.signTagOptions).toHaveLength(6)
      warn.mockRestore()
    })

    it('自行輸入標籤時去掉前後空白、全形轉半形並去重', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()

      wrapper.vm.handleSignTagsChange([' 排班負責人 ', '排班負責人', '財務　覆核', '', 'ＨＲ'])

      expect(wrapper.vm.employeeForm.signTags).toEqual(['排班負責人', '財務 覆核', 'HR'])
    })

    it('開啟既有員工時，已存的標籤會先整理過再顯示', async () => {
      const original = EXISTING_EMPLOYEE.signTags
      EXISTING_EMPLOYEE.signTags = [' 人資', '人資 ', '排班負責人']
      try {
        await mountComponent()
        await wrapper.vm.openEmployeeDialog('e1')
        expect(wrapper.vm.employeeForm.signTags).toEqual(['人資', '排班負責人'])
      } finally {
        EXISTING_EMPLOYEE.signTags = original
      }
    })
  })

  describe('批量匯入的簽核欄位', () => {
    it('預設欄位對應與範本都包含簽核標籤、簽核角色、簽核層級', async () => {
      await mountComponent()

      expect(wrapper.vm.bulkImportForm.columnMappings).toMatchObject({
        signTags: 'signTags',
        signRole: 'signRole',
        signLevel: 'signLevel'
      })
      const [headerRow, descriptionRow, firstSample, secondSample] = wrapper.vm
        .buildBulkImportTemplateCsvContent()
        .replace('﻿', '')
        .split('\n')
      ;['signTags', 'signRole', 'signLevel'].forEach(header => expect(headerRow).toContain(`"${header}"`))
      expect(descriptionRow).toContain('簽核標籤')
      expect(descriptionRow).toContain('R001~R007')
      expect(descriptionRow).toContain('U001~U005')
      expect(firstSample).toContain('"人資"')
      expect(secondSample).toContain('"排班負責人,支援單位主管"')

      const section = wrapper.vm.bulkImportTemplateSections.find(item => item.title === '簽核設定')
      expect(section.fields.map(field => field.key)).toEqual(['signTags', 'signRole', 'signLevel'])
    })

    it('匯入時把簽核欄位的對應一起送給後端', async () => {
      const importSpy = vi.spyOn(apiModule, 'importEmployeesBulk').mockResolvedValue(
        createApiResponse({ preview: [], warnings: [], errors: [] })
      )
      await mountComponent()
      const csv = wrapper.vm.buildBulkImportTemplateCsvContent()
      const file = new File([csv], 'employee-import-template.csv', { type: 'text/csv' })
      await wrapper.vm.handleBulkImportFileChange({ name: file.name, raw: file })

      await wrapper.vm.submitBulkImport()
      await flushPromises()

      const formData = importSpy.mock.calls[0][0]
      expect(JSON.parse(formData.get('mappings'))).toMatchObject({
        signTags: 'signTags',
        signRole: 'signRole',
        signLevel: 'signLevel'
      })
      importSpy.mockRestore()
    })

    it('預覽解析時簽核標籤依逗號、頓號、分號拆開並整理', async () => {
      await mountComponent()
      const mapped = wrapper.vm.mapRowToFormShape(
        { signTags: ' 人資 ，排班負責人、人資;財務覆核\n業務主管', signRole: 'R007', signLevel: 'U001' },
        wrapper.vm.bulkImportForm.columnMappings
      )
      expect(mapped.signTags).toEqual(['人資', '排班負責人', '財務覆核', '業務主管'])
      expect(mapped.signRole).toBe('R007')
      expect(mapped.signLevel).toBe('U001')
    })
  })
})
