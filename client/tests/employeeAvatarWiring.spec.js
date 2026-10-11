import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import { clearEmployeePhotoCache } from '../src/utils/photoUrl'

// 各個畫面的人頭像：用伺服器真的會回的員工物件形狀（_id、name、photo 路徑）餵畫面，
// 照片經過共用快取以登入身分下載；沒有照片的人顯示姓名第一個字。
// 這裡不 mock 頭像元件和快取，只把網路請求換成假伺服器。

const { apiFetchMock, leaveGuards } = vi.hoisted(() => ({ apiFetchMock: vi.fn(), leaveGuards: [] }))

vi.mock('../src/api', () => ({ API_BASE_URL: '', apiFetch: apiFetchMock }))
vi.mock('vue-router', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, onBeforeRouteLeave: guard => { leaveGuards.push(guard) } }
})

import Approval from '../src/views/front/Approval.vue'
import ApprovalDetailContent from '../src/views/front/ApprovalDetailContent.vue'
import FrontLayout from '../src/views/front/FrontLayout.vue'
import ScheduleOverview from '../src/views/ScheduleOverview.vue'
import DepartmentReports from '../src/views/front/DepartmentReports.vue'
import { useAuthStore } from '../src/stores/auth'
import { useMenuStore } from '../src/stores/menu'
import { useProfileStore } from '../src/stores/profile'

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

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
})

const PHOTO = id => `/upload/employees/employee_${id}.png`

// 假伺服器：員工有沒有照片、各網址回什麼，都由每個測試設定
let fake
let blobCounter
let revokedUrls

function resetFake() {
  fake = {
    withPhoto: new Set(),
    photoRequests: [],
    routes: {},
  }
}

function installApi() {
  apiFetchMock.mockImplementation(async (url, init = {}) => {
    const parsed = new URL(String(url), 'http://localhost')
    const photoMatch = parsed.pathname.match(/^\/api\/employees\/([^/]+)\/photo$/)
    if (photoMatch) {
      fake.photoRequests.push(`${photoMatch[1]}?${parsed.searchParams.toString()}`)
      if (!fake.withPhoto.has(photoMatch[1])) return { ok: false, status: 404 }
      return { ok: true, status: 200, blob: async () => ({ type: 'image/png', size: 4 }) }
    }
    const handler = fake.routes[parsed.pathname]
    if (handler) return json(typeof handler === 'function' ? handler(parsed, init) : handler)
    return json([])
  })
}

const mounted = []
function track(wrapper) {
  mounted.push(wrapper)
  return wrapper
}

beforeEach(() => {
  resetFake()
  blobCounter = 0
  revokedUrls = []
  localStorage.clear()
  sessionStorage.clear()
  apiFetchMock.mockReset()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      blobCounter += 1
      return `blob:wiring-${blobCounter}`
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(url => {
      revokedUrls.push(url)
    }),
  })
  setActivePinia(createPinia())
  clearEmployeePhotoCache()
  installApi()
})

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  leaveGuards.length = 0
  clearEmployeePhotoCache()
  vi.restoreAllMocks()
})

// 一個頭像元素的樣子：有圖就是 src，沒有圖就是裡面的字
const avatarLook = avatar => ({
  src: avatar.find('img').exists() ? avatar.find('img').attributes('src') : null,
  text: avatar.find('img').exists() ? '' : avatar.text(),
})

