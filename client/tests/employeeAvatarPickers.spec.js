import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import { clearEmployeePhotoCache } from '../src/utils/photoUrl'

// 員工下拉選單的選項旁邊有小頭像：選項已經帶著員工資料（含照片路徑）的地方才加，
// 選單展開才會畫到，頭像又是捲進畫面才下載，所以選單再長也不會一次打出一堆請求。

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('../src/api', () => ({ API_BASE_URL: '', apiFetch: apiFetchMock }))

import ApprovalFormFields from '../src/components/ApprovalFormFields.vue'
import ApprovalFlowSetting from '../src/components/backComponents/ApprovalFlowSetting.vue'

// 掛的是真正的 Element Plus，機器忙的時候一個測試可能超過預設的 10 秒
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await tick()
  await flushPromises()
}

const ok = body => ({ ok: true, status: 200, json: async () => body })

let photoRequests
let blobCounter
const mounted = []

beforeEach(() => {
  photoRequests = []
  blobCounter = 0
  apiFetchMock.mockReset()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      blobCounter += 1
      return `blob:picker-${blobCounter}`
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  clearEmployeePhotoCache()
})

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  document.body.innerHTML = ''
  clearEmployeePhotoCache()
  vi.restoreAllMocks()
})

describe('申請表單的「員工」欄位下拉選單', () => {
  it('選項旁有頭像：有照片顯示照片，沒有照片顯示姓名第一個字', async () => {
    apiFetchMock.mockImplementation(async url => {
      const match = String(url).match(/^\/api\/employees\/([^/]+)\/photo/)
      if (!match) return ok([])
      photoRequests.push(String(url))
      if (match[1] !== 'u1') return { ok: false, status: 404 }
      return { ok: true, status: 200, blob: async () => ({ type: 'image/png', size: 4 }) }
    })
    const wrapper = mount(ApprovalFormFields, {
      props: {
        fields: [{ _id: 'agent', label: '代理人', type_1: 'user', is_active: true }],
        modelValue: {},
        userOptions: [
          { value: 'u1', label: '王小明 (wang)', name: '王小明', photo: '/upload/employees/employee_u1.png' },
          { value: 'u2', label: '李小華 (lee)', name: '李小華', photo: '' },
        ],
      },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    mounted.push(wrapper)
    await flush()

    const options = [...document.body.querySelectorAll('.user-option')]
    expect(options).toHaveLength(2)
    expect(options[0].querySelector('img')?.getAttribute('src')).toMatch(/^blob:picker-/)
    expect(options[0].textContent).toContain('王小明 (wang)')
    expect(options[1].querySelector('img')).toBeNull()
    expect(options[1].querySelector('.el-avatar').textContent.trim()).toBe('李')
    expect(photoRequests).toEqual(['/api/employees/u1/photo?v=employee_u1.png'])
  })
})

describe('簽核流程設定的簽核人下拉選單', () => {
  const employees = [
    { id: 'e1', name: 'Alice', username: 'alice', role: 'supervisor', photo: '/upload/employees/employee_e1.png', displayName: 'Alice（alice）', department: { id: 'd1', name: '人資部' } },
    { id: 'e2', name: 'Bob', username: 'bob', role: 'employee', photo: '', displayName: 'Bob（bob）', department: { id: 'd2', name: '業務部' } },
  ]

  beforeEach(() => {
    vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    apiFetchMock.mockImplementation(async (url, opts) => {
      const text = String(url)
      const photoMatch = text.match(/^\/api\/employees\/([^/]+)\/photo/)
      if (photoMatch) {
        photoRequests.push(text)
        if (photoMatch[1] !== 'e1') return { ok: false, status: 404 }
        return { ok: true, status: 200, blob: async () => ({ type: 'image/png', size: 4 }) }
      }
      if (text === '/api/approvals/forms') return ok([])
      if (text === '/api/employees/options') return ok(employees)
      if (text === '/api/approvals/forms/f1/workflow' && !opts) {
        return ok({ steps: [{ step_order: 1, approver_type: 'user', approver_value: ['e1'] }, { step_order: 2, approver_type: 'manager', approver_value: 'e1' }] })
      }
      return ok([])
    })
  })

  it('員工清單帶著照片路徑，選項旁的頭像用它（簽核人與主管兩種下拉選單）', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] }, attachTo: document.body })
    mounted.push(wrapper)
    await flush()
    expect(wrapper.vm.employeeOptions[0].photo).toBe('/upload/employees/employee_e1.png')
    // 選項本身的形狀不變，只是畫面上多了頭像
    expect(wrapper.vm.userApproverOptions[0]).toEqual({ value: 'e1', label: 'Alice（alice）' })

    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flush()

    const options = [...document.body.querySelectorAll('.approver-option')]
    // 簽核人下拉（Alice、Bob）+ 主管下拉（申請者的主管、Alice）
    expect(options.length).toBeGreaterThanOrEqual(4)
    const aliceOptions = options.filter(option => option.textContent.includes('Alice'))
    expect(aliceOptions.length).toBeGreaterThanOrEqual(2)
    aliceOptions.forEach(option => expect(option.querySelector('img')?.getAttribute('src')).toMatch(/^blob:picker-/))
    const bob = options.find(option => option.textContent.includes('Bob'))
    expect(bob.querySelector('img')).toBeNull()
    expect(bob.querySelector('.el-avatar').textContent.trim()).toBe('B')
    // 「申請者的主管」不是某一位員工，不放頭像
    const applicantSupervisor = options.find(option => option.textContent.includes('申請者的主管'))
    expect(applicantSupervisor.querySelector('.el-avatar')).toBeNull()
    // Alice 出現在好幾個選單裡，照片只下載一次
    expect(photoRequests).toEqual(['/api/employees/e1/photo?v=employee_e1.png'])
  })
})
