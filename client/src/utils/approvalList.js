// 簽核清單（待我簽核 / 我已簽核 / 我的申請）的分頁共用工具

export const PAGE_SIZE = 20

/** 清單網址附上 page / limit；伺服器有支援分頁時才會回傳 { items, total } */
export function pagedListUrl(path, page = 1, limit = PAGE_SIZE) {
  return `${path}?page=${page}&limit=${limit}`
}

/**
 * 同時接受兩種回應：
 * - 純陣列（沒有分頁，全部筆數都在裡面）
 * - { items, total, page, limit }（分頁）
 */
export function readListPayload(payload, requestedPage = 1) {
  if (Array.isArray(payload)) {
    return { items: payload, total: payload.length, page: 1, paged: false }
  }
  if (payload && Array.isArray(payload.items)) {
    const total = Number(payload.total)
    return {
      items: payload.items,
      total: Number.isFinite(total) ? total : payload.items.length,
      page: Number(payload.page) || requestedPage,
      paged: true,
    }
  }
  return { items: [], total: 0, page: 1, paged: false }
}