describe('簽核頁（Approval.vue）', () => {
  const applicantA = { _id: 'a1', name: '王小明', employeeId: 'E001', department: '內科', photo: PHOTO('a1') }
  const applicantB = { _id: 'a2', name: '李小華', employeeId: 'E002', department: '外科', photo: '' }
  const approverP = { _id: 'p1', name: '林主任', employeeId: 'S001', photo: PHOTO('p1') }

  const baseDoc = (id, applicant, extra = {}) => ({
    _id: id,
    status: 'pending',
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z',
    current_step_index: 0,
    form: { _id: 'f1', name: '請假', category: '人事' },
    applicant_employee: applicant,
    steps: [{ approvers: [{ approver: approverP, decision: 'pending' }] }],
    ...extra,
  })

  async function mountPage() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = track(mount(Approval, { global: { plugins: [ElementPlus, pinia] }, attachTo: document.body }))
    useAuthStore().role = 'supervisor'
    await flush()
    return wrapper
  }

  it('待我簽核：每一張單的申請人都有頭像，有照片顯示照片，沒有的顯示字母', async () => {
    fake.withPhoto = new Set(['a1', 'p1'])
    fake.routes['/api/approvals/inbox'] = [baseDoc('r1', applicantA), baseDoc('r2', applicantB), baseDoc('r3', applicantA)]
    const wrapper = await mountPage()

    const cells = wrapper.findAll('.applicant-info')
    expect(cells).toHaveLength(3)
    const looks = cells.map(cell => avatarLook(cell.find('.el-avatar')))
    expect(looks.filter(look => look.src)).toHaveLength(2)
    expect(looks.filter(look => look.src).every(look => look.src.startsWith('blob:wiring-'))).toBe(true)
    expect(looks.filter(look => !look.src)).toEqual([{ src: null, text: '李' }])
    // 沒有照片的人沒發請求；有照片的人，兩張單只下載一次
    expect(fake.photoRequests.filter(request => request.startsWith('a2'))).toEqual([])
    expect(fake.photoRequests.filter(request => request.startsWith('a1'))).toEqual(['a1?v=employee_a1.png&size=96'])
  })

  it('我已簽核：申請人頭像一樣顯示', async () => {
    fake.withPhoto = new Set(['a1'])
    fake.routes['/api/approvals/history'] = [
      { ...baseDoc('h1', applicantA), status: 'approved', my_approvals: [{ decision: 'approved', decided_at: '2026-06-19T01:00:00.000Z', comment: '同意' }] },
    ]
    const wrapper = await mountPage()
    wrapper.vm.activeTab = 'history'
    await flush()

    const cells = wrapper.findAll('.approval-table .applicant-info')
    expect(cells.length).toBeGreaterThan(0)
    const historyCell = cells.find(cell => cell.text().includes('王小明'))
    expect(avatarLook(historyCell.find('.el-avatar')).src).toMatch(/^blob:wiring-/)
  })

  it('申請單明細：申請人、審核人（物件或只有編號）、簽核紀錄處理人都有頭像', async () => {
    fake.withPhoto = new Set(['a1', 'p1', 'p2'])
    // 員工選項帶回照片路徑，審核人只有編號時用它找照片
    fake.routes['/api/employees/options'] = [
      { id: 'p2', name: '陳經理', username: 'chen', photo: PHOTO('p2') },
      { id: 'a1', name: '王小明', username: 'wang', photo: PHOTO('a1') },
    ]
    fake.routes['/api/approvals/r1'] = {
      ...baseDoc('r1', applicantA),
      steps: [
        {
          all_must_approve: true,
          is_required: true,
          approvers: [
            { approver: approverP, decision: 'approved', decided_at: '2026-06-19T02:00:00.000Z' },
            { approver: 'p2', decision: 'pending' },
          ],
        },
      ],
      logs: [
        { action: 'create', by_employee: applicantA, at: '2026-06-19T00:00:00.000Z', message: '建立送審單' },
        { action: 'approve', by_employee: approverP, at: '2026-06-19T02:00:00.000Z' },
        { action: 'finish', at: '2026-06-19T03:00:00.000Z', message: '流程完成' },
      ],
    }
    const wrapper = await mountPage()
    await wrapper.vm.openDetail('r1')
    await flush()

    const dialog = document.body.querySelector('.el-dialog')
    expect(dialog).toBeTruthy()
    const lookOf = element => ({
      src: element.querySelector('img')?.getAttribute('src') ?? null,
      text: element.querySelector('img') ? '' : element.textContent.trim(),
    })

    // 申請人
    const applicantLine = dialog.querySelector('.applicant-line .el-avatar')
    expect(lookOf(applicantLine).src).toMatch(/^blob:wiring-/)

    // 審核人：物件有照片路徑；只有編號的用員工選項補照片
    const approverAvatars = [...dialog.querySelectorAll('.el-timeline .el-table .applicant-info .el-avatar')]
    expect(approverAvatars).toHaveLength(2)
    approverAvatars.forEach(avatar => expect(lookOf(avatar).src).toMatch(/^blob:wiring-/))

    // 簽核紀錄：有處理人的有頭像，系統自動處理的沒有
    const logRows = [...dialog.querySelectorAll('.detail-logs .el-table__body tr')]
    expect(logRows).toHaveLength(3)
    expect(logRows[0].querySelector('.el-avatar')).toBeTruthy()
    expect(logRows[1].querySelector('.el-avatar')).toBeTruthy()
    expect(logRows[2].querySelector('.el-avatar')).toBeNull()

    // 同一位員工出現在好幾處，照片只下載一次
    ;['a1', 'p1', 'p2'].forEach(id => {
      expect(fake.photoRequests.filter(request => request.startsWith(`${id}?`))).toHaveLength(1)
    })
  })

  it('審核人沒有照片也沒有選項資料時：顯示姓名第一個字，不丟錯', async () => {
    fake.routes['/api/approvals/r1'] = {
      ...baseDoc('r1', applicantB),
      steps: [{ approvers: [{ approver: { _id: 'p9', name: '周組長' }, decision: 'pending' }] }],
    }
    const wrapper = await mountPage()
    await wrapper.vm.openDetail('r1')
    await flush()

    const dialog = document.body.querySelector('.el-dialog')
    const avatar = dialog.querySelector('.el-timeline .el-table .applicant-info .el-avatar')
    expect(avatar.textContent.trim()).toBe('周')
    expect(fake.photoRequests).toEqual([])
  })
})

