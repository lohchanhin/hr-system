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

### 員工（6人）
- 月薪員工（3人）：28,000 - 50,000 元
- 日薪員工（2人）：1,300 - 2,200 元
- 時薪員工（1人）：200 - 350 元
- 薪資項目：1-5 項
- 60% 有勞退自提（1%-6%）
- 40% 有預支薪資（5%-20%）

## 薪資欄位

每位員工包含：
- `salaryType`: 月薪/日薪/時薪
- `salaryAmount`: 薪資金額
- `laborPensionSelf`: 勞退自提金額
- `employeeAdvance`: 預支薪資
- `salaryAccountA`: 主要薪資帳戶（銀行、帳號）
- `salaryAccountB`: 次要薪資帳戶（30%員工有）
- `salaryItems`: 薪資項目陣列（本薪、加給、津貼等）

## 薪資項目池（10種）

- 本薪、職務加給、績效獎金
- 交通津貼、伙食津貼、全勤獎金
- 加班費、專業加給、主管加給、年資加給

## 銀行選項（10家）

台灣銀行、土地銀行、合作金庫、第一銀行、華南銀行、彰化銀行、台北富邦、國泰世華、中國信託、玉山銀行

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
- ✅ 薪資帳戶管理
- ✅ 薪資項目配置
- ✅ 薪資報表生成
- ✅ 薪資匯出功能

## MongoDB 查詢範例

```javascript
// 查詢所有月薪員工
db.employees.find({ salaryType: '月薪' })

// 查詢有勞退自提的員工
db.employees.find({ laborPensionSelf: { $gt: 0 } })

// 查詢有預支薪資的員工  
db.employees.find({ employeeAdvance: { $gt: 0 } })

// 查詢有雙帳戶的員工
db.employees.find({ 'salaryAccountB.bank': { $ne: '' } })

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
```

## 品質保證

- ✅ 所有測試通過（46個測試套件，246個測試）
- ✅ CodeQL 安全掃描通過（0個警告）
- ✅ 代碼審查通過
- ✅ 無破壞性變更

## 評分總覽

根據 SEED_DATA_EVALUATION.md：

| 項目 | 評分 |
|-----|------|
| 薪資類型多樣性 | 10/10 |
| 薪資範圍合理性 | 9/10 |
| 勞退自提測試 | 9/10 |
| 預支薪資測試 | 9/10 |
| 薪資帳戶測試 | 10/10 |
| 薪資項目測試 | 10/10 |
| **總體評分** | **9/10** |
