import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { nextTick } from 'vue'
import EmployeeAvatar from '../EmployeeAvatar.vue'
import { clearEmployeePhotoCache, invalidateEmployeePhoto } from '../../utils/photoUrl'

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))

vi.mock('../../api', () => ({
  API_BASE_URL: 'http://localhost:3000',
  apiFetch: apiFetchMock,
}))

const PHOTO = '/upload/employees/employee_aaa.png'
const NEW_PHOTO = '/upload/employees/employee_bbb.png'

let urlCounter = 0
let revokedUrls = []
let wrappers = []

const imageResponse = () => ({ ok: true, status: 200, blob: async () => ({ type: 'image/png', size: 4 }) })
const notFound = () => ({ ok: false, status: 404 })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await tick()
  await nextTick()
}

function mountAvatar(props = {}) {
  const wrapper = mount(EmployeeAvatar, { props, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  urlCounter = 0
  revokedUrls = []
  wrappers = []
  apiFetchMock.mockReset()
  localStorage.clear()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      urlCounter += 1
      return `blob:photo-${urlCounter}`
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(url => {
      revokedUrls.push(url)
    }),
  })
  clearEmployeePhotoCache()
  revokedUrls = []
})

afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  vi.unstubAllGlobals()
  clearEmployeePhotoCache()
})

describe('EmployeeAvatar 顯示', () => {
  it('伺服器回傳的員工物件有照片：下載後顯示圖片，帶姓名的說明文字', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: PHOTO } })
    await flush()

    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('blob:photo-1')
    expect(wrapper.attributes('role')).toBe('img')
    expect(wrapper.attributes('aria-label')).toBe('王小明的頭像')
    expect(img.attributes('alt')).toBe('王小明的頭像')
    // 預設頭像 32px：向伺服器要 96px 的縮圖（2 倍取檔位），不下載原檔
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/employees/e1/photo?v=employee_aaa.png&size=96',
      {},
      { autoRedirect: false },
    )
  })

  it('也接受 id 欄位與分開傳的 employee-id / name / photo', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const byId = mountAvatar({ employee: { id: 'e7', name: 'Amy', photo: PHOTO } })
    const byProps = mountAvatar({ employeeId: 'e8', name: 'Bob', photo: PHOTO })
    await flush()

    expect(byId.find('img').exists()).toBe(true)
    expect(byProps.find('img').exists()).toBe(true)
    expect(apiFetchMock.mock.calls.map(call => call[0]).sort()).toEqual([
      '/api/employees/e7/photo?v=employee_aaa.png&size=96',
      '/api/employees/e8/photo?v=employee_aaa.png&size=96',
    ])
  })

  it('沒有照片：顯示姓名第一個字，完全不發請求', async () => {
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: '' } })
    await flush()

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('王')
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('hasPhoto 為 false 就不下載；只知道 hasPhoto 為 true（沒有路徑）時照樣下載', async () => {
    const none = mountAvatar({ employee: { _id: 'e1', name: 'A', photo: PHOTO, hasPhoto: false } })
    await flush()
    expect(none.find('img').exists()).toBe(false)
    expect(apiFetchMock).not.toHaveBeenCalled()

    apiFetchMock.mockResolvedValue(imageResponse())
    const flagged = mountAvatar({ employee: { _id: 'e2', name: 'B', hasPhoto: true } })
    await flush()
    expect(flagged.find('img').exists()).toBe(true)
    // 不知道檔名（沒有版本可用）時每次先向伺服器確認，縮圖大小照樣帶上
    expect(apiFetchMock).toHaveBeenCalledWith('/api/employees/e2/photo?size=96', { cache: 'no-cache' }, { autoRedirect: false })
  })

  it('照片拿不到（沒權限 / 檔案不見）：維持姓名字母，不丟錯', async () => {
    apiFetchMock.mockResolvedValue(notFound())
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: 'Zed', photo: PHOTO } })
    await flush()

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('Z')
  })

  it('沒有任何資料也不會丟錯：顯示問號', async () => {
    const empty = mountAvatar()
    const blank = mountAvatar({ employee: { name: '   ' } })
    const odd = mountAvatar({ employee: { _id: 0, name: 123, photo: 5 } })
    await flush()

    expect(empty.text()).toBe('?')
    expect(blank.text()).toBe('?')
    expect(odd.text()).toBe('?')
    expect(empty.attributes('aria-label')).toBe('員工頭像')
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('字母頭像的底色由員工 id 決定：同一個人永遠同一種顏色', () => {
    const color = wrapper => wrapper.attributes('style').match(/--el-avatar-bg-color:\s*([^;]+)/)[1].trim()
    const a1 = color(mountAvatar({ employee: { _id: 'a', name: '甲' } }))
    const a2 = color(mountAvatar({ employee: { _id: 'a', name: '乙' } }))
    const b = color(mountAvatar({ employee: { _id: 'b', name: '甲' } }))
    expect(a1).toBe(a2)
    expect(a1).not.toBe(b)
  })

  it('size 與 shape 會傳給 el-avatar', () => {
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王' }, size: 40, shape: 'square' })
    expect(wrapper.classes()).toContain('el-avatar--square')
    expect(wrapper.attributes('style')).toContain('--el-avatar-size: 40px')
  })

  it('圖片載入失敗（檔案損毀）時改回字母頭像', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: PHOTO } })
    await flush()
    await wrapper.find('img').trigger('error')
    await flush()

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('王')
  })
})

