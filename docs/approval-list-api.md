# 簽核清單 API（我的申請／待我簽核／我已簽核）

三個清單：

| 端點 | 列出 | 預設排序 |
| --- | --- | --- |
| `GET /api/approvals` | 自己送出的申請 | 建立時間新到舊 |
| `GET /api/approvals/inbox` | 目前關卡輪到我、我還沒簽的單 | 建立時間新到舊 |
| `GET /api/approvals/history` | 我簽過（核可、否決、退簽）的單；管理員看全部 | 最後更新時間新到舊 |

## 分頁

- 帶 `page` 或 `limit`（預設每頁 50，最多 200）：回傳 `{ items, total, page, limit }`。
- 都沒帶：回傳純陣列（最多 500 筆）。
- 兩種都帶 `X-Total-Count`、`X-Page`、`X-Limit` 標頭；有篩選時 `total` / `X-Total-Count` 是篩選後的筆數。

## 篩選參數（全部選填，三個清單都可以用）

| 參數 | 說明 | 格式不對時 |
| --- | --- | --- |
| `status` | `pending` / `approved` / `rejected` / `returned` / `canceled` | 不認得的值忽略（和以前管理員歷史清單相同） |
| `form` | 表單 `_id` | 400 `表單參數格式不正確` |
| `from`、`to` | 申請（建立）日期，台灣日期 `YYYY-MM-DD`，含頭尾；台灣 3/1 00:30 送出的單算 3/1 | 400 `開始日期格式不正確，請用 YYYY-MM-DD`；`from` 晚於 `to`：400 `開始日期不可晚於結束日期` |
| `q` | 申請人姓名或員工編號，部分比對、不分大小寫，特殊字元當一般文字；最多 50 字 | 超過 50 字：400 `關鍵字最多 50 個字` |
| `sort` | `newest`（預設）或 `oldest`；排序欄位維持各清單原本的（見上表） | 400 `排序只能是 newest（新到舊）或 oldest（舊到新）` |

- 同一個參數帶兩次（`?q=a&q=b`）：400 `…只能指定一個值`。
- 所有 400 都帶 `code: 'INVALID_LIST_FILTER'` 與 `param`（哪一個參數）。
- `/inbox` 本來就只有簽核中的單：`status` 帶別的狀態時清單是空的。
- 篩選只會在原本的範圍內縮小（自己的申請、輪到我的、我簽過的），不會多看到別人的單。

## 每一列的 `summary`

每一列都有 `summary`（`/history` 也有，雖然它不回傳 `form_data`）。伺服器用那張單自己的答案組出來，整頁只查一次表單欄位，
畫面不必再為每張表單呼叫 `/api/approvals/forms/:id/fields`（跨部門的簽核人原本會被 `FORM_NOT_ALLOWED` 擋下而看不到摘要）。

沒有任何可顯示的答案時是 `null`。否則：

```js
// 請假單
{
  kind: 'leave',
  leaveType: '事假',            // 假別名稱（選項值轉成名稱）；沒有填是 null
  hours: 4,                      // 請假時數；沒填時數也推算不出來是 null
  start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T05:00:00.000Z', // 原始值（ISO 或日期字串），畫面要自己排版時用
  dateOnly: false,               // 開始／結束欄位是不是只有日期
  items: [                       // 已經排好的顯示文字（台灣時間）
    { label: '假別', value: '事假' },
    { label: '開始時間', value: '2026/03/02 09:00' },
    { label: '結束時間', value: '2026/03/02 13:00' },
    { label: '時數', value: '4 小時' },
  ],
}
// 其他表單：依欄位順序前 3 個有填的文字、數字、選項、日期欄位（檔案、簽名、人員欄位不放），每個值最多 40 字
{ kind: 'fields', items: [{ label: '事由', value: '補充 夜班用品' }, { label: '金額', value: '1200' }] }
```

其他表單認得出開始、結束欄位時也會帶 `start` / `end` / `dateOnly`。

實作：`server/src/services/approvalListSummary.js`；測試：`server/tests/approvalListFilters.integration.test.js`。
