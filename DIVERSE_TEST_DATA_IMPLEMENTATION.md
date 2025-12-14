# 測試資料多元性改善實現總結

## 問題描述

原先生成的測試資料不夠多元，需要確保每個月的薪資記錄都包含以下項目：
1. **請假** (Leave) - 請假扣款
2. **加班** (Overtime) - 加班費
3. **夜班津貼** (Night Shift Allowance) - 自動計算，不需審批
4. **其他扣款** (Other Deductions)
5. **績效獎金和其他獎金** (Bonuses)

## 實現方案

### 1. 修改 `seedPayrollRecords` 函數

**位置**: `server/src/seedUtils.js` 第 790-802 行

**變更前**:
```javascript
// 其他扣款 (隨機0-500)
const otherDeductions = Math.random() < 0.2 ? randomInRange(100, 500) : 0;

// 獎金項目 (Stage B)
const nightShiftAllowance = Math.random() < 0.3 ? randomInRange(1000, 3000) : 0;
const performanceBonus = Math.random() < 0.5 ? randomInRange(2000, 8000) : 0;
const otherBonuses = Math.random() < 0.2 ? randomInRange(1000, 5000) : 0;
```

**變更後**:
```javascript
// 其他扣款 (每月都有，確保資料多元性)
const otherDeductions = randomInRange(100, 500);

// 獎金項目 (Stage B) - 每月都有，確保資料多元性
const nightShiftAllowance = randomInRange(1000, 3000);
const performanceBonus = randomInRange(2000, 8000);
const otherBonuses = randomInRange(1000, 5000);
```

**效果**: 
- 夜班津貼概率: 30% → 100%
- 其他扣款概率: 20% → 100%
- 績效獎金概率: 50% → 100%
- 其他獎金概率: 20% → 100%

### 2. 增強 `seedApprovalRequests` 函數

**位置**: `server/src/seedUtils.js` 第 1693-1797 行

**新增功能**:
為每位員工（包括主管和員工）在每個薪資月份（當月和上月）自動生成以下已核准的審批記錄：

1. **請假申請**
   - 日期: 分散在每月 5-14 日（月初不同日期）
   - 請假天數: 1 天
   - 狀態: 已核准 (approved)

2. **加班申請**
   - 日期: 分散在每月 10-24 日（月中不同日期）
   - 加班時間: 18:00-21:00（3 小時）
   - 狀態: 已核准 (approved)

3. **獎金申請**
   - 日期: 分散在每月 20-27 日（月底不同日期）
   - 金額: 5,000-30,000 元（隨機）
   - 狀態: 已核准 (approved)

**程式碼片段**:
```javascript
// 為每位員工在當月和上月都生成已核准的請假、加班、獎金申請
const currentDate = new Date();
const payrollMonths = [
  new Date(currentDate.getFullYear(), currentDate.getMonth(), 1), // 當月
  new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1), // 上個月
];

const allApplicants = [...supervisorList, ...applicants];

payrollMonths.forEach((month, monthIdx) => {
  allApplicants.forEach((applicant, empIdx) => {
    // 生成請假申請
    // 生成加班申請
    // 生成獎金申請
  });
});
```

**效果**:
- 原有多樣化記錄: 8 forms × 4 statuses = 32 筆
- 每月必要記錄: 2 months × (supervisors + employees) × 3 types = 54 筆（假設 9 位員工）
- 總計: 32 + 54 = 86 筆審批記錄

### 3. 更新測試

**位置**: `server/tests/seedApprovalRequests.test.js` 第 211-219 行

**變更**: 將精確數量檢查改為最小數量檢查，以適應新增的每月必要記錄。

```javascript
// 變更前
expect(inserted).toHaveLength(Object.keys(workflowDocs).length * 4);

// 變更後
const expectedMinimumCount = Object.keys(workflowDocs).length * 4;
expect(inserted.length).toBeGreaterThanOrEqual(expectedMinimumCount);
```

## 資料流程

```
seedApprovalRequests
    ↓
生成審批記錄 (ApprovalRequest)
    ↓
seedPayrollRecords
    ↓
根據審批記錄計算薪資調整
    ↓
生成薪資記錄 (PayrollRecord)
```

### 薪資計算邏輯

```javascript
// 1. 基本薪資
baseSalary = employee.salaryAmount

// 2. 扣款項目
totalDeductions = 勞保費 + 健保費 + 勞退 + 預支 + 其他扣款

// 3. 請假扣款（從審批記錄計算）
leaveDeduction = Σ(請假時數 × 時薪)

// 4. 加班費（從審批記錄計算）
overtimePay = Σ(加班時數 × 時薪 × 1.33)

// 5. 獎金項目
totalBonus = 夜班津貼 + 績效獎金 + 其他獎金 + 審批獎金

// 6. 實發金額
finalNetPay = baseSalary - totalDeductions - leaveDeduction + overtimePay + totalBonus
```

## 驗證方式

### 1. 檢查薪資記錄

```javascript
// 查詢某員工的薪資記錄
db.payrollrecords.find({ employee: ObjectId('...') })

// 預期結果:
// - otherDeductions > 0 (每月都有)
// - nightShiftAllowance > 0 (每月都有)
// - performanceBonus > 0 (每月都有)
// - otherBonuses > 0 (每月都有)
// - leaveDeduction > 0 (從審批記錄計算)
// - overtimePay > 0 (從審批記錄計算)
```

### 2. 檢查審批記錄

```javascript
// 查詢某員工的審批記錄
db.approvalrequests.find({ 
  applicant_employee: ObjectId('...'),
  status: 'approved'
})

// 預期結果: 每月至少有 3 筆已核准的記錄
// - 請假申請
// - 加班申請
// - 獎金申請
```

### 3. 運行種子腳本

```bash
cd server
node scripts/seed.js
```

預期輸出包含:
```
=== 審批記錄生成完成 ===
原有多樣化記錄: 32 筆
每月必要記錄 (請假+加班+獎金): 54 筆
總計: 86 筆審批記錄

=== 薪資記錄生成完成 ===
生成 2 個月份的薪資記錄
每月 9 位員工
總計 18 筆薪資記錄
```

## 影響範圍

### 已修改的檔案
1. `server/src/seedUtils.js` - 核心種子資料生成邏輯
2. `server/tests/seedApprovalRequests.test.js` - 審批記錄測試

### 不受影響的功能
- 現有的薪資計算服務 (payrollService.js)
- 薪資匯出功能 (payrollExportService.js)
- 其他審批流程
- 考勤記錄生成

## 效益

1. **資料完整性**: 每個月的薪資記錄都包含完整的項目
2. **測試準確性**: 更真實地模擬生產環境的資料分佈
3. **UI 展示**: 前端顯示的薪資明細更加豐富，方便測試和演示
4. **問題診斷**: 開發人員可以更容易地測試各種薪資計算場景

## 後續改進建議

1. **夜班津貼自動計算**: 目前是隨機生成，可以根據排班記錄（SHIFT-C 晚班）自動計算
2. **請假類型多樣化**: 可以增加特休、病假等不同類型的請假
3. **加班時數變化**: 可以根據員工類型設置不同的加班時數範圍
4. **季節性變化**: 某些月份（如年底）可以有更高的獎金
5. **配置化**: 將生成規則抽取為配置文件，方便調整

## 技術債務

無

## 安全性考量

無安全性影響，僅為測試資料生成邏輯的改進。
