import { jest } from '@jest/globals'

const mockEmployee = {
  find: jest.fn(),
  findById: jest.fn(),
  exists: jest.fn(),
  countDocuments: jest.fn(),
}
const mockReadEmployeePhoto = jest.fn()
const mockDeleteEmployeePhoto = jest.fn()
const mockIsManagedEmployeePhotoPath = jest.fn(() => true)

let listEmployees
let getEmployee
let getEmployeePhoto

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/services/employeePhotoStorage.js', () => ({
    deleteEmployeePhoto: mockDeleteEmployeePhoto,
    isManagedEmployeePhotoPath: mockIsManagedEmployeePhotoPath,
    readEmployeePhoto: mockReadEmployeePhoto,
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
  }
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

  it('serves an employee photo only to an authorized reader', async () => {
    mockEmployee.findById.mockReturnValue(makeEmployeePhotoQuery())
    mockReadEmployeePhoto.mockResolvedValue({
      buffer: Buffer.from('image'),
      mimeType: 'image/png',
    })
    const res = makeRes()

    await getEmployeePhoto({
      user: { id: 'emp1', role: 'employee' },
      params: { id: 'emp1' },
    }, res)

    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    }))
    expect(res.send).toHaveBeenCalledWith(Buffer.from('image'))
  })

  it('does not reveal another employee photo', async () => {
    const res = makeRes()

    await getEmployeePhoto({
      user: { id: 'emp1', role: 'employee' },
      params: { id: 'emp2' },
    }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockEmployee.findById).not.toHaveBeenCalled()
    expect(mockReadEmployeePhoto).not.toHaveBeenCalled()
  })
})
