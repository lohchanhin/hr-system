import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  backOfficeMenuItems,
  beginSession,
  endSession,
  frontMenuItems,
  getAuthenticatedHomeRoute,
  isChangePasswordMenuName,
  isFrontMenuName,
  loginFailureMessage,
  signIn
} from '../src/utils/authNavigation'
import { useMenuStore } from '../src/stores/menu'
import { useProfileStore } from '../src/stores/profile'

function createToken(payload = {}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload })}.sig`
}

const adminMenu = () => [
  { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
  { name: 'HRManagementSystemSetting', label: '人資管理', icon: 'el-icon-user-solid' },
  { name: 'DepartmentReports', label: '報表查看', icon: 'el-icon-data-analysis' },
  { name: 'ManagerChangePassword', label: '變更密碼', icon: 'el-icon-lock' }
]

const supervisorMenu = () => [
  { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
  { name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' },
  { name: 'FrontDepartmentReports', label: '部門報表', icon: 'el-icon-data-analysis' },
  { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' },
  { name: 'FrontChangePassword', label: '變更密碼', icon: 'el-icon-lock' }
]

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

// 管理員打開前台頁面時，員工系統的外框裡不能出現後台選單；兩邊用同一份選單各取自己的部分
describe('前台／後台選單', () => {
  it('前台頁面的名稱', () => {
    expect(isFrontMenuName('Attendance')).toBe(true)
    expect(isFrontMenuName('FrontDepartmentReports')).toBe(true)
    expect(isFrontMenuName('DepartmentReports')).toBe(false)
    expect(isFrontMenuName('AttendanceSetting')).toBe(false)
    expect(isFrontMenuName(undefined)).toBe(false)
  })

  it('主管、員工的選單全部是前台頁面，後台是空的', () => {
    expect(frontMenuItems(supervisorMenu(), 'supervisor').map(item => item.name)).toEqual([
      'Attendance', 'Schedule', 'FrontDepartmentReports', 'Approval', 'FrontChangePassword'
    ])
    expect(backOfficeMenuItems(supervisorMenu())).toEqual([])
  })

  it('管理員的選單全部是後台頁面；前台補上管理員能用的頁面', () => {
    expect(backOfficeMenuItems(adminMenu()).map(item => item.name)).toEqual([
      'AttendanceSetting', 'HRManagementSystemSetting', 'DepartmentReports', 'ManagerChangePassword'
    ])
    expect(frontMenuItems(adminMenu(), 'admin').map(item => item.name)).toEqual([
      'Attendance', 'Schedule', 'Approval', 'FrontChangePassword'
    ])
  })

  it('管理員的選單還沒讀到時也有前台頁面可以點', () => {
    expect(frontMenuItems([], 'admin').map(item => item.name)).toEqual([
      'Attendance', 'Schedule', 'Approval', 'FrontChangePassword'
    ])
  })

  it('不是管理員就不補：選單沒有前台頁面時是空的', () => {
    expect(frontMenuItems(adminMenu(), 'employee')).toEqual([])
    expect(frontMenuItems([], 'supervisor')).toEqual([])
  })

  it('伺服器有給管理員前台頁面時以伺服器為準', () => {
    const menu = [...adminMenu(), { name: 'Approval', label: '簽核', icon: 'el-icon-s-operation' }]
    expect(frontMenuItems(menu, 'admin')).toEqual([{ name: 'Approval', label: '簽核', icon: 'el-icon-s-operation' }])
  })

  it('伺服器回了 frontItems（/api/menu?include=front）就用它，不再用前端寫死的管理員清單', () => {
    const serverFront = [
      { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' },
      { name: 'Settings', label: '不是前台頁面' }
    ]
    expect(frontMenuItems(adminMenu(), 'admin', serverFront).map(item => item.name)).toEqual(['Attendance', 'Approval'])
    expect(frontMenuItems(adminMenu(), 'admin', [])).toEqual([])
    // 舊版伺服器（frontItems 是 null）照舊補上管理員的前台頁面
    expect(frontMenuItems(adminMenu(), 'admin', null)).toHaveLength(4)
  })

  it('每次回傳新的陣列，改動不會影響下一次', () => {
    const first = frontMenuItems([], 'admin')
    first.pop()
    expect(frontMenuItems([], 'admin')).toHaveLength(4)
  })

  it('選單不是陣列或項目不完整時不出錯', () => {
    expect(frontMenuItems(null, 'employee')).toEqual([])
    expect(backOfficeMenuItems(undefined)).toEqual([])
    expect(backOfficeMenuItems([null, {}, { name: 'AttendanceSetting' }])).toEqual([{ name: 'AttendanceSetting' }])
  })

  it('變更密碼的選單項目', () => {
    expect(isChangePasswordMenuName('FrontChangePassword')).toBe(true)
    expect(isChangePasswordMenuName('ManagerChangePassword')).toBe(true)
    expect(isChangePasswordMenuName('Approval')).toBe(false)
  })
})

describe('登入失敗訊息', () => {
  it('帳密錯誤與帳號停用是同一句（伺服器不區分，畫面也不洩漏是哪一種）', () => {
    expect(loginFailureMessage(401, { error: 'Invalid credentials' })).toBe('帳號或密碼錯誤，或帳號已停用')
    expect(loginFailureMessage(401, null)).toBe('帳號或密碼錯誤，或帳號已停用')
  })

  it('次數過多時請使用者稍後再試', () => {
    expect(loginFailureMessage(429, { error: 'Too many login attempts. Please try again later.' })).toBe('登入失敗次數過多，請稍後再試')
  })

  it('伺服器錯誤不顯示英文原文', () => {
    expect(loginFailureMessage(500, { error: 'Unable to sign in' })).toBe('登入失敗，請稍後再試')
    expect(loginFailureMessage(undefined, undefined)).toBe('登入失敗，請稍後再試')
  })

  it('伺服器有給 message 時優先顯示', () => {
    expect(loginFailureMessage(401, { message: ' 帳號已鎖定 ' })).toBe('帳號已鎖定')
    expect(loginFailureMessage(401, { message: '   ' })).toBe('帳號或密碼錯誤，或帳號已停用')
  })
})

describe('beginSession', () => {
  it('存下 token、角色與員工 id，回傳該角色的首頁', () => {
    const token = createToken({ role: 'supervisor' })
    const destination = beginSession({
      token,
      user: { role: 'supervisor', employeeId: 's1', scheduleAccess: { canSchedule: true } }
    })
    expect(destination).toBe('/front/schedule')
    expect(localStorage.getItem('token')).toBe(token)
    expect(sessionStorage.getItem('role')).toBe('supervisor')
    expect(localStorage.getItem('role')).toBe('supervisor')
    expect(sessionStorage.getItem('employeeId')).toBe('s1')
    expect(localStorage.getItem('employeeId')).toBe('s1')
  })

  it('首頁與登入頁無關，只看角色與排班權限', () => {
    const user = (role, canSchedule) => ({ token: createToken(), user: { role, id: 'x', scheduleAccess: { canSchedule } } })
    expect(beginSession(user('employee', false))).toBe('/front/attendance')
    expect(beginSession(user('supervisor', false))).toBe('/front/attendance')
    expect(beginSession(user('supervisor', true))).toBe('/front/schedule')
    expect(beginSession(user('admin', true))).toBe('/manager/settings')
    expect(getAuthenticatedHomeRoute('admin')).toBe('/manager/settings')
  })

  it.each([
    ['沒有 token', { user: { role: 'employee', employeeId: 'e1' } }],
    ['不認得的角色', { token: 'x.y.z', user: { role: 'hr', employeeId: 'e1' } }],
    ['沒有員工 id', { token: 'x.y.z', user: { role: 'employee' } }],
    ['沒有 user', { token: 'x.y.z' }],
    ['空的回應', null]
  ])('回應不完整（%s）時回傳 null，不留下登入狀態', (_label, data) => {
    expect(beginSession(data)).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('role')).toBeNull()
    expect(localStorage.getItem('employeeId')).toBeNull()
  })

  it('換帳號登入時清掉上一個人的選單與個人資料', () => {
    const menuStore = useMenuStore()
    const profileStore = useProfileStore()
    menuStore.setMenu(supervisorMenu())
    profileStore.setProfile({ id: 'old', name: '上一位' })

    beginSession({ token: createToken(), user: { role: 'employee', employeeId: 'new' } })

    expect(menuStore.items).toEqual([])
    expect(profileStore.profile).toBeNull()
  })

  it('沒有 pinia（單獨掛載的元件）時也能建立登入狀態', () => {
    setActivePinia(undefined)
    expect(beginSession({ token: createToken(), user: { role: 'employee', employeeId: 'e1' } })).toBe('/front/attendance')
    expect(localStorage.getItem('employeeId')).toBe('e1')
  })
})

describe('endSession', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'tok')
    localStorage.setItem('role', 'employee')
    localStorage.setItem('employeeId', 'e1')
    localStorage.setItem('username', 'legacy')
    sessionStorage.setItem('role', 'employee')
    sessionStorage.setItem('employeeId', 'e1')
  })

  const expectSignedOut = () => {
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('token_expires')).toBeNull()
    expect(localStorage.getItem('role')).toBeNull()
    expect(localStorage.getItem('employeeId')).toBeNull()
    expect(localStorage.getItem('username')).toBeNull()
    expect(sessionStorage.getItem('role')).toBeNull()
    expect(sessionStorage.getItem('employeeId')).toBeNull()
  }

  // 以前登出只清本機，token 在到期前（1 小時）仍然有效
  it('先請伺服器作廢 token，再清掉本機登入狀態與快取', () => {
    fetch.mockResolvedValue({ ok: true, status: 204 })
    const menuStore = useMenuStore()
    const profileStore = useProfileStore()
    menuStore.setMenu(supervisorMenu())
    profileStore.setProfile({ id: 'e1', name: '某人' })

    endSession()

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toContain('/api/logout')
    expect(options).toMatchObject({ method: 'POST', keepalive: true, headers: { Authorization: 'Bearer tok' } })
    expectSignedOut()
    expect(menuStore.items).toEqual([])
    expect(profileStore.profile).toBeNull()
  })

  it('作廢請求失敗（斷線）或被拒絕（token 已過期）都照樣登出，不跳轉、不丟出錯誤', async () => {
    const originalHref = window.location.href
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(() => endSession()).not.toThrow()
    await Promise.resolve()
    expectSignedOut()

    localStorage.setItem('token', 'tok2')
    fetch.mockResolvedValueOnce({ ok: false, status: 401 })
    endSession()
    await Promise.resolve()
    await Promise.resolve()
    expectSignedOut()
    expect(window.location.href).toBe(originalHref)
  })

  it('fetch 同步丟出錯誤也照樣登出', () => {
    fetch.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => endSession()).not.toThrow()
    expectSignedOut()
  })

  it('變更密碼後伺服器已作廢 token：revokeToken: false 不打登出 API', () => {
    endSession({ revokeToken: false })
    expect(fetch).not.toHaveBeenCalled()
    expectSignedOut()
  })

  it('沒有 token（已過期被清掉）時不打登出 API', () => {
    localStorage.removeItem('token')
    endSession()
    expect(fetch).not.toHaveBeenCalled()
    expectSignedOut()
  })

  it('沒有 pinia（單獨掛載的元件）時也能登出', () => {
    fetch.mockResolvedValue({ ok: true, status: 204 })
    setActivePinia(undefined)
    expect(() => endSession()).not.toThrow()
    expectSignedOut()
  })
})

describe('signIn', () => {
  const okResponse = (user) => ({ ok: true, status: 200, json: async () => ({ token: createToken(), user }) })

  it('只送帳號與密碼，不送 role', async () => {
    fetch.mockResolvedValueOnce(okResponse({ role: 'employee', employeeId: 'e1' }))
    const result = await signIn('alice', 'secret')
    expect(result).toEqual({ destination: '/front/attendance' })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toContain('/api/login')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ username: 'alice', password: 'secret' })
    // 登入請求不帶舊的 Authorization，401 也不會被 apiFetch 自動跳轉
    expect(options.headers.Authorization).toBeUndefined()
  })

  it('失敗時回傳要顯示的訊息，不留下登入狀態', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'Invalid credentials' }) })
    const originalHref = window.location.href
    expect(await signIn('alice', 'wrong')).toEqual({ error: '帳號或密碼錯誤，或帳號已停用' })
    expect(localStorage.getItem('token')).toBeNull()
    expect(window.location.href).toBe(originalHref)
    // 正式流程不重送：一次失敗只算一次（同一帳號 15 分鐘內失敗 5 次會被暫時鎖住）
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('連不上伺服器時回傳連線訊息', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await signIn('alice', 'secret')).toEqual({ error: '無法連線到伺服器，請確認網路連線後再試' })
  })

  it('回應不完整時回傳錯誤', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user: { role: 'employee', employeeId: 'e1' } }) })
    expect(await signIn('alice', 'secret')).toEqual({ error: '登入過程中發生錯誤，請稍後再試' })
  })
})
