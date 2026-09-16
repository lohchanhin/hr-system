/** Builds the canonical cell-identity key used across the schedule grid's selection/cache maps. */
export const buildCellKey = (empId, day) => `${empId}::${day}`

/** Inverse of buildCellKey. Returns { empId, day: NaN } if the key has no '::' separator. */
export const parseCellKey = key => {
  const str = String(key)
  const idx = str.lastIndexOf('::')
  if (idx === -1) {
    return { empId: str, day: NaN }
  }
  const empId = str.slice(0, idx)
  const day = Number(str.slice(idx + 2))
  return { empId, day }
}

/** Normalizes a Mongo doc / id string / undefined into a trimmed id string, or undefined. */
export const normalizeOptionalReferenceId = value => {
  const rawValue = typeof value === 'object' && value
    ? (value._id ?? value.id)
    : value
  const normalized = String(rawValue ?? '').trim()
  return normalized || undefined
}

/** Sorts employees by department then name (locale-aware), for row ordering. */
export const sortEmployeesByDept = list =>
  [...list].sort((a, b) => {
    const deptCompare = (a.department || '').localeCompare(b.department || '')
    if (deptCompare !== 0) return deptCompare
    return (a.name || '').localeCompare(b.name || '')
  })
