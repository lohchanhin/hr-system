import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h, ref } from 'vue'
import ElementPlus, { ElTabs } from 'element-plus'
import * as apiModule from '../src/api'
import { clearEmployeePhotoCache } from '../src/utils/photoUrl'

const { messageMock } = vi.hoisted(() => ({
  messageMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

// 只換掉 ElMessage / ElMessageBox（要檢查顯示了什麼訊息），其餘都是真的 Element Plus
vi.mock('element-plus', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: messageMock,
    ElMessageBox: {
      confirm: vi.fn(() => Promise.resolve()),
      prompt: vi.fn(() => Promise.resolve()),
      alert: vi.fn(() => Promise.resolve()),
    },
  }
})

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ name: '' }),
}))

const menuItems = ref([])
vi.mock('../src/stores/menu', () => ({
  useMenuStore: () => ({ fetchMenu: vi.fn(), setMenu: vi.fn(), items: menuItems }),
}))

import EmployeeManagement from '../src/components/backComponents/EmployeeManagement.vue'
import ModernLayout from '../src/views/ModernLayout.vue'

// 這份測試掛的是真正的 Element Plus 與整個員工編輯視窗，機器忙的時候一個測試可能超過預設的 10 秒
vi.setConfig({ testTimeout: 60000, hookTimeout: 30000 })

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) await tick()
}

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

// 一個很小的假伺服器：員工名單、單一員工、照片、儲存（JSON 與 multipart）都照真實伺服器的格式回應
let server
let apiFetchMock
let blobCounter
let revokedUrls

function baseEmployee(overrides = {}) {
  return {
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
    status: '正職員工',
    accountEnabled: true,
    authVersion: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    isPartTime: true,
    isClocking: false,
    photo: '',
    ...overrides,
  }
}

function resetServer() {
  server = {
    employees: [
      baseEmployee(),
      baseEmployee({ _id: 'e2', name: '李小華', employeeId: 'E002', username: 'lee', photo: '/upload/employees/employee_old.png' }),
    ],
    photoFiles: { 'employee_old.png': 'image/png' },
    saves: [],
    photoRequests: [],
    saveStatus: 200,
    saveBody: null,
    photoCount: 0,
  }
}

const copy = value => JSON.parse(JSON.stringify(value))

function installServer() {
  apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url, options = {}) => {
    const [path, query = ''] = String(url).split('?')
    const method = options.method || 'GET'

    const photoMatch = path.match(/^\/api\/employees\/([^/]+)\/photo$/)
    if (photoMatch && method === 'GET') {
      server.photoRequests.push({ id: photoMatch[1], query })
      const employee = server.employees.find(item => item._id === photoMatch[1])
      const name = employee?.photo?.split('/').pop()
      const type = server.photoFiles[name]
      if (!type) return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      return { ok: true, status: 200, blob: async () => ({ type, size: 8, name }) }
    }

    if (path === '/api/employees' && method === 'GET') {
      const role = new URLSearchParams(query).get('role')
      const employees = role ? server.employees.filter(item => item.role === role) : server.employees
      return ok({
        employees: copy(employees),
        pagination: { total: employees.length, page: 1, pageSize: 20, totalPages: 1 },
      })
    }

    const employeeMatch = path.match(/^\/api\/employees\/([^/]+)$/)
    if (employeeMatch && method === 'GET') {
      const employee = server.employees.find(item => item._id === employeeMatch[1])
      return employee ? ok(copy(employee)) : ok({ error: 'Not found' }, 404)
    }
    if (employeeMatch && method === 'PUT') {
      const record = { id: employeeMatch[1], body: options.body, headers: options.headers || {} }
      server.saves.push(record)
      if (server.saveStatus >= 400) return ok(server.saveBody ?? { error: 'Invalid account state' }, server.saveStatus)
      const employee = server.employees.find(item => item._id === employeeMatch[1])
      let data = {}
      if (typeof options.body === 'string') data = JSON.parse(options.body)
      else {
        data = JSON.parse(options.body.get('data') || '{}')
        const file = options.body.get('photo')
        if (file) {
          server.photoCount += 1
          const name = `employee_new${server.photoCount}.${file.type === 'image/jpeg' ? 'jpg' : 'png'}`
          server.photoFiles[name] = file.type
          data.photo = `/upload/employees/${name}`
        }
      }
      Object.assign(employee, data)
      return ok(copy(employee))
    }

    if (path === '/api/employees' && method === 'POST') {
      server.saves.push({ id: null, body: options.body, headers: options.headers || {}, method })
      if (server.saveStatus >= 400) return ok(server.saveBody ?? { error: 'Invalid account state' }, server.saveStatus)
      let data = {}
      if (typeof options.body === 'string') data = JSON.parse(options.body)
      else {
        data = JSON.parse(options.body.get('data') || '{}')
        const file = options.body.get('photo')
        if (file) {
          server.photoCount += 1
          const name = `employee_new${server.photoCount}.png`
          server.photoFiles[name] = file.type
          data.photo = `/upload/employees/${name}`
        }
      }
      const created = baseEmployee({ ...data, _id: 'e9', photo: data.photo || '' })
      server.employees.push(created)
      return ok(copy(created), 201)
    }

    if (path === '/api/profile') {
      const employee = server.employees.find(item => item._id === 'e1')
      return ok({ id: employee._id, employeeId: employee._id, name: employee.name, photo: employee.photo || '' })
    }
    if (path === '/api/employees/sign-tags') return ok({ tags: [] })
    if (path === '/api/other-control-settings/item-settings') return ok({ itemSettings: {} })
    return ok([])
  })
}

