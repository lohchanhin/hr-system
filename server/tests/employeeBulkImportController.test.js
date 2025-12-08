import { jest } from '@jest/globals'

let workbookRows = []
let departmentDocs = []
let subDepartmentDocs = []

class MockRow {
  constructor(values) {
    this.values = values
    this.cellCount = Math.max(0, values.length - 1)
  }

  eachCell(callback) {
    for (let index = 1; index < this.values.length; index += 1) {
      callback({ value: this.values[index] }, index)
    }
  }

  getCell(index) {
    return { value: this.values[index] }
  }
}

class MockWorksheet {
  constructor(rows) {
    this._rows = rows.map(values => new MockRow(values))
    this.rowCount = this._rows.length
    this.actualRowCount = this._rows.length
  }

  getRow(index) {
    return this._rows[index - 1]
  }
}

class MockWorkbook {
  constructor() {
    this.xlsx = { load: jest.fn().mockResolvedValue(this) }
    this.csv = { read: jest.fn().mockResolvedValue(this) }
    this.worksheets = [new MockWorksheet(workbookRows)]
  }
}

const mockDepartment = {
  find: jest.fn()
}
const mockSubDepartment = {
  find: jest.fn()
}
const mockOrganization = {
  find: jest.fn()
}

let mockEmployeeFind
let mockEmployeeInsertMany
let mockEmployeeStartSession

class MockEmployee {
  constructor(doc) {
    this.doc = doc
  }

  async validate() {}

  toObject() {
    return this.doc
  }

  static find(...args) {
    return mockEmployeeFind(...args)
  }

  static insertMany(...args) {
    return mockEmployeeInsertMany(...args)
  }

  static startSession(...args) {
    return mockEmployeeStartSession(...args)
  }
}

jest.unstable_mockModule('exceljs', () => ({
  default: { Workbook: MockWorkbook }
}))
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }))
jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartment }))
jest.unstable_mockModule('../src/models/Organization.js', () => ({ default: mockOrganization }))
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: MockEmployee }))

let bulkImportEmployees

