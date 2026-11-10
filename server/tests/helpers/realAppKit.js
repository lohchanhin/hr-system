// 真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone）的整合測試共用工具。
// 用法（測試檔最上面）：
//   const kit = createRealAppKit('org_structure')
//   kit.describe('…', () => { beforeAll(kit.start); afterAll(kit.stop); … })
// 沒有設定 APPROVAL_ENGINE_TEST_MONGODB_URI 時整組略過；只接受 loopback 位址，並在隨機命名的資料庫內進行，結束後整個刪除。
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import request from 'supertest'

const MODEL_FILES = {
  Employee: 'Employee.js',
  Organization: 'Organization.js',
  Department: 'Department.js',
  SubDepartment: 'SubDepartment.js',
  FormTemplate: 'form_template.js',
  FormField: 'form_field.js',
  ApprovalWorkflow: 'approval_workflow.js',
  ApprovalRequest: 'approval_request.js',
  ShiftSchedule: 'ShiftSchedule.js',
  AttendanceSetting: 'AttendanceSetting.js',
  AttendanceRecord: 'AttendanceRecord.js',
}

export function createRealAppKit(label) {
  const configured = process.env.APPROVAL_ENGINE_TEST_MONGODB_URI
  const secret = `integration-test-secret-integration-test-secret-${label}`
  const kit = {
    describe: configured ? describe : describe.skip,
    app: null,
    models: {},
    people: {},
  }

  function isolatedMongoUri() {
    const uri = new URL(configured)
    const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
    if (!localHosts.has(uri.hostname)) {
      throw new Error('Integration tests only run against a loopback MongoDB host')
    }
    uri.pathname = `/hr_${label}_${process.pid}_${Date.now()}`
    return uri.toString()
  }

  kit.start = async () => {
    process.env.NODE_ENV = 'test'
    process.env.PORT = process.env.PORT || '0'
    process.env.JWT_SECRET = secret
    process.env.MONGODB_URI = isolatedMongoUri()
    process.env.API_RATE_LIMIT_MAX = '100000'
    process.env.API_MUTATION_RATE_LIMIT_MAX = '100000'
    ;({ app: kit.app } = await import('../../src/index.js'))
    for (const [name, file] of Object.entries(MODEL_FILES)) {
      kit.models[name] = (await import(`../../src/models/${file}`)).default
    }
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all(Object.values(kit.models).map(model => model.syncIndexes()))
  }

  kit.stop = async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  }

  kit.tokenFor = (person) => jwt.sign(
    { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
    secret,
    { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
  )
  kit.as = (key) => ({ Authorization: `Bearer ${kit.tokenFor(kit.people[key])}` })
  kit.get = (key, url) => request(kit.app).get(url).set(kit.as(key))
  kit.post = (key, url, body) => request(kit.app).post(url).set(kit.as(key)).send(body ?? {})
  kit.put = (key, url, body) => request(kit.app).put(url).set(kit.as(key)).send(body ?? {})
  kit.patch = (key, url, body) => request(kit.app).patch(url).set(kit.as(key)).send(body ?? {})
  kit.del = (key, url) => request(kit.app).delete(url).set(kit.as(key))
  kit.id = (key) => String(kit.people[key]._id)

  kit.addPerson = async (key, patch = {}) => {
    kit.people[key] = await kit.models.Employee.create({
      name: key,
      employeeId: key.toUpperCase(),
      email: `${key.toLowerCase()}@example.test`,
      username: key.toLowerCase(),
      role: 'employee',
      ...patch,
    })
    return kit.people[key]
  }

  // 建立一張表單與流程；specs 是欄位 [{ label, type_1, required… }]
  kit.makeForm = async (name, semanticType, steps, specs = []) => {
    const form = await kit.models.FormTemplate.create({ name, semanticType, is_active: true })
    const fields = []
    for (const [index, field] of specs.entries()) {
      fields.push(await kit.models.FormField.create({ form: form._id, order: index + 1, ...field }))
    }
    const workflow = steps ? await kit.models.ApprovalWorkflow.create({ form: form._id, steps }) : null
    const fieldOf = (label) => String(fields.find(field => field.label === label)._id)
    return { form, fields, workflow, fieldOf }
  }

  return kit
}

export default { createRealAppKit }
