# 夜班津貼問題修復說明

## 問題描述
在後台薪資月總覽中，有顯示夜班天數和夜班時數，但是夜班津貼顯示為 0。

## 根本原因

此問題由以下幾個因素造成：

### 1. 班別設定欄位缺失
`shiftController.js` 在建立或更新班別時，沒有正確處理以下欄位：
- `allowanceType` (津貼類型：倍率計算 or 固定津貼)
- `fixedAllowanceAmount` (固定津貼金額)

這導致即使前端有這些欄位，後端也無法正確儲存。

### 2. 驗證邏輯不足
當 `hasAllowance: true` 時，系統沒有驗證是否有設定有效的津貼金額：
- 倍率計算：`allowanceMultiplier` 必須 > 0
- 固定津貼：`fixedAllowanceAmount` 必須 > 0

### 3. 資料不一致
資料庫中可能存在以下情況的班別：
- 舊資料：在欄位新增之前建立的班別
- `isNightShift: true` 且 `hasAllowance: true`
- 但 `allowanceMultiplier` 為 0 或未設定

## 修復內容

### 1. 後端服務修復 (nightShiftAllowanceService.js)
```javascript
// 修復前：未處理 allowanceType 為 undefined 的情況
if (shift.allowanceType === ALLOWANCE_TYPES.FIXED) {
  // ...
}

// 修復後：提供預設值並加入日誌
const allowanceType = shift.allowanceType || 'multiplier';
if (allowanceType === ALLOWANCE_TYPES.FIXED) {
  // ...
} else {
  const multiplier = shift.allowanceMultiplier;
  if (multiplier > 0) {
    // 計算津貼
  } else {
    console.warn(`班別 "${shift.name}" 啟用津貼但倍率為 ${multiplier}`);
  }
}
```

### 2. 班別控制器修復 (shiftController.js)
```javascript
// 修復前：缺少 allowanceType 和 fixedAllowanceAmount
return {
  // ...
  isNightShift: Boolean(...),
  hasAllowance: Boolean(...),
  allowanceMultiplier: ...,
};

// 修復後：加入完整欄位和驗證
const payload = {
  // ...
  allowanceType: merged.allowanceType ?? existing.allowanceType ?? 'multiplier',
  allowanceMultiplier: ...,
  fixedAllowanceAmount: ...,
};

// 驗證邏輯
if (payload.hasAllowance) {
  if (payload.allowanceType === 'multiplier' && (!payload.allowanceMultiplier || payload.allowanceMultiplier <= 0)) {
    throw new Error('啟用夜班津貼時，倍率必須大於 0');
  }
  if (payload.allowanceType === 'fixed' && (!payload.fixedAllowanceAmount || payload.fixedAllowanceAmount <= 0)) {
    throw new Error('啟用夜班津貼時，固定津貼金額必須大於 0');
  }
}
```

### 3. 新增工具腳本

#### 檢查與修復腳本 (fix-night-shift-allowance.js)
用途：檢查資料庫中所有班別設定，找出有問題的配置

```bash
cd server
node scripts/fix-night-shift-allowance.js
```

輸出範例：
```
📝 Shift "夜班" (NIGHT): Setting default allowanceType to 'multiplier'
⚠️  Shift "夜班" (NIGHT): hasAllowance=true but allowanceMultiplier=0
   Suggested fix: Set allowanceMultiplier to a value > 0 (e.g., 0.34 for 34% allowance)
```

#### 驗證測試腳本 (test-shift-validation.js)
用途：測試驗證邏輯是否正確運作

```bash
cd server
node scripts/test-shift-validation.js
```

## 如何修復現有資料

### 方法 1：使用檢查腳本
1. 執行檢查腳本查看問題：
   ```bash
   cd server
   node scripts/fix-night-shift-allowance.js
   ```

2. 根據輸出的建議，記錄需要修復的班別

### 方法 2：透過前端 UI 修復
1. 登入系統，進入「考勤設定」
2. 找到標記為「夜班」且「有津貼」的班別
3. 確認以下設定：
   - ☑️ 是否為夜班
   - ☑️ 是否有夜班津貼
   - 津貼計算方式：
     - 如選擇「倍率計算」：設定津貼倍數 > 0 (例如 0.34 表示 34% 津貼)
     - 如選擇「固定津貼」：設定固定津貼金額 > 0 (例如 200 元)

