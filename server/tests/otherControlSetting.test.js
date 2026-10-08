import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'

import { createFakeOtherControlSettingModel } from './helpers/fakeOtherControlSettingModel.js'

// 設定改存資料庫：測試用記憶體版 model 取代 MongoDB，store 與 controller 都用真的
const fakeModel = createFakeOtherControlSettingModel()

let resetOtherControlSettings
let app

const DEFAULT_ITEM_SETTINGS = {
  C03: ['助理', '專員', '經理'],
  C04: ['護理師', '藥師', '工程師'],
  C05: [
    { label: '英文', levels: ['A1', 'B2', 'C1'] },
    { label: '日文', levels: ['N3', 'N2', 'N1'] }
  ],
  C06: ['第一類', '第二類', '第三類'],
  C07: ['一般員工', '派遣', '實習'],
  C08: ['高中', '大學', '碩士', '博士'],
  C09: ['父親', '母親', '配偶', '其他'],
  C10: ['新進訓練', '專業課程', '領導力'],
  C12: ['特休假', '病假', '事假'],
  C14: ['交通補助', '餐費補助', '職務津貼']
}

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/OtherControlSetting.js', () => ({ default: fakeModel }))
  const routes = (await import('../src/routes/otherControlSettingRoutes.js')).default
  ;({ resetOtherControlSettings } = await import('../src/controllers/otherControlSettingController.js'))

  app = express()
  app.use(express.json())
  app.use('/api/other-control-settings', routes)
})

beforeEach(async () => {
  fakeModel.__clear()
  await resetOtherControlSettings()
})

