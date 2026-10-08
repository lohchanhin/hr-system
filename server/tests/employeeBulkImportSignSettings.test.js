import request from 'supertest'
import express from 'express'
import ExcelJS from 'exceljs'
import { jest } from '@jest/globals'

// 批量匯入：簽核標籤／簽核角色／簽核層級欄位、人員狀態無法辨識時的提醒、
// 離職／留職停薪的人不會被自動升為主管。資料庫模型全部以替身取代。
// 第一次要載入整個路由與 exceljs，單獨跑約 2.6 秒，整套測試同時跑時會更久：給足時間，並在 beforeAll 先準備好，
// 否則第一個測試逾時之後，它還在跑的請求會污染下一個測試的替身狀態（連鎖失敗）。
jest.setTimeout(30000)

const mockEmployeeModel = function (doc) {
  Object.assign(this, doc)
}
mockEmployeeModel.find = jest.fn()
mockEmployeeModel.insertMany = jest.fn()
mockEmployeeModel.updateOne = jest.fn()
mockEmployeeModel.deleteMany = jest.fn()
mockEmployeeModel.startSession = jest.fn()
mockEmployeeModel.prototype.validate = jest.fn()
mockEmployeeModel.prototype.toObject = function () {
  return { ...this }
}

const mockSession = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  abortTransaction: jest.fn(),
  endSession: jest.fn(),
}
const mockOrganizationModel = { find: jest.fn() }
const mockDepartmentModel = { find: jest.fn() }
const mockSubDepartmentModel = { find: jest.fn() }

function mockFindWithData(model, data) {
  model.find.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(data) }))
}

function setupEmployeeFind({ referenceData = [], emailData = [], existingByNo = [] } = {}) {
  mockEmployeeModel.find.mockImplementation((query) => {
    if (query && query.email) return Promise.resolve(emailData)
    if (query && query.employeeId) return Promise.resolve(existingByNo)
    return { lean: jest.fn().mockResolvedValue(referenceData) }
  })
}

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployeeModel }))
jest.unstable_mockModule('../src/models/Organization.js', () => ({ default: mockOrganizationModel }))
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartmentModel }))
jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartmentModel }))

let app
async function setupApp() {
  if (app) return app
  const employeeRoutes = (await import('../src/routes/employeeRoutes.js')).default
  const instance = express()
  instance.use('/api/employees', employeeRoutes)
  app = instance
  return app
}

// 與官方範本相同的英文欄位（第 1 列）；簽核欄位另外加在後面
const BASE_HEADERS = [
  'employeeId', 'name', 'gender', 'idNumber', 'birthDate', 'birthPlace', 'bloodType', 'languages',
  'disabilityLevel', 'identityCategory', 'maritalStatus', 'dependents', 'email', 'mobile', 'landline',
  'householdAddress', 'contactAddress', 'lineId', 'organization', 'department', 'subDepartment',
  'supervisor', 'title', 'practiceTitle', 'status', 'probationDays', 'partTime', 'needClockIn',
  'education_level', 'education_school', 'education_major', 'education_status',
  'education_graduationYear', 'militaryService_type', 'militaryService_branch', 'militaryService_rank',
  'militaryService_dischargeYear', 'emergency1_name', 'emergency1_relation', 'emergency1_phone1',
  'emergency1_phone2', 'emergency2_name', 'emergency2_relation', 'emergency2_phone1',
  'emergency2_phone2', 'hireDate', 'startDate', 'resignationDate', 'dismissalDate', 'rehireStartDate',
  'rehireEndDate', 'appointment_remark', 'salaryType', 'salaryAmount', 'laborPensionSelf',
  'employeeAdvance', 'salaryAccountA_bank', 'salaryAccountA_acct', 'salaryAccountB_bank',
  'salaryAccountB_acct', 'salaryItems', 'annualLeave_totalDays', 'annualLeave_usedDays',
  'annualLeave_accumulatedLeave', 'annualLeave_expiryDate', 'annualLeave_compensatoryHours',
  'laborInsuredSalary', 'pensionInsuredSalary', 'healthInsuredSalary', 'dependentCount',
]
const SIGN_HEADERS = ['signTags', 'signRole', 'signLevel']
const SIGN_LABELS = ['簽核標籤', '簽核角色', '簽核層級']

