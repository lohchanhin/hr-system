import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'

// 這份測試把 store 整個換成假的，只驗證 controller：
// 每支 API 都透過 store 讀寫（沒有自己的記憶體狀態），並維持原本的回應格式與驗證規則。

const clone = (value) => JSON.parse(JSON.stringify(value))

function makeState() {
  return {
    notification: { enableEmail: true, enableSMS: false, frequency: 'immediate' },
    security: {
      enforce2FA: true,
      sessionTimeout: 30,
      ipWhitelist: [{ label: '總部', address: '203.0.113.0/24' }]
    },
    customFields: [{ label: 'A', fieldKey: 'a', type: 'text', category: 'employee' }],
    itemSettings: { C03: ['助理'], C12: ['特休假', '病假', '事假'] },
    integration: { vendor: 'none', webhookUrl: '' },
    automationRules: [],
    formCategories: [
      { id: 'cat-builtin', name: '人事類', code: '人事類', description: '', builtin: true },
      { id: 'cat-custom', name: '考勤類', code: 'ATT', description: '舊', builtin: false }
    ]
  }
}

let state = makeState()
let retryMutator = false

const getSettings = jest.fn(async () => clone(state))
const updateSettings = jest.fn(async (mutator) => {
  const draft = clone(state)
  await mutator(draft)
  if (retryMutator) {
    // 模擬樂觀鎖衝突：store 會重新讀取後把 mutator 再跑一次
    const again = clone(state)
    await mutator(again)
    state = again
  } else {
    state = draft
  }
  return clone(state)
})
const resetSettings = jest.fn(async () => {
  state = makeState()
})

let controller
let app

beforeAll(async () => {
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings,
    updateSettings,
    resetSettings
  }))
  controller = await import('../src/controllers/otherControlSettingController.js')
  const routes = (await import('../src/routes/otherControlSettingRoutes.js')).default

  app = express()
  app.use(express.json())
  app.use('/api/other-control-settings', routes)
})

beforeEach(() => {
  state = makeState()
  retryMutator = false
  getSettings.mockClear()
  updateSettings.mockClear()
  resetSettings.mockClear()
})

const BASE = '/api/other-control-settings'

