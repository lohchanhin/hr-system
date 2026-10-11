import { jest } from '@jest/globals'

const mockEmployee = {
  find: jest.fn(),
  findById: jest.fn(),
  exists: jest.fn(),
  countDocuments: jest.fn(),
}
const mockReadEmployeePhoto = jest.fn()
const mockStatEmployeePhoto = jest.fn()
const mockDeleteEmployeePhoto = jest.fn()
const mockIsManagedEmployeePhotoPath = jest.fn(() => true)
const PHOTO_ETAG = '"photo-etag-1"'

let listEmployees
let getEmployee
let getEmployeePhoto

beforeAll(async () => {
  // 控制器還會從照片儲存模組匯入其他成員（路徑正規化…），所以只覆寫本測試要控制的函式
  const actualPhotoStorage = await import('../src/services/employeePhotoStorage.js')
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/services/employeePhotoStorage.js', () => ({
    ...actualPhotoStorage,
    deleteEmployeePhoto: mockDeleteEmployeePhoto,
    isManagedEmployeePhotoPath: mockIsManagedEmployeePhotoPath,
    readEmployeePhoto: mockReadEmployeePhoto,
    statEmployeePhoto: mockStatEmployeePhoto,
  }))
  const controller = await import('../src/controllers/employeeController.js')
  listEmployees = controller.listEmployees
  getEmployee = controller.getEmployee
  getEmployeePhoto = controller.getEmployeePhoto
})

beforeEach(() => {
  jest.clearAllMocks()
  mockEmployee.countDocuments.mockResolvedValue(1)
})

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    set: jest.fn().mockReturnThis(),
    send: jest.fn(),
    end: jest.fn(),
  }
}

// res.set 可能被呼叫多次（例如 404 先設 Cache-Control）；把所有設定的標頭合併起來方便檢查
function headersSetOn(res) {
  return Object.assign({}, ...res.set.mock.calls.map(([first, second]) => (
    typeof first === 'string' ? { [first]: second } : first
  )))
}

function makeEmployeePhotoQuery(photo = '/upload/employees/employee_test.png') {
  return { select: jest.fn().mockResolvedValue({ photo }) }
}

function makeListQuery(rows = []) {
  const query = {
    select: jest.fn(),
    populate: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn().mockResolvedValue(rows),
  }
  query.select.mockReturnValue(query)
  query.populate.mockReturnValue(query)
  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  return query
}

