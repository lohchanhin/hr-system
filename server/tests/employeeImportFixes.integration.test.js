// 員工批量匯入：真的 Express app + 真的 MongoDB（單機 standalone，沒有交易）下才看得到的問題。
// 預設略過；要執行時指定本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27814 npm test -- tests/employeeImportFixes.integration.test.js
import { jest } from '@jest/globals'
import ExcelJS from 'exceljs'
import request from 'supertest'
import { createRealAppKit } from './helpers/realAppKit.js'

const kit = createRealAppKit('employee_import')

const ZH = {
  employeeId: '員工編號', name: '姓名', gender: '性別 (M=男, F=女, O=其他)', idNumber: '身分證號', email: '電子郵件 (必填唯一)',
  mobile: '手機號碼', landline: '市話', supervisor: '主管員工 ID', status: '人員狀態 (正職員工/試用期/離職/留職停薪)',
  emergency1_name: '緊急聯絡人1 姓名', emergency1_relation: '緊急聯絡人1 關係', emergency1_phone1: '緊急聯絡人1 電話1', emergency1_phone2: '緊急聯絡人1 電話2',
  salaryAccountA_bank: '薪資帳戶A 銀行代號', salaryAccountA_acct: '薪資帳戶A 帳號', salaryItems: '其他薪資項目 (多個逗號分隔)',
}

// 範本的全部欄位（employeeBulkImportController 的預設欄位對應）；測試只填用到的欄位，其餘留空白
const ALL_HEADERS = [
  'employeeId', 'name', 'gender', 'idNumber', 'birthDate', 'birthPlace', 'bloodType', 'languages', 'disabilityLevel', 'identityCategory',
  'maritalStatus', 'dependents', 'email', 'mobile', 'landline', 'householdAddress', 'contactAddress', 'lineId', 'organization', 'department',
  'subDepartment', 'supervisor', 'title', 'practiceTitle', 'status', 'probationDays', 'partTime', 'needClockIn', 'holidayRegime', 'isIndigenous',
  'education_level', 'education_school', 'education_major', 'education_status', 'education_graduationYear', 'militaryService_type',
  'militaryService_branch', 'militaryService_rank', 'militaryService_dischargeYear', 'emergency1_name', 'emergency1_relation', 'emergency1_phone1',
  'emergency1_phone2', 'emergency2_name', 'emergency2_relation', 'emergency2_phone1', 'emergency2_phone2', 'hireDate', 'startDate', 'resignationDate',
  'dismissalDate', 'rehireStartDate', 'rehireEndDate', 'appointment_remark', 'salaryType', 'salaryAmount', 'laborPensionSelf', 'employeeAdvance',
  'salaryAccountA_bank', 'salaryAccountA_acct', 'salaryAccountB_bank', 'salaryAccountB_acct', 'salaryItems', 'laborInsuredSalary',
  'pensionInsuredSalary', 'healthInsuredSalary', 'dependentCount',
]
// only：檔案只有這些欄位（更新模式「檔案裡沒有的欄位不動」用），搭配 mappings 送出
const columnsOf = (only) => (only ? ALL_HEADERS.filter(header => only.includes(header)) : ALL_HEADERS)

async function xlsx(only, rows, mutate) {
  const headers = columnsOf(only)
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('員工資料')
  sheet.addRow(headers)
  sheet.addRow(headers.map(header => ZH[header] || header))
  rows.forEach(row => sheet.addRow(headers.map(header => row[header] ?? '')))
  if (mutate) mutate(sheet)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function csv(only, rows) {
  const headers = columnsOf(only)
  const line = values => values.map(value => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value))).join(',')
  return Buffer.from([line(headers), line(headers.map(header => ZH[header] || header)), ...rows.map(row => line(headers.map(header => row[header] ?? '')))].join('\n'), 'utf8')
}

