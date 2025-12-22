# Night Shift Allowance Fix - Before and After

## 問題現象 (Problem Symptoms)

### Before Fix (修復前)
在月薪資總覽中看到：

| 員工編號 | 姓名 | 夜班天數 | 夜班時數 | 夜班津貼 | 基本薪資 | 實發金額 |
|---------|------|----------|----------|----------|----------|----------|
| E001    | 王小明 | 20       | 140.00   | **0**    | 40,000   | 38,500   |
| E002    | 李美玲 | 18       | 126.00   | **0**    | 42,000   | 40,200   |

❌ **問題**: 有夜班天數和時數，但津貼為 0

### After Fix (修復後)
修復班別設定後，同樣的排班數據：

| 員工編號 | 姓名 | 夜班天數 | 夜班時數 | 夜班津貼 | 基本薪資 | 實發金額 |
|---------|------|----------|----------|----------|----------|----------|
| E001    | 王小明 | 20       | 140.00   | **7,933** | 40,000   | 46,433   |
| E002    | 李美玲 | 18       | 126.00   | **7,140** | 42,000   | 47,340   |

✅ **修復**: 正確計算夜班津貼

## 技術原因 (Technical Root Cause)

### Before Fix - 問題代碼
```javascript
// shiftController.js - 缺少欄位處理
return {
  name,
  code,
  isNightShift: Boolean(merged.isNightShift ?? false),
  hasAllowance: Boolean(merged.hasAllowance ?? false),
  allowanceMultiplier: merged.allowanceMultiplier !== undefined 
    ? Number(merged.allowanceMultiplier) 
    : (existing.allowanceMultiplier ?? 0),
  // ❌ 缺少 allowanceType
  // ❌ 缺少 fixedAllowanceAmount
  // ❌ 缺少驗證邏輯
};
```

### After Fix - 修復代碼
```javascript
// shiftController.js - 完整欄位處理和驗證
const payload = {
  name,
  code,
  isNightShift: Boolean(merged.isNightShift ?? false),
  hasAllowance: Boolean(merged.hasAllowance ?? false),
  allowanceType: merged.allowanceType ?? existing.allowanceType ?? 'multiplier', // ✅ 新增
  allowanceMultiplier: merged.allowanceMultiplier !== undefined 
    ? Number(merged.allowanceMultiplier) 
    : (existing.allowanceMultiplier ?? 0),
  fixedAllowanceAmount: merged.fixedAllowanceAmount !== undefined 
    ? Number(merged.fixedAllowanceAmount) 
    : (existing.fixedAllowanceAmount ?? 0), // ✅ 新增
};

// ✅ 新增驗證邏輯
if (payload.hasAllowance) {
  if (payload.allowanceType === 'multiplier' && 
      (!payload.allowanceMultiplier || payload.allowanceMultiplier <= 0)) {
    throw new Error('啟用夜班津貼時，倍率必須大於 0');
  }
  if (payload.allowanceType === 'fixed' && 
      (!payload.fixedAllowanceAmount || payload.fixedAllowanceAmount <= 0)) {
    throw new Error('啟用夜班津貼時，固定津貼金額必須大於 0');
  }
}

return payload;
```

## 班別設定變化 (Shift Configuration Changes)

### Before Fix - 問題設定
```json
{
  "name": "夜班",
  "code": "SHIFT-D",
  "isNightShift": true,
  "hasAllowance": true,
  "allowanceMultiplier": 0  // ❌ 為 0，不會計算津貼
  // ❌ allowanceType 未定義（資料庫中為 undefined）
  // ❌ fixedAllowanceAmount 未定義
}
```

**結果**: 
- ✅ `nightShiftDays` 被計數
- ✅ `nightShiftHours` 被計數  
- ❌ `nightShiftAllowance` = 0 (因為 allowanceMultiplier = 0)

### After Fix - 正確設定
```json
{
  "name": "夜班",
  "code": "SHIFT-D",
  "isNightShift": true,
  "hasAllowance": true,
  "allowanceType": "multiplier",  // ✅ 明確定義
  "allowanceMultiplier": 0.34,    // ✅ 設定為 0.34 (34% 津貼)
  "fixedAllowanceAmount": 0       // ✅ 倍率模式時此欄位為 0
}
```