let pinia
let wrapper
let management
let layout

// EmployeeManagement 的根是 el-tab-pane，必須放在 el-tabs 裡面
async function mountManagement() {
  const Host = { render: () => h(ElTabs, { modelValue: 'employeeMgmt' }, () => [h(EmployeeManagement)]) }
  wrapper = mount(Host, { global: { plugins: [ElementPlus, pinia] }, attachTo: document.body })
  management = wrapper.findComponent(EmployeeManagement)
  await flush()
  // el-form 的欄位驗證不是這份測試要驗的重點（別的測試已涵蓋），這裡一律視為通過
  management.vm.formRef = { validate: vi.fn(() => Promise.resolve(true)), clearValidate: vi.fn() }
  return management
}

const rowAvatar = employeeName => {
  const row = wrapper.findAll('.employee-info').find(item => item.text().includes(employeeName))
  return row?.find('.employee-avatar')
}

function chooseFile(file) {
  const input = wrapper.find('.employee-photo-upload input[type="file"]')
  expect(input.exists()).toBe(true)
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  return input.trigger('change')
}

const pngFile = (name = 'new.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })

beforeEach(() => {
  resetServer()
  blobCounter = 0
  revokedUrls = []
  messageMock.success.mockClear()
  messageMock.error.mockClear()
  messageMock.warning.mockClear()
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      blobCounter += 1
      return `blob:test-${blobCounter}`
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(url => {
      revokedUrls.push(url)
    }),
  })
  pinia = createPinia()
  setActivePinia(pinia)
  clearEmployeePhotoCache()
  installServer()
})

afterEach(() => {
  layout?.unmount()
  layout = null
  wrapper?.unmount()
  wrapper = null
  apiFetchMock.mockRestore()
  clearEmployeePhotoCache()
})

describe('人資管理：員工清單的頭像', () => {
  it('有照片的員工在清單裡顯示照片，沒有照片的顯示姓名第一個字', async () => {
    await mountManagement()

    const withPhoto = rowAvatar('李小華')
    const withoutPhoto = rowAvatar('王大明')
    expect(withPhoto.find('img').exists()).toBe(true)
    expect(withPhoto.find('img').attributes('src')).toMatch(/^blob:test-/)
    expect(withoutPhoto.find('img').exists()).toBe(false)
    expect(withoutPhoto.text()).toBe('王')
    // 只替有照片的員工發請求，網址帶著照片檔名當版本；清單的頭像 40px，向伺服器要 96px 的縮圖
    expect(server.photoRequests).toEqual([{ id: 'e2', query: 'v=employee_old.png&size=96' }])
  })
})

