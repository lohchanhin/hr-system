# 排班發布流程說明

## 狀態欄位

`ShiftSchedule` 模型新增下列欄位以追蹤發布與員工回覆狀態：

- `state`: `draft`／`pending_confirmation`／`finalized`
- `publishedAt`: 最終發布時間
- `employeeResponse`: `pending`／`confirmed`／`disputed`
- `responseNote`: 員工異議內容
- `responseAt`: 員工最後回覆時間

所有欄位已建立對應索引，批次發布會重設回覆欄位。

## 主要 API

| 方法與路徑 | 權限 | 說明 |
| --- | --- | --- |
| `POST /api/schedules/publish/batch` | 主管／管理員 | 將指定月份與部門的排班設定為 `pending_confirmation`，並清除既有回覆 |
| `POST /api/schedules/publish/finalize` | 主管／管理員 | 確認所有員工皆 `confirmed` 後，將排班狀態改為 `finalized` |
| `POST /api/schedules/respond` | 員工／主管 | 員工提交「確認」或「異議」；異議需附註原因 |
| `GET /api/schedules/monthly` | 登入者 | 回傳 `{ month, schedules, meta }`，`meta` 內含月份狀態、待回覆名單與異議摘要 |

`meta.employeeStatuses` 內含每位員工的回覆狀態、最後回覆時間與異議紀錄，前端可用以顯示待處理名單。

## 前端更新摘要

- `Schedule.vue` 新增發布流程卡片，可啟動批次發布與完成發布，並顯示待回覆／異議清單。
- `MySchedule.vue` 提供員工確認或提出異議，顯示目前回覆結果與最後回覆時間。

## 測試

- 後端新增整合測試覆蓋批次發布、完成發布與員工回覆流程。
- 前端調整既有排班測試以符合新的 API 回傳格式，並覆蓋員工端的月份切換流程。
