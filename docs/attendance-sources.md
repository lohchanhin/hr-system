# 打卡來源：線上打卡與指紋匯入互補

客戶 2026/10/23 的要求（R6）：「線上打卡和指紋記錄，不要互相覆蓋，要互補」。

系統裡的打卡有兩個來源：員工在「出勤打卡」頁面的**線上打卡**，以及管理者在「出勤管理 → 考勤資料匯入」上傳的**考勤機（指紋）檔案**。
兩邊的記錄一律並存、互不覆蓋，所有計算都把它們當成同一組打卡：**每一班的簽到取最早的一筆、簽退取最晚的一筆**。

## 資料欄位

`AttendanceRecord.source`（`server/src/models/AttendanceRecord.js`）：

| 值 | 畫面顯示 | 寫入的地方 |
| --- | --- | --- |
| `online` | 線上 | `POST /api/attendance`（線上打卡，伺服器時間） |
| `import` | 指紋匯入 | `POST /api/attendance/import`（考勤機檔案匯入） |
| `manual` | 手動補登 | 保留給日後的補登功能，目前沒有程式寫入 |
| 沒有欄位（`legacy`） | 未標示 | 這次調整以前的舊資料（線上或匯入都有可能），不回填 |

- 欄位沒有預設值，舊資料維持原樣，部署時不需要資料遷移；讀取時沒有來源一律視為 `legacy`，照常參與計算。
- 新增索引 `attendance_employee_timestamp`（`{ employee: 1, timestamp: 1 }`，非唯一），由 Mongoose 啟動時自動建立（已存在則略過）；匯入比對重複、工時與報表的查詢都用得到。舊資料即使有重複打卡也不影響建立。

## 匯入：只新增、重複略過

`server/src/controllers/attendanceImportController.js`

- 匯入**只會新增**記錄（標示 `source: 'import'`），不會修改或刪除任何既有打卡（線上打卡、先前匯入的、舊資料都一樣）。
- **重複略過**：同一位員工、同一個動作（簽到／簽退…）、時間落在同一分鐘的打卡視為同一筆：
  - 資料庫已經有（不論來源）→ 略過；
  - 同一個檔案裡前面已經出現過 → 略過。
  - 所以同一個檔案再匯入一次，不會多出任何記錄。
- 比對以每 500 筆為一批查一次資料庫（只查這一批的員工與時間範圍）。預覽（`dryRun`）也會比對，管理者在匯入前就看得到會略過幾筆。
- 回應的 `summary` 多了 `duplicateCount`（重複略過的筆數）。`readyCount` 仍是「已對應到員工」的筆數（含重複略過的），`importedCount` 是實際新增的筆數。
- 預覽表格中被略過的列狀態為 `duplicate`（畫面顯示「重複略過」），`duplicateReason` 說明是資料庫已有還是檔案內重複。
- 訊息：
  - 有新增也有略過：`考勤資料匯入完成（新增 X 筆，重複略過 Y 筆）`
  - 全部都是已有的打卡（例如重複匯入）：HTTP 200，`沒有新的打卡記錄：Y 筆與既有打卡記錄重複，已略過`（不是錯誤，畫面以提醒顯示並保留對話框）
  - 同時還有缺少對應員工或驗證錯誤時，重複略過會一併列在 `failureReasons`。
- 比對既有打卡時資料庫出錯：HTTP 500「考勤資料寫入失敗，請稍後再試」。
- 限制：兩位管理者「同時」匯入同一個檔案時，兩邊各自比對時都還沒有對方的資料，可能各新增一次；依序匯入不會重複。

## 線上打卡

`server/src/controllers/attendanceController.js`

- 線上打卡一律標示 `source: 'online'`，時間以伺服器時間為準（不變）。
- 同一班重複的線上簽到／簽退仍然擋下（409）；**指紋匯入的打卡不擋線上打卡**，兩邊都保留，計算時互補。沒有來源的舊資料視同線上打卡，照舊會擋。
- 線上簽退前要有這一班的簽到：線上或指紋匯入的簽到都算（不變）。
  注意：指紋簽到要等管理者匯入後系統才看得到；在匯入之前用線上簽退，仍會因為「沒有簽到」被擋下（維持原本的規則）。

