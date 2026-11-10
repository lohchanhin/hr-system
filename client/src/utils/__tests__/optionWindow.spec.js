import { describe, it, expect } from 'vitest'
import { windowOptions, OPTION_WINDOW_MORE_VALUE, OPTION_WINDOW_SIZE } from '../optionWindow'

const people = (count) => Array.from({ length: count }, (_, index) => ({ value: `e${index + 1}`, label: `員工${index + 1}（N${String(index + 1).padStart(3, '0')}）` }))

describe('windowOptions：選項很多的下拉選單只畫出一部分', () => {
  it('選項不多時原樣回傳，不加提示', () => {
    const options = people(5)
    expect(windowOptions(options)).toEqual(options)
    expect(windowOptions(options, { limit: 5 })).toEqual(options)
  })

  it('超過上限時只留前面幾個，最後加一個不能選的提示說明還有幾筆', () => {
    const result = windowOptions(people(200), { limit: 50 })
    expect(result).toHaveLength(51)
    expect(result.slice(0, 50).map((option) => option.value)).toEqual(people(50).map((option) => option.value))
    expect(result[50]).toEqual({ value: OPTION_WINDOW_MORE_VALUE, label: '還有 150 筆沒有列出，請輸入文字搜尋', disabled: true })
  })

  it('預設上限是 OPTION_WINDOW_SIZE', () => {
    const result = windowOptions(people(OPTION_WINDOW_SIZE + 1))
    expect(result).toHaveLength(OPTION_WINDOW_SIZE + 1)
    expect(result.at(-1).disabled).toBe(true)
  })

  it('輸入文字時搜尋全部選項（不分大小寫，比對名稱與代號），不只搜尋畫出來的那一批', () => {
    const result = windowOptions(people(200), { limit: 50, query: 'n199' })
    expect(result.map((option) => option.value)).toEqual(['e199'])
    expect(windowOptions(people(200), { limit: 50, query: '  員工200 ' }).map((option) => option.value)).toEqual(['e200'])
  })

  it('已選的值不在這一批裡也一定保留（單一值或陣列），選單才顯示得出名稱', () => {
    const multiple = windowOptions(people(200), { limit: 10, selected: ['e150', 'e3'] })
    expect(multiple.map((option) => option.value)).toEqual([
      ...people(10).map((option) => option.value),
      'e150',
      OPTION_WINDOW_MORE_VALUE,
    ])
    const single = windowOptions(people(200), { limit: 10, selected: 'e77', query: '員工19' })
    // 搜尋結果之外，已選的那一位仍在
    expect(single.map((option) => option.value)).toContain('e77')
    expect(single.filter((option) => option.value === 'e77')).toHaveLength(1)
  })

  it('可以自訂提示文字；不是陣列或有空值時不會壞掉', () => {
    const result = windowOptions(people(12), { limit: 10, moreLabel: (hidden) => `還有 ${hidden} 位` })
    expect(result.at(-1).label).toBe('還有 2 位')
    expect(windowOptions(null)).toEqual([])
    expect(windowOptions([null, { value: 'a', label: 'A' }], { selected: [null, ''] })).toEqual([{ value: 'a', label: 'A' }])
  })
})
