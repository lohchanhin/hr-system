import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  acquireCachedEmployeePhoto,
  acquireEmployeePhoto,
  clearEmployeePhotoCache,
  EMPLOYEE_PHOTO_MAX_BYTES,
  EMPLOYEE_PHOTO_SIZE_MESSAGE,
  EMPLOYEE_PHOTO_TYPE_MESSAGE,
  fetchEmployeePhotoUrl,
  invalidateEmployeePhoto,
  prepareEmployeePhotoFile,
  revokeEmployeePhotoUrl,
  subscribeEmployeePhoto,
  validateEmployeePhotoFile,
} from '../photoUrl'

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))

vi.mock('../../api', () => ({
  API_BASE_URL: 'http://localhost:3000',
  apiFetch: apiFetchMock,
}))

const PHOTO = '/upload/employees/employee_aaa.png'
const NEW_PHOTO = '/upload/employees/employee_bbb.png'

let urlCounter = 0
let createdUrls = []
let revokedUrls = []

// 假的圖片回應：blob 的 size 可以指定，方便測試記憶體上限
const imageResponse = (size = 4) => ({
  ok: true,
  status: 200,
  blob: async () => ({ type: 'image/png', size }),
})
const statusResponse = status => ({ ok: false, status })

// 手動控制的請求：先記下是哪些請求、什麼時候回應
function deferredFetch() {
  const pending = []
  apiFetchMock.mockImplementation((path, options, config) => new Promise(resolve => {
    pending.push({ path, options, config, resolve })
  }))
  return pending
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await tick()
}

beforeEach(() => {
  urlCounter = 0
  createdUrls = []
  revokedUrls = []
  apiFetchMock.mockReset()
  localStorage.clear()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      urlCounter += 1
      const url = `blob:photo-${urlCounter}`
      createdUrls.push(url)
      return url
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
  vi.useRealTimers()
  clearEmployeePhotoCache()
})

describe('員工照片快取：下載與去重', () => {
  it('同一位員工同一張照片同時要好幾次，只向伺服器下載一次，大家拿到同一個網址', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())

    const leases = await Promise.all([
      acquireEmployeePhoto('e1', PHOTO),
      acquireEmployeePhoto('e1', PHOTO),
      acquireEmployeePhoto('e1', PHOTO),
    ])

    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    expect(createdUrls).toHaveLength(1)
    expect(new Set(leases.map(lease => lease.url))).toEqual(new Set([createdUrls[0]]))
    leases.forEach(lease => lease.release())
  })

  it('已經快取的照片不會再下載；網址帶上檔名當版本，伺服器可以放心快取', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())

    const first = await acquireEmployeePhoto('e1', PHOTO)
    first.release()
    const second = await acquireEmployeePhoto('e1', PHOTO)

    expect(second.url).toBe(first.url)
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/employees/e1/photo?v=employee_aaa.png',
      {},
      { autoRedirect: false },
    )
    second.release()
  })

  it('照片換了檔名（版本不同）就是新的一份；沒有路徑只知道有照片時每次先向伺服器確認', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())

    const oldLease = await acquireEmployeePhoto('e1', PHOTO)
    const newLease = await acquireEmployeePhoto('e1', NEW_PHOTO)
    expect(newLease.url).not.toBe(oldLease.url)
    expect(apiFetchMock).toHaveBeenCalledTimes(2)

    await acquireEmployeePhoto('e2', '')
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/api/employees/e2/photo',
      { cache: 'no-cache' },
      { autoRedirect: false },
    )
    oldLease.release()
    newLease.release()
  })

  it('員工編號有特殊字元時會編碼；blob: 與 data: 網址直接使用、不發請求', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const lease = await acquireEmployeePhoto('a/b', PHOTO)
    expect(apiFetchMock.mock.calls[0][0]).toBe('/api/employees/a%2Fb/photo?v=employee_aaa.png')
    lease.release()

    apiFetchMock.mockClear()
    const direct = await acquireEmployeePhoto('e1', 'blob:local-preview')
    expect(direct.url).toBe('blob:local-preview')
    expect((await acquireEmployeePhoto('e1', 'data:image/png;base64,AAAA')).url).toBe('data:image/png;base64,AAAA')
    expect(acquireCachedEmployeePhoto('e1', 'blob:local-preview').url).toBe('blob:local-preview')
    expect(apiFetchMock).not.toHaveBeenCalled()
    direct.release()
  })

  it('沒有員工編號時回傳空的租約，不發請求、不丟錯', async () => {
    const lease = await acquireEmployeePhoto('', PHOTO)
    expect(lease.url).toBeNull()
    expect(() => lease.release()).not.toThrow()
    expect(acquireCachedEmployeePhoto(null, PHOTO)).toBeNull()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('acquireCachedEmployeePhoto 只看快取：沒載入過是 null，載入後同步拿得到', async () => {
    expect(acquireCachedEmployeePhoto('e1', PHOTO)).toBeNull()
    apiFetchMock.mockResolvedValue(imageResponse())
    const lease = await acquireEmployeePhoto('e1', PHOTO)
    const cached = acquireCachedEmployeePhoto('e1', PHOTO)
    expect(cached.url).toBe(lease.url)
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    cached.release()
    lease.release()
  })

  it('快取超過 10 分鐘的照片下次使用時重新向伺服器確認', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    apiFetchMock.mockResolvedValue(imageResponse())
    const first = await acquireEmployeePhoto('e1', PHOTO)
    first.release()

    vi.setSystemTime(new Date('2026-01-01T00:09:00Z'))
    const stillFresh = acquireCachedEmployeePhoto('e1', PHOTO)
    expect(stillFresh).not.toBeNull()
    stillFresh.release()

    vi.setSystemTime(new Date('2026-01-01T00:11:00Z'))
    expect(acquireCachedEmployeePhoto('e1', PHOTO)).toBeNull()
    const second = await acquireEmployeePhoto('e1', PHOTO)
    expect(apiFetchMock).toHaveBeenCalledTimes(2)
    expect(second.url).not.toBe(first.url)
    // 舊的那份沒有人在用，已經回收
    expect(revokedUrls).toContain(first.url)
    second.release()
  })
})

