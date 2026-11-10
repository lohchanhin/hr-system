# 薪資政策（後台可調整的薪資計算規則）

2026-11 起，下面三件事從程式寫死改成後台可以調整的「薪資政策」。**沒有動過設定時，算出來的薪資與以前完全相同**：
預設值就是以前寫死的做法，資料庫沒有這份設定（或少了某個欄位）時一律用預設值，不需要搬資料。

| 設定 | 預設值（＝以前的做法） | 影響 |
| --- | --- | --- |
| 月中到職、離職的月薪比例 `proration.method` | `days30` | 月薪人員當月的本薪 |
| 加班費倍率 `overtime.rates` | 勞基法的 4/3、5/3、8/3、1 | 有開「自動計算加班費」的人的加班費 |
| 新進員工是否自動計算加班費 `overtime.newEmployeeAutoCalc` | `true`（開啟） | 只影響**之後新增**的員工；既有員工不會被改 |

程式：`server/src/services/payrollPolicyService.js`（預設值、驗證、讀寫），資料存在 `PayrollPolicy` 集合的單一文件
（`server/src/models/PayrollPolicy.js`，`key: 'default'`）。

## 何時生效、會影響哪些畫面

- 每一次薪資計算在請求開始時讀一次設定，整批員工用同一份：薪資總覽、薪資明細（complete-data）、單獨計算、計算並儲存、
  批量計算、三種銀行匯款 Excel（臺企、台中銀、獎金紙條）、月薪資總覽 PDF、個人薪資表。
  設定不跨請求快取：存檔後下一個請求就是新規則（PM2 多個程序也一樣）。
- **已儲存的薪資記錄（PayrollRecord）不會重算**：金額照存檔當時。計算並儲存時，記錄另外存下當時的 `employment`（含比例算法）
  與 `appliedPolicy`（`{ prorationMethod, overtimeRates }`），之後查核看得出當時用的是哪個規則；舊記錄沒有這兩個欄位。
- 日薪、時薪人員按出勤給薪，不受比例設定影響。

## 1. 月中到職、離職的月薪比例（`proration.method`）

在職期間的判斷不變（`server/src/utils/payrollEmployment.js`）：到職日以台灣日期判斷；只有狀態是「離職員工」才看離職日
（離職日、解聘日，含當天；都沒填時用當月最後一筆班表）；留職停薪且當月沒有班表算整月不在職。
「在職日曆天數」= 當月在職的第一天到最後一天（含頭尾）的日曆天數。

| 值 | 名稱 | 月中到職或離職的本薪 |
| --- | --- | --- |
| `days30`（預設） | 按 30 天計算 | 月薪 × 在職日曆天數 ÷ 30，最多一個月（與月薪換算日薪、時薪的基準相同） |
| `calendarDays` | 按當月日曆天數計算 | 月薪 × 在職日曆天數 ÷ 當月天數（28～31） |
| `none` | 不按比例 | 當月只要有在職（哪怕只有一天）就給整個月的月薪 |

三種算法都一樣的部分：

- 整月在職的人一律是整個月的月薪（`ratio` = 1）。
- **整個月都不在職**的人（尚未到職 `before_hire`、已經離職 `after_resignation`、留職停薪且當月沒有班表 `leave_of_absence`）
  一律沒有本薪（`ratio` = 0），選 `none` 也一樣；這些人沒有任何金額時也不會出現在銀行匯款檔。
- 請假扣款照舊從比例後的本薪扣，扣到 0 為止。

例：月薪 40,000，2026 年 10 月（31 天）。

| 情況 | 在職日曆天數 | `days30` | `calendarDays` | `none` |
| --- | --- | --- | --- | --- |
| 10/16 到職 | 16 | 21,333 | 20,645 | 40,000 |
| 10/15 離職 | 15 | 20,000 | 19,355 | 40,000 |
| 10/2 到職（31 天的月份） | 30 | 40,000 | 38,710 | 40,000 |
| 11/3 才到職 | 0 | 0 | 0 | 0 |

計算結果的 `employment` 會標出套用的規則：
`{ employed, ratio, employedDays, daysInMonth, startKey, endKey, reason, method, basisDays }`，
`method` 是算法，`basisDays` 是分母（`days30` 是 30、`calendarDays` 是當月天數、`none` 是 `null`）。

## 2. 加班費倍率（`overtime.rates`）