describe('人資管理：編輯員工上傳照片（真正的 el-upload，一個 multipart 請求）', () => {
  it('替沒有照片的員工選檔、按儲存：一次送出 data + photo，型別不變，清單立刻出現照片', async () => {
    await mountManagement()
    await management.vm.openEmployeeDialog('e1')
    await flush()

    await chooseFile(pngFile())
    await flush()
    expect(management.vm.employeeForm.photoList).toHaveLength(1)
    expect(management.vm.employeeForm.photoList[0].raw).toBeInstanceOf(File)

    await management.vm.saveEmployee()
    await flush()

    expect(server.saves).toHaveLength(1)
    const { body, headers } = server.saves[0]
    expect(body).toBeInstanceOf(FormData)
    // 不能自己設 Content-Type，瀏覽器才會補上 boundary
    expect(headers['Content-Type']).toBeUndefined()
    expect([...body.keys()]).toEqual(['data', 'photo'])
    expect(body.get('photo')).toBeInstanceOf(File)

    const data = JSON.parse(body.get('data'))
    // 布林值與數字保持原本的型別（以前每個欄位各自 append，變成 'true' / 'false' 字串）
    expect(data.isPartTime).toBe(true)
    expect(data.isClocking).toBe(false)
    expect(data.name).toBe('王大明')
    // 伺服器自己管理的欄位不回寫（accountEnabled 以前會變成 'true' 字串被伺服器拒絕）
    ;['_id', 'id', '__v', 'createdAt', 'updatedAt', 'authVersion', 'accountEnabled', 'photo', 'photoList'].forEach(key => {
      expect(data).not.toHaveProperty(key)
    })

    expect(messageMock.success).toHaveBeenCalledWith('儲存成功')
    expect(messageMock.error).not.toHaveBeenCalled()
    expect(management.vm.employeeDialogVisible).toBe(false)

    const avatar = rowAvatar('王大明')
    expect(avatar.find('img').exists()).toBe(true)
    expect(avatar.find('img').attributes('src')).toMatch(/^blob:test-/)
    expect(server.photoRequests.at(-1)).toEqual({ id: 'e1', query: 'v=employee_new1.png&size=96' })
  })

  it('選一張手機拍的大照片：送出的 photo 是縮到長邊 640px 的 JPEG，不是原檔', async () => {
    await mountManagement()
    await management.vm.openEmployeeDialog('e1')
    await flush()

    // jsdom 沒有影像解碼與 canvas：換成假的，檢查元件真的把縮小後的檔案送出去
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4032, height: 3024, close })))
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => ({ fillRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(), fillStyle: '' }))
    let canvasSize = null
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlobMock(callback, type) {
      canvasSize = [this.width, this.height]
      callback(new Blob([new Uint8Array(60 * 1024)], { type }))
    })
    try {
      const original = new File([new Uint8Array(3 * 1024 * 1024)], 'IMG_0001.jpeg', { type: 'image/jpeg' })
      await chooseFile(original)
      await flush()
      expect(canvasSize).toEqual([640, 480])
      expect(close).toHaveBeenCalled()

      await management.vm.saveEmployee()
      await flush()

      const photo = server.saves[0].body.get('photo')
      expect(photo).toBeInstanceOf(File)
      expect(photo).not.toBe(original)
      expect(photo.type).toBe('image/jpeg')
      expect(photo.name).toBe('IMG_0001.jpg')
      expect(photo.size).toBe(60 * 1024)
    } finally {
      getContext.mockRestore()
      toBlob.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('新增員工同時上傳照片：POST 一個 multipart 請求（兼職開關關著就是 false），新員工的頭像立刻出現', async () => {
    await mountManagement()
    await management.vm.openEmployeeDialog()
    await flush()
    Object.assign(management.vm.employeeForm, {
      name: '新同事',
      employeeNo: 'E099',
      username: 'newbie',
      email: 'new@example.com',
      isPartTime: false,
      isClocking: true,
    })
    await chooseFile(pngFile('hello.png'))
    await flush()

    await management.vm.saveEmployee()
    await flush()

    expect(server.saves).toHaveLength(1)
    const { body, method } = server.saves[0]
    expect(method).toBe('POST')
    expect([...body.keys()]).toEqual(['data', 'photo'])
    const data = JSON.parse(body.get('data'))
    // 以前 FormData 把 false 變成 'false' 字串，伺服器 Boolean('false') 是 true，新員工被存成兼職
    expect(data.isPartTime).toBe(false)
    expect(data.isClocking).toBe(true)
    expect(data.name).toBe('新同事')
    expect(messageMock.success).toHaveBeenCalledWith('儲存成功')

    const avatar = rowAvatar('新同事')
    expect(avatar.find('img').exists()).toBe(true)
    expect(server.photoRequests.at(-1)).toEqual({ id: 'e9', query: 'v=employee_new1.png&size=96' })
  })

  it('欄位再多也只有 data 與 photo 兩個 multipart 欄位（不會超過伺服器的欄位數上限）', async () => {
    server.employees[0].licenses = Array.from({ length: 40 }, (_, index) => ({ name: `證照${index}`, number: String(index) }))
    server.employees[0].medicalCheck = { height: 170, weight: 60 }
    await mountManagement()
    await management.vm.openEmployeeDialog('e1')
    await flush()
    await chooseFile(pngFile())
    await flush()
    await management.vm.saveEmployee()
    await flush()

    const { body } = server.saves[0]
    expect([...body.keys()]).toEqual(['data', 'photo'])
    expect(JSON.parse(body.get('data')).licenses.length).toBe(40)
  })

  it('已經有照片時再選一張：直接換成新的（以前只跳出「僅能上傳一張照片」，儲存後什麼都沒變）', async () => {
    await mountManagement()
    const oldSrc = rowAvatar('李小華').find('img').attributes('src')
    await management.vm.openEmployeeDialog('e2')
    await flush()
    expect(management.vm.employeeForm.photoList).toHaveLength(1)
    expect(management.vm.employeeForm.photoList[0].raw).toBeUndefined()
    // 編輯視窗的縮圖卡片約 148px：向伺服器要 384px 的縮圖，不下載原檔；這份只用來顯示，不是待上傳的檔案
    expect(server.photoRequests).toContainEqual({ id: 'e2', query: 'v=employee_old.png&size=384' })

    await chooseFile(pngFile('replacement.png'))
    await flush()

    expect(messageMock.warning).not.toHaveBeenCalledWith('僅能上傳一張照片')
    expect(management.vm.employeeForm.photoList).toHaveLength(1)
    expect(management.vm.employeeForm.photoList[0].raw).toBeInstanceOf(File)
    expect(management.vm.employeeForm.photoList[0].raw.name).toBe('replacement.png')

    await management.vm.saveEmployee()
    await flush()

    expect(server.saves).toHaveLength(1)
    expect(server.saves[0].body).toBeInstanceOf(FormData)
    expect(server.saves[0].body.get('photo').name).toBe('replacement.png')
    const newSrc = rowAvatar('李小華').find('img').attributes('src')
    expect(newSrc).toMatch(/^blob:test-/)
    expect(newSrc).not.toBe(oldSrc)
    // 舊照片沒有人在用了，已經回收
    expect(revokedUrls).toContain(oldSrc)
    expect(server.photoRequests.at(-1)).toEqual({ id: 'e2', query: 'v=employee_new1.png&size=96' })
  })

  it('沒有選新照片只改別的欄位：照舊用 JSON 儲存，原本的照片路徑保留', async () => {
    await mountManagement()
    await management.vm.openEmployeeDialog('e2')
    await flush()
    management.vm.employeeForm.name = '李小華（改）'
    await management.vm.saveEmployee()
    await flush()

    expect(server.saves).toHaveLength(1)
    expect(typeof server.saves[0].body).toBe('string')
    expect(server.saves[0].headers['Content-Type']).toBe('application/json')
    const data = JSON.parse(server.saves[0].body)
    expect(data.photo).toBe('/upload/employees/employee_old.png')
    expect(data).not.toHaveProperty('accountEnabled')
    expect(rowAvatar('李小華（改）').find('img').exists()).toBe(true)
  })

  it('移除照片再儲存：送出空的 photo，清單改回字母頭像', async () => {
    await mountManagement()
    await management.vm.openEmployeeDialog('e2')
    await flush()

    const removeButton = wrapper.find('.employee-photo-upload .el-upload-list__item-delete')
    expect(removeButton.exists()).toBe(true)
    await removeButton.trigger('click')
    await flush()
    expect(management.vm.employeeForm.photoList).toHaveLength(0)

    await management.vm.saveEmployee()
    await flush()

    expect(JSON.parse(server.saves[0].body).photo).toBe('')
    const avatar = rowAvatar('李小華')
    expect(avatar.find('img').exists()).toBe(false)
    expect(avatar.text()).toBe('李')
  })

  it('編輯視窗的縮圖用已登入的方式載入照片，不會用被擋下的 /upload/employees 網址', async () => {
    await mountManagement()
    await management.vm.openEmployeeDialog('e2')
    await flush()

    const thumbnails = wrapper.findAll('.employee-photo-upload img').map(img => img.attributes('src'))
    expect(thumbnails.length).toBeGreaterThan(0)
    thumbnails.forEach(src => {
      expect(src).not.toContain('/upload/employees/')
    })
    expect(thumbnails.some(src => src.startsWith('blob:test-'))).toBe(true)
  })

  it('選了不支援的格式或太大的檔案：馬上說明原因，不會放進縮圖', async () => {
    await mountManagement()
    await management.vm.openEmployeeDialog('e1')
    await flush()

    await chooseFile(new File(['x'], 'IMG_0001.heic', { type: 'image/heic' }))
    await flush()
    expect(messageMock.warning).toHaveBeenLastCalledWith('不支援的圖片格式，僅支援 JPEG、PNG、GIF、WebP')
    expect(management.vm.employeeForm.photoList).toHaveLength(0)

    await chooseFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.gif', { type: 'image/gif' }))
    await flush()
    expect(messageMock.warning).toHaveBeenLastCalledWith('圖片檔案過大，最大 5MB')
    expect(management.vm.employeeForm.photoList).toHaveLength(0)
    expect(server.saves).toHaveLength(0)
  })
})