describe('員工照片快取：同時下載數量上限', () => {
  it('同時最多 6 個請求，其餘排隊，前面完成後才會繼續', async () => {
    const pending = deferredFetch()

    const loads = Array.from({ length: 10 }, (_, index) => acquireEmployeePhoto(`e${index}`, `/upload/employees/p${index}.png`))
    await flush()
    expect(pending).toHaveLength(6)

    pending[0].resolve(imageResponse())
    pending[1].resolve(imageResponse())
    await flush()
    expect(pending).toHaveLength(8)

    pending.slice(2).forEach(job => job.resolve(imageResponse()))
    await flush()
    pending.slice(8).forEach(job => job.resolve(imageResponse()))
    const leases = await Promise.all(loads)

    expect(pending).toHaveLength(10)
    expect(leases.every(lease => lease.url)).toBe(true)
    leases.forEach(lease => lease.release())
  })
})

describe('員工照片快取：找不到的照片（負向快取）', () => {
  it('404 之後 60 秒內不再重試，過了才再問一次', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    apiFetchMock.mockResolvedValue(statusResponse(404))

    const first = await acquireEmployeePhoto('e1', PHOTO)
    expect(first.url).toBeNull()
    expect(() => first.release()).not.toThrow()

    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'))
    expect((await acquireEmployeePhoto('e1', PHOTO)).url).toBeNull()
    expect(apiFetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-01-01T00:01:05Z'))
    apiFetchMock.mockResolvedValue(imageResponse())
    const later = await acquireEmployeePhoto('e1', PHOTO)
    expect(apiFetchMock).toHaveBeenCalledTimes(2)
    expect(later.url).toBe(createdUrls[0])
    later.release()
  })

  it('連線失敗、429、5xx 只擋 5 秒；回來的不是圖片也當成沒有照片', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    apiFetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await acquireEmployeePhoto('e1', PHOTO)).url).toBeNull()
    expect((await acquireEmployeePhoto('e1', PHOTO)).url).toBeNull()
    expect(apiFetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-01-01T00:00:06Z'))
    apiFetchMock.mockResolvedValue(statusResponse(429))
    expect((await acquireEmployeePhoto('e1', PHOTO)).url).toBeNull()
    expect(apiFetchMock).toHaveBeenCalledTimes(2)

    vi.setSystemTime(new Date('2026-01-01T00:00:12Z'))
    apiFetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => ({ type: 'text/html', size: 3 }) })
    expect((await acquireEmployeePhoto('e1', PHOTO)).url).toBeNull()
    expect(createdUrls).toHaveLength(0)
  })

  it('負向快取是依「員工 + 照片版本」記的：換了照片檔名會重新問', async () => {
    apiFetchMock.mockResolvedValueOnce(statusResponse(404))
    expect((await acquireEmployeePhoto('e1', PHOTO)).url).toBeNull()

    apiFetchMock.mockResolvedValueOnce(imageResponse())
    const lease = await acquireEmployeePhoto('e1', NEW_PHOTO)
    expect(lease.url).toBe(createdUrls[0])
    expect(apiFetchMock).toHaveBeenCalledTimes(2)
    lease.release()
  })
})

