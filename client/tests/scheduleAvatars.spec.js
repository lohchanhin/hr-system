import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import realShape from './fixtures/scheduleLeaveApprovals.realShape.json'
import { clearEmployeePhotoCache } from '../src/utils/photoUrl'

// 排班頁的人頭像：員工欄、相關簽核的申請人欄、發布狀態的待回覆 / 異議名單。
// 員工清單與簽核單都用伺服器真的會回的形狀（員工物件有 _id 與 photo 路徑），
// 照片經由共用快取以登入身分下載，同一位員工在頁面上出現很多次也只下載一次。

const elementPlusMock = vi.hoisted(() => {
  const ElMessage = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
  const ElMessageBox = { alert: vi.fn(), confirm: vi.fn() }
  const loadingServiceMock = vi.fn(() => ({ close: vi.fn() }))
  return { module: { ElMessage, ElMessageBox, ElLoading: { service: loadingServiceMock } }, ElMessage }
})
vi.mock('element-plus', () => elementPlusMock.module)
global.ElMessage = elementPlusMock.ElMessage

vi.mock('../src/api', () => ({ apiFetch: vi.fn(), importScheduleRecords: vi.fn() }))
const pushMock = vi.fn()
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router')
  return { ...actual, useRouter: () => ({ push: pushMock }) }
})

import { apiFetch } from '../src/api'
import Schedule from '../src/views/front/Schedule.vue'

const encodeBase64 = data => Buffer.from(data, 'utf8').toString('base64')
const setRoleToken = role => localStorage.setItem('token', `stub.${encodeBase64(JSON.stringify({ role }))}.sig`)

const [sha, wang] = realShape.employees
const SHA_PHOTO = '/upload/employees/employee_sha.png'
const SUPERVISOR_PHOTO = '/upload/employees/employee_supervisor.png'

// 沙俊宇有照片，王小明沒有
const employees = [{ ...sha, photo: SHA_PHOTO }, { ...wang, photo: '' }]
const approvals = realShape.response.approvals.map(approval => ({
  ...approval,
  applicant_employee: {
    ...approval.applicant_employee,
    photo: approval.applicant_employee._id === sha._id ? SHA_PHOTO : '',
  },
}))

function mountSchedule() {
  const TableStub = {
    name: 'ElTable',
    props: ['data'],
    provide() {
      return { tableContext: this }
    },
    template: '<div class="table-stub"><slot></slot></div>'
  }
  const ColumnStub = {
    name: 'ElTableColumn',
    inject: ['tableContext'],
    props: ['label', 'fixed', 'width', 'className'],
    template: `
      <div class="col" :data-label="label" :data-width="width || ''">
        <div class="col-header"><slot name="header"></slot></div>
        <div v-for="row in (tableContext?.data || [])" :key="row && (row._id || row.id || row.name || JSON.stringify(row))" class="cell">
          <slot :row="row"></slot>
        </div>
      </div>
    `
  }
  const stubs = {
    // 其餘元件都是替身；頭像元件用真的，el-avatar 替身會把圖片畫出來
    EmployeeAvatar: false,
    'el-avatar': {
      name: 'ElAvatar',
      props: ['src', 'size'],
      template: '<span class="el-avatar"><img v-if="src" :src="src" /><slot v-else></slot></span>',
    },
    'el-date-picker': true,
    'el-table': TableStub,
    'el-table-column': ColumnStub,
    'el-select': { name: 'ElSelect', props: ['modelValue', 'disabled'], template: '<select v-bind="$attrs"><slot></slot></select>' },
    'el-option': { name: 'ElOption', props: ['label', 'value'], template: '<option :value="value"><slot>{{ label }}</slot></option>' },
    'el-steps': { name: 'ElSteps', template: '<div class="steps-stub"><slot></slot></div>' },
    'el-step': { name: 'ElStep', template: '<div class="step-stub"><slot></slot></div>' },
    'el-checkbox': { name: 'ElCheckbox', props: ['modelValue'], template: '<label><input type="checkbox" /><slot></slot></label>' },
    'el-input': { name: 'ElInput', template: '<input v-bind="$attrs" />' },
    'el-popover': { name: 'ElPopover', template: '<div class="popover-stub"><slot></slot><slot name="reference"></slot></div>' },
    'el-tag': { name: 'ElTag', template: '<span class="tag-stub" v-bind="$attrs"><slot></slot></span>' },
    'el-tooltip': { name: 'ElTooltip', template: '<span class="tooltip-stub"><slot></slot></span>' },
    'el-button': { name: 'ElButton', template: '<button v-bind="$attrs"><slot></slot></button>' },
    'el-progress': true,
    'el-pagination': { name: 'ElPagination', emits: ['current-change', 'size-change'], template: '<div class="pagination-stub"></div>' },
    'el-switch': { name: 'ElSwitch', template: '<input type="checkbox" />' },
    'el-divider': { name: 'ElDivider', template: '<div class="divider-stub"></div>' },
    'el-descriptions': { name: 'ElDescriptions', template: '<div><slot></slot></div>' },
    'el-descriptions-item': { name: 'ElDescriptionsItem', template: '<div><slot></slot></div>' },
    'el-dialog': { name: 'ElDialog', props: ['modelValue'], template: '<div class="dialog-stub"><slot></slot></div>' },
    'el-drawer': { name: 'ElDrawer', props: ['modelValue'], template: '<aside class="drawer-stub"><slot></slot></aside>' },
    'el-badge': { name: 'ElBadge', template: '<span><slot></slot></span>' },
    'el-icon': { name: 'ElIcon', template: '<span><slot></slot></span>' },
    'el-empty': { name: 'ElEmpty', template: '<div class="empty-stub"></div>' },
    'el-alert': { name: 'ElAlert', props: ['title', 'type'], template: '<div class="alert-stub">{{ title }}</div>' },
    'el-timeline': { name: 'ElTimeline', template: '<div><slot></slot></div>' },
    'el-timeline-item': { name: 'ElTimelineItem', template: '<div><slot></slot></div>' },
    ScheduleDashboard: { name: 'ScheduleDashboard', template: '<div class="dashboard-stub"></div>', props: ['summary'] }
  }
  return shallowMount(Schedule, { global: { stubs } })
}