describe('EmployeeAvatar 共用快取與重新整理', () => {
  it('同一位員工同時出現在很多地方，只下載一次；已經載過的頭像第一次 render 就有圖', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const employee = { _id: 'e1', name: '王小明', photo: PHOTO }
    const wrappersOfSame = [mountAvatar({ employee }), mountAvatar({ employee }), mountAvatar({ employee })]
    await flush()

    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    wrappersOfSame.forEach(wrapper => expect(wrapper.find('img').attributes('src')).toBe('blob:photo-1'))

    const later = mountAvatar({ employee })
    // 沒有等待也已經有圖（同步取快取）
    expect(later.find('img').attributes('src')).toBe('blob:photo-1')
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('照片被更換（作廢通知）：所有正在顯示這位員工的頭像自動換成新照片', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const employee = { _id: 'e1', name: '王小明', photo: PHOTO }
    const one = mountAvatar({ employee })
    const two = mountAvatar({ employee })
    const stranger = mountAvatar({ employee: { _id: 'e2', name: '李小華', photo: PHOTO } })
    await flush()
    expect(one.find('img').attributes('src')).toBe('blob:photo-1')
    const strangerSrc = stranger.find('img').attributes('src')

    invalidateEmployeePhoto('e1')
    await flush()

    expect(one.find('img').attributes('src')).toBe('blob:photo-3')
    expect(two.find('img').attributes('src')).toBe('blob:photo-3')
    expect(stranger.find('img').attributes('src')).toBe(strangerSrc)
    // 舊的那份沒有人在用了，已經回收
    expect(revokedUrls).toEqual(['blob:photo-1'])
  })

  it('員工物件的 photo 換了檔名（重新載入名單後）：改用新照片；被移除就回到字母', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: PHOTO } })
    await flush()
    expect(wrapper.find('img').attributes('src')).toBe('blob:photo-1')

    await wrapper.setProps({ employee: { _id: 'e1', name: '王小明', photo: NEW_PHOTO } })
    await flush()
    expect(wrapper.find('img').attributes('src')).toBe('blob:photo-2')
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/api/employees/e1/photo?v=employee_bbb.png&size=96',
      {},
      { autoRedirect: false },
    )

    await wrapper.setProps({ employee: { _id: 'e1', name: '王小明', photo: '' } })
    await flush()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('王')
  })

  it('換成另一位員工時不會留著上一位的照片', async () => {
    apiFetchMock.mockResolvedValueOnce(imageResponse())
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: PHOTO } })
    await flush()
    expect(wrapper.find('img').exists()).toBe(true)

    await wrapper.setProps({ employee: { _id: 'e2', name: '李小華', photo: '' } })
    await flush()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('李')
  })

  it('下載途中就被卸載：不會留下沒人回收的網址', async () => {
    let resolveFetch
    apiFetchMock.mockImplementation(() => new Promise(resolve => {
      resolveFetch = resolve
    }))
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: PHOTO } })
    await flush()
    wrapper.unmount()
    wrappers = wrappers.filter(item => item !== wrapper)

    resolveFetch(imageResponse())
    await flush()
    // 快取擁有這個網址，沒有任何畫面持有租約：登出 / 清空時一定會回收
    clearEmployeePhotoCache()
    expect(revokedUrls).toEqual(['blob:photo-1'])
  })

  it('卸載後放開租約：被取代的舊照片這時才回收', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: PHOTO } })
    await flush()
    invalidateEmployeePhoto('e1')
    // 還有畫面在用，先不回收
    expect(revokedUrls).toEqual([])

    await flush()
    wrapper.unmount()
    wrappers = wrappers.filter(item => item !== wrapper)
    expect(revokedUrls).toContain('blob:photo-1')
  })
})