describe('Other Control Settings - Item Settings', () => {

  it('回傳整體設定時包含 itemSettings 預設值', async () => {
    const res = await request(app).get('/api/other-control-settings')

    expect(res.status).toBe(200)
    expect(res.body.itemSettings).toEqual(DEFAULT_ITEM_SETTINGS)
  })

  it('可單獨取得 itemSettings 字典資料', async () => {
    const res = await request(app).get('/api/other-control-settings/item-settings')

    expect(res.status).toBe(200)
    expect(res.body).toEqual(DEFAULT_ITEM_SETTINGS)
  })

  it('拒絕非陣列的字典項目', async () => {
    const res = await request(app)
      .put('/api/other-control-settings/item-settings')
      .send({ C03: 'not-array' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('C03')
  })

  it('更新後回傳覆寫後的 itemSettings', async () => {
    const payload = {
      C03: ['實習生', '正職'],
      C05: [
        { label: '英文', levels: ['A2', 'B1'] },
        { label: '西班牙文', levels: ['初階', '進階'] }
      ]
    }

    const updateRes = await request(app)
      .put('/api/other-control-settings/item-settings')
      .send(payload)

    expect(updateRes.status).toBe(200)
    expect(updateRes.body).toMatchObject(payload)

    const fetchRes = await request(app).get('/api/other-control-settings/item-settings')

    expect(fetchRes.status).toBe(200)
    expect(fetchRes.body).toMatchObject(payload)
    expect(Object.keys(fetchRes.body)).toEqual(expect.arrayContaining(Object.keys(DEFAULT_ITEM_SETTINGS)))
  })
})

describe('Other Control Settings - 持久化（資料存在資料庫，不再只放記憶體）', () => {
  it('更新字典後資料寫進資料庫文件', async () => {
    await request(app)
      .put('/api/other-control-settings/item-settings')
      .send({ C12: ['休假', '事假', '公假'] })

    expect(fakeModel.__documents).toHaveLength(1)
    expect(fakeModel.__documents[0].key).toBe('default')
    expect(fakeModel.__documents[0].data.itemSettings.C12).toEqual(['休假', '事假', '公假'])
  })

  it('重啟後（記憶體狀態全失、只剩資料庫）仍讀得到更新後的字典、自訂欄位與分類', async () => {
    await request(app)
      .put('/api/other-control-settings/item-settings')
      .send({ C12: ['休假', '事假', '公假'] })
    await request(app)
      .put('/api/other-control-settings/custom-fields')
      .send({ customFields: [{ label: '員工證字號', fieldKey: 'nationalId', type: 'text', category: 'employee' }] })
    const created = await request(app)
      .post('/api/other-control-settings/form-categories')
      .send({ name: '考勤類', code: 'ATT' })

    // 模擬重啟：以全新的 express app 與重新載入的 controller/store 模組實例讀同一份資料庫
    jest.resetModules()
    const restartedRoutes = (await import('../src/routes/otherControlSettingRoutes.js')).default
    const restartedApp = express()
    restartedApp.use(express.json())
    restartedApp.use('/api/other-control-settings', restartedRoutes)

    const res = await request(restartedApp).get('/api/other-control-settings')

    expect(res.status).toBe(200)
    expect(res.body.itemSettings.C12).toEqual(['休假', '事假', '公假'])
    expect(res.body.customFields).toEqual([
      { label: '員工證字號', fieldKey: 'nationalId', type: 'text', category: 'employee' }
    ])
    expect(res.body.formCategories.some((category) => category.id === created.body.id)).toBe(true)
  })

  it('讀取不快取：資料庫內容被別的程序改掉時下一次請求就看得到', async () => {
    await request(app).get('/api/other-control-settings')
    fakeModel.__seed({
      key: 'default',
      revision: 5,
      data: { itemSettings: { C12: ['外部修改'] } }
    })

    const res = await request(app).get('/api/other-control-settings/item-settings')

    expect(res.body.C12).toEqual(['外部修改'])
    expect(res.body.C03).toEqual(['助理', '專員', '經理'])
  })

  it('舊資料缺少的預設欄位與字典在讀取時自動補上', async () => {
    fakeModel.__seed({ key: 'default', revision: 1, data: { notification: { enableSMS: true } } })

    const res = await request(app).get('/api/other-control-settings')

    expect(res.body.notification).toMatchObject({ enableSMS: true, enableEmail: true, digestTime: '08:30' })
    expect(res.body.itemSettings.C12).toEqual(['特休假', '病假', '事假'])
    expect(res.body.formCategories).toHaveLength(4)
  })

  it('更新一個字典不會動到其他字典，也不會動到其他區塊', async () => {
    await request(app).put('/api/other-control-settings/notification').send({ defaultReminderMinutes: 10 })
    await request(app).put('/api/other-control-settings/item-settings').send({ C14: ['全勤獎金'] })

    const res = await request(app).get('/api/other-control-settings')

    expect(res.body.itemSettings.C14).toEqual(['全勤獎金'])
    expect(res.body.itemSettings.C12).toEqual(['特休假', '病假', '事假'])
    expect(res.body.notification.defaultReminderMinutes).toBe(10)
  })
})

describe('Other Control Settings - 各區塊的回應格式', () => {
  it('整體設定的欄位順序與內容與先前相同', async () => {
    const res = await request(app).get('/api/other-control-settings')

    expect(res.status).toBe(200)
    expect(Object.keys(res.body)).toEqual([
      'notification',
      'security',
      'customFields',
      'itemSettings',
      'integration',
      'automationRules',
      'formCategories'
    ])
    expect(res.body.notification).toEqual({
      enableEmail: true,
      enableSMS: false,
      defaultReminderMinutes: 30,
      digestTime: '08:30',
      escalationTargets: ['manager'],
      frequency: 'immediate'
    })
    expect(res.body.customFields.find((field) => field.fieldKey === 'C12')).toMatchObject({
      label: '假別類別 (C12)',
      type: 'select',
      category: 'dictionary'
    })
    expect(res.body.formCategories.map((category) => category.name)).toEqual(['人事類', '總務類', '請假類', '其他'])
  })

  it('通知設定：只合併送來的欄位並回傳整份通知設定', async () => {
    const res = await request(app)
      .put('/api/other-control-settings/notification')
      .send({ enableSMS: true, frequency: 'daily' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      enableEmail: true,
      enableSMS: true,
      defaultReminderMinutes: 30,
      digestTime: '08:30',
      escalationTargets: ['manager'],
      frequency: 'daily'
    })
  })

  it('資安設定：ipWhitelist 不是陣列時保留原值，其餘欄位合併', async () => {
    const keep = await request(app)
      .put('/api/other-control-settings/security')
      .send({ sessionTimeout: 15, ipWhitelist: 'not-an-array' })

    expect(keep.status).toBe(200)
    expect(keep.body.sessionTimeout).toBe(15)
    expect(keep.body.enforce2FA).toBe(true)
    expect(keep.body.ipWhitelist).toHaveLength(2)

    const replace = await request(app)
      .put('/api/other-control-settings/security')
      .send({ ipWhitelist: [{ label: '分公司', address: '192.0.2.10' }] })

    expect(replace.body.ipWhitelist).toEqual([{ label: '分公司', address: '192.0.2.10' }])
    expect(replace.body.sessionTimeout).toBe(15)
  })

  it('整合設定：合併後回傳整份整合設定', async () => {
    const res = await request(app)
      .put('/api/other-control-settings/integration')
      .send({ vendor: 'acme', webhookUrl: 'https://example.invalid/hook' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      vendor: 'acme',
      syncSchedule: true,
      syncPayroll: false,
      webhookUrl: 'https://example.invalid/hook',
      autoRetry: true,
      lastSync: '尚未同步',
      statusMessage: '等待測試'
    })
  })

  it('自訂欄位：整份取代並回傳；非陣列回 400', async () => {
    const bad = await request(app).put('/api/other-control-settings/custom-fields').send({ customFields: 'x' })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'customFields 必須為陣列' })

    const noBody = await request(app).put('/api/other-control-settings/custom-fields').send({})
    expect(noBody.status).toBe(400)

    const customFields = [{ label: 'A', fieldKey: 'a', type: 'text', category: 'employee' }]
    const ok = await request(app).put('/api/other-control-settings/custom-fields').send({ customFields })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual(customFields)
    expect(fakeModel.__documents[0].data.customFields).toEqual(customFields)
  })

  it('字典更新：非物件回 400（不會寫入資料庫）', async () => {
    const res = await request(app).put('/api/other-control-settings/item-settings').send([])

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'itemSettings 必須為物件' })
    expect(fakeModel.__documents).toHaveLength(0)
  })

  it('字典更新：可以新增自訂字典、可以清空既有字典', async () => {
    const res = await request(app)
      .put('/api/other-control-settings/item-settings')
      .send({ C99: ['A', 'B'], C03: [] })

    expect(res.status).toBe(200)
    expect(res.body.C99).toEqual(['A', 'B'])
    expect(res.body.C03).toEqual([])
  })
})