describe('ApprovalDetailContent（排班頁引用的申請單明細）', () => {
  it('申請人、審核人、簽核紀錄處理人的頭像', async () => {
    fake.withPhoto = new Set(['a1', 'p1'])
    fake.routes['/api/approvals/r9'] = {
      _id: 'r9',
      status: 'approved',
      form: { name: '請假', category: '人事', fields: [] },
      form_data: {},
      applicant_employee: { _id: 'a1', name: '王小明', photo: PHOTO('a1') },
      current_step_index: 0,
      steps: [{ all_must_approve: true, is_required: true, approvers: [{ approver: { _id: 'p1', name: '林主任', photo: PHOTO('p1') }, decision: 'approved' }] }],
      logs: [{ action: 'approve', by_employee: { _id: 'p1', name: '林主任', photo: PHOTO('p1') }, at: '2026-06-19T02:00:00.000Z' }],
    }
    const wrapper = track(mount(ApprovalDetailContent, { props: { approvalId: 'r9' }, global: { plugins: [ElementPlus] } }))
    await flush()

    const avatars = wrapper.findAll('.el-avatar')
    // 申請人 + 審核人 + 紀錄處理人
    expect(avatars).toHaveLength(3)
    avatars.forEach(avatar => expect(avatarLook(avatar).src).toMatch(/^blob:wiring-/))
    expect(fake.photoRequests.sort()).toEqual(['a1?v=employee_a1.png&size=48', 'p1?v=employee_p1.png&size=48'])
  })
})

