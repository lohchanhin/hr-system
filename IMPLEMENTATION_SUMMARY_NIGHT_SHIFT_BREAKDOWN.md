# 夜班津貼明細功能實施總結

## 問題描述

原始問題：
```
夜班天數 9 天
夜班時數 63.00 小時
夜班津貼 NT$ 0

根據排班計算，應該分析該夜班是固定津貼還是浮動津貼，必須寫出夜班津貼的金額
目前還是不能算
```

## 根本原因

系統能正確統計夜班天數和時數，但當班別配置不當時（如 `allowanceMultiplier` = 0），津貼計算為 0，且沒有任何提示說明為何無法計算。

## 解決方案

### 1. 後端增強 (nightShiftAllowanceService.js)

#### 原有邏輯
```javascript
if (shift.isNightShift && shift.hasAllowance) {
  // 簡單計算津貼
  // 如果配置錯誤，只有 console.warn
}

return {
  nightShiftDays,
  nightShiftHours,
  allowanceAmount,
  calculationMethod: totalAllowance > 0 ? 'calculated' : 'fixed'
};
```

#### 新增邏輯
```javascript
const shiftBreakdown = [];  // 詳細明細
const configurationIssues = [];  // 配置問題

for (const schedule of schedules) {
  // ... 計算邏輯
  
  if (multiplier > 0) {
    // 正常計算
    calculationDetail = `浮動津貼: NT$ ${hourlyRate}/時 × ${workHours}時 × ${multiplier}`;
  } else {
    // 記錄配置問題
    const issue = `班別「${shift.name}」倍率為 ${multiplier} 或未設定`;
    configurationIssues.push(issue);
    calculationDetail = `倍率未設定 (應設定 allowanceMultiplier > 0)`;
    hasIssue = true;
  }
  
  shiftBreakdown.push({
    shiftName,
    allowanceType,
    workHours,
    allowanceAmount,
    calculationDetail,
    hasIssue  // 🆕 標記問題
  });
}

// 🆕 更精確的計算方式判斷
let calculationMethod = 'not_calculated';
if (nightShiftDays > 0) {
  if (totalAllowance > 0) {
    calculationMethod = 'calculated';
  } else if (configurationIssues.length > 0) {
    calculationMethod = 'configuration_error';  // 🆕
  } else if (finalAllowance > 0) {
    calculationMethod = 'fixed';
  } else {
    calculationMethod = 'no_allowance_configured';  // 🆕
  }
}

return {
  nightShiftDays,
  nightShiftHours,
  allowanceAmount,
  calculationMethod,
  shiftBreakdown,  // 🆕 詳細明細
  configurationIssues  // 🆕 問題列表
};
```

### 2. 資料模型更新 (PayrollRecord.js)

```javascript
// 新增欄位
nightShiftBreakdown: { type: Array, default: [] },
nightShiftConfigurationIssues: { type: Array, default: [] }
```

### 3. 前端 UI 增強 (SalaryManagementSetting.vue)

#### 基本資訊卡片 - 夜班津貼區域

**原有顯示**:
```
夜班津貼
NT$ 0
根據排班計算
```

**新增顯示**:
```
夜班津貼
NT$ 0  ⚠️  (橘色警告)
⚠️ 配置錯誤 (紅色)

[錯誤提示框]
⚠️ 夜班津貼配置問題：
• 班別「夜班」(NIGHT) 設定為倍率計算但倍率為 0 或未設定

請至「考勤設定」頁面檢查並修正班別設定
```

#### 薪資計算明細對話框

**原有顯示**:
```
項目          說明                              金額
----------------------------------------------------
夜班津貼      9 天夜班，共 63.00 小時           NT$ 0
```

**新增顯示**:
```
項目                  說明                                      金額
------------------------------------------------------------------------
夜班津貼 ⚠️          配置錯誤：9 天夜班但津貼為 0              NT$ 0 (紅色)
  ↳ 夜班 (NIGHT)     倍率未設定 (應設定 allowanceMultiplier)   NT$ 0 (紅色)
```

### 4. 計算方式標示更新

| calculationMethod | 顯示 | 說明 |
|---|---|---|
| `calculated` | ✅ 根據排班計算 (綠色) | 成功計算 |
| `configuration_error` | ⚠️ 配置錯誤 (紅色) | 🆕 配置不當 |
| `no_allowance_configured` | ⚠️ 未配置津貼 (橘色) | 🆕 未設定 |
| `fixed` | 固定津貼 | 使用固定值 |
| `no_schedules` | 本月無夜班排班 | 無排班 |
| `no_shifts` | 未設定夜班班別 | 無班別 |

## 功能展示

### 場景 1: 倍率未設定

**班別設定**:
```javascript
{
  name: "夜班",
  code: "NIGHT",
  isNightShift: true,
  hasAllowance: true,
  allowanceType: "multiplier",
  allowanceMultiplier: 0  // ❌ 問題
}
```

**系統回傳**:
```javascript
{
  nightShiftDays: 9,
  nightShiftHours: 63.0,
  allowanceAmount: 0,
  calculationMethod: "configuration_error",
  shiftBreakdown: [{
    shiftName: "夜班",
    shiftCode: "NIGHT",
    allowanceType: "浮動津貼",
    workHours: 7.0,
    allowanceAmount: 0,
    calculationDetail: "倍率未設定 (應設定 allowanceMultiplier > 0，例如 0.34 表示 34% 津貼)",
    hasIssue: true
  }],
  configurationIssues: [
    "班別「夜班」(NIGHT) 設定為倍率計算但倍率為 0 或未設定"
  ]
}
```

**UI 顯示**: 會顯示紅色警告和詳細的配置問題說明

