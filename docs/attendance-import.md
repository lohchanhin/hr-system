# 考勤資料匯入格式說明

後台管理者可透過「考勤資料匯入」功能匯入多筆打卡紀錄。此功能支援 Excel (XLSX) 與 CSV 檔案，並提供欄位對應、員工映射與預覽匯入流程。

## 基本欄位

匯入檔案需至少包含下列欄位，可於匯入介面調整欄位對應：

| 欄位 | 說明 |
| ---- | ---- |
| `USERID` | 打卡資料來源的員工識別值，可對應員工編號 (`employeeId`)、Email 或資料庫 `_id`。 |
| `CHECKTIME` | 打卡時間。支援 `yyyy-MM-dd HH:mm:ss`、`yyyy/MM/dd HH:mm`、`MM/dd/yyyy HH:mm` 等常見格式，以及 Excel 日期欄位。 |
| `CHECKTYPE` | 打卡動作，系統會將 `I` 轉換為 `clockIn`、`O` 轉換為 `clockOut`。亦支援直接填寫 `clockIn` / `clockOut`。 |
| `REMARK` (選填) | 額外備註內容，將原樣寫入資料庫。 |

## 時區與重複打卡

- 可於匯入介面選擇時區（預設為 `Asia/Taipei`）。未帶有時區資訊的時間將依此設定換算為 UTC 儲存。
- 系統不會移除重複打卡紀錄，將依檔案內容逐筆新增。

## 員工對應機制

1. 匯入時會先依照 `USERID` 嘗試比對員工編號、Email 及 `_id`。
2. 若仍有無法對應的員工，API 會於回應的 `missingUsers` 欄位列出識別值、出現列號與樣本資料，前端可於對話框中選擇對應員工或標記忽略。
3. 完成映射後重新送出即可完成匯入，忽略的識別值將不會建立紀錄。

## API 路由

- `POST /api/attendance/import`
  - 需使用 `multipart/form-data`，欄位包含：
    - `file`：上傳之 Excel/CSV 檔案。
    - `mappings`：欄位對應設定（JSON）。
    - `options`：包含 `timezone` 與 `dryRun` 的設定（JSON）。
    - `userMappings`：重新對應使用者的設定（JSON，選填）。
    - `ignoreUsers`：欲忽略的識別值清單（JSON 陣列，選填）。
  - `dryRun: true` 時僅回傳預覽結果，不會寫入資料庫。

## 回應結構重點

- `preview`：每列的解析結果、錯誤與對應狀態。
- `missingUsers`：需人工映射或忽略的識別值清單。
- `summary`：包含總筆數、已就緒筆數、缺少對應筆數、忽略筆數、錯誤筆數與實際匯入筆數。

若需要建立匯入範例，可使用下列最小範本：

```csv
USERID,CHECKTIME,CHECKTYPE,REMARK
A001,2024-01-05 08:00:00,I,早班
A001,2024-01-05 17:30:00,O,下班
```

將此檔案與對應欄位設定上傳，即可測試整體流程。