### 方法 3：透過 API 修復
使用 PUT `/api/shifts/:id` 更新班別：

```bash
curl -X PUT http://localhost:5000/api/shifts/{shiftId} \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "hasAllowance": true,
    "allowanceType": "multiplier",
    "allowanceMultiplier": 0.34
  }'
```

## 驗證修復是否成功

### 1. 檢查班別設定
進入「考勤設定」，確認夜班班別的津貼設定正確：
- 津貼倍數或固定金額 > 0

### 2. 檢查月薪資總覽
1. 進入「薪資管理設定」>「月薪資總覽」
2. 選擇有夜班排班的月份
3. 查看員工列表中：
   - 「夜班天數」應 > 0
   - 「夜班時數」應 > 0
   - **「夜班津貼」應 > 0** (修復後)

### 3. 檢查計算結果
在月薪資總覽中，點擊「詳細」查看員工薪資明細：
- 基本資訊中顯示夜班天數和時數
- 加項中顯示夜班津貼金額
- 總實發金額應包含夜班津貼

## 預防措施

修復後，系統會自動執行以下驗證：

1. **建立班別時**：如果 `hasAllowance: true`，必須設定有效的津貼配置
2. **更新班別時**：如果啟用津貼，必須設定有效的倍數或金額
3. **計算薪資時**：如果發現配置不正確，會在日誌中輸出警告

## 技術細節

### 計算公式

#### 倍率計算
```
夜班津貼 = 基本時薪 × 夜班工作時數 × 津貼倍數

其中：
- 基本時薪 = 月薪 / 30 / 8 (月薪制)
- 基本時薪 = 日薪 / 8 (日薪制)
- 基本時薪 = 時薪 (時薪制)
- 夜班工作時數 = 班別時數 - 休息時數
```

範例：
- 月薪 40,000 元
- 時薪 = 40,000 / 30 / 8 = 166.67 元
- 夜班 22:00-06:00，扣除 1 小時休息 = 7 小時
- 津貼倍數 0.34 (34%)
- 單班津貼 = 166.67 × 7 × 0.34 = 396.67 元
- 月津貼 (20 班) = 396.67 × 20 = 7,933 元

#### 固定津貼
```
夜班津貼 = 固定津貼金額 × 夜班天數
```

範例：
- 固定津貼 200 元/班
- 當月夜班 20 天
- 月津貼 = 200 × 20 = 4,000 元

### 資料結構

#### AttendanceSetting.shifts
```javascript
{
  name: String,              // 班別名稱
  code: String,              // 班別代碼
  isNightShift: Boolean,     // 是否為夜班
  hasAllowance: Boolean,     // 是否有津貼
  allowanceType: String,     // 津貼類型：'multiplier' 或 'fixed'
  allowanceMultiplier: Number, // 津貼倍數 (allowanceType='multiplier' 時使用)
  fixedAllowanceAmount: Number, // 固定津貼金額 (allowanceType='fixed' 時使用)
  // ... 其他欄位
}
```

## 常見問題

### Q1: 為什麼有夜班天數但沒有津貼？
A: 這是因為班別設定中 `hasAllowance: true`，但 `allowanceMultiplier` 或 `fixedAllowanceAmount` 為 0 或未設定。請依照上述方法修復。

### Q2: 修復後舊的薪資記錄會自動更新嗎？
A: 不會。已經儲存的薪資記錄不會自動更新。修復只影響未來的計算。如需重算舊記錄，需要重新計算該月份的薪資。

### Q3: 如何重新計算某月份的薪資？
A: 在月薪資總覽中，選擇該月份後，系統會自動重新計算未儲存的薪資記錄。如果記錄已儲存，可能需要先刪除該記錄。

### Q4: 為什麼前端可以設定但後端沒有儲存？
A: 這是此次修復的主要問題。修復前，後端控制器沒有處理 `allowanceType` 和 `fixedAllowanceAmount` 欄位。修復後已解決。

### Q5: 檢查腳本會自動修復嗎？
A: 預設不會。腳本只會報告問題。如果要自動設定預設倍數，需要取消註解腳本中的相關程式碼（第 76-78 行）。

## 相關文件

- [夜班津貼功能實施說明](../../docs/night-shift-allowance-implementation.md)
- [薪資計算設計文件](../../docs/salary-calculation-design.md)
- [每月薪資調整項目設定](../../docs/monthly-salary-adjustments.md)
