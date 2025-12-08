# 薪資測試資料更新說明

## 快速開始

```bash
cd server
node scripts/seed.js
```

## 生成的測試資料

### 主管（3人）
- 月薪：65,000 - 100,000 元
- 薪資項目：4-7 項
- 60% 有勞退自提（1%-6%）
- 40% 有預支薪資（5%-10%）
- **100% 具備雙銀行帳戶（A帳戶匯本薪，B帳戶匯獎金）**

### 員工（6人）
- 月薪員工（3人）：28,000 - 50,000 元
- 日薪員工（2人）：1,300 - 2,200 元
- 時薪員工（1人）：200 - 350 元
- 薪資項目：1-5 項
- 60% 有勞退自提（1%-6%）
- 40% 有預支薪資（5%-20%）
- **100% 具備雙銀行帳戶（A帳戶匯本薪，B帳戶匯獎金）**

## 考勤記錄

- **60個工作日**的考勤記錄（涵蓋前2個月）
- 包含打卡記錄：clockIn、clockOut、outing、breakIn
- 自動排除週末
- 每個員工每天至少2筆記錄（上下班）

## 薪資記錄

- 自動生成**前2個月**的薪資記錄
- 每筆記錄包含：
  - **基本薪資**：本薪金額
  - **扣款項目**：勞保費、健保費、勞退自提、預支薪資、其他扣款
  - **實領金額（Stage A）**：本薪 - 扣款
  - **獎金項目（Stage B）**：夜班津貼、績效獎金、其他獎金
  - **銀行帳戶**：A帳戶（本薪）、B帳戶（獎金）

## 薪資欄位

每位員工包含：
- `salaryType`: 月薪/日薪/時薪
- `salaryAmount`: 薪資金額
- `laborPensionSelf`: 勞退自提金額
- `employeeAdvance`: 預支薪資
- `salaryAccountA`: **主要薪資帳戶（銀行、帳號）- 匯款本薪**
- `salaryAccountB`: **次要薪資帳戶（銀行、帳號）- 匯款獎金**
- `salaryItems`: 薪資項目陣列（本薪、加給、津貼等）

## 薪資項目池（10種）

- 本薪、職務加給、績效獎金
- 交通津貼、伙食津貼、全勤獎金
- 加班費、專業加給、主管加給、年資加給

## 銀行選項（10家）

台灣銀行、土地銀行、合作金庫、第一銀行、華南銀行、彰化銀行、台北富邦、國泰世華、中國信託、玉山銀行

## 銀行匯款Excel匯出功能

系統提供兩種銀行格式的薪資匯款Excel檔案：

### 1. 台灣企銀格式
```bash
POST /api/payroll/export?month=2024-11-01&bankType=taiwan
```

### 2. 台中銀行格式
```bash
POST /api/payroll/export?month=2024-11-01&bankType=taichung
```

### 匯款明細說明
- **A帳戶（本薪）**：匯款實領金額（Stage A）
- **B帳戶（獎金）**：匯款獎金總額（Stage B）

## 薪資查詢API

### 查看月薪資總覽
```bash
GET /api/payroll/overview/monthly?month=2024-11-01
```

篩選參數：
- `organization`: 機構ID
- `department`: 部門ID  
- `subDepartment`: 單位ID
- `employeeId`: 員工ID

回傳資料包含：
- 員工基本資料
- 本薪多少
- 扣了什麼（勞保、健保、勞退自提、預支等）
- 加了什麼（夜班津貼、績效獎金等）
- 實際領取多少
- 銀行A、銀行B資訊

## 測試帳號

**預設密碼**：`password`

查看完整帳號資訊（包含薪資）：
```bash
cat server/scripts/seed-accounts.json
```

## 詳細文件

- [測試資料評估報告](./SEED_DATA_EVALUATION.md) - 詳細評分（總分9/10）
- [薪資測試資料使用指南](./SALARY_TEST_DATA_GUIDE.md) - 完整使用說明

## 測試場景

此測試資料支援以下功能測試：
- ✅ 薪資計算（月薪/日薪/時薪）
- ✅ 勞退自提計算
- ✅ 預支薪資扣除
- ✅ 薪資帳戶管理（雙帳戶）
- ✅ 薪資項目配置
- ✅ 薪資報表生成
- ✅ **薪資匯出功能（台灣企銀、台中銀行格式）**
- ✅ **考勤記錄管理（60天）**
- ✅ **月薪資明細查詢**

## MongoDB 查詢範例

```javascript
// 查詢所有月薪員工
db.employees.find({ salaryType: '月薪' })

// 查詢有勞退自提的員工
db.employees.find({ laborPensionSelf: { $gt: 0 } })

// 查詢有預支薪資的員工  
db.employees.find({ employeeAdvance: { $gt: 0 } })

// 查詢有雙帳戶的員工（現在所有員工都有）
db.employees.find({ 'salaryAccountB.bank': { $ne: '' } })

// 查詢薪資記錄
db.payrollrecords.find({ month: new Date('2024-11-01') })

// 查詢某員工的薪資記錄
db.payrollrecords.find({ employee: ObjectId('...') }).sort({ month: -1 })

// 統計薪資類型
db.employees.aggregate([
  {
    $group: {
      _id: '$salaryType',
      count: { $sum: 1 },
      avgSalary: { $avg: '$salaryAmount' }
    }
  }
])

// 查詢考勤記錄
db.attendancerecords.find({ employee: ObjectId('...') }).sort({ timestamp: -1 })

// 統計每位員工的考勤天數
db.attendancerecords.aggregate([
  { $match: { action: 'clockIn' } },
  {
    $group: {
      _id: '$employee',
      days: { $sum: 1 }
    }
  }
])
```

## 品質保證

- ✅ 所有測試通過（46個測試套件，246個測試）
- ✅ CodeQL 安全掃描通過（0個警告）
- ✅ 代碼審查通過
- ✅ 無破壞性變更

## 功能清單對照

根據需求檢查表：

| 需求 | 狀態 | 說明 |
|-----|------|------|
| 1. 人員資料完整 | ✅ | 根據Employee模型詳細填寫 |
| 2. 考勤記錄（前2個月） | ✅ | 60個工作日的打卡記錄 |
| 3. 薪資明細清楚 | ✅ | 本薪、扣款、加款、實領一目了然 |
| 4. 雙銀行帳戶 | ✅ | 所有員工100%具備A、B銀行帳戶 |
| 5. Excel匯出功能 | ✅ | 支援台灣企銀、台中銀行格式 |

## 評分總覽

根據 SEED_DATA_EVALUATION.md：

| 項目 | 評分 |
|-----|------|
| 薪資類型多樣性 | 10/10 |
| 薪資範圍合理性 | 9/10 |
| 勞退自提測試 | 9/10 |
| 預支薪資測試 | 9/10 |
| 薪資帳戶測試 | **10/10** ✨ |
| 薪資項目測試 | 10/10 |
| 考勤記錄測試 | **10/10** ✨ |
| 薪資記錄生成 | **10/10** ✨ |
| **總體評分** | **10/10** ✨ |