const tick = () => new Promise(resolve => setTimeout(resolve))
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await tick()
}

let photoRequests
let blobCounter

function setupApi({ publishSummary, includeSelf = false, supervisorPhoto } = {}) {
  photoRequests = []
  apiFetch.mockImplementation(async url => {
    const { pathname, searchParams } = new URL(url, 'http://localhost')
    const ok = body => ({ ok: true, json: async () => body })

    const photoMatch = pathname.match(/^\/api\/employees\/([^/]+)\/photo$/)
    if (photoMatch) {
      photoRequests.push(`${photoMatch[1]}?${searchParams.toString()}`)
      if (![sha._id, realShape.supervisor].includes(photoMatch[1])) return { ok: false, status: 404 }
      return { ok: true, status: 200, blob: async () => ({ type: 'image/png', size: 4 }) }
    }
    if (pathname === '/api/employees/schedule' && searchParams.get('supervisor') && searchParams.get('pageSize') === '200' && !searchParams.has('department')) {
      return ok({ employees: employees.map(e => ({ _id: e._id, subDepartment: { _id: e.subDepartment } })) })
    }
    if (pathname === '/api/employees/schedule') {
      return ok({ employees, pagination: { page: 1, pageSize: 50, total: employees.length, totalPages: 1 } })
    }
    if (pathname === `/api/employees/${realShape.supervisor}`) {
      return ok({
        _id: realShape.supervisor,
        name: '林主任',
        ...(supervisorPhoto !== undefined ? { photo: supervisorPhoto } : {}),
        department: { _id: employees[0].department, name: 'Dept A' },
        subDepartment: { _id: employees[0].subDepartment, name: 'Sub A' }
      })
    }
    if (pathname === '/api/schedules/preferences/include-self') return ok({ includeSelf })
    if (pathname === '/api/departments') return ok([{ _id: employees[0].department, name: 'Dept A' }])
    if (pathname === '/api/sub-departments') {
      return ok([{ _id: employees[0].subDepartment, name: 'Sub A', department: { _id: employees[0].department } }])
    }
    if (pathname === '/api/schedules/monthly') {
      return ok({
        schedules: [],
        publishSummary: publishSummary || { status: 'draft', pendingEmployees: [], disputedEmployees: [], publishedAt: null, hasSchedules: false, totalEmployees: 0, allEmployeesConfirmed: false },
        pagination: { page: 1, limit: 20, totalEmployees: 0 }
      })
    }
    if (pathname === '/api/schedules/leave-approvals') {
      return { ok: true, headers: { get: () => null }, json: async () => ({ ...realShape.response, approvals }) }
    }
    return ok([])
  })
}

async function mountSupervisorPage(options) {
  setRoleToken('supervisor')
  localStorage.setItem('employeeId', realShape.supervisor)
  setupApi(options)
  const wrapper = mountSchedule()
  mounted.push(wrapper)
  await flush()
  await wrapper.vm.$nextTick()
  return wrapper
}

// 這一欄每一列裡的頭像：有照片的是 img，沒有的是姓名第一個字
const avatarsIn = (wrapper, selector) =>
  wrapper.findAll(`${selector} .el-avatar`).map(avatar => ({
    src: avatar.find('img').exists() ? avatar.find('img').attributes('src') : null,
    text: avatar.text(),
  }))

