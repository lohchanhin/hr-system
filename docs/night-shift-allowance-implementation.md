# 夜班津貼功能實施說明

## 概述

本次更新實現了完整的夜班津貼功能，包括：
1. 班別設定中可標記是否為夜班、是否有津貼及津貼倍數
2. 測試資料中包含夜班班別和夜班員工
3. 薪資計算時自動根據實際排班計算夜班津貼

## 實施細節

### 1. 資料模型更新

#### AttendanceSetting Model (server/src/models/AttendanceSetting.js)
在班別 (shifts) 中新增三個欄位：
- `isNightShift`: Boolean - 是否為夜班
- `hasAllowance`: Boolean - 是否有津貼
- `allowanceMultiplier`: Number - 津貼倍數

### 2. 後端控制器更新

#### shiftController.js (server/src/controllers/shiftController.js)
更新 `buildShiftPayload` 函數以處理新增的夜班相關欄位。

### 3. 前端介面更新

#### ShiftScheduleSetting.vue (client/src/components/backComponents/ShiftScheduleSetting.vue)

**表單新增欄位：**
- 是否為夜班 (Switch)
- 是否有夜班津貼 (Switch，只有標記為夜班時才能啟用)
- 津貼倍數 (InputNumber，範圍 0-10，精度 0.01)

**班別列表新增欄位：**
- 顯示夜班標記
- 顯示津貼倍數

### 4. 測試資料更新

#### seedUtils.js (server/src/seedUtils.js)

**新增夜班班別：**
```javascript
{
  name: '夜班',
  code: 'SHIFT-D',
  startTime: '22:00',
  endTime: '06:00',
  breakDuration: 60,
  breakWindows: [{ start: '02:00', end: '03:00', label: '休息' }],
  crossDay: true,
  remark: '夜間值班，含夜班津貼',
  color: '#ffffff',
  bgColor: '#1e293b',
  isNightShift: true,
  hasAllowance: true,
  allowanceMultiplier: 0.34, // 34% 津貼
}
```

**員工分配：**
- 偶數索引的員工 (0, 2, 4) 設定為夜班員工
- 夜班員工的 `monthlySalaryAdjustments.nightShiftAllowance` 設定為 2000-4000 元
- 夜班員工 80% 的排班會分配到夜班

### 5. 薪資計算服務

#### nightShiftAllowanceService.js (新建)
新建服務用於計算夜班津貼：

**計算邏輯：**
1. 查詢員工當月的所有排班記錄
2. 找出標記為夜班且啟用津貼的班別
3. 計算每個夜班班次的工作時數（扣除休息時間）
4. 計算津貼：`津貼 = 時薪 × 工作時數 × 津貼倍數`
5. 如果沒有夜班排班，則使用員工設定的固定津貼

**返回資料：**
- `nightShiftDays`: 夜班天數
- `nightShiftHours`: 夜班總時數
- `allowanceAmount`: 津貼金額（四捨五入到整數）
- `calculationMethod`: 計算方式 (calculated/fixed/no_shifts/error_fallback)

#### payrollService.js (更新)
整合夜班津貼計算：
1. 呼叫 `calculateNightShiftAllowance` 計算動態津貼
2. 優先順序：自訂參數 > 動態計算 > 固定設定
3. 薪資記錄中增加夜班相關資料

### 6. 計算公式

#### 時薪計算
```javascript
// 月薪
hourlyRate = 月薪 / 30 / 8

// 日薪
hourlyRate = 日薪 / 8

// 時薪
hourlyRate = 時薪
```

#### 班別工作時數
```javascript
totalMinutes = (endHour * 60 + endMin) - (startHour * 60 + startMin)

// 處理跨日班別
if (crossDay && totalMinutes < 0) {
  totalMinutes += 24 * 60
}

workMinutes = totalMinutes - breakDuration
workHours = workMinutes / 60
```

#### 夜班津貼
```javascript
shiftAllowance = hourlyRate × workHours × allowanceMultiplier
```

## 範例

### 夜班班別設定範例
```json
{
  "name": "夜班",
  "code": "SHIFT-D",
  "startTime": "22:00",
  "endTime": "06:00",
  "breakDuration": 60,
  "crossDay": true,
  "isNightShift": true,
  "hasAllowance": true,
  "allowanceMultiplier": 0.34
}
```

### 夜班員工薪資計算範例

假設員工資料：
- 薪資類型：月薪
- 月薪：40,000 元
- 時薪：40,000 / 30 / 8 = 166.67 元

當月排班：
- 夜班 (22:00-06:00，扣除 1 小時休息) × 20 天
- 工作時數：7 小時/天
- 津貼倍數：0.34

計算：
```
單班津貼 = 166.67 × 7 × 0.34 = 396.67 元
月津貼總額 = 396.67 × 20 = 7,933 元 (四捨五入)
```

## 測試建議

### 1. 班別設定測試
- 新增夜班班別，設定津貼倍數
- 編輯現有班別，修改夜班設定
- 驗證夜班標記在班別列表中正確顯示

### 2. 排班測試
- 為員工排夜班
- 驗證排班記錄正確儲存

### 3. 薪資計算測試
- 執行薪資計算
- 驗證夜班津貼正確計算
- 檢查薪資記錄中的夜班資料（天數、時數、計算方法）

### 4. 測試資料驗證
```bash
cd server
node scripts/seed.js
```
- 驗證有夜班班別（SHIFT-D）
- 驗證有夜班員工（偶數索引員工）
- 驗證夜班員工有津貼設定

## API 使用範例

### 取得班別列表
```bash
GET /api/shifts
Authorization: Bearer <token>
```

### 建立/更新夜班班別
```bash
POST /api/shifts
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "夜班",
  "code": "NIGHT",
  "startTime": "22:00",
  "endTime": "06:00",
  "breakDuration": 60,
  "crossDay": true,
  "isNightShift": true,
  "hasAllowance": true,
  "allowanceMultiplier": 0.34
}
```

### 計算薪資
```bash
POST /api/payroll/calculate/save
Authorization: Bearer <token>
Content-Type: application/json

{
  "employeeId": "employee_id",
  "month": "2024-01-01"
}
```

回應會包含：
```json
{
  "nightShiftDays": 20,
  "nightShiftHours": 140,
  "nightShiftAllowance": 7933,
  "nightShiftCalculationMethod": "calculated",
  ...
}
```

## 相容性說明

### 向下相容
- 現有班別不受影響，預設值為非夜班
- 現有薪資計算邏輯保持不變
- 如果員工有設定固定夜班津貼，在沒有夜班排班時會使用固定值

### 優先順序
薪資計算時，夜班津貼的優先順序：
1. API 自訂參數 (customData.nightShiftAllowance)
2. 動態計算值（根據實際排班）
3. 員工固定設定 (monthlySalaryAdjustments.nightShiftAllowance)

## 後續改進建議

1. **夜班定義時段**：可以增加夜班時段定義（例如：22:00-06:00 才算夜班），而不只是用標記
2. **津貼計算規則**：可以支援更複雜的津貼計算規則（例如：不同時段不同倍數）
3. **統計報表**：增加夜班統計報表，顯示各員工的夜班天數和津貼總額
4. **匯出功能**：薪資匯出時包含夜班明細
5. **前端顯示**：在薪資明細頁面顯示夜班資料

## 相關文件

- [薪資計算設計文件](./salary-calculation-design.md)
- [每月薪資調整項目設定](./monthly-salary-adjustments.md)
- [測試資料說明](./TEST_DATA_GUIDE.md)
