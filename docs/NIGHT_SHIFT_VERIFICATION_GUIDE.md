# 夜班津貼功能驗證指南

本文件說明如何驗證系統中的夜班員工測試資料和夜班津貼顯示功能。

## 需求確認

根據問題描述：
- ✅ **測試資料要包含有員工是夜班**
- ✅ **月薪資總覽能看到夜班津貼的輔助金額**

## 功能實現狀態

系統已完整實現夜班津貼功能，包括：

### 1. 後端實現

#### 資料模型
- **AttendanceSetting.shifts** 包含夜班欄位：
  - `isNightShift`: 標記是否為夜班
  - `hasAllowance`: 是否有津貼
  - `allowanceMultiplier`: 津貼倍數（例如：0.34 = 34%）

#### 服務層
- **nightShiftAllowanceService.js**: 計算夜班津貼
  - 查詢員工當月夜班排班記錄
  - 計算實際夜班工作時數
  - 套用津貼倍數計算金額
  - 錯誤處理和降級機制

- **payrollService.js**: 整合夜班津貼到薪資計算
  - 自動呼叫夜班津貼計算
  - 支援三層優先級：自訂參數 > 動態計算 > 固定設定
  - 返回詳細的夜班統計資料

#### API 端點
- **GET /api/payroll/monthly-overview**: 月薪資總覽
  - 返回每位員工的 `nightShiftAllowance` 欄位
  - 支援按機構、部門、單位篩選
  - 自動計算沒有薪資記錄的員工

### 2. 前端實現

#### 月薪資總覽頁面
**位置**: `client/src/components/backComponents/SalaryManagementSetting.vue`

**夜班津貼顯示** (第 401-405 行):
```vue
<el-table-column prop="nightShiftAllowance" label="夜班津貼" width="100" align="right">
  <template #default="{ row }">
    {{ formatCurrency(row.nightShiftAllowance) }}
  </template>
</el-table-column>
```

該欄位位於「加項」分組中，與績效獎金、其他獎金並列顯示。

### 3. 測試資料

#### 夜班班別設定
**位置**: `server/src/seedUtils.js` (第 316-332 行)

```javascript
{
  name: '夜班',
  code: 'SHIFT-D',
  startTime: '22:00',
  endTime: '06:00',
  breakTime: '01:00',
  breakDuration: 60,
  breakWindows: [
    { start: '02:00', end: '03:00', label: '休息' },
  ],
  crossDay: true,
  remark: '夜間值班，含夜班津貼',
  color: '#ffffff',
  bgColor: '#1e293b',
  isNightShift: true,        // 標記為夜班
  hasAllowance: true,        // 啟用津貼
  allowanceMultiplier: 0.34, // 津貼倍數 34%
}
```

#### 夜班員工設定
**位置**: `server/src/seedUtils.js` (第 1096-1114 行)

測試資料中偶數索引的員工（員工 0, 2, 4）被設定為夜班員工：
- **王小明** (員工 0)
- **陳俊宏** (員工 2)
- **吳建國** (員工 4)

每位夜班員工都有：
- 固定夜班津貼：2,000 - 4,000 元
- 約 80% 的排班會被分配到夜班
- 備註：「夜班員工，含固定夜班津貼」

```javascript
const isNightShiftEmployee = i % 2 === 0;
const monthlySalaryAdjustments = isNightShiftEmployee ? {
  nightShiftAllowance: randomInRange(2000, 4000),
  performanceBonus: 0,
  otherBonuses: 0,
  healthInsuranceFee: 0,
  debtGarnishment: 0,
  otherDeductions: 0,
  notes: '夜班員工，含固定夜班津貼',
} : { ... };
```

#### 夜班排班分配
**位置**: `server/src/seedUtils.js` (第 644-656 行)

```javascript
// 判斷是否為夜班員工（偶數索引的員工）
const isNightShiftEmployee = employeeIndex % 2 === 0;

// 夜班員工主要分配夜班（80%），其他員工不分配夜班
let shiftOption;
if (isNightShiftEmployee && nightShiftOption && Math.random() < 0.8) {
  shiftOption = nightShiftOption;
} else {
  shiftOption = regularShiftOptions.length > 0 
    ? randomElement(regularShiftOptions)
    : randomElement(shiftOptions);
}
```