/**
 * 組出 xlsx：第 1 列英文欄位、第 2 列中文說明（需要至少 3 個已知說明才會被當成說明列），資料列從第 3 列開始。
 * signColumns: 'english'＝第 1 列有 signTags 等欄位名；'labels'＝第 1 列留空、只有第 2 列的中文名稱；
 * 'none'＝完全沒有簽核欄位（舊版檔案）。
 */
async function createWorkbookBuffer(rows, { signColumns = 'english', labelSuffix = '' } = {}) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('員工資料')
  const headers = [...BASE_HEADERS]
  const labelRow = BASE_HEADERS.map(() => '')
  labelRow[0] = '員工編號'
  labelRow[1] = '姓名'
  labelRow[BASE_HEADERS.indexOf('email')] = '電子郵件 (必填唯一)'
  labelRow[BASE_HEADERS.indexOf('mobile')] = '手機號碼'
  labelRow[BASE_HEADERS.indexOf('supervisor')] = '主管員工 ID'
  labelRow[BASE_HEADERS.indexOf('department')] = '部門 ID'
  if (signColumns !== 'none') {
    SIGN_HEADERS.forEach((header, index) => {
      headers.push(signColumns === 'english' ? header : '')
      labelRow.push(`${SIGN_LABELS[index]}${labelSuffix}`)
    })
  }
  worksheet.addRow(headers)
  worksheet.addRow(labelRow)
  rows.forEach((data) => {
    worksheet.addRow(headers.map((header, index) => {
      const key = header || (index >= BASE_HEADERS.length ? SIGN_HEADERS[index - BASE_HEADERS.length] : '')
      return data[key] !== undefined ? data[key] : ''
    }))
  })
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

async function postImport(buffer, options = {}) {
  const application = await setupApp()
  return request(application)
    .post('/api/employees/bulk-import')
    .attach('file', buffer, { filename: 'import.xlsx' })
    .field('options', JSON.stringify(options))
}

const person = (no, extra = {}) => ({
  employeeId: no,
  name: `員工${no}`,
  idNumber: `A12345${no.replace(/\D/g, '').padStart(4, '0')}`,
  email: `${no.toLowerCase()}@example.com`,
  ...extra,
})

beforeAll(async () => {
  await setupApp()
  await createWorkbookBuffer([]) // 預熱 exceljs
}, 60000)

beforeEach(() => {
  mockEmployeeModel.find.mockReset()
  mockEmployeeModel.insertMany.mockReset()
  mockEmployeeModel.updateOne.mockReset()
  mockEmployeeModel.updateOne.mockResolvedValue({ acknowledged: true })
  mockEmployeeModel.deleteMany.mockReset()
  mockEmployeeModel.deleteMany.mockResolvedValue()
  mockEmployeeModel.startSession.mockReset()
  mockEmployeeModel.prototype.validate.mockReset()
  mockEmployeeModel.prototype.validate.mockImplementation(async function () {})
  Object.values(mockSession).forEach((fn) => fn.mockReset())
  mockEmployeeModel.startSession.mockResolvedValue(mockSession)
  mockSession.startTransaction.mockResolvedValue()
  mockSession.commitTransaction.mockResolvedValue()
  mockSession.abortTransaction.mockResolvedValue()
  mockSession.endSession.mockResolvedValue()
  mockEmployeeModel.insertMany.mockImplementation(async (docs) => docs.map((doc) => ({ ...doc })))
  mockOrganizationModel.find.mockReset()
  mockDepartmentModel.find.mockReset()
  mockSubDepartmentModel.find.mockReset()
  mockFindWithData(mockOrganizationModel, [])
  mockFindWithData(mockDepartmentModel, [])
  mockFindWithData(mockSubDepartmentModel, [])
  setupEmployeeFind()
})

