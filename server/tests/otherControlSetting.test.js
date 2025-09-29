import express from 'express'
import request from 'supertest'

import routes from '../src/routes/otherControlSettingRoutes.js'
import { resetOtherControlSettings } from '../src/controllers/otherControlSettingController.js'

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
  C11: ['日班', '晚班', '大夜班'],
  C12: ['特休假', '病假', '事假'],
  C13: ['專案趕工', '系統維護', '例行支援'],
  C14: ['交通補助', '餐費補助', '職務津貼']
}

const app = express()
app.use(express.json())
app.use('/api/other-control-settings', routes)

describe('Other Control Settings - Item Settings', () => {
  beforeEach(() => {
    resetOtherControlSettings()
  })

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
