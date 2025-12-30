# 月薪資總覽夜班津貼顯示修復 (Monthly Overview Night Shift Allowance Display Fix)

## 問題描述 (Problem Description)

在月薪資總覽頁面中，夜班津貼欄位顯示為 **NT$ 0**，但點擊「詳細」按鈕查看員工詳細資料時，夜班津貼卻能正確顯示實際金額。

**English**: In the monthly salary overview page, the night shift allowance column shows **NT$ 0**, but when clicking the "Details" button to view employee details, the night shift allowance displays the correct amount.

## 根本原因 (Root Cause)

月薪資總覽 API (`/api/payroll/overview/monthly`) 在有既存薪資記錄 (PayrollRecord) 時，會直接使用資料庫中儲存的數值。這些記錄可能是在夜班津貼計算功能修復之前建立的，因此包含過期的 `nightShiftAllowance: 0` 值。

相反地，員工詳細資料功能 (`/api/payroll/complete-data/:employeeId/:month`) 總是會動態重新計算所有數值，包括夜班津貼，因此能顯示正確的結果。

**English**: The monthly overview API uses cached values from existing PayrollRecords in the database. These records may have been created before the night shift calculation was fixed, containing outdated `nightShiftAllowance: 0` values. In contrast, the employee details view always dynamically recalculates all values including night shift allowance, showing correct results.

## 解決方案 (Solution)

修改了月薪資總覽的後端程式碼，使其：

1. **總是動態計算夜班數據** - 對所有員工呼叫 `calculateCompleteWorkData()` 函數
2. **覆寫快取的夜班數據** - 如果存在 PayrollRecord，用最新計算的夜班數據覆寫舊值
3. **保留其他欄位** - 薪資、扣款等其他欄位繼續使用快取值以維持效能
4. **重新計算總額** - 更新 `totalBonus` 和 `totalPayment` 以包含最新的夜班津貼

**English**: Modified the monthly overview backend code to:
1. Always dynamically calculate night shift data for all employees
2. Override cached night shift data with fresh calculations
3. Preserve other fields (salary, deductions) from cache for performance
4. Recalculate totals to include updated night shift allowance

## 技術細節 (Technical Details)

### 修改檔案 (Modified Files)
- `/server/src/controllers/payrollController.js` - `getMonthlyPayrollOverview()` 函數

### 程式碼變更摘要 (Code Changes Summary)

```javascript
// 新增：總是為每位員工計算工作數據
let workData = null;
try {
  workData = await calculateCompleteWorkData(employeeIdStr, month);
} catch (error) {
  console.error(`Error calculating work data for employee ${employeeIdStr}:`, error);
}

// ... 既有的薪資記錄處理邏輯 ...

// 新增：用動態計算的夜班數據覆寫既有記錄
if (payroll && workData) {
  payroll = {
    ...payroll,
    nightShiftDays: workData.nightShiftDays,
    nightShiftHours: workData.nightShiftHours,
    nightShiftAllowance: workData.nightShiftAllowance,
    nightShiftCalculationMethod: workData.nightShiftCalculationMethod,
    nightShiftBreakdown: workData.nightShiftBreakdown,
    nightShiftConfigurationIssues: workData.nightShiftConfigurationIssues,
    // 重新計算獎金總額
    totalBonus: (payroll.overtimePay || 0) + 
               (workData.nightShiftAllowance || 0) + 
               (payroll.performanceBonus || 0) + 
               (payroll.otherBonuses || 0),
  };
  payroll.totalPayment = (payroll.netPay || 0) + payroll.totalBonus;
}
```

## 測試結果 (Test Results)

✅ 所有測試通過 (All tests passed):
- 14 個薪資相關測試 (14 payroll tests)
- 5 個夜班津貼測試 (5 night shift allowance tests)

✅ 程式碼審查完成 (Code review completed):
- 2 個次要的效能優化建議（非必要）
- 沒有重大問題 (No critical issues)

✅ 安全掃描通過 (Security scan passed):
- 0 個安全漏洞 (0 vulnerabilities)

## 使用方式 (How to Use)

修復後，不需要任何手動操作：

1. 系統會自動使用最新的排班和考勤資料計算夜班津貼
2. 月薪資總覽表會顯示正確的夜班津貼金額
3. 與詳細檢視的數值保持一致

**English**: After the fix, no manual action is required:
1. The system automatically calculates night shift allowance from current schedules
2. Monthly overview displays correct night shift allowance amounts
3. Values match those shown in the detailed view

## 效能影響 (Performance Impact)

**最小化效能影響 (Minimal performance impact)**:
- 只重新計算夜班相關數據，不重算整個薪資
- 其他欄位（基本薪資、扣款等）仍使用快取值
- 計算採用平行處理 (`Promise.all`)，不影響整體回應時間

**English**: 
- Only recalculates night shift data, not entire payroll
- Other fields (base salary, deductions) still use cached values
- Calculations are parallelized, minimal impact on response time

## 向後相容性 (Backward Compatibility)

✅ 完全相容 (Fully compatible):
- 既有的 PayrollRecord 資料不會被修改
- 如果計算失敗，會優雅地回退到使用快取值
- 不需要執行資料庫遷移腳本
- 所有既有功能保持正常運作

**English**:
- Existing PayrollRecord data is not modified
- Gracefully falls back to cached values if calculation fails
- No database migration required
- All existing functionality remains intact

## 相關文件 (Related Documentation)

- [夜班津貼修復總結](./NIGHT_SHIFT_ALLOWANCE_FIX_SUMMARY.md) - 班別設定修復
- [月薪資總覽操作指南](./docs/MONTHLY_SALARY_OVERVIEW_GUIDE.md) - 完整功能說明
- [修復夜班津貼為 0](./docs/FIX_NIGHT_SHIFT_ALLOWANCE_ZERO.md) - 班別配置問題
- [夜班津貼驗證指南](./docs/NIGHT_SHIFT_VERIFICATION_GUIDE.md) - 測試驗證

## 支援 (Support)

如有任何問題，請：
1. 檢查排班系統中是否有正確的夜班排班記錄
2. 確認班別設定中夜班津貼是否已正確設定
3. 查看瀏覽器開發者工具的 Network 面板，檢查 API 回應

**English**: For issues:
1. Check if night shift schedules exist in the scheduling system
2. Verify night shift allowance is properly configured in shift settings
3. Check browser DevTools Network panel to inspect API responses