加班費 = 每一段的 時數 × 時薪 × 倍率（各段四捨五入後加總）。下面是加班計算用到的每一個倍率；國定假日超過 8 小時的兩段
以前直接沿用平日的倍率，現在是自己的設定，預設值相同。

| 鍵 | 日別 | 說明 | 預設 |
| --- | --- | --- | --- |
| `weekdayFirst2` | 平日 | 平日加班前 2 小時 | 4/3 |
| `weekdayAfter2` | 平日 | 平日加班第 3～4 小時 | 5/3 |
| `restDayFirst2` | 休息日 | 休息日加班前 2 小時 | 4/3 |
| `restDayHours3To8` | 休息日 | 休息日加班第 3～8 小時 | 5/3 |
| `restDayHours9To12` | 休息日 | 休息日加班第 9～12 小時 | 8/3 |
| `holidayWithin8` | 國定假日 | 國定假日出勤 8 小時內（不論做幾小時都以 8 小時計，加發一日工資） | 1 |
| `holidayAfter8First2` | 國定假日 | 國定假日出勤超過 8 小時的前 2 小時 | 4/3 |
| `holidayAfter10` | 國定假日 | 國定假日出勤超過 10 小時的 2 小時 | 5/3 |

- 每個倍率是 1～5 的數字，最多小數兩位，或三分之一的倍數（預設的 4/3、5/3、8/3 沒辦法用兩位小數表示）。
  可以傳數字（`1.5`、`1.3333333333333333`）、數字字串（`"1.5"`）或分數字串（`"4/3"`）。
- 時數上限不變：平日最多算 4 小時、休息日最多 12 小時、國定假日最多 12 小時（超過的不計）。
- 只有員工資料開了「自動計算加班費」（`autoOvertimeCalc`）的人才算加班費；沒開的人加班費一律 0。
- 明細（complete-data）回傳 `overtimeRates`（這次套用的倍率）與 `overtimeCalcEnabled`（員工有沒有開），每一筆加班的
  `rateSegments` 每一段有 `rateKey` 與 `multiplier`。

## 3. 新進員工是否自動計算加班費（`overtime.newEmployeeAutoCalc`）

- `POST /api/employees` 沒有帶 `autoOvertimeCalc` 時用這個值；有帶就照帶的值。
- 員工批量匯入（`POST /api/employees/bulk-import`）新增的員工一律用這個值（匯入檔沒有這個欄位）；更新模式不會動到既有員工的設定。
- 系統第一次啟動時建立的管理員帳號、種子資料不經過這個設定（照資料模型的預設：關閉）。
- **改這個設定不會改到任何既有員工**。既有員工要在員工資料逐一修改，或用下面的整批設定明確地改。

## API

所有路徑都要登入，只有**管理員**可以使用（其他角色回 403）。錯誤一律是 `{ "error": "中文訊息" }`。

### `GET /api/payroll/policy`

```json
{
  "proration": { "method": "days30" },
  "overtime": {
    "rates": {
      "weekdayFirst2": 1.3333333333333333,
      "weekdayAfter2": 1.6666666666666667,
      "restDayFirst2": 1.3333333333333333,
      "restDayHours3To8": 1.6666666666666667,
      "restDayHours9To12": 2.6666666666666665,
      "holidayWithin8": 1,
      "holidayAfter8First2": 1.3333333333333333,
      "holidayAfter10": 1.6666666666666667
    },
    "newEmployeeAutoCalc": true
  },
  "defaults": { "proration": { "method": "days30" }, "overtime": { "rates": { "...": "同上" }, "newEmployeeAutoCalc": true } },
  "customized": { "prorationMethod": false, "overtimeRates": [], "newEmployeeAutoCalc": false },
  "options": {
    "prorationMethods": [
      { "value": "days30", "label": "按 30 天計算", "description": "月中到職或離職的月薪 = 月薪 × 在職日曆天數 ÷ 30（最多一個月），與月薪換算日薪、時薪的基準相同。" },
      { "value": "calendarDays", "label": "按當月日曆天數計算", "description": "月中到職或離職的月薪 = 月薪 × 在職日曆天數 ÷ 當月天數（28～31 天）。" },
      { "value": "none", "label": "不按比例", "description": "當月只要有在職（哪怕只有一天）就給整個月的月薪；整個月都不在職（尚未到職、已離職、留職停薪且當月沒有班表）仍然沒有本薪。" }
    ],
    "overtimeRates": [
      { "key": "weekdayFirst2", "dayType": "workday", "label": "平日加班前 2 小時", "default": 1.3333333333333333, "defaultText": "4/3", "min": 1, "max": 5 }
    ]
  },
  "stats": { "activeEmployees": 24, "autoOvertimeCalcOn": 6, "autoOvertimeCalcOff": 18 },
  "updatedAt": null
}
```