describe('批量匯入：簽核標籤／角色／層級', () => {
  it('標準範本欄位（signTags / signRole / signLevel）可匯入：標籤依逗號、頓號、分號、換行拆開並整理', async () => {
    const buffer = await createWorkbookBuffer([
      person('E001', { signTags: ' 人資 ，排班負責人、人資;財務　覆核\n業務主管 ', signRole: 'R007', signLevel: 'U002' }),
      person('E002', { signTags: '支援單位主管', signRole: '覆核', signLevel: 'L3' }),
      person('E003', {}),
    ])

    const response = await postImport(buffer)

    expect(response.status).toBe(200)
    const docs = mockEmployeeModel.insertMany.mock.calls[0][0]
    expect(docs[0].signTags).toEqual(['人資', '排班負責人', '財務 覆核', '業務主管'])
    expect(docs[0].signRole).toBe('R007')
    expect(docs[0].signLevel).toBe('U002')
    // 名稱也可以，存成代碼
    expect(docs[1].signTags).toEqual(['支援單位主管'])
    expect(docs[1].signRole).toBe('R002')
    expect(docs[1].signLevel).toBe('U003')
    // 沒填就是沒有
    expect(docs[2].signTags).toEqual([])
    expect(docs[2].signRole).toBeUndefined()
    expect(response.body.warnings.filter((w) => /簽核/.test(w))).toEqual([])
  })

  it('第 1 列沒有英文欄位名時，改用第 2 列的中文名稱（含括號說明）讀取', async () => {
    const buffer = await createWorkbookBuffer(
      [person('E001', { signTags: '人資、排班負責人', signRole: '審核', signLevel: 'U001' })],
      { signColumns: 'labels', labelSuffix: ' (請參考範本說明)' }
    )

    const response = await postImport(buffer)

    expect(response.status).toBe(200)
    const [doc] = mockEmployeeModel.insertMany.mock.calls[0][0]
    expect(doc.signTags).toEqual(['人資', '排班負責人'])
    expect(doc.signRole).toBe('R003')
    expect(doc.signLevel).toBe('U001')
  })

  it('舊版檔案沒有這三個欄位也能匯入，而且更新既有員工時完全不動簽核設定', async () => {
    const buffer = await createWorkbookBuffer(
      [person('E001', { name: '舊員工' }), person('E002')],
      { signColumns: 'none' }
    )
    setupEmployeeFind({
      emailData: [{ _id: 'id-1', email: 'e001@example.com', employeeId: 'E001' }],
      existingByNo: [{ _id: 'id-1', employeeId: 'E001', email: 'e001@example.com', signTags: ['人資'], signRole: 'R003', signLevel: 'U002' }],
    })

    const response = await postImport(buffer, { updateExisting: true })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ createdCount: 1, updatedCount: 1 })
    const update = mockEmployeeModel.updateOne.mock.calls[0][1]
    ;['signTags', 'signRole', 'signLevel'].forEach((key) => expect(update.$set).not.toHaveProperty(key))
    expect(response.body.warnings.filter((w) => /簽核/.test(w))).toEqual([])
  })

  it('不認得的角色與層級只提醒（不讓整批失敗），該欄位視為沒填', async () => {
    const buffer = await createWorkbookBuffer([
      person('E001', { signTags: '人資', signRole: 'banana', signLevel: 'U999' }),
    ])

    const response = await postImport(buffer)

    expect(response.status).toBe(200)
    const [doc] = mockEmployeeModel.insertMany.mock.calls[0][0]
    expect(doc.signTags).toEqual(['人資'])
    expect(doc.signRole).toBeUndefined()
    expect(doc.signLevel).toBeUndefined()
    expect(response.body.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('第 3 列「簽核角色」的值「banana」'),
      expect.stringContaining('第 3 列「簽核層級」的值「U999」'),
    ]))
  })

  it('標籤太長時只提醒並略過該欄位', async () => {
    const buffer = await createWorkbookBuffer([person('E001', { signTags: '長'.repeat(60) })])

    const response = await postImport(buffer)

    expect(response.status).toBe(200)
    expect(mockEmployeeModel.insertMany.mock.calls[0][0][0].signTags).toEqual([])
    expect(response.body.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('第 3 列「簽核標籤」'),
    ]))
  })

  describe('更新既有員工', () => {
    const existing = (extra = {}) => ({
      _id: 'id-1',
      employeeId: 'E001',
      email: 'e001@example.com',
      signTags: ['人資', '排班負責人'],
      signRole: 'R003',
      signLevel: 'U002',
      ...extra,
    })

    function stubExisting() {
      setupEmployeeFind({
        emailData: [{ _id: 'id-1', email: 'e001@example.com', employeeId: 'E001' }],
        existingByNo: [existing()],
      })
    }

    it('有填就取代原有的標籤、角色、層級', async () => {
      stubExisting()
      const buffer = await createWorkbookBuffer([
        person('E001', { signTags: '財務覆核、人資', signRole: '核定', signLevel: 'L4' }),
      ])

      const response = await postImport(buffer, { updateExisting: true })

      expect(response.status).toBe(200)
      const update = mockEmployeeModel.updateOne.mock.calls[0][1]
      expect(update.$set.signTags).toEqual(['財務覆核', '人資'])
      expect(update.$set.signRole).toBe('R004')
      expect(update.$set.signLevel).toBe('U004')
      expect(response.body.warnings.filter((w) => /清除/.test(w))).toEqual([])
    })

    it('欄位存在但儲存格空白時清空，並在結果提醒原本有哪些標籤', async () => {
      stubExisting()
      const buffer = await createWorkbookBuffer([person('E001', { signTags: '', signRole: '', signLevel: '' })])

      const response = await postImport(buffer, { updateExisting: true })

      expect(response.status).toBe(200)
      const update = mockEmployeeModel.updateOne.mock.calls[0][1]
      expect(update.$set.signTags).toEqual([])
      expect(update.$set.signRole).toBe('')
      expect(update.$set.signLevel).toBe('')
      expect(response.body.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('第 3 列「簽核標籤」空白，已清除原有標籤：人資、排班負責人'),
        expect.stringContaining('「簽核角色」空白，已清除原有角色：R003'),
        expect.stringContaining('「簽核層級」空白，已清除原有層級：U002'),
      ]))
    })

    describe('員工編號對不到、改用 Email 比對到既有員工時', () => {
      const OLD_EMAIL = 'old@example.com'
      const matchedByEmail = (extra = {}) => ({
        _id: 'id-1',
        email: OLD_EMAIL,
        employeeId: 'OLD-1',
        signTags: ['人資', '排班負責人'],
        signRole: 'R007',
        signLevel: 'U002',
        ...extra,
      })

      it('清空簽核標籤／角色／層級時一樣提醒原本有什麼（兩種比對方式的警告一致）', async () => {
        setupEmployeeFind({ emailData: [matchedByEmail()], existingByNo: [] })
        const buffer = await createWorkbookBuffer([
          person('NEW-99', { email: OLD_EMAIL, signTags: '', signRole: '', signLevel: '' }),
        ])

        const response = await postImport(buffer, { updateExisting: true })

        expect(response.status).toBe(200)
        expect(response.body).toMatchObject({ createdCount: 0, updatedCount: 1 })
        const update = mockEmployeeModel.updateOne.mock.calls[0][1]
        expect(update.$set.signTags).toEqual([])
        expect(update.$set.signRole).toBe('')
        expect(update.$set.signLevel).toBe('')
        expect(response.body.warnings).toEqual(expect.arrayContaining([
          expect.stringContaining('第 3 列「簽核標籤」空白，已清除原有標籤：人資、排班負責人'),
          expect.stringContaining('「簽核角色」空白，已清除原有角色：R007'),
          expect.stringContaining('「簽核層級」空白，已清除原有層級：U002'),
        ]))
      })

      it('Email 比對的查詢會帶出簽核標籤、角色、層級，也帶出聯絡人與薪資項目', async () => {
        setupEmployeeFind({ emailData: [matchedByEmail()], existingByNo: [] })
        const buffer = await createWorkbookBuffer([person('NEW-99', { email: OLD_EMAIL })])

        await postImport(buffer, { updateExisting: true })

        const emailLookup = mockEmployeeModel.find.mock.calls.find(([query]) => query && query.email)
        expect(emailLookup).toBeTruthy()
        const fields = String(emailLookup[1]).split(/\s+/)
        expect(fields).toEqual(expect.arrayContaining(['email', 'employeeId', 'signTags', 'signRole', 'signLevel', 'emergencyContacts', 'salaryItems']))
      })

      it('沒有清空任何簽核設定時不多出提醒；檔案沒有這三個欄位時完全不動', async () => {
        setupEmployeeFind({ emailData: [matchedByEmail()], existingByNo: [] })
        const filled = await createWorkbookBuffer([
          person('NEW-99', { email: OLD_EMAIL, signTags: '財務覆核', signRole: '核定', signLevel: 'L4' }),
        ])
        const withValues = await postImport(filled, { updateExisting: true })
        expect(withValues.status).toBe(200)
        expect(withValues.body.warnings.filter((w) => /清除/.test(w))).toEqual([])

        mockEmployeeModel.updateOne.mockClear()
        const oldFormat = await createWorkbookBuffer([person('NEW-99', { email: OLD_EMAIL })], { signColumns: 'none' })
        const withoutColumns = await postImport(oldFormat, { updateExisting: true })
        expect(withoutColumns.status).toBe(200)
        const update = mockEmployeeModel.updateOne.mock.calls[0][1]
        ;['signTags', 'signRole', 'signLevel'].forEach((key) => expect(update.$set).not.toHaveProperty(key))
        expect(withoutColumns.body.warnings.filter((w) => /簽核/.test(w))).toEqual([])
      })

      it('Mongoose 文件轉成純物件再用，既有的聯絡人在合併新聯絡人時保留（子文件不會被整個展開）', async () => {
        const stored = matchedByEmail({
          emergencyContacts: [{ name: '甲', relation: '配偶', phone1: '0911', phone2: '' }],
        })
        // 像 Mongoose 的子文件：直接展開只會得到內部欄位（$__、_doc），要 toObject() 才有真正的內容
        const subdocument = { $__: {}, _doc: stored.emergencyContacts[0], toObject: () => ({ ...stored.emergencyContacts[0] }) }
        const document = {
          ...stored,
          emergencyContacts: [subdocument],
          toObject: () => ({ ...stored }),
        }
        setupEmployeeFind({ emailData: [document], existingByNo: [] })
        const buffer = await createWorkbookBuffer([
          person('NEW-99', { email: OLD_EMAIL, emergency2_name: '乙', emergency2_relation: '兄弟', emergency2_phone1: '0922' }),
        ])

        const response = await postImport(buffer, { updateExisting: true })

        expect(response.status).toBe(200)
        const { emergencyContacts } = mockEmployeeModel.updateOne.mock.calls[0][1].$set
        expect(emergencyContacts).toEqual([
          { name: '甲', relation: '配偶', phone1: '0911', phone2: '' },
          { name: '乙', relation: '兄弟', phone1: '0922', phone2: '' },
        ])
        expect(JSON.stringify(emergencyContacts)).not.toContain('toObject')
      })
    })

    it('不認得的角色不會拿來清空原有角色', async () => {
      stubExisting()
      const buffer = await createWorkbookBuffer([person('E001', { signTags: '人資', signRole: 'banana' })])

      const response = await postImport(buffer, { updateExisting: true })

      expect(response.status).toBe(200)
      const update = mockEmployeeModel.updateOne.mock.calls[0][1]
      expect(update.$set.signTags).toEqual(['人資'])
      expect(update.$set).not.toHaveProperty('signRole')
    })
  })
})