describe('otherControlSettingController - 讀取都經由 store', () => {
  it('GET / 回傳 store 的整份設定', async () => {
    const res = await request(app).get(BASE)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(state)
    expect(getSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('GET /item-settings 與 /form-categories 只回對應區塊', async () => {
    const items = await request(app).get(`${BASE}/item-settings`)
    const categories = await request(app).get(`${BASE}/form-categories`)

    expect(items.body).toEqual(state.itemSettings)
    expect(categories.body).toEqual(state.formCategories)
    expect(getSettings).toHaveBeenCalledTimes(2)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('controller 自己不留狀態：store 內容變了，下一次請求就是新內容', async () => {
    await request(app).put(`${BASE}/item-settings`).send({ C12: ['休假'] })
    state.itemSettings.C12 = ['外部修改']

    const res = await request(app).get(`${BASE}/item-settings`)

    expect(res.body.C12).toEqual(['外部修改'])
  })
})

describe('otherControlSettingController - 寫入都經由 store.updateSettings', () => {
  it('PUT /notification 合併欄位、寫入 store、回傳通知區塊', async () => {
    const res = await request(app).put(`${BASE}/notification`).send({ enableSMS: true, extra: 1 })

    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(typeof updateSettings.mock.calls[0][0]).toBe('function')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enableEmail: true, enableSMS: true, frequency: 'immediate', extra: 1 })
    expect(state.notification).toEqual(res.body)
  })

  it('PUT /security 保留非陣列的 ipWhitelist，陣列則整份取代', async () => {
    const keep = await request(app).put(`${BASE}/security`).send({ sessionTimeout: 5, ipWhitelist: 'x' })
    expect(keep.body.ipWhitelist).toEqual([{ label: '總部', address: '203.0.113.0/24' }])
    expect(keep.body.sessionTimeout).toBe(5)

    const replace = await request(app)
      .put(`${BASE}/security`)
      .send({ ipWhitelist: [{ label: 'B', address: '1.1.1.1' }] })
    expect(replace.body.ipWhitelist).toEqual([{ label: 'B', address: '1.1.1.1' }])
    expect(state.security.ipWhitelist).toEqual([{ label: 'B', address: '1.1.1.1' }])
    expect(updateSettings).toHaveBeenCalledTimes(2)
  })

  it('PUT /integration 合併欄位並回傳整合區塊', async () => {
    const res = await request(app).put(`${BASE}/integration`).send({ vendor: 'acme' })

    expect(res.body).toEqual({ vendor: 'acme', webhookUrl: '' })
    expect(state.integration).toEqual(res.body)
    expect(updateSettings).toHaveBeenCalledTimes(1)
  })

  it('PUT /item-settings 只取代送來的字典，其餘保留；驗證失敗時不碰 store', async () => {
    const invalid = await request(app).put(`${BASE}/item-settings`).send({ C03: 'x' })
    const notObject = await request(app).put(`${BASE}/item-settings`).send([1])
    expect(invalid.status).toBe(400)
    expect(invalid.body).toEqual({ error: 'itemSettings.C03 必須為陣列' })
    expect(notObject.status).toBe(400)
    expect(notObject.body).toEqual({ error: 'itemSettings 必須為物件' })
    expect(updateSettings).not.toHaveBeenCalled()
    expect(getSettings).not.toHaveBeenCalled()

    const ok = await request(app).put(`${BASE}/item-settings`).send({ C12: ['休假', '公假'] })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ C03: ['助理'], C12: ['休假', '公假'] })
    expect(updateSettings).toHaveBeenCalledTimes(1)
  })

  it('PUT /custom-fields 整份取代；非陣列回 400 且不碰 store', async () => {
    const bad = await request(app).put(`${BASE}/custom-fields`).send({ customFields: {} })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'customFields 必須為陣列' })
    expect(updateSettings).not.toHaveBeenCalled()

    const next = [{ label: 'B', fieldKey: 'b', type: 'select', category: 'dictionary' }]
    const ok = await request(app).put(`${BASE}/custom-fields`).send({ customFields: next })
    expect(ok.body).toEqual(next)
    expect(state.customFields).toEqual(next)
  })

  it('resetOtherControlSettings 交給 store.resetSettings', async () => {
    state.itemSettings.C12 = ['被改過']

    await controller.resetOtherControlSettings()

    expect(resetSettings).toHaveBeenCalledTimes(1)
    expect(state.itemSettings.C12).toEqual(['特休假', '病假', '事假'])
  })
})