const createRes = () => {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

const mappings = {
  employeeNo: 'employeeNo',
  name: 'name',
  email: 'email',
  department: 'department',
  subDepartment: 'subDepartment',
  idNumber: 'idNumber'
}

beforeEach(async () => {
  jest.resetModules()
  workbookRows = []
  departmentDocs = []
  subDepartmentDocs = []
  mockEmployeeFind = jest.fn().mockResolvedValue([])
  mockEmployeeInsertMany = jest.fn().mockImplementation(async docs => docs)
  mockEmployeeStartSession = jest.fn()
  mockDepartment.find.mockImplementation(() => ({
    lean: jest.fn().mockImplementation(() => Promise.resolve(departmentDocs))
  }))
  mockSubDepartment.find.mockImplementation(() => ({
    lean: jest.fn().mockImplementation(() => Promise.resolve(subDepartmentDocs))
  }))
  mockOrganization.find.mockImplementation(() => ({ 
    lean: jest.fn().mockResolvedValue([]) 
  }))

  ;({ bulkImportEmployees } = await import('../src/controllers/employeeBulkImportController.js'))
})

describe('employeeBulkImportController subDepartment resolution', () => {
  const baseFile = {
    buffer: Buffer.from('dummy'),
    mimetype: 'application/vnd.ms-excel',
    originalname: 'test.xlsx'
  }

  it('matches subDepartment by department when names duplicate', async () => {
    workbookRows = [
      [, 'employeeNo', 'name', 'email', 'department', 'subDepartment', 'idNumber'],
      [, 'E001', 'Alice', 'alice@example.com', 'Dept A', 'Support', 'A1'],
      [, 'E002', 'Bob', 'bob@example.com', 'Dept B', 'Support', 'B1']
    ]
    departmentDocs = [
      { _id: 'depA', name: 'Dept A' },
      { _id: 'depB', name: 'Dept B' }
    ]
    subDepartmentDocs = [
      { _id: 'sdA', name: 'Support', department: 'depA' },
      { _id: 'sdB', name: 'Support', department: 'depB' }
    ]

    const req = {
      file: baseFile,
      bulkImportPayload: { mappings, valueMappings: {}, ignore: {} }
    }
    const res = createRes()

    await bulkImportEmployees(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mockEmployeeInsertMany).toHaveBeenCalled()
    const insertedDocs = mockEmployeeInsertMany.mock.calls[0][0]
    expect(insertedDocs[0].subDepartment).toBe('sdA')
    expect(insertedDocs[1].subDepartment).toBe('sdB')
  })

  it('falls back to global subDepartment lookup when department is missing', async () => {
    workbookRows = [
      [, 'employeeNo', 'name', 'email', 'department', 'subDepartment', 'idNumber'],
      [, 'E003', 'Cara', 'cara@example.com', '', 'Support', 'C1']
    ]
    subDepartmentDocs = [{ _id: 'sdA', name: 'Support', department: 'depA' }]

    const req = {
      file: baseFile,
      bulkImportPayload: { mappings, valueMappings: {}, ignore: {} }
    }
    const res = createRes()

    await bulkImportEmployees(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const insertedDocs = mockEmployeeInsertMany.mock.calls[0][0]
    expect(insertedDocs[0].subDepartment).toBe('sdA')
  })

  it('returns department-filtered options when subDepartment is missing', async () => {
    workbookRows = [
      [, 'employeeNo', 'name', 'email', 'department', 'subDepartment', 'idNumber'],
      [, 'E004', 'Drew', 'drew@example.com', 'Dept A', 'Unknown', 'D1']
    ]
    departmentDocs = [
      { _id: 'depA', name: 'Dept A' },
      { _id: 'depB', name: 'Dept B' }
    ]
    subDepartmentDocs = [
      { _id: 'sdA', name: 'Alpha', department: 'depA' },
      { _id: 'sdB', name: 'Beta', department: 'depB' }
    ]

    const req = {
      file: baseFile,
      bulkImportPayload: { mappings, valueMappings: {}, ignore: {} }
    }
    const res = createRes()

    await bulkImportEmployees(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
    const response = res.json.mock.calls[0][0]
    expect(response.missingReferences.subDepartment.options).toEqual([
      {
        id: 'sdA',
        name: 'Alpha',
        code: '',
        department: 'depA',
        departmentName: '',
        departmentCode: '',
        organization: '',
        organizationName: '',
        organizationUnitName: '',
        organizationCode: ''
      }
    ])
  })

  it('uses global options when department has no subDepartments', async () => {
    workbookRows = [
      [, 'employeeNo', 'name', 'email', 'department', 'subDepartment', 'idNumber'],
      [, 'E005', 'Evan', 'evan@example.com', 'Dept A', 'Unknown', 'E1']
    ]
    departmentDocs = [{ _id: 'depA', name: 'Dept A' }]
    subDepartmentDocs = [{ _id: 'sdB', name: 'Beta', department: 'depB' }]

    const req = {
      file: baseFile,
      bulkImportPayload: { mappings, valueMappings: {}, ignore: {} }
    }
    const res = createRes()

    await bulkImportEmployees(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
    const response = res.json.mock.calls[0][0]
    expect(response.missingReferences.subDepartment.options).toEqual([
      { 
        id: 'sdB', 
        name: 'Beta', 
        code: '', 
        department: 'depB',
        departmentName: '',
        departmentCode: '',
        organization: '',
        organizationName: '',
        organizationUnitName: '',
        organizationCode: ''
      }
    ])
  })

  it('falls back to global alias map when department-filtered mapping misses', async () => {
    workbookRows = [
      [, 'employeeNo', 'name', 'email', 'department', 'subDepartment', 'idNumber'],
      [, 'E006', 'Finn', 'finn@example.com', 'Dept A', 'Support', 'F1']
    ]
    departmentDocs = [{ _id: 'depA', name: 'Dept A' }]
    subDepartmentDocs = [{ _id: 'sdGlobal', name: 'Global Support', department: 'depB' }]

    const req = {
      file: baseFile,
      bulkImportPayload: {
        mappings,
        valueMappings: { subDepartment: { Support: 'Global Support' } },
        ignore: {}
      }
    }
    const res = createRes()

    await bulkImportEmployees(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const insertedDocs = mockEmployeeInsertMany.mock.calls[0][0]
    expect(insertedDocs[0].subDepartment).toBe('sdGlobal')
  })
})