describe('員工照片快取：網址的回收', () => {
  it('還有畫面在用的照片被取代時不回收，最後一個使用者放開才回收', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const a = await acquireEmployeePhoto('e1', PHOTO)
    const b = await acquireEmployeePhoto('e1', PHOTO)

    invalidateEmployeePhoto('e1')
    expect(revokedUrls).not.toContain(a.url)

    a.release()
    expect(revokedUrls).not.toContain(a.url)
    b.release()
    expect(revokedUrls).toEqual([a.url])
    // 重複放開不會出錯、也不會重複回收
    b.release()
    expect(revokedUrls).toEqual([a.url])
  })

  it('沒有人在用的照片，作廢時立刻回收；之後再要會重新下載', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const first = await acquireEmployeePhoto('e1', PHOTO)
    first.release()

    invalidateEmployeePhoto('e1')
    expect(revokedUrls).toEqual([first.url])
    expect(acquireCachedEmployeePhoto('e1', PHOTO)).toBeNull()

    const second = await acquireEmployeePhoto('e1', PHOTO)
    expect(apiFetchMock).toHaveBeenCalledTimes(2)
    expect(second.url).not.toBe(first.url)
    second.release()
  })

  it('作廢只影響那一位員工，也會清掉他的負向快取', async () => {
    apiFetchMock.mockResolvedValueOnce(imageResponse())
    const other = await acquireEmployeePhoto('e2', PHOTO)
    other.release()
    apiFetchMock.mockResolvedValueOnce(statusResponse(404))
    expect((await acquireEmployeePhoto('e1', PHOTO)).url).toBeNull()

    invalidateEmployeePhoto('e1')
    expect(revokedUrls).toEqual([])
    expect(acquireCachedEmployeePhoto('e2', PHOTO)).not.toBeNull()

    apiFetchMock.mockResolvedValueOnce(imageResponse())
    const fresh = await acquireEmployeePhoto('e1', PHOTO)
    expect(fresh.url).toBeTruthy()
    fresh.release()
  })

  it('超過 300 張時，從最久沒用的開始回收；正在顯示的不回收', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const inUse = await acquireEmployeePhoto('keep', PHOTO)
    for (let index = 0; index < 305; index += 1) {
      const lease = await acquireEmployeePhoto(`e${index}`, PHOTO)
      lease.release()
    }

    expect(revokedUrls).not.toContain(inUse.url)
    expect(acquireCachedEmployeePhoto('keep', PHOTO)).not.toBeNull()
    // 最早放開的那幾張已被回收，最近的還在
    expect(acquireCachedEmployeePhoto('e0', PHOTO)).toBeNull()
    expect(acquireCachedEmployeePhoto('e304', PHOTO)).not.toBeNull()
    expect(revokedUrls.length).toBeGreaterThanOrEqual(5)
    inUse.release()
  })

  it('照片很大時也會依佔用的記憶體回收（上限 48MB）', async () => {
    const big = 20 * 1024 * 1024
    apiFetchMock.mockResolvedValue(imageResponse(big))
    const first = await acquireEmployeePhoto('big1', PHOTO)
    first.release()
    const second = await acquireEmployeePhoto('big2', PHOTO)
    second.release()
    expect(revokedUrls).toEqual([])
    const third = await acquireEmployeePhoto('big3', PHOTO)
    third.release()

    expect(revokedUrls).toEqual([first.url])
    expect(acquireCachedEmployeePhoto('big1', PHOTO)).toBeNull()
    expect(acquireCachedEmployeePhoto('big3', PHOTO)).not.toBeNull()
  })

  it('清空快取（登出）：沒人在用的立刻回收，還在用的等放開再回收', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const idle = await acquireEmployeePhoto('e1', PHOTO)
    idle.release()
    const busy = await acquireEmployeePhoto('e2', PHOTO)

    clearEmployeePhotoCache()
    expect(revokedUrls).toEqual([idle.url])
    busy.release()
    expect(revokedUrls).toEqual([idle.url, busy.url])
    expect(acquireCachedEmployeePhoto('e1', PHOTO)).toBeNull()
  })

  it('換了登入帳號（token 不同）就清掉快取，不會把別人的照片留給下一位登入者', async () => {
    localStorage.setItem('token', 'token-of-alice')
    apiFetchMock.mockResolvedValue(imageResponse())
    const lease = await acquireEmployeePhoto('e1', PHOTO)
    lease.release()
    const sameUser = acquireCachedEmployeePhoto('e1', PHOTO)
    expect(sameUser).not.toBeNull()
    sameUser.release()

    localStorage.setItem('token', 'token-of-bob')
    expect(acquireCachedEmployeePhoto('e1', PHOTO)).toBeNull()
    expect(revokedUrls).toContain(lease.url)
  })

  it('lease 另外提供 Blob，要把照片交給會自己 revoke 網址的元件時用它另外建立網址（不能直接給共用快取的網址）', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const lease = await acquireEmployeePhoto('e1', PHOTO)

    expect(lease.url).toMatch(/^blob:photo-/)
    expect(lease.blob).toEqual({ type: 'image/png', size: 4 })
    expect((await acquireEmployeePhoto('', PHOTO))).toMatchObject({ url: null, blob: null })
    lease.release()
  })

  it('登出後（有登入過、token 被清掉）清除快取不會讓每個頭像各打一個 401 請求', async () => {
    localStorage.setItem('token', 'token-of-alice')
    apiFetchMock.mockResolvedValue(imageResponse())
    const lease = await acquireEmployeePhoto('e1', PHOTO)
    lease.release()
    const callsBefore = apiFetchMock.mock.calls.length

    // 畫面上的頭像會在收到作廢通知時馬上重新載入（EmployeeAvatar 的做法）
    const reloaded = []
    const unsubscribe = subscribeEmployeePhoto('e1', () => {
      void acquireEmployeePhoto('e1', PHOTO).then(next => reloaded.push(next))
    })

    localStorage.removeItem('token')
    clearEmployeePhotoCache()
    await flush()

    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]).toMatchObject({ url: null, blob: null })
    expect(apiFetchMock.mock.calls.length).toBe(callsBefore)
    unsubscribe()

    // 之後再有人要照片（例如重新登入後）照常下載
    localStorage.setItem('token', 'token-of-bob')
    const afterLogin = await acquireEmployeePhoto('e1', PHOTO)
    expect(afterLogin.url).toMatch(/^blob:photo-/)
    afterLogin.release()
  })

  it('revokeEmployeePhotoUrl 不會回收快取擁有的網址，其他 blob: 網址照舊回收', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const lease = await acquireEmployeePhoto('e1', PHOTO)

    revokeEmployeePhotoUrl(lease.url)
    expect(revokedUrls).toEqual([])
    revokeEmployeePhotoUrl('blob:some-local-preview')
    expect(revokedUrls).toEqual(['blob:some-local-preview'])
    revokeEmployeePhotoUrl('/upload/x.png')
    revokeEmployeePhotoUrl(null)
    expect(revokedUrls).toEqual(['blob:some-local-preview'])
    lease.release()
  })

  it('fetchEmployeePhotoUrl（舊用法）走同一份快取：同一張只下載一次', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const [a, b] = await Promise.all([
      fetchEmployeePhotoUrl('e1', PHOTO),
      fetchEmployeePhotoUrl('e1', PHOTO),
    ])
    expect(a).toBe(b)
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    expect(await fetchEmployeePhotoUrl('e1', '')).toBeNull()
    expect(await fetchEmployeePhotoUrl('', PHOTO)).toBeNull()
  })
})