describe('otherControlSettingController - 表單分類', () => {
  it('POST 新增：驗證先於 store；成功回 201，id 與寫入 store 的相同', async () => {
    const noName = await request(app).post(`${BASE}/form-categories`).send({ name: ' ' })
    expect(noName.status).toBe(400)
    expect(noName.body).toEqual({ error: 'name 為必填欄位' })
    const noCode = await request(app).post(`${BASE}/form-categories`).send({ name: 'x', code: ' ' })
    expect(noCode.status).toBe(400)
    expect(noCode.body).toEqual({ error: 'code 為必填欄位' })
    expect(updateSettings).not.toHaveBeenCalled()

    const ok = await request(app)
      .post(`${BASE}/form-categories`)
      .send({ name: ' 總務類 ', code: 'GEN', description: ' d ' })
    expect(ok.status).toBe(201)
    expect(ok.body).toEqual({ id: expect.any(String), name: '總務類', code: 'GEN', description: 'd', builtin: false })
    expect(state.formCategories.at(-1)).toEqual(ok.body)
  })

  it('POST 新增：code 與既有分類重複回 409，store 內容不變', async () => {
    const res = await request(app).post(`${BASE}/form-categories`).send({ name: '重複', code: 'ATT' })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'code 已存在' })
    expect(state.formCategories).toHaveLength(2)
  })

  it('POST 新增：mutator 因衝突重跑時仍只新增一筆，回傳的 id 與存入的相同', async () => {
    retryMutator = true

    const res = await request(app).post(`${BASE}/form-categories`).send({ name: '新分類', code: 'NEW' })

    expect(res.status).toBe(201)
    expect(state.formCategories.filter((category) => category.code === 'NEW')).toHaveLength(1)
    expect(state.formCategories.at(-1).id).toBe(res.body.id)
  })

  it('PUT 更新：404 / 400 / 409 都不改動 store，成功時回傳更新後的分類', async () => {
    const missing = await request(app).put(`${BASE}/form-categories/nope`).send({ name: 'x' })
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '找不到指定分類' })

    const emptyName = await request(app).put(`${BASE}/form-categories/cat-custom`).send({ name: ' ' })
    expect(emptyName.status).toBe(400)
    expect(emptyName.body).toEqual({ error: 'name 為必填欄位' })

    const emptyCode = await request(app).put(`${BASE}/form-categories/cat-custom`).send({ code: '' })
    expect(emptyCode.status).toBe(400)
    expect(emptyCode.body).toEqual({ error: 'code 為必填欄位' })

    const duplicate = await request(app).put(`${BASE}/form-categories/cat-custom`).send({ code: '人事類' })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body).toEqual({ error: 'code 已存在' })

    expect(state).toEqual(makeState())

    const ok = await request(app).put(`${BASE}/form-categories/cat-custom`).send({ name: ' 出勤類 ' })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ id: 'cat-custom', name: '出勤類', code: 'ATT', description: '舊', builtin: false })
    expect(state.formCategories[1]).toEqual(ok.body)
  })

  it('DELETE：自訂分類可刪，內建 400，不存在 404', async () => {
    const builtin = await request(app).delete(`${BASE}/form-categories/cat-builtin`)
    expect(builtin.status).toBe(400)
    expect(builtin.body).toEqual({ error: '內建分類無法刪除' })

    const missing = await request(app).delete(`${BASE}/form-categories/nope`)
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '找不到指定分類' })
    expect(state.formCategories).toHaveLength(2)

    const ok = await request(app).delete(`${BASE}/form-categories/cat-custom`)
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ success: true })
    expect(state.formCategories.map((category) => category.id)).toEqual(['cat-builtin'])
  })
})

describe('otherControlSettingController - store 失敗', () => {
  let errorSpy

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  function driverError() {
    return Object.assign(new Error('failed to connect to mongodb://admin:s3cret@db.internal:27017'), {
      name: 'MongoServerSelectionError'
    })
  }

  it('讀取失敗：500 加上通用訊息，log 只有錯誤名稱', async () => {
    getSettings.mockRejectedValueOnce(driverError())

    const res = await request(app).get(BASE)

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: expect.any(String) })
    expect(JSON.stringify(res.body)).not.toMatch(/mongodb|s3cret|db\.internal/)
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/mongodb|s3cret|db\.internal/)
    expect(JSON.stringify(errorSpy.mock.calls)).toContain('MongoServerSelectionError')
  })

  it('寫入失敗：500 加上通用訊息，不洩漏送出的設定內容', async () => {
    updateSettings.mockRejectedValueOnce(driverError())

    const res = await request(app)
      .put(`${BASE}/integration`)
      .send({ webhookUrl: 'https://example.invalid/hook?token=TOPSECRET' })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: expect.any(String) })
    expect(JSON.stringify(res.body)).not.toMatch(/mongodb|s3cret|TOPSECRET/)
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/mongodb|s3cret|TOPSECRET/)
  })
})