- 最上層的 `proration`、`overtime` 是**目前生效**的設定；`defaults` 是預設值（形狀相同）。
- `customized` 標出改過的部分：`overtimeRates` 是改過的倍率鍵。
- `options.overtimeRates` 依畫面建議的順序列出 8 個倍率（範例只列一個），`dayType` 是 `workday` / `rest_day` / `national_holiday`，
  `defaultText` 是預設值的分數寫法（顯示用）。
- `stats`：在職員工（狀態不是「離職員工」，留職停薪也算）中自動計算加班費開啟、關閉的人數（舊資料沒有這個欄位算關閉）。
- `updatedAt`：最後一次存檔的時間，沒存過是 `null`。

### `PUT /api/payroll/policy`

部分更新：只改有送的欄位，其他維持原樣。**送 `null` 或送預設值都代表回到預設值**（所以把 GET 的 `defaults` 原樣送回去就是全部恢復預設）。
回傳更新後的完整內容（與 GET 相同）。

```json
{ "proration": { "method": "calendarDays" } }
```

```json
{ "overtime": { "rates": { "weekdayFirst2": 1.5, "weekdayAfter2": "4/3", "holidayAfter10": null }, "newEmployeeAutoCalc": false } }
```

400 的情況（都不會寫入任何欄位）：

| 內容 | 訊息 |
| --- | --- |
| `{}` | 沒有要更新的設定 |
| 不認得的鍵（任一層） | 不認得的設定：overtime.rates.nightBonus |
| `proration.method` 不是三個值之一 | 月中到職、離職的月薪比例只能是 days30、calendarDays、none |
| 倍率超出 1～5、超過兩位小數、不是數字 | 「平日加班前 2 小時」的倍率必須是 1 到 5 之間的數字（最多小數兩位，或 4/3 這類三分之一的倍數） |
| `newEmployeeAutoCalc` 不是布林值 | 新進員工是否自動計算加班費（overtime.newEmployeeAutoCalc）必須是 true 或 false |

各欄位各自原子寫入（`$set` / `$unset`）：兩個人同時改不同的欄位不會互相蓋掉。

### 員工的 `autoOvertimeCalc`、`requiresScheduling`

- `POST /api/employees`、`PUT /api/employees/:id` 接受 `autoOvertimeCalc`（自動計算加班費）與 `requiresScheduling`（需要排班），
  值是 `true` / `false`（舊版 multipart 表單的 `"true"` / `"false"` 字串也接受）；其他值回 400
  `「自動計算加班費」（autoOvertimeCalc）只能是 true 或 false`。以前這兩個欄位沒有任何寫入路徑，畫面上的開關存不進去。
- 新增時沒帶 `autoOvertimeCalc`：用 `overtime.newEmployeeAutoCalc`；沒帶 `requiresScheduling`：需要（資料模型的預設）。
- 修改時沒帶就不動。
- `GET /api/employees/:id`（管理員）與 `GET /api/employees`（管理員清單）都回傳這兩個欄位。

### `POST /api/employees/auto-overtime-calc`（整批設定）

```json
{ "enabled": true, "dryRun": true }
```

```json
{ "enabled": false, "employeeIds": ["6731a0c2e4b0a1b2c3d4e5f6", "6731a0c2e4b0a1b2c3d4e5f7"] }
```

- `enabled`（必填，布林）：開啟或關閉。
- `employeeIds`（選填）：只改這些員工（不論狀態，最多 5000 筆，24 碼 ID）。**沒帶就是所有不是「離職員工」的員工**（留職停薪也算）。
- `dryRun`（選填，布林，預設 `false`）：只回傳人數，不寫入。

dryRun 的回應：

```json
{ "enabled": true, "dryRun": true, "scope": "active", "matched": 24, "willChange": 18 }
```

實際執行的回應（一次 `updateMany`，只改設定值不同的人）：

```json
{
  "enabled": true, "dryRun": false, "scope": "selected", "matched": 2, "willChange": 2, "notFound": 0, "changed": 2,
  "stats": { "activeEmployees": 24, "autoOvertimeCalcOn": 8, "autoOvertimeCalcOff": 16 }
}
```