describe('EmployeeAvatar 縮圖大小', () => {
  const photoRequests = () => apiFetchMock.mock.calls.map(call => call[0])

  it('向伺服器要頭像大小 2 倍的縮圖（取固定檔位）：20px 要 48，32px 與 40px 共用 96，64px 要 160', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    mountAvatar({ employee: { _id: 'a', name: 'A', photo: PHOTO }, size: 20 })
    mountAvatar({ employee: { _id: 'b', name: 'B', photo: PHOTO }, size: 24 })
    mountAvatar({ employee: { _id: 'c', name: 'C', photo: PHOTO }, size: 28 })
    mountAvatar({ employee: { _id: 'd', name: 'D', photo: PHOTO }, size: 40 })
    mountAvatar({ employee: { _id: 'e', name: 'E', photo: PHOTO }, size: 64 })
    mountAvatar({ employee: { _id: 'f', name: 'F', photo: PHOTO }, size: 'large' })
    mountAvatar({ employee: { _id: 'g', name: 'G', photo: PHOTO }, size: '24' })
    await flush()

    expect(photoRequests().sort()).toEqual([
      '/api/employees/a/photo?v=employee_aaa.png&size=48',
      '/api/employees/b/photo?v=employee_aaa.png&size=48',
      '/api/employees/c/photo?v=employee_aaa.png&size=96',
      '/api/employees/d/photo?v=employee_aaa.png&size=96',
      '/api/employees/e/photo?v=employee_aaa.png&size=160',
      '/api/employees/f/photo?v=employee_aaa.png&size=160',
      '/api/employees/g/photo?v=employee_aaa.png&size=48',
    ])
  })

  it('同一位員工的 32px 與 40px 頭像共用同一份縮圖：只下載一次，先載過的第二個頭像一掛上就有圖', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const employee = { _id: 'e1', name: '王小明', photo: PHOTO }
    const small = mountAvatar({ employee, size: 32 })
    await flush()
    const big = mountAvatar({ employee, size: 40 })

    expect(big.find('img').attributes('src')).toBe(small.find('img').attributes('src'))
    await flush()
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('同一位員工在不同檔位各抓一份（20px 與 64px），但換照片時兩份都換掉', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const employee = { _id: 'e1', name: '王小明', photo: PHOTO }
    const tiny = mountAvatar({ employee, size: 20 })
    const large = mountAvatar({ employee, size: 64 })
    await flush()
    expect(photoRequests().sort()).toEqual([
      '/api/employees/e1/photo?v=employee_aaa.png&size=160',
      '/api/employees/e1/photo?v=employee_aaa.png&size=48',
    ])

    invalidateEmployeePhoto('e1')
    await flush()
    expect(apiFetchMock).toHaveBeenCalledTimes(4)
    expect(tiny.find('img').exists()).toBe(true)
    expect(large.find('img').exists()).toBe(true)
  })

  it('頭像大小改變、檔位跟著變時重新取圖；檔位沒變就不重抓', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: PHOTO }, size: 32 })
    await flush()
    expect(apiFetchMock).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ size: 40 })
    await flush()
    expect(apiFetchMock).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ size: 64 })
    await flush()
    expect(apiFetchMock).toHaveBeenCalledTimes(2)
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/api/employees/e1/photo?v=employee_aaa.png&size=160',
      {},
      { autoRedirect: false },
    )
  })
})