describe('人資管理：儲存失敗時一定有說明', () => {
  async function openWithPhoto() {
    await mountManagement()
    await management.vm.openEmployeeDialog('e1')
    await flush()
    await chooseFile(pngFile())
    await flush()
  }

  it('伺服器回中文原因就原樣顯示，視窗保持開啟、照片還在', async () => {
    server.saveStatus = 400
    server.saveBody = { error: '圖片檔案過大，最大 5MB' }
    await openWithPhoto()
    await management.vm.saveEmployee()
    await flush()

    expect(messageMock.error).toHaveBeenCalledWith('圖片檔案過大，最大 5MB')
    expect(messageMock.success).not.toHaveBeenCalled()
    expect(management.vm.employeeDialogVisible).toBe(true)
    expect(management.vm.employeeForm.photoList).toHaveLength(1)
  })

  it('英文錯誤也要讓使用者看到（已知的對照成中文），不再一律是「儲存失敗」', async () => {
    server.saveStatus = 400
    server.saveBody = { error: 'Too many fields' }
    await openWithPhoto()
    await management.vm.saveEmployee()
    await flush()
    expect(messageMock.error).toHaveBeenLastCalledWith('送出的欄位過多，請聯絡系統管理員')

    server.saveBody = { error: 'Internal server error', requestId: 'req-123' }
    server.saveStatus = 500
    await management.vm.saveEmployee()
    await flush()
    expect(messageMock.error).toHaveBeenLastCalledWith('伺服器發生錯誤，請稍後再試或聯絡系統管理員（錯誤代碼 req-123）')
  })

  it('連線中斷（沒有回應）：顯示網路錯誤，視窗保持開啟，可以再按一次', async () => {
    await openWithPhoto()
    const original = apiFetchMock.getMockImplementation()
    apiFetchMock.mockImplementation(async (url, options = {}) => {
      if (options.method === 'PUT') throw new TypeError('Failed to fetch')
      return original(url, options)
    })
    await management.vm.saveEmployee()
    await flush()

    expect(messageMock.error).toHaveBeenCalledWith('儲存失敗，請檢查網路後再試')
    expect(management.vm.employeeDialogVisible).toBe(true)
    expect(management.vm.employeeSaving).toBe(false)

    apiFetchMock.mockImplementation(original)
    await management.vm.saveEmployee()
    await flush()
    expect(messageMock.success).toHaveBeenCalledWith('儲存成功')
  })

  it('儲存中再按一次不會重複送出', async () => {
    await openWithPhoto()
    await Promise.all([management.vm.saveEmployee(), management.vm.saveEmployee(), management.vm.saveEmployee()])
    await flush()
    expect(server.saves).toHaveLength(1)
  })
})

