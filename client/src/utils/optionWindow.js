// 選項很多（上百位員工）的下拉選單：一次只畫出一部分，輸入文字時搜尋全部。
// el-select 會把每個選項都掛在畫面上，幾百位員工乘上好幾個選單會讓設定頁變得很慢。
// 已選的值一定留在選項裡（不然標籤會變成一串編號）；被省略時在最後加一個不能選的提示。

export const OPTION_WINDOW_SIZE = 60
export const OPTION_WINDOW_MORE_VALUE = '__option_window_more__'

/**
 * @param {Array<{ value: string, label: string }>} options 全部選項
 * @param {{ query?: string, selected?: any, limit?: number, moreLabel?: (hidden: number) => string }} config
 *   query：使用者輸入的搜尋文字（比對 label，不分大小寫）；selected：目前選的值（單一值或陣列）
 * @returns {Array} 要畫出來的選項
 */
export function windowOptions(options, { query = '', selected = [], limit = OPTION_WINDOW_SIZE, moreLabel } = {}) {
  const list = Array.isArray(options) ? options.filter(Boolean) : []
  const text = String(query ?? '').trim().toLowerCase()
  const matches = text
    ? list.filter((option) => String(option.label ?? '').toLowerCase().includes(text))
    : list
  const chosen = new Set((Array.isArray(selected) ? selected : [selected])
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map(String))
  const visible = matches.slice(0, Math.max(1, limit))
  const shown = new Set(visible.map((option) => String(option.value)))
  // 已選的值不在這一批裡時補在後面，選單才顯示得出名稱
  const kept = chosen.size
    ? list.filter((option) => chosen.has(String(option.value)) && !shown.has(String(option.value)))
    : []
  const hidden = matches.length - visible.length
  const result = [...visible, ...kept]
  if (hidden > 0) {
    result.push({
      value: OPTION_WINDOW_MORE_VALUE,
      label: typeof moreLabel === 'function' ? moreLabel(hidden) : `還有 ${hidden} 筆沒有列出，請輸入文字搜尋`,
      disabled: true,
    })
  }
  return result
}

export default { windowOptions, OPTION_WINDOW_SIZE, OPTION_WINDOW_MORE_VALUE }