**結果**:
- ✅ `nightShiftDays` 被計數
- ✅ `nightShiftHours` 被計數
- ✅ `nightShiftAllowance` = 時薪 × 時數 × 0.34

## 計算範例 (Calculation Example)

### 員工資料
- 姓名: 王小明
- 薪資類型: 月薪
- 月薪: 40,000 元
- 當月夜班: 20 天

### Before Fix 計算
```
基本時薪 = 40,000 / 30 / 8 = 166.67 元
夜班工作時數 = 7 小時/天 (22:00-06:00，扣除 1 小時休息)
津貼倍數 = 0 (❌ 設定錯誤)

單班津貼 = 166.67 × 7 × 0 = 0 元
月津貼總額 = 0 × 20 = 0 元 ❌
```

### After Fix 計算
```
基本時薪 = 40,000 / 30 / 8 = 166.67 元
夜班工作時數 = 7 小時/天 (22:00-06:00，扣除 1 小時休息)
津貼倍數 = 0.34 (✅ 正確設定)

單班津貼 = 166.67 × 7 × 0.34 = 396.67 元
月津貼總額 = 396.67 × 20 = 7,933 元 ✅
```

## 修復步驟 (Fix Steps)

### Step 1: 檢查現有設定
```bash
cd server
node scripts/fix-night-shift-allowance.js
```

輸出範例：
```
⚠️  Shift "夜班" (SHIFT-D): hasAllowance=true but allowanceMultiplier=0
   Suggested fix: Set allowanceMultiplier to a value > 0 (e.g., 0.34 for 34% allowance)
```

### Step 2: 修復設定 (透過 UI)
1. 登入系統
2. 進入「考勤設定」
3. 找到「夜班」班別
4. 確認設定：
   - ☑️ 是否為夜班: **是**
   - ☑️ 是否有夜班津貼: **是**
   - 津貼計算方式: **倍率計算**
   - 津貼倍數: **0.34** (或其他合適的值)

### Step 3: 驗證結果
1. 進入「薪資管理設定」→「月薪資總覽」
2. 選擇有夜班的月份
3. 確認「夜班津貼」欄位顯示正確金額

## 預防措施 (Prevention)

### 後端驗證
修復後，當試圖建立或更新班別時：

```javascript
// ❌ 這個請求會被拒絕
POST /api/shifts
{
  "name": "夜班",
  "hasAllowance": true,
  "allowanceMultiplier": 0  // ❌ 錯誤: 倍率必須 > 0
}

// Response: 400 Bad Request
{
  "error": "啟用夜班津貼時，倍率必須大於 0"
}
```

```javascript
// ✅ 這個請求會成功
POST /api/shifts
{
  "name": "夜班",
  "hasAllowance": true,
  "allowanceType": "multiplier",
  "allowanceMultiplier": 0.34  // ✅ 正確
}

// Response: 201 Created
```

### 前端提示
前端已有完整的表單驗證，確保使用者輸入正確的值。

## 影響範圍 (Impact)

### ✅ 向後相容
- 現有的非夜班班別不受影響
- 現有的薪資計算邏輯保持不變
- 只影響標記為夜班且啟用津貼的班別

### ✅ 資料遷移
- 提供了檢查腳本來識別問題
- 不會自動修改現有資料（需手動確認）
- 可以選擇性地設定預設倍數

### ✅ 新建班別
- 強制驗證津貼設定
- 防止建立無效配置
- 提供清楚的錯誤訊息

## 總結 (Summary)

| 項目 | Before | After |
|------|--------|-------|
| 後端欄位處理 | ❌ 不完整 | ✅ 完整 |
| 輸入驗證 | ❌ 缺少 | ✅ 完整 |
| 錯誤日誌 | ❌ 無 | ✅ 有 |
| 夜班津貼計算 | ❌ 可能為 0 | ✅ 正確計算 |
| 資料一致性 | ❌ 可能不一致 | ✅ 一致 |
| 文件說明 | ⚠️ 基本 | ✅ 完整 |
| 遷移工具 | ❌ 無 | ✅ 有 |

**修復狀態**: ✅ **COMPLETED**