- `scope`：`active`（所有在職員工）或 `selected`（指定員工）；`matched`：符合的人數；`willChange`：設定值會改變的人數；
  `notFound`（只有指定員工時）：找不到的 ID 數；`changed`：實際改了幾筆；`stats` 同 GET policy。
- 400：`enabled` 不是布林、`employeeIds` 是空陣列或不是陣列、ID 格式不對、`dryRun` 不是布林、多了不認得的欄位。

建議的畫面流程：先送 `dryRun: true` 顯示「將影響 N 人（其中 M 人會改變）」，使用者確認後再送一次 `dryRun: false`。

### 薪資總覽的 `summary`（`GET /api/payroll/overview/monthly`）

回應多了 `summary`：整個篩選結果（不只這一頁）的人數與金額合計。

```json
{
  "items": [ "…這一頁的列…" ],
  "pagination": { "total": 24, "page": 2, "pageSize": 10, "totalPages": 3 },
  "summary": {
    "headCount": 24,
    "withPayrollRecord": 10,
    "totals": {
      "baseSalary": 0, "leaveDeduction": 0,
      "laborInsuranceFee": 0, "healthInsuranceFee": 0, "laborPensionSelf": 0, "employeeAdvance": 0, "debtGarnishment": 0,
      "otherDeductions": 0, "lateEarlyDeduction": 0, "deductionShortfall": 0, "netPay": 653859,
      "overtimePay": 0, "nightShiftAllowance": 0, "recurringAllowance": 0, "performanceBonus": 0, "otherBonuses": 0,
      "totalBonus": 0, "totalPayment": 754991
    }
  }
}
```

- `totals` 的每一欄是各列金額先四捨五入成整數再相加（與畫面「本頁合計」的算法相同）；`headCount` = `pagination.total`。
- 結果只有一頁時 `summary` 一定有。**超過一頁時要帶 `summary=true` 才會計算**（要把其他頁的員工也算一遍：500 人約 2～3 秒），
  沒帶時是 `null`。建議：換月份、篩選、搜尋時帶 `summary=true`；只換頁或換每頁筆數時不帶，沿用上一次的合計。
- 列上新增 `hoursSource`：工時、請假、加班時數的來源。`calculated`（沒有薪資記錄，即時計算）、`record`（薪資記錄存下的時數）、
  `attendance`（薪資記錄是舊式的、沒有存時數（全是 0），改用現在的出勤資料，與薪資明細相同）。金額一律照薪資記錄。
  以前舊式記錄的員工工時、請假、加班時數整列顯示 0。
- 列上的 `employment` 有 `method`、`basisDays`（見上）。

### 銀行匯款 Excel 的範圍篩選（`POST /api/payroll/export`）

查詢參數除了 `month`、`format`（或舊的 `bankType`），可以加上與薪資總覽相同的 `organization`、`department`、`subDepartment`：

```
POST /api/payroll/export?month=2026-10-01&format=taichung&department=6731a0c2e4b0a1b2c3d4e5f6
```

- 只匯出範圍內的員工，範圍外員工的薪資記錄也不會被帶進來。
- 不認得的查詢參數回 400 `不支援的匯出條件：dept（只接受 organization、department、subDepartment）`（打錯參數名稱時不會悄悄匯出全公司）。
- 部門、單位不是正確的 ID 回 400 `Invalid department filter`；範圍內沒有員工回 400 `這個範圍沒有員工，沒有資料可以匯出`。
- 月薪資總覽 PDF（`GET /api/payroll/export/pdf`）本來就接受同樣的篩選（另外還有 `employeeId`）。

## 啟動時的紀錄

伺服器啟動時記一行（只讀、只算筆數，讀不到也不影響啟動），例如：

```
Payroll policy (defaults, not saved): proration days30; overtime rates default; new employees autoOvertimeCalc on; active employees autoOvertimeCalc on 6 / off 15
```

改過設定時會是 `saved setting`，改過的倍率列在 `customized (weekdayFirst2, ...)`。

## 部署注意

- 不需要搬資料：沒有 `payrollpolicies` 集合或文件就是預設值。
- 既有員工的 `autoOvertimeCalc` 不會被改；新進員工預設改為開啟（`newEmployeeAutoCalc: true`），不想要的話在薪資設定關掉。
