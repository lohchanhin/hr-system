# 薪資項目設定移除說明 / Salary Item Settings Removal

## 問題背景 / Background

問題：如果薪資項目全部跑簽核系統確認加薪或扣薪，那系統後台薪資管理裡面的薪資項目設定是否還有必要？

Question: If all salary items go through the approval system to confirm salary increases or deductions, is it still necessary to have the salary item settings in the system's backend salary management?

## 調查結果 / Investigation Results

### 原有功能 / Original Functionality

1. **薪資項目設定** (Salary Item Settings) 位於「薪資管理設定」頁面
   - 可以定義薪資項目如：交通津貼、伙食補助、全勤獎金
   - 每個項目可設定：
     - 項目名稱
     - 類型（加項/扣項）
     - 是否計稅
     - 是否影響投保
     - 說明

2. **員工記錄** (Employee Records)
   - 員工資料中有 `salaryItems` 欄位
   - 可以從薪資項目設定中選擇多個項目
   - 這些項目儲存在員工記錄中

### 關鍵發現 / Key Findings

**薪資項目並未被實際使用** / **Salary Items Are Not Actually Used**

經過仔細檢查程式碼，發現薪資項目：

1. ❌ **不在薪資計算中使用**
   - 檢查了 `payrollService.js`
   - 檢查了 `payrollController.js`
   - 檢查了所有薪資相關的計算邏輯
   - 薪資計算完全不參考員工的 `salaryItems` 欄位

2. ❌ **不在簽核流程中使用**
   - 檢查了 `approvalController.js`
   - 檢查了 `approvalWorkflow.js`
   - 簽核系統沒有使用薪資項目

3. ✅ **僅作為標籤/元數據存在**
   - 只是儲存在員工記錄中
   - 沒有任何功能性用途
   - 前端有硬編碼的備用選項

## 實施的變更 / Changes Implemented

### 1. 移除薪資項目設定標籤 / Removed Salary Item Settings Tab

**檔案**: `client/src/components/backComponents/SalaryManagementSetting.vue`

**變更內容**:
- 移除「薪資項目設定」標籤頁（約60行程式碼）
- 移除相關的變數和函數：
  - `salaryItems`
  - `itemDialogVisible`
  - `itemForm`
  - `openItemDialog()`
  - `saveItem()`
  - `deleteItem()`

- 更新其他標籤的編號（2→1, 3→2, 4→3, 5→4, 6→5）
- 更新預設標籤從 `'salaryItem'` 改為 `'grade'`

### 2. 更新資料持久化函數 / Updated Data Persistence Functions

**`persistSetting()` 函數**:
```javascript
// 移除前 / Before
const payload = {
  salaryItems: salaryItems.value,
  grades: gradeList.value,
  // ...
}

// 移除後 / After
const payload = {
  // Note: salaryItems removed - no longer used
  grades: gradeList.value,
  // ...
}
```

**`fetchSetting()` 函數**:
```javascript
// 移除前 / Before
salaryItems.value = s.salaryItems || []

// 移除後 / After
// Note: salaryItems removed - no longer used
```

### 3. 保留的項目 / What Was Kept

1. **Employee.salaryItems 欄位** - 為了向後相容性保留
2. **EmployeeManagement 組件** - 仍然使用硬編碼的備用選項
3. **API 端點** - 薪資設定 API 仍然存在（向後相容）

## 影響評估 / Impact Assessment

### ✅ 正面影響 / Positive Impact

1. **簡化使用者介面**
   - 移除了一個不起作用的功能
   - 減少使用者困惑

2. **程式碼簡化**
   - 移除了約 60+ 行無用程式碼
   - 降低維護負擔

3. **向後相容**
   - 保留了員工記錄中的 `salaryItems` 欄位
   - 現有資料不會遺失

### ⚠️ 注意事項 / Considerations

1. **資料庫中的現有設定**
   - 薪資設定文件中的 `salaryItems` 將不再更新
   - 但不會影響系統運作

2. **員工管理功能**
   - 員工管理頁面仍然可以選擇薪資項目
   - 使用硬編碼的選項列表

## 測試結果 / Test Results

### 伺服器測試 / Server Tests
```
✅ 241/249 測試通過
❌ 8 個失敗（與本次變更無關的既有問題）
```

### 前端測試 / Client Tests
```
✅ 207/215 測試通過
❌ 8 個失敗（與本次變更無關的既有問題）
```

### 建構驗證 / Build Verification
```
✅ npm run build 成功
```

## 結論與建議 / Conclusion and Recommendations

### 結論 / Conclusion

**移除薪資項目設定是正確的決定**，因為：

1. 該功能從未在實際薪資計算中使用
2. 沒有與簽核系統整合
3. 僅作為裝飾性的元數據存在
4. 移除不會影響系統功能

### 未來建議 / Future Recommendations

如果未來需要薪資項目功能，建議：

1. **整合薪資計算**
   - 在 `payrollService.js` 中實際使用薪資項目
   - 根據員工選擇的項目自動計算加項/扣項

2. **整合簽核流程**
   - 建立薪資調整簽核表單
   - 使用薪資項目作為調整類型

3. **動態計算**
   - 根據薪資項目屬性（計稅、影響投保）自動處理

4. **重新設計**
   - 設計完整的薪資結構系統
   - 包含項目定義、計算邏輯和簽核整合

## 相關文件 / Related Documentation

- [Salary Calculation Design](./salary-calculation-design.md)
- [Salary Calculation Guide](./SALARY_CALCULATION_GUIDE.md)

## 變更記錄 / Change Log

| 日期 / Date | 版本 / Version | 描述 / Description |
|------------|---------------|-------------------|
| 2025-12-14 | 1.0 | 初始版本 - 移除薪資項目設定標籤 / Initial version - Remove salary item settings tab |
