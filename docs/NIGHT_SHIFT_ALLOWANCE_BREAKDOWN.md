# 夜班津貼計算明細功能說明

## 概述

本次更新增強了夜班津貼計算功能，當班別配置不當導致津貼為 0 時，系統現在會：
1. 明確指出配置錯誤
2. 顯示詳細的班次計算明細
3. 提供具體的修復建議

## 問題場景

當員工的排班記錄顯示：
- 夜班天數：9 天
- 夜班時數：63.00 小時
- 夜班津貼：NT$ 0

這通常表示班別設定有問題：
- 班別已設定 `isNightShift: true` 和 `hasAllowance: true`
- 但津貼計算所需的參數未正確設定

## 新增功能

### 1. 配置錯誤檢測

系統現在會檢測以下配置問題：

#### 倍率計算模式 (allowanceType: 'multiplier')
```javascript
{
  isNightShift: true,
  hasAllowance: true,
  allowanceType: 'multiplier',
  allowanceMultiplier: 0 // ❌ 錯誤：應 > 0
}
```
**錯誤訊息**: 班別「夜班」(NIGHT) 設定為倍率計算但倍率為 0 或未設定

**修復方法**: 設定 `allowanceMultiplier` > 0，例如 0.34 表示 34% 津貼

#### 固定津貼模式 (allowanceType: 'fixed')
```javascript
{
  isNightShift: true,
  hasAllowance: true,
  allowanceType: 'fixed',
  fixedAllowanceAmount: 0 // ❌ 錯誤：應 > 0
}
```
**錯誤訊息**: 班別「夜班」(NIGHT) 設定為固定津貼但金額為 0 或未設定

**修復方法**: 設定 `fixedAllowanceAmount` > 0，例如 200 表示每班 200 元

### 2. 計算方式標示

`nightShiftCalculationMethod` 現在有以下可能值：

| 值 | 說明 | 顯示 |
|---|---|---|
| `calculated` | 成功根據排班計算 | ✅ 根據排班計算 |
| `configuration_error` | 配置錯誤導致無法計算 | ⚠️ 配置錯誤 |
| `no_allowance_configured` | 有夜班但未配置津貼 | ⚠️ 未配置津貼 |
| `fixed` | 使用固定津貼 | 固定津貼 |
| `no_schedules` | 本月無夜班排班 | 本月無夜班排班 |
| `no_shifts` | 未設定夜班班別 | 未設定夜班班別 |

### 3. 詳細班次明細

新增 `nightShiftBreakdown` 陣列，包含每個夜班的詳細計算：

```javascript
{
  shiftName: "夜班",
  shiftCode: "NIGHT",
  allowanceType: "浮動津貼", // 或 "固定津貼"
  workHours: 7.0,
  allowanceAmount: 396.67,
  calculationDetail: "浮動津貼: NT$ 166.67/時 × 7.00時 × 0.34 = NT$ 396.67",
  hasIssue: false
}
```

當有配置問題時：
```javascript
{
  shiftName: "夜班",
  shiftCode: "NIGHT",
  allowanceType: "浮動津貼",
  workHours: 7.0,
  allowanceAmount: 0,
  calculationDetail: "倍率未設定 (應設定 allowanceMultiplier > 0，例如 0.34 表示 34% 津貼)",
  hasIssue: true // ⚠️ 標記為有問題
}
```

### 4. 配置問題列表

新增 `nightShiftConfigurationIssues` 陣列，列出所有配置問題：

```javascript
[
  "班別「夜班」(NIGHT) 設定為倍率計算但倍率為 0 或未設定",
  "班別「大夜班」(LATE_NIGHT) 設定為固定津貼但金額為 0 或未設定"
]
```

## UI 顯示

### 月薪資總覽 - 基本資訊卡片

夜班津貼欄位現在會：
1. 當金額為 0 且有夜班天數時，以橘色警示色顯示
2. 顯示計算方式圖示：
   - ✅ 根據排班計算（綠色）
   - ⚠️ 配置錯誤（紅色）
   - ⚠️ 未配置津貼（橘色）
3. 如果有配置問題，顯示錯誤提示框：
   ```
   ⚠️ 夜班津貼配置問題：
   • 班別「夜班」(NIGHT) 設定為倍率計算但倍率為 0 或未設定
   
   請至「考勤設定」頁面檢查並修正班別設定
   ```

### 薪資計算明細對話框