describe('員工照片快取：同一位員工的新舊版本', () => {
  it('換了新照片之後，這位員工舊版本的照片被回收；別的員工不受影響', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const other = await acquireEmployeePhoto('e2', PHOTO)
    other.release()
    const oldLease = await acquireEmployeePhoto('e1', PHOTO)
    oldLease.release()

    const newLease = await acquireEmployeePhoto('e1', NEW_PHOTO)
    expect(revokedUrls).toEqual([oldLease.url])
    expect(acquireCachedEmployeePhoto('e1', PHOTO)).toBeNull()
    expect(acquireCachedEmployeePhoto('e2', PHOTO)).not.toBeNull()
    newLease.release()
  })

  it('舊版本還有畫面在用時先留著，等最後一個使用者放開才回收', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const oldLease = await acquireEmployeePhoto('e1', PHOTO)
    const newLease = await acquireEmployeePhoto('e1', NEW_PHOTO)

    expect(revokedUrls).toEqual([])
    oldLease.release()
    expect(revokedUrls).toEqual([oldLease.url])
    newLease.release()
  })

  it('新舊兩個版本同時在下載（作廢通知與重新載入名單同時發生）：各自拿到有效的網址，不會互相搶掉重來', async () => {
    const pending = deferredFetch()
    const oldLoad = acquireEmployeePhoto('e1', PHOTO)
    const newLoad = acquireEmployeePhoto('e1', NEW_PHOTO)
    await flush()
    expect(pending).toHaveLength(2)

    // 舊版本先回來，新版本後回來：後到的是目前的版本，舊的先留著給還在用的人，等他放開再回收
    pending[0].resolve(imageResponse())
    await flush()
    pending[1].resolve(imageResponse())
    const [oldLease, newLease] = await Promise.all([oldLoad, newLoad])

    expect(oldLease.url).toBeTruthy()
    expect(newLease.url).toBeTruthy()
    expect(oldLease.url).not.toBe(newLease.url)
    // 沒有為了搶快取而重新下載
    expect(pending).toHaveLength(2)
    expect(revokedUrls).toEqual([])

    oldLease.release()
    expect(revokedUrls).toEqual([oldLease.url])
    newLease.release()
  })

  it('同時等同一張照片的好幾個呼叫端各算一份使用數：全部放開之後才會被作廢時立刻回收', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const leases = await Promise.all([
      acquireEmployeePhoto('e1', PHOTO),
      acquireEmployeePhoto('e1', PHOTO),
      acquireEmployeePhoto('e1', PHOTO),
    ])
    leases[0].release()
    leases[1].release()
    invalidateEmployeePhoto('e1')
    expect(revokedUrls).toEqual([])

    leases[2].release()
    expect(revokedUrls).toEqual([leases[0].url])
  })

  it('快取只看照片檔名：/upload/... 路徑與完整網址是同一張照片，不會重複下載', async () => {
    apiFetchMock.mockResolvedValue(imageResponse())
    const byPath = await acquireEmployeePhoto('e1', PHOTO)
    const byUrl = await acquireEmployeePhoto('e1', `http://localhost:3000${PHOTO}?x=1`)

    expect(byUrl.url).toBe(byPath.url)
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    byPath.release()
    byUrl.release()
  })
})