kit.describe('員工批量匯入 against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  const { models } = kit

  const upload = (buffer, { filename = 'import.xlsx', options = {}, valueMappings, ignore } = {}) => {
    let call = request(kit.app).post('/api/employees/bulk-import').set(kit.as('admin'))
      .attach('file', buffer, filename.endsWith('.csv') ? { filename, contentType: 'text/csv' } : { filename })
      .field('options', JSON.stringify(options))
    if (valueMappings) call = call.field('valueMappings', JSON.stringify(valueMappings))
    if (ignore) call = call.field('ignore', JSON.stringify(ignore))
    return call
  }
  const byNo = (employeeId) => models.Employee.findOne({ employeeId }).lean()

  beforeAll(async () => {
    await kit.start()
    await kit.addPerson('admin', { role: 'admin', employeeId: 'ADM-1', email: 'admin@example.test' })
  })

  afterAll(kit.stop)

  it('keeps leading zeros of phone, bank and employee numbers in a CSV file', async () => {
        const res = await upload(csv(null, [{
      employeeId: '00123', name: '王小明', idNumber: 'A123456789', email: 'zero@example.test',
      mobile: '0912345678', landline: '0229998888', salaryAccountA_bank: '004', salaryAccountA_acct: '00123456789012',
    }]), { filename: 'import.csv' })
    expect(res.status).toBe(200)
    const saved = await byNo('00123')
    // 以前 CSV 的每一格都先被轉成數字：0912345678 變成 912345678、銀行代號 004 變成 4、員工編號 00123 變成 123
    expect(saved).toBeTruthy()
    expect(saved.mobile).toBe('0912345678')
    expect(saved.landline).toBe('0229998888')
    expect(saved.salaryAccountA).toMatchObject({ bank: '004', acct: '00123456789012' })
    expect(saved.username).toBe('00123')
  })

  it('accepts a blank 性別 cell and the Chinese words 男／女', async () => {
        const res = await upload(await xlsx(null, [
      { employeeId: 'G-1', name: '沒填性別', idNumber: 'C123456789', email: 'g1@example.test', gender: '' },
      { employeeId: 'G-2', name: '填男', idNumber: 'C223456789', email: 'g2@example.test', gender: '男' },
      { employeeId: 'G-3', name: '填女性', idNumber: 'C323456789', email: 'g3@example.test', gender: '女性' },
      { employeeId: 'G-4', name: '填小寫', idNumber: 'C423456789', email: 'g4@example.test', gender: 'f' },
    ]))
    expect(res.status).toBe(200)
    // 沒填：資料庫的預設值（和在畫面上新增員工沒選性別時相同）
    expect((await byNo('G-1')).gender).toBe('M')
    expect((await byNo('G-2')).gender).toBe('M')
    expect((await byNo('G-3')).gender).toBe('F')
    expect((await byNo('G-4')).gender).toBe('F')

    // 更新模式：寫不進資料庫列舉的值不能存進去（存進去之後這位員工每次存檔都會驗證失敗，連改密碼都不行）
    const update = await upload(await xlsx(null, [
      { employeeId: 'G-1', name: '沒填性別', idNumber: 'C123456789', email: 'g1@example.test', gender: '女' },
      { employeeId: 'G-2', name: '填男', idNumber: 'C223456789', email: 'g2@example.test', gender: '不明' },
    ]), { options: { updateExisting: true } })
    expect(update.status).toBe(200)
    expect((await byNo('G-1')).gender).toBe('F')
    expect((await byNo('G-2')).gender).toBe('M')
    expect(update.body.warnings.join('\n')).toContain('性別')
    const reloaded = await models.Employee.findOne({ employeeId: 'G-2' })
    await expect(reloaded.validate()).resolves.toBeUndefined()
  })

  it('rejects two rows with the same 員工編號 with a clear message instead of a database error', async () => {
    const res = await upload(await xlsx(null, [
      { employeeId: 'DUP-1', name: '重複一', idNumber: 'D123456789', email: 'dup1@example.test' },
      { employeeId: 'DUP-1', name: '重複二', idNumber: 'D223456789', email: 'dup2@example.test' },
    ]))
    expect(res.status).toBe(400)
    expect(res.body.errors.join('\n')).toContain('員工編號重複')
    expect(res.body.errors.join('\n')).not.toMatch(/E11000|duplicate key/i)
    expect(await models.Employee.countDocuments({ employeeId: 'DUP-1' })).toBe(0)

    // 帳號（預設＝員工編號）已經是別人的登入帳號
    await models.Employee.create({ name: '帳號佔用', employeeId: 'OTHER-7', email: 'taken@example.test', username: 'T-100', role: 'employee' })
    const taken = await upload(await xlsx(null, [
      { employeeId: 'T-100', name: '新進', idNumber: 'D323456789', email: 'new-t100@example.test' },
    ]))
    expect(taken.status).toBe(400)
    expect(taken.body.errors.join('\n')).toContain('帳號「T-100」已被其他員工使用')
    expect(taken.body.errors.join('\n')).not.toMatch(/E11000|duplicate key/i)
  })

  it('lets the administrator map or ignore a supervisor the file refers to but the system does not know', async () => {
    const boss = await kit.addPerson('boss', { role: 'supervisor', employeeId: 'BOSS-1' })
    const rows = [{ employeeId: 'S-1', name: '有主管', idNumber: 'E123456789', email: 's1@example.test', supervisor: '王主任' }]
    const first = await upload(await xlsx(null, rows))
    expect(first.status).toBe(409)
    expect(first.body.missingReferences.supervisor.values.map(item => item.value)).toEqual(['王主任'])

    // 以前伺服器把 supervisor 的對應與略過丟掉，怎麼選都回同一個 409
    const mapped = await upload(await xlsx(null, rows), { valueMappings: { supervisor: { 王主任: String(boss._id) } } })
    expect(mapped.status).toBe(200)
    expect(String((await byNo('S-1')).supervisor)).toBe(String(boss._id))

    const rows2 = [{ employeeId: 'S-2', name: '略過主管', idNumber: 'E223456789', email: 's2@example.test', supervisor: '王主任' }]
    const ignored = await upload(await xlsx(null, rows2), { ignore: { supervisor: ['王主任'] } })
    expect(ignored.status).toBe(200)
    expect((await byNo('S-2')).supervisor ?? null).toBeNull()
  })

  it('update mode keeps what the file does not mention: allowance amounts and the other fields of an emergency contact', async () => {
    await models.Employee.create({
      name: '既有員工', employeeId: 'U-1', email: 'u1@example.test', username: 'u-1', role: 'employee', idNumber: 'F123456789',
      salaryItems: ['交通津貼', '伙食津貼'], salaryItemAmounts: { 交通津貼: 1500, 伙食津貼: 2400 },
      emergencyContacts: [{ name: '李媽媽', relation: '母', phone1: '0911000111', phone2: '0222223333' }],
    })
        const res = await upload(await xlsx(null, [{
      employeeId: 'U-1', name: '既有員工', idNumber: 'F123456789', email: 'u1@example.test', salaryItems: '交通津貼,職務加給', emergency1_phone1: '0922000222',
    }]), { options: { updateExisting: true } })
    expect(res.status).toBe(200)
    const saved = await byNo('U-1')
    // 仍在清單裡的項目金額不動（薪資的固定津貼從這裡算）；新加的項目是 0；拿掉的項目不留
    expect(saved.salaryItems).toEqual(['交通津貼', '職務加給'])
    expect(saved.salaryItemAmounts).toEqual({ 交通津貼: 1500, 職務加給: 0 })
    // 只填了電話1：姓名、關係、電話2 不能被清空
    expect(saved.emergencyContacts[0]).toMatchObject({ name: '李媽媽', relation: '母', phone1: '0922000222', phone2: '0222223333' })
  })

  it('update mode: a supervisor matched by e-mail under a new 員工編號 is the existing person, not a phantom id', async () => {
    const chief = await models.Employee.create({ name: '陳主任', employeeId: 'OLD-9', email: 'chief@example.test', username: 'old-9', role: 'supervisor', idNumber: 'H123456789' })
        const res = await upload(await xlsx(null, [
      { employeeId: 'NEW-99', name: '陳主任', idNumber: 'H123456789', email: 'chief@example.test' },
      { employeeId: 'P-2', name: '部屬', idNumber: 'H223456789', email: 'p2@example.test', supervisor: 'NEW-99' },
    ]), { options: { updateExisting: true } })
    expect(res.status).toBe(200)
    const subordinate = await byNo('P-2')
    expect(String(subordinate.supervisor)).toBe(String(chief._id))
    expect(await models.Employee.exists({ _id: subordinate.supervisor })).toBeTruthy()
  })

  it('keeps serving other requests while a large file is imported, and the initial passwords work', async () => {
    const count = 150
    const rows = Array.from({ length: count }, (_, index) => ({
      employeeId: `BIG-${index}`, name: `大量${index}`, idNumber: `K1${String(index).padStart(8, '0')}`, email: `big${index}@example.test`, gender: 'F',
    }))
    const buffer = await xlsx(null, rows)
    // 以前每一列都在主執行緒算一次密碼雜湊（PBKDF2 十萬次）：150 列期間計時器幾乎一次都跑不到，其他人的請求全部卡住
    let ticks = 0
    let last = Date.now()
    let longestStall = 0
    const timer = setInterval(() => {
      const now = Date.now()
      longestStall = Math.max(longestStall, now - last)
      last = now
      ticks += 1
    }, 10)
    const started = Date.now()
    let res
    try {
      res = await upload(buffer)
    } finally {
      clearInterval(timer)
    }
    const elapsed = Date.now() - started
    expect(res.status).toBe(200)
    expect(res.body.createdCount).toBe(count)
    expect(ticks).toBeGreaterThan(30)
    expect(longestStall).toBeLessThan(Math.max(elapsed / 2, 1500))

    // 初始密碼＝身分證號，登入用的驗證通過；回應的預覽不帶初始密碼（身分證號不以明碼回傳）
    const first = await models.Employee.findOne({ employeeId: 'BIG-0' }).select('+passwordHash')
    const lastOne = await models.Employee.findOne({ employeeId: `BIG-${count - 1}` }).select('+passwordHash')
    expect(first.verifyPassword('K100000000')).toBe(true)
    expect(first.verifyPassword('K100000001')).toBe(false)
    expect(lastOne.verifyPassword(`K1${String(count - 1).padStart(8, '0')}`)).toBe(true)
    expect(res.body.preview[0]).not.toHaveProperty('initialPassword')
    expect(JSON.stringify(res.body)).not.toContain('K100000000')
  })

  it('puts an employee in the 護理部 of the 機構 on the same row when several 機構 have a department of that name', async () => {
    const orgA = await models.Organization.create({ name: '迦南醫院' })
    const orgB = await models.Organization.create({ name: '迦南護理之家' })
    const deptA = await models.Department.create({ name: '護理部', code: 'NUR-A', organization: orgA._id })
    const deptB = await models.Department.create({ name: '護理部', code: 'NUR-B', organization: orgB._id })
    const res = await upload(await xlsx(null, [
      { employeeId: 'D-A', name: '醫院護理師', idNumber: 'L123456789', email: 'da@example.test', organization: '迦南醫院', department: '護理部' },
      { employeeId: 'D-B', name: '護理之家護理師', idNumber: 'L223456789', email: 'db@example.test', organization: '迦南護理之家', department: '護理部' },
      { employeeId: 'D-C', name: '用代碼', idNumber: 'L323456789', email: 'dc@example.test', organization: '迦南醫院', department: 'NUR-A' },
    ]))
    expect(res.status).toBe(200)
    // 以前不看機構，同名的部門誰最後讀到就用誰：兩個人都進了同一個機構的護理部
    expect(String((await byNo('D-A')).department)).toBe(String(deptA._id))
    expect(String((await byNo('D-B')).department)).toBe(String(deptB._id))
    expect((await byNo('D-B')).organization).toBe(String(orgB._id))
    expect(String((await byNo('D-C')).department)).toBe(String(deptA._id))

    // 沒有填機構、名稱又對到好幾個部門：不能替使用者猜，請他補機構或改用部門代碼
    const ambiguous = await upload(await xlsx(null, [
      { employeeId: 'D-D', name: '沒填機構', idNumber: 'L423456789', email: 'dd@example.test', department: '護理部' },
    ]))
    expect(ambiguous.status).toBe(400)
    expect(ambiguous.body.errors.join('\n')).toContain('部門「護理部」在多個機構都有')
    expect(await byNo('D-D')).toBeNull()
  })

  it('update mode cannot lock every administrator out by setting the last one to 離職', async () => {
        const res = await upload(await xlsx(null, [
      { employeeId: 'ADM-1', name: 'admin', idNumber: 'J123456789', email: 'admin@example.test', status: '離職' },
    ]), { options: { updateExisting: true } })
    expect(res.status).toBe(400)
    expect(res.body.errors.join('\n')).toContain('管理員')
    expect((await byNo('ADM-1')).status).toBe('正職員工')
    // 管理員還能登入系統操作
    expect((await kit.get('admin', '/api/employees?pageSize=1')).status).toBe(200)
  })

  it('a file without some optional template columns still imports; a missing required column is named in Chinese', async () => {
    // 只留必填與幾個常用欄位（範本的血型、學歷…都刪掉了）：以前整批回「匯入檔案缺少必要欄位」
    const few = ['employeeId', 'name', 'idNumber', 'email', 'mobile', 'department']
    const department = await models.Department.create({ name: '復健科', organization: (await models.Organization.create({ name: '復健機構' }))._id })
    const res = await upload(await xlsx(few, [
      { employeeId: 'OPT-1', name: '少欄位', idNumber: 'M123456789', email: 'opt1@example.test', mobile: '0911000111', department: '復健科' },
    ]))
    expect(res.status).toBe(200)
    expect(res.body.createdCount).toBe(1)
    expect(res.body.warnings.join('\n')).toContain('檔案沒有這些欄位，已略過')
    expect((await byNo('OPT-1')).mobile).toBe('0911000111')
    // 結果帶部門名稱（department 仍是部門 _id）；沒有初始密碼
    expect(res.body.preview[0]).toMatchObject({ department: String(department._id), departmentName: '復健科' })
    expect(res.body.preview[0]).not.toHaveProperty('initialPassword')
    // 匯入成功時不再出現「資料庫為單機模式…」的提醒
    expect(res.body.warnings.join('\n')).not.toContain('單機模式')

    const noEmail = await upload(await xlsx(['employeeId', 'name', 'idNumber'], [
      { employeeId: 'OPT-2', name: '沒有 Email 欄', idNumber: 'M223456789' },
    ]))
    expect(noEmail.status).toBe(400)
    expect(noEmail.body.errors).toEqual(['找不到必填欄位「Email」（檔案第 1 列要有「email」）'])
    expect(await byNo('OPT-2')).toBeNull()
  })

  it('recognises a short description row whose labels carry remarks (員工編號 (必填) …)', async () => {
    const only = ['employeeId', 'name', 'email', 'idNumber']
    const res = await upload(await xlsx(only, [
      { employeeId: 'DESC-1', name: '說明列', idNumber: 'M323456789', email: 'desc1@example.test' },
    ], (sheet) => {
      // 第 2 列改成範本的寫法（括號備註）：完全相同的只有「電子郵件 (必填唯一)」一格，以前會被當成第一筆資料
      sheet.getRow(2).values = ['員工編號 (必填)', '姓名 (必填)', '電子郵件 (必填唯一)', '身分證號 (作為初始密碼)']
    }))
    expect(res.status).toBe(200)
    expect(res.body.createdCount).toBe(1)
    expect(await byNo('DESC-1')).toBeTruthy()
  })
})