describe('批量匯入：人員狀態', () => {
  it('常見寫法會對應到系統狀態（已離職、在職、留停…），不再默默變成正職員工', async () => {
    const buffer = await createWorkbookBuffer([
      person('E001', { status: '已離職' }),
      person('E002', { status: '在職' }),
      person('E003', { status: '留停' }),
      person('E004', { status: '試用期' }),
      person('E005', { status: '離職員工' }),
    ])

    const response = await postImport(buffer)

    expect(response.status).toBe(200)
    const docs = mockEmployeeModel.insertMany.mock.calls[0][0]
    expect(docs.map((doc) => doc.employmentStatus)).toEqual([
      '離職員工',
      '正職員工',
      '留職停薪',
      '試用期員工',
      '離職員工',
    ])
    expect(response.body.warnings.filter((w) => /人員狀態/.test(w))).toEqual([])
  })

  it('無法辨識的狀態（例如約聘）提醒該列，不會被當成已確認的狀態；空白儲存格沿用預設且不提醒', async () => {
    const buffer = await createWorkbookBuffer([
      person('E001', { status: '約聘' }),
      person('E002', { status: '' }),
      person('E003', { status: 1 }),
    ])

    const response = await postImport(buffer)

    expect(response.status).toBe(200)
    const docs = mockEmployeeModel.insertMany.mock.calls[0][0]
    // 沒有寫入任何人員狀態，由資料庫預設值（正職員工）決定
    docs.forEach((doc) => expect(doc.employmentStatus).toBeUndefined())
    const statusWarnings = response.body.warnings.filter((w) => /人員狀態/.test(w))
    expect(statusWarnings).toHaveLength(2)
    expect(statusWarnings[0]).toContain('第 3 列「人員狀態」的值「約聘」無法辨識')
    expect(statusWarnings[0]).toContain('正職員工')
    expect(statusWarnings[1]).toContain('第 5 列')
  })

  it('更新既有員工時，無法辨識的狀態維持原狀態不變', async () => {
    setupEmployeeFind({
      emailData: [{ _id: 'id-1', email: 'e001@example.com', employeeId: 'E001' }],
      existingByNo: [{ _id: 'id-1', employeeId: 'E001', email: 'e001@example.com' }],
    })
    const buffer = await createWorkbookBuffer([person('E001', { status: '約聘' })])

    const response = await postImport(buffer, { updateExisting: true })

    expect(response.status).toBe(200)
    expect(mockEmployeeModel.updateOne.mock.calls[0][1].$set).not.toHaveProperty('status')
    expect(response.body.warnings).toEqual(expect.arrayContaining([expect.stringContaining('維持原狀態')]))
  })
})