// 每個測試掛的頁面用完就卸載，不讓上一個測試的頭像還在背景發請求
const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
})

beforeEach(() => {
  setActivePinia(createPinia())
  apiFetch.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  pushMock.mockReset()
  blobCounter = 0
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      blobCounter += 1
      return `blob:schedule-${blobCounter}`
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  clearEmployeePhotoCache()
})

describe('排班頁的人頭像（餵伺服器真的回應形狀）', () => {
  it('員工欄：有照片的員工顯示照片，沒有的顯示姓名第一個字', async () => {
    const wrapper = await mountSupervisorPage()

    const rows = wrapper.vm.virtualVisibleEmployees
    expect(rows.map(row => row._id)).toEqual([sha._id, wang._id])
    expect(rows[0].photo).toBe(SHA_PHOTO)

    const avatars = avatarsIn(wrapper, '.col[data-label="員工姓名"] .employee-name')
    expect(avatars).toHaveLength(2)
    expect(avatars[0].src).toMatch(/^blob:schedule-/)
    expect(avatars[1]).toEqual({ src: null, text: '王' })
  })

  it('「包含自己」：名單裡補上的主管本人那一列也有頭像（個人資料帶的照片）', async () => {
    const wrapper = await mountSupervisorPage({ includeSelf: true, supervisorPhoto: SUPERVISOR_PHOTO })

    const rows = wrapper.vm.virtualVisibleEmployees
    expect(rows.map(row => row._id).sort()).toEqual([realShape.supervisor, sha._id, wang._id].sort())
    const self = rows.find(row => row._id === realShape.supervisor)
    expect(self.name).toBe('林主任')
    expect(self.photo).toBe(SUPERVISOR_PHOTO)

    const avatars = avatarsIn(wrapper, '.col[data-label="員工姓名"] .employee-name')
    expect(avatars).toHaveLength(3)
    // 沙俊宇與主管本人有照片，王小明沒有
    expect(avatars.filter(avatar => avatar.src)).toHaveLength(2)
    expect(avatars.filter(avatar => !avatar.src)).toEqual([{ src: null, text: '王' }])
    // 22px 的頭像：各向伺服器要一次 48px 的縮圖
    expect([...photoRequests].sort()).toEqual([
      `${realShape.supervisor}?v=employee_supervisor.png&size=48`,
      `${sha._id}?v=employee_sha.png&size=48`,
    ].sort())
  })

  it('「包含自己」但個人資料沒有照片（舊資料）：主管本人那一列是字母頭像，不發照片請求', async () => {
    const wrapper = await mountSupervisorPage({ includeSelf: true })

    const self = wrapper.vm.virtualVisibleEmployees.find(row => row._id === realShape.supervisor)
    expect(self.photo).toBe('')
    const avatars = avatarsIn(wrapper, '.col[data-label="員工姓名"] .employee-name')
    expect(avatars.filter(avatar => avatar.text === '林')).toEqual([{ src: null, text: '林' }])
    expect(photoRequests.some(request => request.startsWith(realShape.supervisor))).toBe(false)
  })

  it('相關簽核的申請人欄：同一位申請人的每一張單都有頭像，照片只下載一次', async () => {
    const wrapper = await mountSupervisorPage()

    const cells = wrapper.findAll('.modern-approval-table .col[data-label="申請人"] .cell')
    expect(cells).toHaveLength(approvals.length)
    cells.forEach(cell => {
      const name = cell.text()
      const image = cell.find('img')
      if (name === sha.name) expect(image.exists()).toBe(true)
      else expect(image.exists()).toBe(false)
    })

    // 員工欄 + 相關簽核好幾張單，沙俊宇的照片只向伺服器要一次
    expect(photoRequests).toEqual([`${sha._id}?v=employee_sha.png&size=48`])
  })

  it('發布狀態的待回覆名單：頭像用員工清單裡的照片', async () => {
    const wrapper = await mountSupervisorPage({
      publishSummary: {
        status: 'pending_confirmation',
        pendingEmployees: [
          { id: sha._id, name: sha.name, pendingCount: 2 },
          { id: wang._id, name: wang.name, pendingCount: 1 },
        ],
        disputedEmployees: [],
        publishedAt: '2026-07-01T00:00:00.000Z',
        hasSchedules: true,
        totalEmployees: 2,
        allEmployeesConfirmed: false,
      },
    })

    const avatars = avatarsIn(wrapper, '[data-test="pending-card"] .card-item')
    expect(avatars).toHaveLength(2)
    expect(avatars[0].src).toMatch(/^blob:schedule-/)
    expect(avatars[1].src).toBeNull()
    expect(avatars[1].text).toBe('王')
  })
})