describe('員工照片快取：作廢通知', () => {
  it('作廢時通知訂閱那位員工（和訂閱全部）的人，取消訂閱後不再通知', async () => {
    const forE1 = vi.fn()
    const forE2 = vi.fn()
    const forAll = vi.fn()
    const offE1 = subscribeEmployeePhoto('e1', forE1)
    const offE2 = subscribeEmployeePhoto('e2', forE2)
    const offAll = subscribeEmployeePhoto('*', forAll)

    invalidateEmployeePhoto('e1')
    expect(forE1).toHaveBeenCalledTimes(1)
    expect(forE2).not.toHaveBeenCalled()
    expect(forAll).toHaveBeenCalledWith('e1')

    offE1()
    invalidateEmployeePhoto('e1')
    expect(forE1).toHaveBeenCalledTimes(1)
    expect(forAll).toHaveBeenCalledTimes(2)

    clearEmployeePhotoCache()
    expect(forE2).toHaveBeenCalledTimes(1)
    offE2()
    offAll()
  })

  it('訂閱者出錯不會影響其他訂閱者', () => {
    const broken = vi.fn(() => {
      throw new Error('boom')
    })
    const healthy = vi.fn()
    const offA = subscribeEmployeePhoto('e1', broken)
    const offB = subscribeEmployeePhoto('e1', healthy)
    expect(() => invalidateEmployeePhoto('e1')).not.toThrow()
    expect(healthy).toHaveBeenCalledTimes(1)
    offA()
    offB()
  })

  it('下載途中照片被作廢：舊的結果丟掉，等下載的人自動拿到作廢後的新照片', async () => {
    const pending = deferredFetch()
    const loading = acquireEmployeePhoto('e1', PHOTO)
    await flush()
    expect(pending).toHaveLength(1)

    invalidateEmployeePhoto('e1')
    pending[0].resolve(imageResponse())
    await flush()
    // 舊結果被丟掉，沒有建立網址；重新發出第二個請求
    expect(createdUrls).toHaveLength(0)
    expect(pending).toHaveLength(2)

    pending[1].resolve(imageResponse())
    const lease = await loading
    expect(lease.url).toBe(createdUrls[0])
    expect(createdUrls).toHaveLength(1)
    lease.release()
  })
})