describe('批量匯入：被指定為主管的人', () => {
  it('在職的人被指定為主管會升為 supervisor；離職與留職停薪的人不會，並提醒', async () => {
    const buffer = await createWorkbookBuffer([
      person('S001', { status: '正職員工' }),
      person('S002', { status: '離職' }),
      person('S003', { status: '留職停薪' }),
      person('E010', { supervisor: 'S001' }),
      person('E011', { supervisor: 'S002' }),
      person('E012', { supervisor: 'S003' }),
    ])

    const response = await postImport(buffer)

    expect(response.status).toBe(200)
    const docs = mockEmployeeModel.insertMany.mock.calls[0][0]
    const roleOf = (no) => docs.find((doc) => doc.employeeNo === no).role
    expect(roleOf('S001')).toBe('supervisor')
    expect(roleOf('S002')).toBe('employee')
    expect(roleOf('S003')).toBe('employee')
    expect(response.body.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('第 4 列的員工是「離職員工」'),
      expect.stringContaining('第 5 列的員工是「留職停薪」'),
    ]))
    expect(response.body.warnings.filter((w) => /不會自動設為主管權限/.test(w))).toHaveLength(2)
  })

  it('明確指定預設權限時不提醒也不改變行為', async () => {
    const buffer = await createWorkbookBuffer([
      person('S002', { status: '離職' }),
      person('E011', { supervisor: 'S002' }),
    ])

    const response = await postImport(buffer, { defaultRole: 'admin' })

    expect(response.status).toBe(200)
    expect(mockEmployeeModel.insertMany.mock.calls[0][0].map((doc) => doc.role)).toEqual(['admin', 'admin'])
    expect(response.body.warnings.filter((w) => /不會自動設為主管權限/.test(w))).toEqual([])
  })
})