describe('Other Control Settings - 表單分類', () => {
  it('列出內建分類', async () => {
    const res = await request(app).get('/api/other-control-settings/form-categories')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(4)
    expect(res.body.every((category) => category.builtin === true)).toBe(true)
  })

  it('新增分類：回 201 與完整物件，code 預設為 name，欄位會 trim', async () => {
    const res = await request(app)
      .post('/api/other-control-settings/form-categories')
      .send({ name: '  考勤類  ', description: ' 出勤相關 ' })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.any(String),
      name: '考勤類',
      code: '考勤類',
      description: '出勤相關',
      builtin: false
    })

    const list = await request(app).get('/api/other-control-settings/form-categories')
    expect(list.body).toHaveLength(5)
    expect(list.body[4]).toEqual(res.body)
  })

  it('新增分類：缺 name 回 400、code 重複回 409，都不會寫入', async () => {
    const missing = await request(app).post('/api/other-control-settings/form-categories').send({ name: '   ' })
    expect(missing.status).toBe(400)
    expect(missing.body).toEqual({ error: 'name 為必填欄位' })

    const emptyCode = await request(app)
      .post('/api/other-control-settings/form-categories')
      .send({ name: '有名稱', code: '   ' })
    expect(emptyCode.status).toBe(400)
    expect(emptyCode.body).toEqual({ error: 'code 為必填欄位' })

    const duplicate = await request(app)
      .post('/api/other-control-settings/form-categories')
      .send({ name: '另一個人事類', code: '人事類' })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body).toEqual({ error: 'code 已存在' })

    expect(fakeModel.__documents).toHaveLength(0)
  })

  it('更新分類：只改有送來的欄位並回傳更新後物件，內建分類也可改名', async () => {
    const created = await request(app)
      .post('/api/other-control-settings/form-categories')
      .send({ name: '考勤類', code: 'ATT', description: '舊說明' })

    const updated = await request(app)
      .put(`/api/other-control-settings/form-categories/${created.body.id}`)
      .send({ description: ' 新說明 ' })
    expect(updated.status).toBe(200)
    expect(updated.body).toEqual({ ...created.body, description: '新說明' })

    const builtin = await request(app)
      .put('/api/other-control-settings/form-categories/cat-other')
      .send({ name: '其他類' })
    expect(builtin.status).toBe(200)
    expect(builtin.body).toMatchObject({ id: 'cat-other', name: '其他類', code: '其他', builtin: true })

    const list = await request(app).get('/api/other-control-settings/form-categories')
    expect(list.body.find((category) => category.id === 'cat-other').name).toBe('其他類')
  })

  it('更新分類：找不到回 404、清空 name 回 400、code 與別的分類重複回 409', async () => {
    const missing = await request(app).put('/api/other-control-settings/form-categories/nope').send({ name: 'x' })
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '找不到指定分類' })

    const emptyName = await request(app)
      .put('/api/other-control-settings/form-categories/cat-other')
      .send({ name: '  ' })
    expect(emptyName.status).toBe(400)
    expect(emptyName.body).toEqual({ error: 'name 為必填欄位' })

    const emptyCode = await request(app)
      .put('/api/other-control-settings/form-categories/cat-other')
      .send({ code: '' })
    expect(emptyCode.status).toBe(400)
    expect(emptyCode.body).toEqual({ error: 'code 為必填欄位' })

    const duplicate = await request(app)
      .put('/api/other-control-settings/form-categories/cat-other')
      .send({ code: '人事類' })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body).toEqual({ error: 'code 已存在' })

    const sameCode = await request(app)
      .put('/api/other-control-settings/form-categories/cat-other')
      .send({ code: '其他' })
    expect(sameCode.status).toBe(200)

    // 驗證失敗的請求都沒有改到資料
    const list = await request(app).get('/api/other-control-settings/form-categories')
    expect(list.body.find((category) => category.id === 'cat-other')).toMatchObject({ name: '其他', code: '其他' })
  })

  it('刪除分類：自訂分類可刪（回 { success: true }），內建回 400，找不到回 404', async () => {
    const created = await request(app)
      .post('/api/other-control-settings/form-categories')
      .send({ name: '考勤類', code: 'ATT' })

    const removed = await request(app).delete(`/api/other-control-settings/form-categories/${created.body.id}`)
    expect(removed.status).toBe(200)
    expect(removed.body).toEqual({ success: true })

    const builtin = await request(app).delete('/api/other-control-settings/form-categories/cat-personnel')
    expect(builtin.status).toBe(400)
    expect(builtin.body).toEqual({ error: '內建分類無法刪除' })

    const missing = await request(app).delete(`/api/other-control-settings/form-categories/${created.body.id}`)
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '找不到指定分類' })

    const list = await request(app).get('/api/other-control-settings/form-categories')
    expect(list.body).toHaveLength(4)
  })
})