## 驗證步驟

### 步驟 1: 生成測試資料

```bash
cd server
node scripts/seed.js
```

執行後會建立：
- 9 位人員（3 位主管 + 6 位員工）
- 4 個班別（包含夜班）
- 3 位夜班員工（王小明、陳俊宏、吳建國）
- 最近 60 天的考勤和排班記錄

### 步驟 2: 驗證班別設定

查詢資料庫確認夜班設定：

```javascript
// MongoDB Shell
db.attendancesettings.findOne({}, { shifts: 1 })

// 應該找到夜班設定：
{
  name: '夜班',
  isNightShift: true,
  hasAllowance: true,
  allowanceMultiplier: 0.34
}
```

### 步驟 3: 驗證員工設定

查詢夜班員工：

```javascript
// MongoDB Shell
db.employees.find(
  { 'monthlySalaryAdjustments.nightShiftAllowance': { $gt: 0 } },
  { name: 1, employeeId: 1, 'monthlySalaryAdjustments.nightShiftAllowance': 1 }
)

// 應該找到 3 位員工
// 每位都有 nightShiftAllowance: 2000-4000
```

### 步驟 4: 驗證排班記錄

查詢夜班排班：

```javascript
// MongoDB Shell
// 先找到夜班的 _id
const nightShift = db.attendancesettings.findOne().shifts.find(s => s.isNightShift)

// 查詢夜班排班記錄
db.shiftschedules.find({ shiftId: nightShift._id.toString() }).count()

// 應該有多筆夜班排班記錄
```

### 步驟 5: 測試薪資計算 API

啟動伺服器：

```bash
cd server
npm run dev
```

測試薪資計算：

```bash
# 登入取得 token
curl -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"password"}'

# 計算薪資（替換 <employeeId> 為實際員工 ID）
curl -X POST http://localhost:3000/api/payroll/calculate \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <token>" \
  -d '{
    "employeeId": "<employeeId>",
    "month": "2024-12-01"
  }'
```

**預期回應應包含**：
```json
{
  "nightShiftDays": 16,           // 夜班天數
  "nightShiftHours": 112.0,       // 夜班時數
  "nightShiftAllowance": 7933,    // 夜班津貼
  "nightShiftCalculationMethod": "calculated",  // 計算方式
  ...
}
```

### 步驟 6: 驗證月薪資總覽

測試月薪資總覽 API：

```bash
# 取得月薪資總覽
curl "http://localhost:3000/api/payroll/monthly-overview?month=2024-12-01" \
  -H "Authorization: Bearer <token>"
```

**預期回應**：
- 返回陣列，每個元素代表一位員工
- 每個元素都應包含 `nightShiftAllowance` 欄位
- 夜班員工的 `nightShiftAllowance` 應大於 0

```json
[
  {
    "employeeId": "EMP001",
    "name": "王小明",
    "nightShiftAllowance": 7933,    // 夜班津貼
    "performanceBonus": 5000,
    "otherBonuses": 2000,
    "totalPayment": 45933,
    ...
  }
]
```

### 步驟 7: 驗證前端顯示

1. 啟動前端開發伺服器：
   ```bash
   cd client
   npm run dev
   ```

2. 在瀏覽器中開啟 http://localhost:5173

3. 登入系統（帳號: admin, 密碼: password）

4. 進入「薪資管理設定」→「月薪資總覽」頁籤

5. 選擇月份（例如：2024-12）

6. 查看表格中的「加項」分組

7. 驗證「夜班津貼」欄位：
   - ✅ 欄位存在且有正確的標籤
   - ✅ 夜班員工的津貼金額大於 0
   - ✅ 非夜班員工的津貼為 0
   - ✅ 金額格式正確顯示（貨幣格式）

### 步驟 8: 執行自動化測試

執行夜班津貼驗證測試：

```bash
cd server
npm test -- nightShiftTestDataVerification.test.js
```