describe('EmployeeAvatar 捲進畫面才下載', () => {
  let observers

  beforeEach(() => {
    observers = []
    class FakeIntersectionObserver {
      constructor(callback, options) {
        this.callback = callback
        this.options = options
        this.targets = []
        this.disconnected = false
        observers.push(this)
      }

      observe(target) {
        this.targets.push(target)
      }

      disconnect() {
        this.disconnected = true
      }

      show() {
        this.callback([{ isIntersecting: true, target: this.targets[0] }])
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  })

  it('還沒捲到的頭像不發請求，捲進畫面才下載，之後不再監看', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: PHOTO } })
    await flush()

    expect(observers).toHaveLength(1)
    expect(observers[0].targets).toHaveLength(1)
    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('img').exists()).toBe(false)

    observers[0].show()
    await flush()
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.find('img').attributes('src')).toBe('blob:photo-1')
    expect(observers[0].disconnected).toBe(true)
  })

  it('一整頁的頭像只有進入畫面的那幾個會發請求', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    for (let index = 0; index < 20; index += 1) {
      mountAvatar({ employee: { _id: `e${index}`, name: `員工${index}`, photo: PHOTO } })
    }
    await flush()
    expect(apiFetchMock).not.toHaveBeenCalled()

    observers.slice(0, 3).forEach(observer => observer.show())
    await flush()
    expect(apiFetchMock).toHaveBeenCalledTimes(3)
  })

  it('lazy 設為 false（標題列的頭像）一掛上就下載，不等捲動', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: PHOTO }, lazy: false })
    await flush()

    expect(observers).toHaveLength(0)
    expect(wrapper.find('img').exists()).toBe(true)
  })

  it('還沒捲到就被卸載：停止監看', async () => {
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: PHOTO } })
    await flush()
    wrapper.unmount()
    wrappers = wrappers.filter(item => item !== wrapper)

    expect(observers[0].disconnected).toBe(true)
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('沒有照片的頭像就算捲進畫面也不發請求', async () => {
    mountAvatar({ employee: { _id: 'e1', name: '王小明' } })
    await flush()
    observers.forEach(observer => observer.show())
    await flush()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('沒有照片的頭像不建立 observer：上千個選項的下拉選單不會有上千個監看', async () => {
    for (let index = 0; index < 50; index += 1) {
      mountAvatar({ employeeId: `e${index}`, name: `員工${index}`, photo: '' })
    }
    mountAvatar({ employee: { _id: 'x', name: 'X', hasPhoto: false, photo: PHOTO } })
    await flush()
    expect(observers).toHaveLength(0)
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('原本沒有照片、之後才有（上傳後名單重新載入）：這時才開始等捲進畫面再下載', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const wrapper = mountAvatar({ employee: { _id: 'e1', name: '王小明', photo: '' } })
    await flush()
    expect(observers).toHaveLength(0)

    await wrapper.setProps({ employee: { _id: 'e1', name: '王小明', photo: PHOTO } })
    await flush()
    expect(observers).toHaveLength(1)
    expect(apiFetchMock).not.toHaveBeenCalled()

    observers[0].show()
    await flush()
    expect(wrapper.find('img').exists()).toBe(true)
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })
})
