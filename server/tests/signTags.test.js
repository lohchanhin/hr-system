import { normalizeSignTag, normalizeSignTags, splitSignTagText } from '../src/utils/signTags.js'

describe('normalizeSignTag', () => {
  it('去頭尾空白（含全形空白）、壓縮內部空白、全形字轉半形', () => {
    expect(normalizeSignTag('  人資 ')).toBe('人資')
    expect(normalizeSignTag('人資　')).toBe('人資')
    expect(normalizeSignTag('財務　　覆核')).toBe('財務 覆核')
    expect(normalizeSignTag('財務\t覆核')).toBe('財務 覆核')
    expect(normalizeSignTag('ＨＲ１')).toBe('HR1')
  })

  it('空值與非文字回傳空字串', () => {
    expect(normalizeSignTag('')).toBe('')
    expect(normalizeSignTag('   ')).toBe('')
    expect(normalizeSignTag(null)).toBe('')
    expect(normalizeSignTag(undefined)).toBe('')
    expect(normalizeSignTag({ name: '人資' })).toBe('')
    expect(normalizeSignTag(['人資'])).toBe('')
  })

  it('數字當作文字', () => {
    expect(normalizeSignTag(101)).toBe('101')
  })
})

describe('normalizeSignTags', () => {
  it('去空、去重，保留第一次出現的順序', () => {
    expect(normalizeSignTags([' 人資', '人資 ', '', '排班負責人', '人資', null, '財務覆核'])).toEqual([
      '人資',
      '排班負責人',
      '財務覆核',
    ])
  })

  it('單一值當作一個標籤，沒有值回傳空陣列，不會拆逗號', () => {
    expect(normalizeSignTags('人資')).toEqual(['人資'])
    expect(normalizeSignTags('人資,財務')).toEqual(['人資,財務'])
    expect(normalizeSignTags(undefined)).toEqual([])
    expect(normalizeSignTags(null)).toEqual([])
    expect(normalizeSignTags([])).toEqual([])
  })

  it('同一個人用全形與半形寫同一個標籤只留一個', () => {
    expect(normalizeSignTags(['ＨＲ', 'HR'])).toEqual(['HR'])
  })

  it('不會改動傳入的陣列', () => {
    const input = [' 人資 ', '人資']
    normalizeSignTags(input)
    expect(input).toEqual([' 人資 ', '人資'])
  })
})

describe('splitSignTagText', () => {
  it('依逗號、全形逗號、頓號、分號、換行拆開', () => {
    expect(splitSignTagText('人資,排班負責人，財務覆核、業務主管;支援單位主管；業務負責人\n新標籤')).toEqual([
      '人資',
      '排班負責人',
      '財務覆核',
      '業務主管',
      '支援單位主管',
      '業務負責人',
      '新標籤',
    ])
  })

  it('拆開後一樣會整理與去重', () => {
    expect(splitSignTagText(' 人資 ,, 人資、 ')).toEqual(['人資'])
    expect(splitSignTagText('')).toEqual([])
    expect(splitSignTagText(null)).toEqual([])
  })

  it('陣列與數字也能處理', () => {
    expect(splitSignTagText([' 人資 ', '人資'])).toEqual(['人資'])
    expect(splitSignTagText(101)).toEqual(['101'])
  })
})