該測試會驗證：
1. ✅ 夜班班別設定是否存在
2. ✅ 夜班員工設定是否正確
3. ✅ 夜班排班記錄是否存在
4. ✅ 薪資計算是否包含夜班津貼
5. ✅ 月薪資總覽資料結構是否正確

## 計算邏輯說明

### 夜班津貼計算公式

```
夜班津貼 = 時薪 × 夜班工作時數 × 津貼倍數
```

### 計算範例

**員工條件**：
- 月薪：40,000 元
- 每日工作時數：8 小時
- 每月工作天數：30 天

**時薪計算**：
```
時薪 = 40,000 ÷ 30 ÷ 8 = 166.67 元
```

**夜班條件**：
- 班別時間：22:00 - 06:00（跨日）
- 休息時間：1 小時
- 實際工作時數：7 小時
- 津貼倍數：0.34

**單班津貼**：
```
單班津貼 = 166.67 × 7 × 0.34 = 396.67 元
```

**月津貼（20 天夜班）**：
```
月津貼 = 396.67 × 20 = 7,933 元
```

### 優先級順序

系統支援三種夜班津貼來源，優先級如下：

1. **自訂參數** (最高優先級)
   - 從 API 請求的 `customData.nightShiftAllowance`
   - 用於手動調整或特殊情況

2. **動態計算** (中等優先級)
   - 根據實際排班記錄計算
   - 使用上述計算公式
   - 標記為 `calculationMethod: 'calculated'`

3. **固定設定** (最低優先級)
   - 從 `employee.monthlySalaryAdjustments.nightShiftAllowance`
   - 用於沒有排班記錄或計算失敗時
   - 標記為 `calculationMethod: 'fixed'`

## 故障排除

### 問題 1: 沒有夜班員工

**症狀**: 查詢不到有 `nightShiftAllowance` 設定的員工

**解決方案**:
```bash
# 重新執行 seed 腳本
cd server
node scripts/seed.js
```

### 問題 2: 沒有夜班排班記錄

**症狀**: 查詢不到夜班的 `ShiftSchedule` 記錄

**可能原因**:
- 種子資料生成時發生錯誤
- 排班邏輯有問題

**解決方案**:
1. 檢查種子腳本的輸出日誌
2. 重新執行種子腳本
3. 手動檢查資料庫中的 `attendancesettings` 集合

### 問題 3: 夜班津貼為 0

**症狀**: 薪資計算返回 `nightShiftAllowance: 0`

**可能原因**:
- 該員工本月沒有夜班排班
- 員工沒有設定固定夜班津貼

**檢查步驟**:
1. 確認員工是否有夜班排班記錄
2. 確認員工的 `monthlySalaryAdjustments.nightShiftAllowance` 設定
3. 檢查夜班班別的 `hasAllowance` 和 `allowanceMultiplier` 設定

### 問題 4: 前端不顯示夜班津貼

**症狀**: 月薪資總覽沒有顯示夜班津貼欄位

**檢查步驟**:
1. 確認前端代碼包含夜班津貼欄位定義
2. 檢查 API 回應是否包含 `nightShiftAllowance` 欄位
3. 檢查瀏覽器控制台是否有錯誤訊息

## 相關文件

- [夜班津貼功能實施總結](../NIGHT_SHIFT_IMPLEMENTATION_SUMMARY.md)
- [測試資料說明文件](TEST_DATA_GUIDE.md)
- [薪資計算系統文件](PAYROLL_README.md)
- [夜班津貼實施文件](night-shift-allowance-implementation.md)

## 結論

系統已完整實現夜班津貼功能，符合以下需求：

✅ **測試資料包含夜班員工**
- 3 位夜班員工（王小明、陳俊宏、吳建國）
- 每位都有固定夜班津貼設定（2,000-4,000 元）
- 約 80% 的排班被分配到夜班

✅ **月薪資總覽顯示夜班津貼**
- 前端 UI 包含「夜班津貼」欄位
- API 返回 `nightShiftAllowance` 資料
- 支援動態計算和固定設定兩種模式
- 顯示格式化的金額

系統可正常使用，所有功能已準備就緒。