describe('標題列的頭像：自己的照片換了馬上更新', () => {
  async function mountHeader() {
    localStorage.setItem('employeeId', 'e1')
    sessionStorage.setItem('employeeId', 'e1')
    layout = mount(ModernLayout, {
      global: {
        plugins: [ElementPlus, pinia],
        stubs: { 'router-view': { template: '<div />' } },
      },
    })
    await flush()
  }

  it('管理員在人資管理替自己換照片，後台標題列的頭像跟著換，不用重新整理', async () => {
    server.employees[0].photo = '/upload/employees/employee_old.png'
    await mountHeader()
    const header = () => layout.find('[data-test="header-user"] img')
    expect(header().exists()).toBe(true)
    const before = header().attributes('src')

    await mountManagement()
    await management.vm.openEmployeeDialog('e1')
    await flush()
    await chooseFile(pngFile('mine.png'))
    await flush()
    await management.vm.saveEmployee()
    await flush()

    expect(header().exists()).toBe(true)
    expect(header().attributes('src')).not.toBe(before)
    expect(revokedUrls).toContain(before)
  })

  it('改的是別人的照片：標題列的頭像不動、不重新讀個人資料', async () => {
    await mountHeader()
    await mountManagement()
    const profileCalls = () => apiFetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/profile')).length
    const before = profileCalls()

    await management.vm.openEmployeeDialog('e2')
    await flush()
    await chooseFile(pngFile('other.png'))
    await flush()
    await management.vm.saveEmployee()
    await flush()

    expect(profileCalls()).toBe(before)
  })

  it('管理員第一次上傳自己的照片：標題列從字母變成照片', async () => {
    await mountHeader()
    expect(layout.find('[data-test="header-user"] img').exists()).toBe(false)
    expect(layout.find('[data-test="header-user"]').text()).toContain('王')

    await mountManagement()
    await management.vm.openEmployeeDialog('e1')
    await flush()
    await chooseFile(pngFile('first.png'))
    await flush()
    await management.vm.saveEmployee()
    await flush()

    expect(layout.find('[data-test="header-user"] img').exists()).toBe(true)
  })
})

describe('人資管理：直屬主管下拉選單的頭像', () => {
  it('選項旁有主管的頭像：有照片顯示照片，沒有顯示字母', async () => {
    server.employees.push(
      baseEmployee({ _id: 's1', name: '林主任', employeeId: 'S001', username: 'lin', role: 'supervisor', photo: '/upload/employees/employee_old.png' }),
      baseEmployee({ _id: 's2', name: '陳組長', employeeId: 'S002', username: 'chen', role: 'supervisor', photo: '' }),
    )
    await mountManagement()
    await management.vm.openEmployeeDialog('e1')
    await flush()
    await management.vm.fetchSupervisorCandidates()
    await flush()

    const options = [...document.body.querySelectorAll('.supervisor-option')]
    expect(options.map(option => option.lastElementChild.textContent.trim())).toEqual(['林主任（S001）', '陳組長（S002）'])
    expect(options[0].querySelector('img')?.getAttribute('src')).toMatch(/^blob:test-/)
    expect(options[1].querySelector('img')).toBeNull()
    expect(options[1].querySelector('.el-avatar').textContent.trim()).toBe('陳')
  })
})