describe('Other Control Settings - 資料庫錯誤', () => {
  const DRIVER_MESSAGE = 'connect ECONNREFUSED 10.0.0.5:27017 mongodb://admin:s3cret@db.internal/hr'
  let errorSpy

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  function breakReads() {
    fakeModel.__breakReads(Object.assign(new Error(DRIVER_MESSAGE), { name: 'MongoNetworkError' }))
  }

  const cases = [
    ['get', '/api/other-control-settings', undefined],
    ['get', '/api/other-control-settings/item-settings', undefined],
    ['get', '/api/other-control-settings/form-categories', undefined],
    ['put', '/api/other-control-settings/notification', { enableSMS: true }],
    ['put', '/api/other-control-settings/security', { sessionTimeout: 5 }],
    ['put', '/api/other-control-settings/integration', { webhookUrl: 'https://example.invalid/hook?token=TOPSECRET' }],
    ['put', '/api/other-control-settings/item-settings', { C12: ['休假'] }],
    ['put', '/api/other-control-settings/custom-fields', { customFields: [] }],
    ['post', '/api/other-control-settings/form-categories', { name: '考勤類' }],
    ['put', '/api/other-control-settings/form-categories/cat-other', { name: '其他類' }],
    ['delete', '/api/other-control-settings/form-categories/cat-other', undefined]
  ]

  it.each(cases)('%s %s 資料庫失敗時回通用 500 JSON，不外洩驅動訊息', async (method, url, body) => {
    breakReads()

    const req = request(app)[method](url)
    const res = body === undefined ? await req : await req.send(body)

    expect(res.status).toBe(500)
    expect(Object.keys(res.body)).toEqual(['error'])
    expect(typeof res.body.error).toBe('string')
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|mongodb|s3cret|10\.0\.0\.5|MongoNetworkError/i)

    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toMatch(/ECONNREFUSED|mongodb|s3cret|10\.0\.0\.5|TOPSECRET|webhook/i)
  })

  it('寫入階段（findOneAndUpdate）失敗同樣回通用 500，且 log 不含設定內容', async () => {
    fakeModel.__failNextWrite(Object.assign(new Error(DRIVER_MESSAGE), { name: 'MongoServerError', code: 50 }))

    const res = await request(app)
      .put('/api/other-control-settings/integration')
      .send({ webhookUrl: 'https://example.invalid/hook?token=TOPSECRET' })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: expect.any(String) })
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|mongodb|s3cret|TOPSECRET/i)
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/ECONNREFUSED|mongodb|s3cret|TOPSECRET/i)
  })
})
