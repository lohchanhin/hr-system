import { jest } from '@jest/globals'

import { createFakeOtherControlSettingModel } from './helpers/fakeOtherControlSettingModel.js'

const fakeModel = createFakeOtherControlSettingModel()

let store

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/OtherControlSetting.js', () => ({ default: fakeModel }))
  store = await import('../src/services/otherControlSettingsStore.js')
})

beforeEach(() => {
  fakeModel.__clear()
  fakeModel.init.mockClear()
  fakeModel.findOne.mockClear()
  fakeModel.findOneAndUpdate.mockClear()
  fakeModel.deleteOne.mockClear()
})

function storedDocument(data, extra = {}) {
  return { key: 'default', data, revision: 3, ...extra }
}

describe('otherControlSettingsStore - getSettings / defaults merge', () => {
  it('尚未有任何文件時回傳預設值，且讀取不會建立文件', async () => {
    const settings = await store.getSettings()

    expect(settings.itemSettings.C12).toEqual(['特休假', '病假', '事假'])
    expect(settings.formCategories.map((category) => category.id)).toEqual([
      'cat-personnel',
      'cat-general',
      'cat-leave',
      'cat-other'
    ])
    expect(Object.keys(settings)).toEqual([
      'notification',
      'security',
      'customFields',
      'itemSettings',
      'integration',
      'automationRules',
      'formCategories'
    ])
    expect(fakeModel.__documents).toHaveLength(0)
    expect(fakeModel.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('已存的值優先，日後新增的預設欄位與字典會自動出現', async () => {
    fakeModel.__seed(
      storedDocument({
        notification: { enableEmail: false, defaultReminderMinutes: 5 },
        itemSettings: { C12: ['休假', '事假', '公假'] },
        security: { sessionTimeout: 99 }
      })
    )

    const settings = await store.getSettings()

    // 已存的值優先
    expect(settings.notification.enableEmail).toBe(false)
    expect(settings.notification.defaultReminderMinutes).toBe(5)
    expect(settings.security.sessionTimeout).toBe(99)
    expect(settings.itemSettings.C12).toEqual(['休假', '事假', '公假'])
    // 沒存過的欄位／字典／區塊由預設值補上
    expect(settings.notification.digestTime).toBe('08:30')
    expect(settings.security.ipWhitelist).toHaveLength(2)
    expect(settings.itemSettings.C03).toEqual(['助理', '專員', '經理'])
    expect(settings.integration.vendor).toBe('none')
    expect(settings.automationRules).toHaveLength(2)
    expect(settings.customFields.some((field) => field.fieldKey === 'C12')).toBe(true)
  })

  it('字典陣列以已存的整份為準，空陣列也不會被預設值補回', async () => {
    fakeModel.__seed(storedDocument({ itemSettings: { C03: [], C14: ['全勤獎金'] } }))

    const { itemSettings } = await store.getSettings()

    expect(itemSettings.C03).toEqual([])
    expect(itemSettings.C14).toEqual(['全勤獎金'])
  })

  it('已存的陣列區塊（customFields / formCategories）整份優先，內建分類缺少時補回', async () => {
    fakeModel.__seed(
      storedDocument({
        customFields: [{ label: '自訂', fieldKey: 'mine', type: 'text', category: 'employee' }],
        formCategories: [
          { id: 'cat-personnel', name: '人事類（改名）', code: '人事', description: '', builtin: true },
          { id: 'abc', name: '自訂分類', code: 'MINE', description: '', builtin: false }
        ]
      })
    )

    const settings = await store.getSettings()

    expect(settings.customFields).toEqual([{ label: '自訂', fieldKey: 'mine', type: 'text', category: 'employee' }])
    expect(settings.formCategories.map((category) => category.id)).toEqual([
      'cat-general',
      'cat-leave',
      'cat-other',
      'cat-personnel',
      'abc'
    ])
    expect(settings.formCategories.find((category) => category.id === 'cat-personnel').name).toBe('人事類（改名）')
  })

  it('保留資料庫內未知的區塊，型別不符的區塊退回預設值', async () => {
    fakeModel.__seed(
      storedDocument({
        futureSection: { enabled: true },
        notification: 'broken',
        customFields: 'broken'
      })
    )

    const settings = await store.getSettings()

    expect(settings.futureSection).toEqual({ enabled: true })
    expect(settings.notification.enableEmail).toBe(true)
    expect(Array.isArray(settings.customFields)).toBe(true)
    expect(settings.customFields.length).toBeGreaterThan(0)
  })

  it('每次回傳獨立複本，修改回傳值不會影響預設值或下一次讀取', async () => {
    const first = await store.getSettings()
    first.itemSettings.C12.push('被改過')
    first.formCategories.pop()

    const second = await store.getSettings()

    expect(second.itemSettings.C12).toEqual(['特休假', '病假', '事假'])
    expect(second.formCategories).toHaveLength(4)
    expect(store.getDefaultSettings().itemSettings.C12).toEqual(['特休假', '病假', '事假'])
  })

  it('資料庫錯誤原樣往外丟，由呼叫端決定如何回應', async () => {
    fakeModel.findOne.mockImplementationOnce(() => ({
      lean: async () => {
        throw new Error('connection refused')
      }
    }))

    await expect(store.getSettings()).rejects.toThrow('connection refused')
  })
})

describe('otherControlSettingsStore - updateSettings', () => {
  it('第一次更新時以 upsert 建立文件（revision 1，內容為預設值疊上變更）並回傳新設定', async () => {
    const result = await store.updateSettings((settings) => {
      settings.itemSettings = { ...settings.itemSettings, C12: ['休假', '事假', '公假'] }
    })

    expect(result.itemSettings.C12).toEqual(['休假', '事假', '公假'])
    expect(fakeModel.init).toHaveBeenCalled()
    expect(fakeModel.findOneAndUpdate).toHaveBeenCalledTimes(1)
    const [filter, update, options] = fakeModel.findOneAndUpdate.mock.calls[0]
    expect(filter).toEqual({ key: 'default' })
    expect(update.$setOnInsert.revision).toBe(1)
    expect(options).toMatchObject({ upsert: true, new: false })

    expect(fakeModel.__documents).toHaveLength(1)
    const [stored] = fakeModel.__documents
    expect(stored.key).toBe('default')
    expect(stored.data.itemSettings.C12).toEqual(['休假', '事假', '公假'])
    // 沒改的部分一併存入，之後讀取不需要靠預設值
    expect(stored.data.itemSettings.C03).toEqual(['助理', '專員', '經理'])
    expect(stored.data.formCategories).toHaveLength(4)

    const reread = await store.getSettings()
    expect(reread).toEqual(result)
  })

  it('已有文件時用 revision 做條件更新並遞增，只覆寫 data', async () => {
    fakeModel.__seed(storedDocument({ itemSettings: { C12: ['特休假'] } }, { revision: 7 }))

    await store.updateSettings((settings) => {
      settings.notification.defaultReminderMinutes = 15
    })

    const [filter, update, options] = fakeModel.findOneAndUpdate.mock.calls[0]
    expect(filter).toEqual({ key: 'default', revision: 7 })
    expect(Object.keys(update)).toEqual(['$set', '$inc'])
    expect(update.$inc).toEqual({ revision: 1 })
    expect(options).toMatchObject({ new: true })
    expect(fakeModel.__documents).toHaveLength(1)
    expect(fakeModel.__documents[0].revision).toBe(8)
    expect(fakeModel.__documents[0].data.notification.defaultReminderMinutes).toBe(15)
    expect(fakeModel.__documents[0].data.itemSettings.C12).toEqual(['特休假'])
  })

  it('舊文件沒有 revision 欄位時仍可更新', async () => {
    fakeModel.__seed({ key: 'default', data: { notification: { enableSMS: true } } })

    await store.updateSettings((settings) => {
      settings.notification.frequency = 'daily'
    })

    const [filter] = fakeModel.findOneAndUpdate.mock.calls[0]
    expect(filter.revision).toEqual({ $in: [null] })
    expect(fakeModel.__documents[0].revision).toBe(1)
    expect(fakeModel.__documents[0].data.notification).toMatchObject({ enableSMS: true, frequency: 'daily' })
  })

  it('mutator 可為非同步，回傳值會被忽略（只看對傳入物件的修改）', async () => {
    const result = await store.updateSettings(async (settings) => {
      await Promise.resolve()
      settings.integration.vendor = 'acme'
      return { integration: { vendor: 'ignored' }, itemSettings: {} }
    })

    expect(result.integration.vendor).toBe('acme')
    expect(result.itemSettings.C12).toEqual(['特休假', '病假', '事假'])
  })

  it('mutator 丟出錯誤時不寫入，錯誤原樣往外丟', async () => {
    fakeModel.__seed(storedDocument({ notification: { enableSMS: true } }))
    const failure = Object.assign(new Error('找不到'), { status: 404 })

    await expect(
      store.updateSettings((settings) => {
        settings.notification.enableSMS = false
        throw failure
      })
    ).rejects.toBe(failure)

    expect(fakeModel.findOneAndUpdate).not.toHaveBeenCalled()
    expect(fakeModel.__documents[0].data.notification.enableSMS).toBe(true)
    expect(fakeModel.__documents[0].revision).toBe(3)
  })

  it('mutator 若把區塊刪掉或改壞，寫入前會用預設值補齊', async () => {
    const result = await store.updateSettings((settings) => {
      delete settings.itemSettings
      settings.formCategories = []
    })

    expect(result.itemSettings.C12).toEqual(['特休假', '病假', '事假'])
    expect(result.formCategories).toHaveLength(4)
  })

  it('mutator 不是函式時拒絕', async () => {
    await expect(store.updateSettings(null)).rejects.toThrow(TypeError)
    expect(fakeModel.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('同一程序內同時更新會排隊執行，全部變更都保留且不需要重試', async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        store.updateSettings((settings) => {
          settings.itemSettings = { ...settings.itemSettings, [`Z${index}`]: [`v${index}`] }
        })
      )
    )

    const { itemSettings } = await store.getSettings()
    for (let index = 0; index < 6; index += 1) {
      expect(itemSettings[`Z${index}`]).toEqual([`v${index}`])
    }
    expect(fakeModel.__documents).toHaveLength(1)
    expect(fakeModel.__documents[0].revision).toBe(6)
    // 第一次 upsert + 之後 5 次條件更新，每次一發，沒有因衝突重試
    expect(fakeModel.findOneAndUpdate).toHaveBeenCalledTimes(6)
  })

  it('某個更新失敗不會卡住後面的更新', async () => {
    const first = store.updateSettings(() => {
      throw new Error('boom')
    })
    const second = store.updateSettings((settings) => {
      settings.integration.vendor = 'ok'
    })

    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toMatchObject({ integration: { vendor: 'ok' } })
  })

  it('別的程序在讀取與寫入之間先改了設定：重新讀取後再套用一次，兩邊的變更都保留', async () => {
    fakeModel.__seed(storedDocument({ itemSettings: { C12: ['特休假'] } }, { revision: 1 }))
    fakeModel.__beforeNextWrite((documents) => {
      documents[0].data.notification = { enableSMS: true }
      documents[0].revision = 2
    })
    const mutator = jest.fn((settings) => {
      settings.itemSettings = { ...settings.itemSettings, C12: ['休假'] }
    })

    const result = await store.updateSettings(mutator)

    expect(mutator).toHaveBeenCalledTimes(2)
    expect(result.itemSettings.C12).toEqual(['休假'])
    expect(result.notification.enableSMS).toBe(true)
    expect(fakeModel.__documents[0].revision).toBe(3)
    expect(fakeModel.__documents[0].data.notification.enableSMS).toBe(true)
    expect(fakeModel.__documents[0].data.itemSettings.C12).toEqual(['休假'])
  })

  it('同時第一次建立：另一邊先建好時重新讀取後套用，不會蓋掉對方', async () => {
    fakeModel.__beforeNextWrite((documents) => {
      documents.push({ key: 'default', data: { notification: { enableSMS: true } }, revision: 1 })
    })

    const result = await store.updateSettings((settings) => {
      settings.integration.vendor = 'acme'
    })

    expect(fakeModel.__documents).toHaveLength(1)
    expect(result.notification.enableSMS).toBe(true)
    expect(result.integration.vendor).toBe('acme')
    expect(fakeModel.__documents[0].revision).toBe(2)
  })

  it('第一次建立遇到 duplicate key（E11000）時重試', async () => {
    fakeModel.__beforeNextWrite((documents) => {
      documents.push({ key: 'default', data: { notification: { enableSMS: true } }, revision: 1 })
    })
    fakeModel.__failNextWrite(Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }))

    const result = await store.updateSettings((settings) => {
      settings.integration.vendor = 'acme'
    })

    expect(result.integration.vendor).toBe('acme')
    expect(result.notification.enableSMS).toBe(true)
    expect(fakeModel.__documents).toHaveLength(1)
  })

  it('其他資料庫錯誤原樣往外丟，不重試', async () => {
    fakeModel.__seed(storedDocument({}))
    fakeModel.__failNextWrite(new Error('not primary'))

    await expect(store.updateSettings(() => {})).rejects.toThrow('not primary')
    expect(fakeModel.findOneAndUpdate).toHaveBeenCalledTimes(1)
  })

  it('一直遇到衝突時有次數上限，超過後丟出錯誤而不是無限重試', async () => {
    fakeModel.__seed(storedDocument({}, { revision: 1 }))
    for (let index = 0; index < 20; index += 1) {
      fakeModel.__beforeNextWrite((documents) => {
        documents[0].revision += 1
      })
    }
    const mutator = jest.fn()

    await expect(store.updateSettings(mutator)).rejects.toThrow('同時被多次修改')
    expect(mutator.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(mutator.mock.calls.length).toBeLessThanOrEqual(10)
  })

  it('resetSettings 刪除文件，之後回到預設值', async () => {
    await store.updateSettings((settings) => {
      settings.itemSettings = { ...settings.itemSettings, C12: ['自訂'] }
    })
    expect(fakeModel.__documents).toHaveLength(1)

    await store.resetSettings()

    expect(fakeModel.deleteOne).toHaveBeenCalledWith({ key: 'default' })
    expect((await store.getSettings()).itemSettings.C12).toEqual(['特休假', '病假', '事假'])
  })
})

describe('otherControlSettingsStore - dictionaries', () => {
  it('getDictionaryItems 把字串項目轉成 { name, code }', async () => {
    const items = await store.getDictionaryItems('C12')

    expect(items).toEqual([
      { name: '特休假', code: '特休假' },
      { name: '病假', code: '病假' },
      { name: '事假', code: '事假' }
    ])
  })

  it('getDictionaryItems 是即時讀取：字典更新後馬上反映，且重新建立 store 狀態（重啟）後仍在', async () => {
    await store.updateSettings((settings) => {
      settings.itemSettings = { ...settings.itemSettings, C12: ['休假', '事假', '公假'] }
    })

    // 另一份模組實例（模擬重啟後的程序）讀同一個資料庫
    const restarted = await import('../src/services/otherControlSettingsStore.js?restarted')
    expect(await restarted.getDictionaryItems('C12')).toEqual([
      { name: '休假', code: '休假' },
      { name: '事假', code: '事假' },
      { name: '公假', code: '公假' }
    ])
  })

  it('getDictionaryItems 接受物件項目：name/label/text 與 code/value/key/id，缺的一邊互相補', async () => {
    fakeModel.__seed(
      storedDocument({
        itemSettings: {
          D1: [
            { name: '特休', code: 'AL' },
            { label: '病假', value: 'SL' },
            { text: '事假', key: 'PL' },
            { label: '公假', id: 7 },
            { label: '喪假' },
            { code: 'ONLYCODE' }
          ]
        }
      })
    )

    expect(await store.getDictionaryItems('D1')).toEqual([
      { name: '特休', code: 'AL' },
      { name: '病假', code: 'SL' },
      { name: '事假', code: 'PL' },
      { name: '公假', code: '7' },
      { name: '喪假', code: '喪假' },
      { name: 'ONLYCODE', code: 'ONLYCODE' }
    ])
  })

  it('getDictionaryItems 略過空白／無效項目、修剪空白、同名只留第一筆', async () => {
    fakeModel.__seed(
      storedDocument({
        itemSettings: {
          D2: ['  特休假  ', '', '   ', null, undefined, true, [], {}, { label: '  ' }, '特休假', { label: '特休假', code: 'X' }, 3, '病假']
        }
      })
    )

    expect(await store.getDictionaryItems('D2')).toEqual([
      { name: '特休假', code: '特休假' },
      { name: '3', code: '3' },
      { name: '病假', code: '病假' }
    ])
  })

  it('getDictionaryItems 對複合字典（C05 語言能力）使用 label 當名稱', async () => {
    expect((await store.getDictionaryItems('C05')).map((item) => item.name)).toEqual(['英文', '日文'])
  })

  it('getDictionaryItems 對未知／空白／危險的 key 回傳空陣列', async () => {
    expect(await store.getDictionaryItems('NOPE')).toEqual([])
    expect(await store.getDictionaryItems('')).toEqual([])
    expect(await store.getDictionaryItems('   ')).toEqual([])
    expect(await store.getDictionaryItems(undefined)).toEqual([])
    expect(await store.getDictionaryItems(12)).toEqual([])
    expect(await store.getDictionaryItems('__proto__')).toEqual([])
    expect(await store.getDictionaryItems('constructor')).toEqual([])
    expect(await store.getDictionaryItems('toString')).toEqual([])
  })

  it('getDictionaryItems 允許 key 前後有空白，字典為空陣列或非陣列時回傳空陣列', async () => {
    fakeModel.__seed(storedDocument({ itemSettings: { E1: [], E2: 'oops', E3: { a: 1 } } }))

    expect((await store.getDictionaryItems(' C12 ')).length).toBe(3)
    expect(await store.getDictionaryItems('E1')).toEqual([])
    expect(await store.getDictionaryItems('E2')).toEqual([])
    expect(await store.getDictionaryItems('E3')).toEqual([])
  })

  it('getDictionaryDefinitions 回傳 itemSettings 內所有值為陣列的字典代碼', async () => {
    fakeModel.__seed(storedDocument({ itemSettings: { C12: ['休假'], X9: [], BAD: 'oops' } }))

    const definitions = await store.getDictionaryDefinitions()

    expect(definitions).toEqual(expect.arrayContaining(['C03', 'C05', 'C12', 'C14', 'X9']))
    expect(definitions).not.toContain('BAD')
  })

  it('normalizeDictionaryItems 非陣列時回傳空陣列', () => {
    expect(store.normalizeDictionaryItems(undefined)).toEqual([])
    expect(store.normalizeDictionaryItems('abc')).toEqual([])
    expect(store.normalizeDictionaryItems(null)).toEqual([])
  })
})