describe('前台側邊欄的使用者頭像（FrontLayout.vue）', () => {
  async function mountLayout(profile) {
    localStorage.setItem('employeeId', profile.id)
    fake.routes['/api/profile'] = () => profile
    const pinia = createPinia()
    setActivePinia(pinia)
    useMenuStore().setMenu([{ name: 'MySchedule', label: '我的排班', icon: 'el-icon-calendar' }])
    vi.spyOn(useMenuStore(), 'fetchMenu').mockResolvedValue()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: { template: '<div />' } },
        { path: '/attendance', name: 'attendance', component: { template: '<div />' } },
        { path: '/myschedule', name: 'MySchedule', component: { template: '<div />' } },
      ],
    })
    await router.push({ name: 'attendance' })
    await router.isReady()
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1440 })
    const wrapper = track(mount(FrontLayout, {
      global: { plugins: [ElementPlus, router, pinia], stubs: { 'router-view': { template: '<div />' } } },
    }))
    await flush()
    return { wrapper, pinia, router }
  }

  const baseProfile = { id: 'u1', employeeId: 'u1', name: '王小明', role: 'employee', username: 'wang', photo: PHOTO('u1') }

  it('有照片：側邊欄顯示登入者的照片（伺服器 /api/profile 的 id 就是員工 _id）', async () => {
    fake.withPhoto = new Set(['u1'])
    const { wrapper } = await mountLayout(baseProfile)

    const avatar = wrapper.find('.sidebar-header .el-avatar')
    expect(avatarLook(avatar).src).toMatch(/^blob:wiring-/)
    expect(fake.photoRequests).toEqual(['u1?v=employee_u1.png&size=96'])
  })

  it('沒有照片：顯示姓名第一個字', async () => {
    const { wrapper } = await mountLayout({ ...baseProfile, photo: '' })
    expect(avatarLook(wrapper.find('.sidebar-header .el-avatar'))).toEqual({ src: null, text: '王' })
    expect(fake.photoRequests).toEqual([])
  })

  it('個人資料重新讀取後照片換了（管理員改了自己的照片）：頭像跟著換，舊照片回收', async () => {
    fake.withPhoto = new Set(['u1'])
    const { wrapper, pinia } = await mountLayout(baseProfile)
    const before = avatarLook(wrapper.find('.sidebar-header .el-avatar')).src

    useProfileStore(pinia).setProfile({ ...baseProfile, photo: '/upload/employees/employee_u1_new.png' })
    await flush()

    const after = avatarLook(wrapper.find('.sidebar-header .el-avatar')).src
    expect(after).toMatch(/^blob:wiring-/)
    expect(after).not.toBe(before)
    expect(revokedUrls).toContain(before)
    expect(fake.photoRequests.at(-1)).toBe('u1?v=employee_u1_new.png&size=96')
  })

  it('登出：清掉所有照片快取（別人的照片不能留給下一位登入者）', async () => {
    fake.withPhoto = new Set(['u1'])
    const { wrapper } = await mountLayout({ ...baseProfile, role: 'employee' })
    const src = avatarLook(wrapper.find('.sidebar-header .el-avatar')).src

    await wrapper.find('.logout-btn').trigger('click')
    await flush()
    expect(revokedUrls).toContain(src)
  })
})