在詳細薪資明細中，夜班津貼會顯示：
1. 主項目：夜班津貼（含天數、時數和配置狀態）
2. 子項目：每個夜班班別的詳細計算
   ```
   夜班津貼    配置錯誤：9 天夜班但津貼為 0    NT$ 0 ⚠️
     ↳ 夜班 (NIGHT)    倍率未設定 (應設定 allowanceMultiplier > 0...)    NT$ 0 ⚠️
   ```

有問題的項目會以紅色顯示並標示警告圖示。

## 資料結構變更

### PayrollRecord 模型新增欄位

```javascript
{
  // 既有欄位
  nightShiftDays: Number,
  nightShiftHours: Number,
  nightShiftCalculationMethod: String,
  
  // 新增欄位
  nightShiftBreakdown: Array,           // 班次計算明細
  nightShiftConfigurationIssues: Array  // 配置問題列表
}
```

### nightShiftAllowanceService 回傳值

```javascript
{
  nightShiftDays: 9,
  nightShiftHours: 63.0,
  allowanceAmount: 0,
  calculationMethod: 'configuration_error',
  shiftBreakdown: [
    {
      shiftName: "夜班",
      shiftCode: "NIGHT",
      allowanceType: "浮動津貼",
      workHours: 7.0,
      allowanceAmount: 0,
      calculationDetail: "倍率未設定 (應設定 allowanceMultiplier > 0...)",
      hasIssue: true
    }
  ],
  configurationIssues: [
    "班別「夜班」(NIGHT) 設定為倍率計算但倍率為 0 或未設定"
  ]
}
```

## 如何修復配置問題

### 方法 1: 透過前端 UI

1. 登入系統，進入「考勤設定」頁面
2. 找到標記為「夜班」且「有津貼」的班別
3. 確認津貼設定：
   - **倍率計算**: 設定「津貼倍數」> 0 (例如 0.34)
   - **固定津貼**: 設定「固定津貼金額」> 0 (例如 200)

### 方法 2: 透過 API

```bash
# 更新為倍率計算
curl -X PUT http://localhost:5000/api/shifts/{shiftId} \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "hasAllowance": true,
    "allowanceType": "multiplier",
    "allowanceMultiplier": 0.34
  }'

# 更新為固定津貼
curl -X PUT http://localhost:5000/api/shifts/{shiftId} \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "hasAllowance": true,
    "allowanceType": "fixed",
    "fixedAllowanceAmount": 200
  }'
```

### 方法 3: 執行檢查腳本

```bash
cd server
node scripts/fix-night-shift-allowance.js
```

腳本會輸出所有有問題的班別配置。

## 津貼計算公式

### 倍率計算 (allowanceType: 'multiplier')

```
夜班津貼 = 時薪 × 夜班工作時數 × 津貼倍數

其中：
- 時薪 = 月薪 ÷ 30 ÷ 8 (月薪制)
- 夜班工作時數 = 班別時數 - 休息時數
- 津貼倍數 = allowanceMultiplier
```

**範例**:
- 月薪: 40,000 元
- 時薪: 40,000 ÷ 30 ÷ 8 = 166.67 元/時
- 夜班: 22:00-06:00，休息 1 小時 = 7 小時
- 津貼倍數: 0.34
- 單班津貼: 166.67 × 7 × 0.34 = 396.67 元
- 月津貼 (9 天): 396.67 × 9 = 3,570 元

### 固定津貼 (allowanceType: 'fixed')

```
夜班津貼 = 固定津貼金額 × 夜班天數
```

**範例**:
- 固定津貼: 200 元/班
- 夜班天數: 9 天
- 月津貼: 200 × 9 = 1,800 元

## 向後兼容性

- 既有薪資記錄不受影響
- 新欄位預設為空陣列，不影響既有邏輯
- UI 會優雅降級，不顯示額外資訊但不會出錯

## 測試

已新增測試案例驗證：
1. 配置錯誤檢測（倍率為 0）
2. 配置錯誤檢測（固定金額為 0）
3. 班次明細包含計算細節
4. 配置問題列表正確生成

執行測試：
```bash
cd server
npm test -- nightShiftAllowance.test.js
```

## 總結

本次更新解決了夜班津貼顯示為 0 時無法判斷原因的問題。系統現在能：
1. **明確指出問題**: 顯示具體的配置錯誤訊息
2. **提供詳細資訊**: 展示每個班次的計算明細
3. **指引修復方向**: 告訴使用者應該如何修正配置

這大幅提升了系統的可用性和問題診斷能力。
