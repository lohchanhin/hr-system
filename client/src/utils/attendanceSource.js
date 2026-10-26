// 打卡來源（後端 AttendanceRecord.source）：線上打卡、指紋（考勤機）匯入、手動補登。
// 舊資料沒有來源欄位，顯示「未標示」。兩種來源並存、互不覆蓋，計算時簽到取最早、簽退取最晚。
const SOURCE_META = {
  online: { label: '線上', tagType: 'success' },
  import: { label: '指紋匯入', tagType: 'warning' },
  manual: { label: '手動補登', tagType: 'primary' },
  legacy: { label: '未標示', tagType: 'info' }
}

export function resolveAttendanceSource(source) {
  return Object.prototype.hasOwnProperty.call(SOURCE_META, source) ? source : 'legacy'
}

export function attendanceSourceLabel(source) {
  return SOURCE_META[resolveAttendanceSource(source)].label
}

export function attendanceSourceTagType(source) {
  return SOURCE_META[resolveAttendanceSource(source)].tagType
}