describe('排班總覽（ScheduleOverview.vue）', () => {
  it('姓名欄：有照片的員工顯示照片，沒有的顯示字母', async () => {
    fake.withPhoto = new Set(['emp-1'])
    const month = new Date().toISOString().slice(0, 7)
    const day = `${month}-01`
    fake.routes['/api/schedules/overview'] = {
      month,
      days: [day],
      organizations: [{
        id: 'org-1',
        name: '台北總院',
        departments: [{
          id: 'dept-1',
          name: '內科部',
          subDepartments: [{
            id: 'sub-1',
            name: '急診一科',
            employees: [
              { id: 'emp-1', name: 'Alice', title: '護理師', photo: PHOTO('emp-1'), schedules: [{ date: day, shiftId: 's1', shiftName: '早班' }] },
              { id: 'emp-2', name: 'Bob', title: '護理師', photo: '', schedules: [] },
            ],
          }],
        }],
      }],
    }
    fake.routes['/api/organizations'] = [{ _id: 'org-1', name: '台北總院' }]
    fake.routes['/api/departments'] = [{ _id: 'dept-1', name: '內科部', organization: 'org-1' }]
    fake.routes['/api/sub-departments'] = [{ _id: 'sub-1', name: '急診一科', department: 'dept-1' }]

    const TableStub = {
      name: 'ElTable',
      props: ['data'],
      provide() {
        return { tableData: this.data }
      },
      template: '<div class="table-stub"><slot></slot></div>',
    }
    const ColumnStub = {
      name: 'ElTableColumn',
      inject: ['tableData'],
      props: ['label', 'prop'],
      template: `
        <div class="column-stub" :data-label="label">
          <div v-for="row in (tableData || [])" :key="row.id || row.name" class="cell">
            <slot :row="row"><span>{{ prop ? row[prop] : '' }}</span></slot>
          </div>
        </div>`,
    }
    const wrapper = track(shallowMount(ScheduleOverview, {
      global: {
        stubs: {
          EmployeeAvatar: false,
          'el-avatar': { name: 'ElAvatar', props: ['src'], template: '<span class="el-avatar"><img v-if="src" :src="src" /><slot v-else></slot></span>' },
          'el-table': TableStub,
          'el-table-column': ColumnStub,
          'el-select': { name: 'ElSelect', props: ['modelValue'], template: '<select><slot /></select>' },
          'el-option': { name: 'ElOption', props: ['label', 'value'], template: '<option :value="value">{{ label }}</option>' },
          'el-date-picker': { name: 'ElDatePicker', props: ['modelValue'], template: '<input />' },
          'el-button': { name: 'ElButton', template: '<button><slot /></button>' },
          'el-button-group': { name: 'ElButtonGroup', template: '<div><slot /></div>' },
          'el-card': { name: 'ElCard', template: '<section><slot /><slot name="header" /></section>' },
          'el-alert': { name: 'ElAlert', template: '<div><slot /></div>' },
          'el-empty': { name: 'ElEmpty', template: '<div><slot /></div>' },
          'el-skeleton': { name: 'ElSkeleton', template: '<div />' },
          'el-collapse': { name: 'ElCollapse', template: '<div><slot /></div>' },
          'el-collapse-item': { name: 'ElCollapseItem', template: '<section><slot name="title" /><slot /></section>' },
        },
      },
    }))
    await flush()

    const avatars = wrapper.findAll('.overview-person .el-avatar').map(avatarLook)
    expect(avatars).toHaveLength(2)
    expect(avatars[0].src).toMatch(/^blob:wiring-/)
    expect(avatars[1]).toEqual({ src: null, text: 'B' })
    expect(fake.photoRequests).toEqual(['emp-1?v=employee_emp-1.png&size=48'])
  })
})

describe('部門報表預覽（DepartmentReports.vue）', () => {
  it('每一列的員工用 employee（_id）找照片；伺服器沒帶照片欄位時顯示字母', async () => {
    fake.withPhoto = new Set(['emp-1'])
    const TableStub = {
      name: 'ElTable',
      props: ['data'],
      provide() {
        return { tableData: this.data }
      },
      template: '<div class="table-stub"><slot></slot></div>',
    }
    const ColumnStub = {
      name: 'ElTableColumn',
      inject: { tableData: { default: () => [] } },
      props: ['label', 'prop'],
      template: `
        <div class="column-stub" :data-label="label">
          <div v-for="row in (tableData || [])" :key="row.employee" class="cell">
            <slot :row="row"><span>{{ prop ? row[prop] : '' }}</span></slot>
          </div>
        </div>`,
    }
    const wrapper = track(mount(DepartmentReports, {
      global: {
        plugins: [ElementPlus],
        stubs: {
          'el-table': TableStub,
          'el-table-column': ColumnStub,
          'el-card': { template: '<div><slot name="header" /><slot /></div>' },
        },
      },
    }))
    await flush()

    wrapper.vm.preview.state = 'success'
    wrapper.vm.preview.summary = null
    wrapper.vm.preview.records = [
      { employee: 'emp-1', name: '王小明', photo: PHOTO('emp-1'), scheduled: 3 },
      { employee: 'emp-2', name: '李小華', scheduled: 2 },
    ]
    await flush()

    const avatars = wrapper.findAll('.report-person .el-avatar').map(avatarLook)
    expect(avatars).toHaveLength(2)
    expect(avatars[0].src).toMatch(/^blob:wiring-/)
    expect(avatars[1]).toEqual({ src: null, text: '李' })
    expect(fake.photoRequests).toEqual(['emp-1?v=employee_emp-1.png&size=48'])
  })
})