describe('employee read authorization', () => {
  it('limits an employee list request to the authenticated employee', async () => {
    const query = makeListQuery([{ _id: 'emp1', name: 'Self' }])
    mockEmployee.find.mockReturnValue(query)
    const res = makeRes()

    await listEmployees({ user: { id: 'emp1', role: 'employee' }, query: {} }, res)

    expect(mockEmployee.find).toHaveBeenCalledWith({ _id: 'emp1' })
    const projection = query.select.mock.calls[0][0]
    expect(projection).not.toContain('salaryAmount')
    expect(projection).not.toContain('salaryAccount')
    expect(projection).not.toContain('idNumber')
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      employees: [{ _id: 'emp1', name: 'Self' }],
    }))
  })

  it('limits a supervisor list to self and direct reports with a safe projection', async () => {
    const query = makeListQuery([{ _id: 'emp2', name: 'Direct report' }])
    mockEmployee.find.mockReturnValue(query)
    const res = makeRes()

    await listEmployees({ user: { id: 'sup1', role: 'supervisor' }, query: {} }, res)

    expect(mockEmployee.find).toHaveBeenCalledWith({
      $or: [{ _id: 'sup1' }, { supervisor: 'sup1' }],
    })
    const projection = query.select.mock.calls[0][0]
    expect(projection).toContain('name')
    expect(projection).not.toContain('salaryAmount')
    expect(projection).not.toContain('salaryAccount')
    expect(projection).not.toContain('idNumber')
    expect(projection).not.toContain('medicalCheck')
  })

  it('does not reveal another employee profile to an employee', async () => {
    const res = makeRes()

    await getEmployee({
      user: { id: 'emp1', role: 'employee' },
      params: { id: 'admin1' },
    }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' })
    expect(mockEmployee.findById).not.toHaveBeenCalled()
  })

  it('uses a safe projection when a supervisor reads a direct report', async () => {
    const supervisorId = '507f1f77bcf86cd799439021'
    const employeeId = '507f1f77bcf86cd799439022'
    const employee = {
      _id: employeeId,
      name: 'Direct report',
      supervisor: { _id: supervisorId, name: 'Supervisor' },
      toObject() { return { ...this } },
    }
    const query = {
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockResolvedValue(employee),
    }
    mockEmployee.findById.mockReturnValue(query)
    const res = makeRes()

    await getEmployee({
      user: { id: supervisorId, role: 'supervisor' },
      params: { id: employeeId },
    }, res)

    expect(res.status).not.toHaveBeenCalled()
    const projection = query.select.mock.calls[0][0]
    expect(projection).not.toContain('salaryAmount')
    expect(projection).not.toContain('salaryAccount')
    expect(projection).not.toContain('idNumber')
    expect(res.json).toHaveBeenCalled()
  })

  it('serves an employee photo with safe headers and a validator', async () => {
    mockEmployee.findById.mockReturnValue(makeEmployeePhotoQuery())
    mockStatEmployeePhoto.mockResolvedValue({ size: 5, mtimeMs: 1, etag: PHOTO_ETAG })
    mockReadEmployeePhoto.mockResolvedValue({
      buffer: Buffer.from('image'),
      mimeType: 'image/png',
    })
    const res = makeRes()

    await getEmployeePhoto({
      user: { id: 'emp1', role: 'employee' },
      params: { id: 'emp1' },
      query: {},
      headers: {},
    }, res)

    expect(headersSetOn(res)).toMatchObject({
      'Content-Type': 'image/png',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      ETag: PHOTO_ETAG,
      Vary: 'Authorization',
    })
    expect(res.send).toHaveBeenCalledWith(Buffer.from('image'))
  })

  // 政策改變：大頭照像員工通訊錄，任何已登入的使用者都可以看（簽核、排班、選單到處都要顯示人頭）；
  // 以前只有管理員、本人與直屬主管看得到，其他人一律 404，畫面上只剩姓名縮寫
  it.each([
    ['an employee reading a colleague', { id: 'emp1', role: 'employee' }],
    ['a supervisor reading someone who is not their direct report', { id: 'sup1', role: 'supervisor' }],
    ['an administrator', { id: 'admin1', role: 'admin' }],
  ])('serves the photo to %s', async (_label, user) => {
    mockEmployee.findById.mockReturnValue(makeEmployeePhotoQuery())
    mockStatEmployeePhoto.mockResolvedValue({ size: 5, mtimeMs: 1, etag: PHOTO_ETAG })
    mockReadEmployeePhoto.mockResolvedValue({ buffer: Buffer.from('image'), mimeType: 'image/png' })
    const res = makeRes()

    await getEmployeePhoto({ user, params: { id: 'someone-else' }, query: {}, headers: {} }, res)

    expect(mockEmployee.findById).toHaveBeenCalledWith('someone-else')
    expect(mockEmployee.exists).not.toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    expect(res.send).toHaveBeenCalledWith(Buffer.from('image'))
  })

  it('refuses a request that has no authenticated user', async () => {
    const res = makeRes()

    await getEmployeePhoto({ params: { id: 'emp1' }, query: {}, headers: {} }, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(mockEmployee.findById).not.toHaveBeenCalled()
  })

  it('revalidates every time unless the caller asks for the current photo version', async () => {
    mockEmployee.findById.mockReturnValue(makeEmployeePhotoQuery('/upload/employees/employee_test.png'))
    mockStatEmployeePhoto.mockResolvedValue({ size: 5, mtimeMs: 1, etag: PHOTO_ETAG })
    mockReadEmployeePhoto.mockResolvedValue({ buffer: Buffer.from('image'), mimeType: 'image/png' })
    const cacheControlFor = async (query) => {
      const res = makeRes()
      await getEmployeePhoto({
        user: { id: 'emp1', role: 'employee' }, params: { id: 'emp1' }, query, headers: {},
      }, res)
      return headersSetOn(res)['Cache-Control']
    }

    // 沒帶版本、或帶的是舊照片的檔名：不可以讓瀏覽器直接用快取，否則換了照片還會看到舊圖
    expect(await cacheControlFor({})).toBe('private, no-cache')
    expect(await cacheControlFor({ v: 'employee_old.png' })).toBe('private, no-cache')
    expect(await cacheControlFor({ v: ['employee_test.png', 'x'] })).toBe('private, no-cache')
    // 帶目前照片的檔名（換照片檔名就會變）：快取 5 分鐘
    expect(await cacheControlFor({ v: 'employee_test.png' })).toBe('private, max-age=300, must-revalidate')
  })

  it.each([
    ['the exact validator', PHOTO_ETAG],
    ['a weak form of the validator', `W/${PHOTO_ETAG}`],
    ['a list that contains the validator', `"other", ${PHOTO_ETAG}`],
    ['a wildcard', '*'],
  ])('answers 304 without reading the file when If-None-Match is %s', async (_label, header) => {
    mockEmployee.findById.mockReturnValue(makeEmployeePhotoQuery())
    mockStatEmployeePhoto.mockResolvedValue({ size: 5, mtimeMs: 1, etag: PHOTO_ETAG })
    const res = makeRes()

    await getEmployeePhoto({
      user: { id: 'emp1', role: 'employee' },
      params: { id: 'emp1' },
      query: {},
      headers: { 'if-none-match': header },
    }, res)

    expect(res.status).toHaveBeenCalledWith(304)
    expect(res.end).toHaveBeenCalled()
    expect(res.send).not.toHaveBeenCalled()
    expect(mockReadEmployeePhoto).not.toHaveBeenCalled()
    expect(headersSetOn(res)).toMatchObject({ ETag: PHOTO_ETAG, 'Cache-Control': 'private, no-cache' })
  })

  it('sends the new photo when If-None-Match carries the validator of the previous photo', async () => {
    mockEmployee.findById.mockReturnValue(makeEmployeePhotoQuery())
    mockStatEmployeePhoto.mockResolvedValue({ size: 9, mtimeMs: 2, etag: '"photo-etag-2"' })
    mockReadEmployeePhoto.mockResolvedValue({ buffer: Buffer.from('new-image'), mimeType: 'image/jpeg' })
    const res = makeRes()

    await getEmployeePhoto({
      user: { id: 'emp1', role: 'employee' },
      params: { id: 'emp1' },
      query: {},
      headers: { 'if-none-match': PHOTO_ETAG },
    }, res)

    expect(res.status).not.toHaveBeenCalled()
    expect(res.send).toHaveBeenCalledWith(Buffer.from('new-image'))
    expect(headersSetOn(res)).toMatchObject({ ETag: '"photo-etag-2"', 'Content-Type': 'image/jpeg' })
  })

  it('looks a legacy full-URL photo value up by its /upload path', async () => {
    mockEmployee.findById.mockReturnValue(makeEmployeePhotoQuery('http://hr.example.com/upload/employee_legacy.png'))
    mockStatEmployeePhoto.mockResolvedValue({ size: 5, mtimeMs: 1, etag: PHOTO_ETAG })
    mockReadEmployeePhoto.mockResolvedValue({ buffer: Buffer.from('image'), mimeType: 'image/png' })
    const res = makeRes()

    await getEmployeePhoto({
      user: { id: 'emp1', role: 'employee' }, params: { id: 'emp2' }, query: {}, headers: {},
    }, res)

    expect(mockStatEmployeePhoto).toHaveBeenCalledWith('/upload/employee_legacy.png')
    expect(mockReadEmployeePhoto).toHaveBeenCalledWith('/upload/employee_legacy.png')
    expect(res.send).toHaveBeenCalled()
  })

  it.each([
    ['the employee does not exist', null, null],
    ['the employee has no photo', { photo: '' }, null],
    ['the photo file is missing or unreadable', { photo: '/upload/employees/employee_gone.png' }, null],
  ])('answers an uncacheable 404 when %s', async (_label, employee, stat) => {
    mockEmployee.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(employee) })
    mockStatEmployeePhoto.mockResolvedValue(stat)
    const res = makeRes()

    await getEmployeePhoto({
      user: { id: 'emp1', role: 'employee' }, params: { id: 'emp2' }, query: {}, headers: {},
    }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' })
    expect(headersSetOn(res)['Cache-Control']).toBe('no-store')
    expect(mockReadEmployeePhoto).not.toHaveBeenCalled()
  })

  it('answers 404 when the file disappears between the status check and the read', async () => {
    mockEmployee.findById.mockReturnValue(makeEmployeePhotoQuery())
    mockStatEmployeePhoto.mockResolvedValue({ size: 5, mtimeMs: 1, etag: PHOTO_ETAG })
    mockReadEmployeePhoto.mockResolvedValue(null)
    const res = makeRes()

    await getEmployeePhoto({
      user: { id: 'emp1', role: 'employee' }, params: { id: 'emp2' }, query: {}, headers: {},
    }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(headersSetOn(res)).not.toHaveProperty('ETag')
    expect(res.send).not.toHaveBeenCalled()
  })

  it('treats a malformed employee id as not found', async () => {
    const castError = Object.assign(new Error('Cast to ObjectId failed for value "x"'), { name: 'CastError' })
    mockEmployee.findById.mockReturnValue({ select: jest.fn().mockRejectedValue(castError) })
    const res = makeRes()

    await getEmployeePhoto({
      user: { id: 'emp1', role: 'employee' }, params: { id: 'x' }, query: {}, headers: {},
    }, res)

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('reports an unreadable photo file as a server error without echoing the system message', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockEmployee.findById.mockReturnValue(makeEmployeePhotoQuery())
    mockStatEmployeePhoto.mockResolvedValue({ size: 5, mtimeMs: 1, etag: PHOTO_ETAG })
    mockReadEmployeePhoto.mockRejectedValue(Object.assign(
      new Error("EACCES: permission denied, open 'C:\\hr\\upload\\employees\\employee_test.png'"),
      { code: 'EACCES' },
    ))
    const res = makeRes()

    await getEmployeePhoto({
      user: { id: 'emp1', role: 'employee' }, params: { id: 'emp1' }, query: {}, headers: {},
    }, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: '載入照片失敗' })
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to read employee photo',
      expect.objectContaining({ code: 'EACCES' }),
    )
    consoleError.mockRestore()
  })
})