## 計算：簽到取最早、簽退取最晚

共用的比對在 `server/src/services/attendancePunchService.js` 的 `matchShiftPunches`：

- 以班別時間（考勤時區，預設台灣時間 `ATTENDANCE_TIMEZONE=Asia/Taipei`）加上「打卡緩衝」設定算出這一班的簽到時段、簽退時段（與線上打卡的開放時段、薪資遲到早退判斷相同）。
- 簽到取簽到時段內最早的一筆，簽退取簽退時段內、晚於簽到的最晚一筆，不分來源。
- 例：08:10 線上簽到，之後匯入 07:55 簽到、17:05 簽退 → 這一班以 07:55-17:05 計算，不算遲到；之後再用線上在 17:20 簽退 → 簽退改取 17:20。

各處的使用：

| 功能 | 檔案 | 說明 |
| --- | --- | --- |
| 薪資工時、出勤天數、每日出勤明細 | `services/workHoursCalculationService.js` | 先依班別時段比對；時段內找不到時才沿用原本依日期比對的方式（例如遲到超過打卡緩衝的人仍算得到工時）。每日明細多了 `clockInSource`、`clockOutSource`。 |
| 遲到早退扣款 | `services/attendanceDeductionService.js` | 原本就是「符合線上打卡 punchKey 或落在打卡時段內」一起比對，簽到取最早、簽退取最晚，匯入的打卡不會因為有線上打卡而被忽略（已補測試）。 |
| 部門報表：出勤、遲到、早退、工時 | `services/reportMetricsService.js` | 遲到、早退改依班別時段比對（與薪資扣款一致，時間以台灣時間顯示）；出勤與工時先依時段比對，找不到再沿用依日期比對。 |
| 打卡記錄（員工出勤打卡頁） | `client/src/views/front/Attendance.vue` | 每筆打卡顯示來源（線上／指紋匯入／未標示）。 |
| 薪資明細的每日出勤明細 | `client/src/components/backComponents/SalaryManagementSetting.vue` | 上班、下班時間下方標示該筆打卡的來源。 |
| 考勤資料匯入對話框 | `client/src/components/backComponents/AttendanceImportDialog.vue` | 說明只新增不覆蓋；預覽與結果顯示重複略過的列與筆數。 |

另外修正：工時、遲到早退與報表讀取打卡時多讀前一天，月初第一天台灣時間 08:00 以前的打卡（UTC 是前一天，例如 07:55 的指紋簽到）也算得到。

### 對既有資料的影響

- 舊資料不改；部署後重新計算時，同一班同時有多筆打卡的，簽退改取最晚的一筆（原本工時取「簽到後的第一筆簽退」）。
- 部門報表的遲到、早退原本用 UTC 時間比較班別時間，台灣時間的打卡會比錯（幾乎不會出現遲到）；改為與薪資扣款相同的比對後，報表會開始列出實際的遲到、早退。

## 測試

- `server/tests/attendanceSources.test.js`：比對工具、工時、遲到早退、報表的混合來源情境（線上簽到＋指紋簽退、兩邊都有、指紋比線上早、舊資料、跨日大夜班）。
- `server/tests/attendanceImport.test.js`：匯入標示來源、只新增不修改／刪除、檔案內與資料庫重複略過、重複匯入、預覽、跨批次、資料庫錯誤。
- `server/tests/attendance.test.js`：線上打卡標示來源、匯入的打卡不擋線上打卡、匯入的簽到可作為線上簽退前的簽到。
- `server/tests/attendanceSources.integration.test.js`（真的 MongoDB，預設略過）：
  `APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:<port> npm test -- tests/attendanceSources.integration.test.js`
- 前端：`client/tests/attendance.spec.js`、`client/tests/salaryPunchSource.spec.js`、`client/src/components/backComponents/__tests__/AttendanceImportDialog.spec.js`、`client/src/utils/__tests__/attendanceSource.spec.js`。
