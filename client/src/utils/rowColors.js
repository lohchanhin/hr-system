export const ROW_COLOR_PALETTE = Object.freeze([
  { index: 0, label: '湖水藍', bg: '#ecfeff', border: '#67e8f9' },
  { index: 1, label: '霧紫色', bg: '#f3e8ff', border: '#d8b4fe' },
  { index: 2, label: '薄荷綠', bg: '#ecfdf3', border: '#86efac' },
  { index: 3, label: '暖米黃', bg: '#fffbeb', border: '#fcd34d' },
  { index: 4, label: '粉橘色', bg: '#fff7ed', border: '#fdba74' },
  { index: 5, label: '淺粉紅', bg: '#fdf2f8', border: '#f9a8d4' },
  { index: 6, label: '銀灰藍', bg: '#f1f5f9', border: '#94a3b8' },
  { index: 7, label: '薰衣草', bg: '#faf5ff', border: '#c4b5fd' }
])

export function normalizeRowColorIndex(value) {
  if (value === '' || value === null || value === undefined) return null
  const index = Number(value)
  if (!Number.isInteger(index)) return null
  if (index < 0 || index >= ROW_COLOR_PALETTE.length) return null
  return index
}

export function resolveRowColor(index) {
  const normalized = normalizeRowColorIndex(index)
  if (normalized === null) return null
  return ROW_COLOR_PALETTE[normalized]
}