describe('員工照片上傳前檢查', () => {
  const file = (type, size) => ({ type, size, name: 'p' })

  it('JPEG / PNG / GIF / WebP、5MB 以內才合格', () => {
    ;['image/jpeg', 'image/png', 'image/gif', 'image/webp'].forEach(type => {
      expect(validateEmployeePhotoFile(file(type, 1024))).toBe('')
    })
    expect(validateEmployeePhotoFile(file('image/png', EMPLOYEE_PHOTO_MAX_BYTES))).toBe('')
    expect(validateEmployeePhotoFile(file('image/png', EMPLOYEE_PHOTO_MAX_BYTES + 1))).toBe(EMPLOYEE_PHOTO_SIZE_MESSAGE)
    ;['image/heic', 'image/bmp', 'image/svg+xml', 'application/pdf', ''].forEach(type => {
      expect(validateEmployeePhotoFile(file(type, 1024))).toBe(EMPLOYEE_PHOTO_TYPE_MESSAGE)
    })
    expect(validateEmployeePhotoFile(file('image/png', 0))).toBe('無效的圖片資料')
    expect(validateEmployeePhotoFile(null)).toBe('無效的圖片資料')
  })

  it('合格的檔案原樣通過；不支援的格式直接回中文原因', async () => {
    const good = new File(['x'], 'p.png', { type: 'image/png' })
    expect(await prepareEmployeePhotoFile(good)).toEqual({ file: good, error: '' })
    const heic = new File(['x'], 'p.heic', { type: 'image/heic' })
    expect(await prepareEmployeePhotoFile(heic)).toEqual({ file: null, error: EMPLOYEE_PHOTO_TYPE_MESSAGE })
  })

  it('超過 5MB 的手機照片：瀏覽器能縮圖就縮成 JPEG，不能就回「檔案過大」', async () => {
    const huge = new File([new Uint8Array(EMPLOYEE_PHOTO_MAX_BYTES + 10)], 'IMG_0001.png', { type: 'image/png' })

    // 沒有縮圖功能（jsdom）
    expect(await prepareEmployeePhotoFile(huge)).toEqual({ file: null, error: EMPLOYEE_PHOTO_SIZE_MESSAGE })

    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close })))
    const drawImage = vi.fn()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage })
    let canvasSize = null
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlobMock(callback, type) {
      canvasSize = [this.width, this.height]
      callback(new Blob(['small'], { type }))
    })
    try {
      const result = await prepareEmployeePhotoFile(huge)
      expect(result.error).toBe('')
      expect(result.file).toBeInstanceOf(File)
      expect(result.file.type).toBe('image/jpeg')
      expect(result.file.name).toBe('IMG_0001.jpg')
      expect(canvasSize).toEqual([1600, 1200])
      expect(drawImage).toHaveBeenCalled()
      expect(close).toHaveBeenCalled()
    } finally {
      getContext.mockRestore()
      toBlob.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('GIF 超過 5MB 不縮圖（會失去動畫），直接回「檔案過大」', async () => {
    const hugeGif = new File([new Uint8Array(EMPLOYEE_PHOTO_MAX_BYTES + 10)], 'a.gif', { type: 'image/gif' })
    vi.stubGlobal('createImageBitmap', vi.fn())
    try {
      expect(await prepareEmployeePhotoFile(hugeGif)).toEqual({ file: null, error: EMPLOYEE_PHOTO_SIZE_MESSAGE })
      expect(globalThis.createImageBitmap).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
