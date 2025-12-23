# 移除員工薪資設定中的夜班輔助津貼功能

## 變更概述

本次變更完全移除了員工資料管理中「薪資設定」頁簽內的「夜班輔助津貼」欄位。夜班津貼現在完全由班別設定自動計算，不再允許在員工個人資料中手動設定。

## 變更原因

夜班輔助津貼應該由班別設定確認，而不是在每月薪資調整項目中手動設定。這樣可以：
- 確保夜班津貼的計算與實際排班一致
- 避免手動設定造成的錯誤或不一致
- 簡化薪資設定流程
- 統一夜班津貼的管理方式

## 主要變更內容

### 前端變更

#### EmployeeManagement.vue
- **位置**: `client/src/components/backComponents/EmployeeManagement.vue`
- **變更內容**:
  - 移除「夜班補助津貼」表單欄位（第897-902行）
  - 移除 `emptyEmployee` 物件中的 `nightShiftAllowance` 初始值（第3253行）

**變更前**:
```vue
<el-form-item label="夜班補助津貼" prop="monthlySalaryAdjustments.nightShiftAllowance">
  <el-input-number v-model="employeeForm.monthlySalaryAdjustments.nightShiftAllowance" 
    :min="0" :step="100"
    :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
    :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')" />
</el-form-item>
```

**變更後**: 已移除此欄位

### 後端變更

#### Employee.js (資料模型)
- **位置**: `server/src/models/Employee.js`
- **變更內容**: 從 `monthlySalaryAdjustments` schema 中移除 `nightShiftAllowance` 欄位

**變更前**:
```javascript
monthlySalaryAdjustments: {
  // 扣款項目
  healthInsuranceFee: { type: Number, default: 0 },
  debtGarnishment: { type: Number, default: 0 },
  otherDeductions: { type: Number, default: 0 },
  
  // 獎金/津貼項目
  nightShiftAllowance: { type: Number, default: 0 }, // 夜班補助津貼
  performanceBonus: { type: Number, default: 0 },
  otherBonuses: { type: Number, default: 0 },
  
  // 說明備註
  notes: String,
}
```

**變更後**:
```javascript
monthlySalaryAdjustments: {
  // 扣款項目
  healthInsuranceFee: { type: Number, default: 0 },
  debtGarnishment: { type: Number, default: 0 },
  otherDeductions: { type: Number, default: 0 },
  
  // 獎金/津貼項目
  performanceBonus: { type: Number, default: 0 },
  otherBonuses: { type: Number, default: 0 },
  
  // 說明備註
  notes: String,
}
```

#### payrollService.js (薪資計算服務)
- **位置**: `server/src/services/payrollService.js`
- **變更內容**: 更新薪資計算邏輯，不再從員工個人設定讀取夜班津貼

**變更前**:
```javascript
// 優先使用自定義值，然後使用動態計算的夜班津貼，最後使用員工設定的每月調整項目
const nightShiftAllowance = customData.nightShiftAllowance ?? 
                            nightShiftAllowanceData?.allowanceAmount ?? 
                            employee.monthlySalaryAdjustments?.nightShiftAllowance ?? 0;
```

**變更後**:
```javascript
// 夜班津貼使用動態計算值或自定義值（不再使用員工個人設定）
const nightShiftAllowance = customData.nightShiftAllowance ?? 
                            nightShiftAllowanceData?.allowanceAmount ?? 0;
```

#### nightShiftAllowanceService.js (夜班津貼計算服務)
- **位置**: `server/src/services/nightShiftAllowanceService.js`
- **變更內容**: 移除使用員工個人設定作為後備選項的邏輯

**變更前**:
```javascript
// 如果有計算出的夜班津貼，使用它；否則使用員工設定的固定津貼
const finalAllowance = totalAllowance > 0
  ? totalAllowance
  : (employee.monthlySalaryAdjustments?.nightShiftAllowance || 0);
```

**變更後**:
```javascript
// 如果有計算出的夜班津貼，使用它；否則為 0（不再使用員工設定的固定津貼）
const finalAllowance = totalAllowance > 0 ? totalAllowance : 0;
```

#### seedUtils.js (測試資料生成)
- **位置**: `server/src/seedUtils.js`
- **變更內容**: 更新測試資料生成，不再為員工設定固定夜班津貼