### 場景 2: 正確設定倍率

**班別設定**:
```javascript
{
  name: "夜班",
  code: "NIGHT",
  isNightShift: true,
  hasAllowance: true,
  allowanceType: "multiplier",
  allowanceMultiplier: 0.34  // ✅ 正確
}
```

**系統回傳** (假設月薪 40,000 元):
```javascript
{
  nightShiftDays: 9,
  nightShiftHours: 63.0,
  allowanceAmount: 3570,  // 396.67 × 9 ≈ 3570
  calculationMethod: "calculated",
  shiftBreakdown: [{
    shiftName: "夜班",
    shiftCode: "NIGHT",
    allowanceType: "浮動津貼",
    workHours: 7.0,
    allowanceAmount: 396.67,
    calculationDetail: "浮動津貼: NT$ 166.67/時 × 7.00時 × 0.34 = NT$ 396.67",
    hasIssue: false
  }],
  configurationIssues: []
}
```

**UI 顯示**: 顯示綠色 ✅ "根據排班計算" 和詳細的計算公式

### 場景 3: 固定津貼

**班別設定**:
```javascript
{
  name: "夜班",
  code: "NIGHT",
  isNightShift: true,
  hasAllowance: true,
  allowanceType: "fixed",
  fixedAllowanceAmount: 200  // ✅ 每班 200 元
}
```

**系統回傳**:
```javascript
{
  nightShiftDays: 9,
  nightShiftHours: 63.0,
  allowanceAmount: 1800,  // 200 × 9
  calculationMethod: "calculated",
  shiftBreakdown: [{
    shiftName: "夜班",
    shiftCode: "NIGHT",
    allowanceType: "固定津貼",
    workHours: 7.0,
    allowanceAmount: 200,
    calculationDetail: "固定津貼: NT$ 200.00",
    hasIssue: false
  }],
  configurationIssues: []
}
```

**UI 顯示**: 顯示固定津貼計算方式和總金額

## 技術實現細節

### 新增欄位

1. **nightShiftBreakdown** (Array):
   - 每個元素代表一個夜班的計算明細
   - 包含班別名稱、類型、時數、金額、計算公式、是否有問題

2. **nightShiftConfigurationIssues** (Array):
   - 包含所有發現的配置問題
   - 用中文描述具體問題和建議修復方式

### 計算邏輯流程

```
1. 查詢員工當月排班 → schedules[]
2. 對每個排班：
   a. 檢查是否為夜班且啟用津貼
   b. 計算工作時數
   c. 根據 allowanceType 計算津貼：
      - multiplier: 檢查 allowanceMultiplier > 0
      - fixed: 檢查 fixedAllowanceAmount > 0
   d. 如果配置不當：
      - 記錄到 configurationIssues
      - 標記 hasIssue = true
      - 提供修復建議
   e. 記錄詳細資訊到 shiftBreakdown
3. 彙總計算結果
4. 判斷 calculationMethod
5. 返回完整結果
```

### UI 渲染邏輯

```vue
<!-- 基本資訊卡片 -->
<div class="stat-value" :class="{ 'text-warning': allowance === 0 && days > 0 }">
  {{ formatCurrency(allowance) }}
</div>

<div v-if="calculationMethod" class="stat-note">
  <span v-if="calculationMethod === 'configuration_error'" class="text-danger">
    <el-icon><WarningFilled /></el-icon> 配置錯誤
  </span>
</div>

<!-- 配置問題提示 -->
<el-alert v-if="configurationIssues.length > 0" type="error">
  <ul>
    <li v-for="issue in configurationIssues">{{ issue }}</li>
  </ul>
  請至「考勤設定」頁面檢查並修正班別設定
</el-alert>

<!-- 薪資明細表格 -->
<el-table :data="breakdown">
  <el-table-column prop="item">
    <template #default="{ row }">
      <span :class="{ 'text-warning': row.hasIssue }">{{ row.item }}</span>
      <el-icon v-if="row.hasIssue"><Warning /></el-icon>
    </template>
  </el-table-column>
</el-table>
```

## 測試覆蓋

新增測試案例：
- ✅ 配置錯誤：倍率為 0
- ✅ 配置錯誤：固定金額為 0
- ✅ 包含詳細班次明細
- ✅ 配置問題列表生成

## 向後兼容性

- ✅ 既有 PayrollRecord 不受影響（新欄位預設為空陣列）
- ✅ 既有 UI 優雅降級（不顯示額外資訊但不出錯）
- ✅ API 回傳格式向後兼容

## 使用者操作流程

1. **發現問題**: 在月薪資總覽看到夜班津貼為 NT$ 0 但有夜班天數
2. **查看詳情**: 點擊「詳細」查看薪資明細
3. **識別原因**: 看到 ⚠️ 配置錯誤和具體問題描述
4. **修正配置**: 根據提示到「考勤設定」頁面修正班別設定
5. **重新計算**: 重新查看薪資總覽，確認津貼已正確計算

## 文件

- ✅ 詳細功能說明: `docs/NIGHT_SHIFT_ALLOWANCE_BREAKDOWN.md`
- ✅ 實施總結: `IMPLEMENTATION_SUMMARY_NIGHT_SHIFT_BREAKDOWN.md`

## 總結

本次更新徹底解決了「夜班津貼為 0 時無法判斷原因」的問題，提供了：

1. **明確的問題診斷**: 精確指出哪個班別配置有問題
2. **詳細的計算透明度**: 顯示每個班次的計算公式
3. **可操作的修復指引**: 告訴使用者應該如何修正
4. **視覺化的問題提示**: 使用顏色和圖示突顯問題

這大幅提升了系統的可用性和維護性。
