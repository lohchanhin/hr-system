import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { clearEmployeePhotoCache } from '../src/utils/photoUrl'

// 月薪資總覽：總覽表格是一頁上百列的數字，不放頭像（也不替整頁員工要照片）；
// 點進單一員工的薪資明細視窗，主角是那一個人，姓名旁才有頭像。
// 用伺服器真的會回的資料形狀（_id、name、photo 路徑）餵畫面，掛真正的 Element Plus，
// 這裡不 mock 頭像元件和快取，只把網路請求換成假伺服器。

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('../src/api', () => ({ API_BASE_URL: '', apiFetch: apiFetchMock }))

import SalaryManagementSetting from '../src/components/backComponents/SalaryManagementSetting.vue'

// 掛的是真正的 Element Plus，機器忙的時候一個測試可能超過預設的 10 秒
vi.setConfig({ testTimeout: 60000, hookTimeout: 30000 })

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

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const PHOTO = id => `/upload/employees/employee_${id}.png`

let routes
let withPhoto
let photoRequests
let blobCounter
const mounted = []

beforeEach(() => {
  routes = {}
  withPhoto = new Set()
  photoRequests = []
  blobCounter = 0
  localStorage.clear()
  apiFetchMock.mockReset()
  apiFetchMock.mockImplementation(async url => {
    const parsed = new URL(String(url), 'http://localhost')
    const photoMatch = parsed.pathname.match(/^\/api\/employees\/([^/]+)\/photo$/)
    if (photoMatch) {
      photoRequests.push(`${photoMatch[1]}?${parsed.searchParams.toString()}`)
      if (!withPhoto.has(photoMatch[1])) return { ok: false, status: 404 }
      return { ok: true, status: 200, blob: async () => ({ type: 'image/png', size: 4 }) }
    }
    const handler = routes[parsed.pathname]
    if (handler !== undefined) return json(typeof handler === 'function' ? handler(parsed) : handler)
    return json([])
  })
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      blobCounter += 1
      return `blob:salary-${blobCounter}`
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

const overviewRow = overrides => ({
  _id: 'e1',
  employeeId: 'E001',
  name: '王小明',
  photo: PHOTO('e1'),
  department: '內科',
  subDepartment: '',
  organization: '',
  salaryType: '月薪',
  workDays: 22,
  actualWorkHours: 176,
  hourlyRate: 200,
  totalPayment: 40000,
  ...overrides,
})

async function mountOverview(rows) {
  routes['/api/payroll/overview/monthly'] = { items: rows, pagination: { total: rows.length, page: 1, pageSize: 20, totalPages: 1 } }
  const wrapper = mount(SalaryManagementSetting, { global: { plugins: [ElementPlus] }, attachTo: document.body })
  mounted.push(wrapper)
  await flush()
  return wrapper
}

// 一個頭像元素的樣子：有圖就是 src，沒有圖就是裡面的字
const lookOf = element => ({
  src: element.querySelector('img')?.getAttribute('src') ?? null,
  text: element.querySelector('img') ? '' : element.textContent.trim(),
})

describe('月薪資總覽（SalaryManagementSetting.vue）', () => {
  it('總覽表格沒有頭像，也不替整頁員工下載照片', async () => {
    withPhoto = new Set(['e1'])
    const wrapper = await mountOverview([
      overviewRow(),
      overviewRow({ _id: 'e2', employeeId: 'E002', name: '李小華', photo: '' }),
    ])

    // 表格裡有這兩個人
    expect(wrapper.text()).toContain('王小明')
    expect(wrapper.text()).toContain('李小華')
    expect(wrapper.findAll('.el-table .el-avatar')).toHaveLength(0)
    expect(photoRequests).toEqual([])
  })

  it('詳細資料視窗：基本資訊的姓名旁有頭像（40px，向伺服器要 96px 的縮圖）', async () => {
    withPhoto = new Set(['e1'])
    const wrapper = await mountOverview([overviewRow()])
    expect(photoRequests).toEqual([])

    await wrapper.vm.showDetailDialog(wrapper.vm.filteredOverviewData[0])
    await flush()

    const inDialog = document.body.querySelector('.el-dialog .payroll-person')
    expect(inDialog).toBeTruthy()
    expect(inDialog.textContent).toContain('王小明')
    expect(lookOf(inDialog.querySelector('.el-avatar')).src).toMatch(/^blob:salary-/)
    expect(inDialog.querySelector('.el-avatar').getAttribute('aria-label')).toBe('王小明的頭像')
    expect(photoRequests).toEqual(['e1?v=employee_e1.png&size=96'])
  })

  it('詳細資料視窗：員工沒有照片顯示姓名第一個字，不發照片請求', async () => {
    const wrapper = await mountOverview([overviewRow({ photo: '' })])
    await wrapper.vm.showDetailDialog(wrapper.vm.filteredOverviewData[0])
    await flush()

    const inDialog = document.body.querySelector('.el-dialog .payroll-person')
    expect(lookOf(inDialog.querySelector('.el-avatar'))).toEqual({ src: null, text: '王' })
    expect(photoRequests).toEqual([])
  })

  it('舊的伺服器沒帶 photo 欄位：詳細資料視窗顯示字母，不丟錯、不發照片請求', async () => {
    const row = overviewRow()
    delete row.photo
    const wrapper = await mountOverview([row])
    await wrapper.vm.showDetailDialog(wrapper.vm.filteredOverviewData[0])
    await flush()

    const inDialog = document.body.querySelector('.el-dialog .payroll-person')
    expect(lookOf(inDialog.querySelector('.el-avatar'))).toEqual({ src: null, text: '王' })
    expect(photoRequests).toEqual([])
  })

  it('換看另一位員工的明細：頭像跟著換成那位員工的照片', async () => {
    withPhoto = new Set(['e1', 'e2'])
    const wrapper = await mountOverview([
      overviewRow(),
      overviewRow({ _id: 'e2', employeeId: 'E002', name: '李小華', photo: PHOTO('e2') }),
    ])
    const [first, second] = wrapper.vm.filteredOverviewData

    await wrapper.vm.showDetailDialog(first)
    await flush()
    const firstSrc = lookOf(document.body.querySelector('.el-dialog .payroll-person .el-avatar')).src
    expect(firstSrc).toMatch(/^blob:salary-/)

    await wrapper.vm.showDetailDialog(second)
    await flush()
    const person = document.body.querySelector('.el-dialog .payroll-person')
    expect(person.textContent).toContain('李小華')
    expect(person.querySelector('.el-avatar').getAttribute('aria-label')).toBe('李小華的頭像')
    expect(lookOf(person.querySelector('.el-avatar')).src).toMatch(/^blob:salary-/)
    expect(photoRequests).toEqual(['e1?v=employee_e1.png&size=96', 'e2?v=employee_e2.png&size=96'])
  })
})