**變更前**:
```javascript
const monthlySalaryAdjustments = isNightShiftEmployee ? {
  nightShiftAllowance: randomInRange(2000, 4000),
  performanceBonus: 0,
  // ...
  notes: '夜班員工，含固定夜班津貼',
} : {
  nightShiftAllowance: 0,
  // ...
}
```

**變更後**:
```javascript
const monthlySalaryAdjustments = isNightShiftEmployee ? {
  performanceBonus: 0,
  // ...
  notes: '夜班員工，夜班津貼由班別設定自動計算',
} : {
  performanceBonus: 0,
  // ...
}
```

### 文檔變更

#### monthly-salary-adjustments.md
- **位置**: `docs/monthly-salary-adjustments.md`
- **變更內容**: 
  - 移除使用場景中的「固定的夜班津貼」說明
  - 移除欄位說明中的「夜班補助津貼」
  - 更新計算範例，移除夜班津貼相關內容
  - 更新 API 範例，移除夜班津貼相關參數
  - 更新資料庫結構說明

### 測試變更

#### monthlySalaryAdjustments.test.js
- **位置**: `server/tests/monthlySalaryAdjustments.test.js`
- **變更內容**: 移除所有與 `nightShiftAllowance` 相關的測試斷言

## 夜班津貼計算方式

移除員工個人設定後，夜班津貼的計算方式如下：

1. **班別設定**: 在出勤設定中配置夜班班別，並設定固定津貼金額
2. **排班記錄**: 系統根據員工的排班記錄，計算當月夜班天數
3. **自動計算**: 使用 `nightShiftAllowanceService.js` 自動計算夜班津貼
4. **薪資套用**: 計算結果自動套用到薪資計算中

**優先順序**:
1. API 自訂參數 (customData.nightShiftAllowance) - 最高優先權
2. 班別設定計算值 (nightShiftAllowanceData.allowanceAmount) - 次優先
3. 預設值 0 - 最低優先

## 影響範圍

### 正面影響
1. **資料一致性**: 夜班津貼完全由班別設定和排班記錄決定，避免人工設定錯誤
2. **流程簡化**: 減少員工薪資設定的複雜度
3. **管理集中**: 夜班津貼統一在班別設定中管理

### 需要注意的事項
1. **現有資料**: 如果資料庫中已有員工設定的 `nightShiftAllowance` 值，這些值將被忽略
2. **班別設定**: 需要確保所有夜班班別都正確設定了固定津貼金額
3. **排班記錄**: 需要確保員工的排班記錄正確，以便正確計算夜班津貼

## 測試結果

所有相關測試通過：
- ✅ Monthly Salary Adjustments 測試: 6 個測試通過
- ✅ Night Shift Allowance Service 測試: 5 個測試通過
- ✅ 無安全漏洞（CodeQL 掃描）

## 驗證步驟

如需驗證此變更，請按照以下步驟操作：

1. **前端驗證**:
   - 登入系統
   - 進入「員工管理」
   - 編輯任一員工
   - 切換到「薪資設定」頁簽
   - 確認「每月薪資調整項目」中**沒有**「夜班補助津貼」欄位

2. **後端驗證**:
   - 檢查班別設定中的夜班班別是否正確設定津貼金額
   - 計算薪資時，夜班津貼應該根據排班記錄自動計算
   - API 回應中的夜班津貼應該來自班別設定計算，而非員工個人設定

3. **測試驗證**:
   ```bash
   cd server
   npm test -- monthlySalaryAdjustments.test.js
   npm test -- nightShiftAllowance.test.js
   ```

## 回滾計劃

如需回滾此變更，需要：
1. 還原所有變更的檔案
2. 重新部署前端和後端
3. 在員工資料中重新設定夜班津貼值（如需要）

## 相關文件

- [每月薪資調整項目功能說明](./monthly-salary-adjustments.md)
- [夜班津貼實作說明](./night-shift-allowance-implementation.md)
- [薪資計算系統文件](./PAYROLL_README.md)

## 聯絡資訊

如有任何問題或需要協助，請聯絡：
- 專案維護者
- 系統管理員

---

**變更日期**: 2025-12-23  
**變更版本**: v1.0.0  
**狀態**: ✅ 已完成並測試
