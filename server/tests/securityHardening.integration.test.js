// 權限與輸入檢查的端到端測試：真的 Express app（src/index.js）+ 真的登入 + 真的 MongoDB（單機 standalone）。
// 預設略過；要執行時指定一個本機的暫用資料庫（和其他整合測試相同的環境變數）：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27321 npm test -- tests/securityHardening.integration.test.js
// 只接受 loopback 位址，並在隨機命名的資料庫內進行，結束後整個刪除。
import crypto from 'crypto'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import request from 'supertest'

const configured = process.env.APPROVAL_ENGINE_TEST_MONGODB_URI
const describeIntegration = configured ? describe : describe.skip

function isolatedMongoUri() {
  const uri = new URL(configured)
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
  if (!localHosts.has(uri.hostname)) {
    throw new Error('Security hardening integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_security_hardening_${process.pid}_${Date.now()}`
  return uri.toString()
}

describeIntegration('authentication, authorization and input handling through the real app', () => {
  jest.setTimeout(120000)
  let app
  let Employee
  let AttendanceRecord
  let SubDepartment
  const people = {}
  const tokens = {}
  const PASSWORD = 'Start1234pw'

  const id = (key) => String(people[key]._id)
  const as = (key) => ({ Authorization: `Bearer ${tokens[key]}` })
  const login = (username, password) => request(app).post('/api/login').send({ username, password })

  async function addPerson(key, patch = {}) {
    people[key] = await Employee.create({
      name: key,
      email: `${key}@example.test`,
      username: key,
      password: PASSWORD,
      role: 'employee',
      employeeId: `E-${key}`,
      ...patch,
    })
    return people[key]
  }

  async function signIn(key) {
    const res = await login(key, PASSWORD)
    expect(res.status).toBe(200)
    tokens[key] = res.body.token
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.PORT = process.env.PORT || '0'
    process.env.JWT_SECRET = 'integration-test-secret-integration-test-secret'
    process.env.MONGODB_URI = isolatedMongoUri()
    process.env.API_RATE_LIMIT_MAX = '100000'
    process.env.API_MUTATION_RATE_LIMIT_MAX = '100000'
    process.env.LOGIN_RATE_LIMIT_IP_MAX = '100000'
    process.env.LOGIN_RATE_LIMIT_ACCOUNT_MAX = '100000'
    ;({ app } = await import('../src/index.js'))
    ;({ default: Employee } = await import('../src/models/Employee.js'))
    ;({ default: AttendanceRecord } = await import('../src/models/AttendanceRecord.js'))
    ;({ default: SubDepartment } = await import('../src/models/SubDepartment.js'))
    const { default: Department } = await import('../src/models/Department.js')
    const { default: Organization } = await import('../src/models/Organization.js')
    await mongoose.connect(process.env.MONGODB_URI)
    await Employee.syncIndexes()

    const org = await Organization.create({ name: '測試機構' })
    const nursing = await Department.create({ name: '護理部', organization: org._id })
    const care = await Department.create({ name: '長照部', organization: org._id })
    const ward = await SubDepartment.create({ name: '3A 病房', department: nursing._id })
    people.org = org
    people.ward = ward

    await addPerson('headnurse', { role: 'supervisor', department: nursing._id })
    await addPerson('nurse', { department: nursing._id, subDepartment: ward._id, supervisor: people.headnurse._id })
    await addPerson('carer', { department: care._id })
    await addPerson('planner', { department: nursing._id })
    await SubDepartment.updateOne({ _id: ward._id }, { $set: { schedulers: [people.planner._id] } })

    const punch = (key, hour) => ({
      employee: people[key]._id,
      action: 'clockIn',
      timestamp: new Date(Date.UTC(2031, 2, 3, hour)),
      source: 'import',
    })
    await AttendanceRecord.insertMany([punch('nurse', 0), punch('nurse', 1), punch('carer', 0), punch('carer', 1), punch('carer', 2)])

    for (const key of ['headnurse', 'nurse', 'carer', 'planner']) await signIn(key)
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  describe('Mongo operators in the query string', () => {
    const employeesIn = (res) => Array.from(new Set(res.body.map((row) => String(row.employee?._id ?? row.employee)))).sort()

    it('still lets a supervisor read the punches of a direct report, and nothing of another department', async () => {
      const own = await request(app).get(`/api/attendance?employee=${id('nurse')}`).set(as('headnurse'))
      expect(own.status).toBe(200)
      expect(employeesIn(own)).toEqual([id('nurse')])

      const other = await request(app).get(`/api/attendance?employee=${id('carer')}`).set(as('headnurse'))
      expect(other.status).toBe(403)
    })

    // 以前 ?employee[$gte]=<部屬> 會先用「找到的第一位員工」（部屬本人）通過範圍檢查，
    // 再把 { $gte: ... } 原樣當成查詢條件，查出編號比部屬大的所有員工的打卡記錄（其他部門也在內）
    it.each([
      ['$gte', (nurseId) => `employee[$gte]=${nurseId}`],
      ['$exists', () => 'employee[$exists]=true'],
      ['$ne', () => 'employee[$ne]=000000000000000000000000'],
      ['$in', (nurseId, carerId) => `employee[$in][]=${nurseId}&employee[$in][]=${carerId}`],
    ])('refuses %s on the attendance list instead of widening the scope', async (_name, buildQuery) => {
      const res = await request(app)
        .get(`/api/attendance?${buildQuery(id('nurse'), id('carer'))}`)
        .set(as('headnurse'))

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid query parameter')
      expect(JSON.stringify(res.body)).not.toContain(id('carer'))
    })

    it('refuses operators on the department report as well', async () => {
      const res = await request(app)
        .get('/api/reports/department/attendance/export?month=2031-03&format=json&department[$exists]=true')
        .set(as('headnurse'))

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid query parameter')
    })
  })

  describe('schedule export', () => {
    // index.js 依路徑（/export）決定要不要查排班權限，但路徑比對不分大小寫：以前 /EXPORT 會繞過檢查
    it('needs schedule access whatever the letter case of the path', async () => {
      const query = `month=2031-03&department=${people.ward.department}&format=excel`
      for (const path of ['/api/schedules/export', '/api/schedules/EXPORT', '/api/schedules/Export/']) {
        const refused = await request(app).get(`${path}?${query}`).set(as('nurse'))
        expect(refused.status).toBe(403)
      }

      const allowed = await request(app).get(`/api/schedules/export?${query}`).set(as('planner'))
      expect(allowed.status).toBe(200)
      expect(allowed.headers['content-type']).toContain('spreadsheetml')
    })
  })

  describe('malformed ids', () => {
    it('answers 400 (not 500 with the database error) when a scheduler sends a malformed schedule or employee id', async () => {
      const put = await request(app).put('/api/schedules/not-an-id').set(as('planner')).send({})
      expect(put.status).toBe(400)
      expect(put.body).toEqual({ error: 'Invalid employee or schedule id' })

      const remove = await request(app).delete('/api/schedules/not-an-id').set(as('planner'))
      expect(remove.status).toBe(400)

      const batch = await request(app)
        .post('/api/schedules/batch')
        .set(as('planner'))
        .send({ schedules: [{ employee: { $ne: null }, date: '2031-03-03', shiftId: 'x' }] })
      expect(batch.status).toBe(400)
      expect(JSON.stringify(batch.body)).not.toContain('Cast to')
    })

    it('answers 400 for a malformed organization filter on the department list', async () => {
      const bad = await request(app).get('/api/departments?organization=zzz').set(as('nurse'))
      expect(bad.status).toBe(400)
      expect(bad.body.error).toBe('Invalid organization filter')

      const good = await request(app).get(`/api/departments?organization=${people.org._id}`).set(as('nurse'))
      expect(good.status).toBe(200)
      expect(good.body.map((department) => department.name).sort()).toEqual(['護理部', '長照部'])
    })
  })

  describe('changing the password', () => {
    // 舊版資料的性別存成中文，不符合現在的格式：整份驗證會失敗。
    // 以前這位員工一改密碼，存檔的錯誤沒有人接，整個服務直接結束（所有人斷線）。
    it('lets an employee whose stored record has legacy field values change the password, and ends the old sessions', async () => {
      const salt = crypto.randomBytes(16).toString('hex')
      const hash = crypto.pbkdf2Sync(PASSWORD, salt, 100000, 64, 'sha512').toString('hex')
      const inserted = await Employee.collection.insertOne({
        username: 'legacy',
        passwordHash: `${salt}:${hash}`,
        role: 'employee',
        name: '舊資料員工',
        email: 'legacy@example.test',
        gender: '女',
        status: '正職員工',
        accountEnabled: true,
        authVersion: 0,
      })
      const signedIn = await login('legacy', PASSWORD)
      expect(signedIn.status).toBe(200)
      const oldToken = signedIn.body.token

      const same = await request(app)
        .post('/api/change-password')
        .set('Authorization', `Bearer ${oldToken}`)
        .send({ oldPassword: PASSWORD, newPassword: PASSWORD })
      expect(same.status).toBe(400)
      expect(same.body.error).toBe('新密碼不可與舊密碼相同')

      const changed = await request(app)
        .post('/api/change-password')
        .set('Authorization', `Bearer ${oldToken}`)
        .send({ oldPassword: PASSWORD, newPassword: 'Changed5678pw' })
      expect(changed.status).toBe(200)

      const stored = await Employee.collection.findOne({ _id: inserted.insertedId })
      expect(stored.authVersion).toBe(1)
      expect(stored.gender).toBe('女')
      expect(stored.passwordHash).not.toBe(`${salt}:${hash}`)

      expect((await request(app).get('/api/profile').set('Authorization', `Bearer ${oldToken}`)).status).toBe(401)
      expect((await login('legacy', PASSWORD)).status).toBe(401)
      expect((await login('legacy', 'Changed5678pw')).status).toBe(200)
      // 服務還在
      expect((await request(app).get('/api/health')).status).toBe(200)
    })

    it('stops accepting guesses of the old password after 10 wrong attempts for that account only', async () => {
      const guess = (key, oldPassword) => request(app)
        .post('/api/change-password')
        .set(as(key))
        .send({ oldPassword, newPassword: 'Another9012pw' })

      const statuses = []
      for (let i = 0; i < 10; i += 1) statuses.push((await guess('carer', `Wrong${i}pw`)).status)
      expect(statuses).toEqual(Array(10).fill(400))

      const locked = await guess('carer', PASSWORD)
      expect(locked.status).toBe(429)
      expect(locked.body.error).toBe('舊密碼錯誤次數過多，請稍後再試')
      // 密碼沒有被改掉
      expect((await login('carer', PASSWORD)).status).toBe(200)

      // 其他帳號不受影響
      const other = await guess('nurse', PASSWORD)
      expect(other.status).toBe(200)
    })
  })
})
