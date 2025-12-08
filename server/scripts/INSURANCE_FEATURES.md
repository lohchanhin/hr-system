# 勞保與薪資扣款功能說明

## 功能概述

本系統支援完整的勞保設定與薪資扣款管理，包括：

- **勞保等級設定**：支援 1-28 級勞保投保級距
- **自動/手動扣費**：彈性選擇自動或手動處理勞健保費扣除
- **自動加班計算**：根據打卡記錄自動計算加班費
- **遲到扣款管理**：設定遲到扣款規則和金額

## 欄位說明

### 員工個人資料 - 勞保設定

在員工資料中新增了以下勞保相關欄位：

| 欄位名稱 | 類型 | 預設值 | 說明 |
|---------|------|-------|------|
| `laborInsuranceLevel` | Number | 0 | 勞保等級（1-28）<br>根據薪資金額自動對應投保級距 |
| `autoDeduction` | Boolean | true | 自動扣費開關<br>- `true`: 系統自動扣除勞健保費<br>- `false`: 需手動處理扣費 |
| `autoOvertimeCalc` | Boolean | false | 自動加班計算<br>- `true`: 根據打卡記錄自動計算加班費<br>- `false`: 需手動登記加班 |
| `lateDeductionEnabled` | Boolean | false | 遲到扣款啟用<br>- `true`: 啟用遲到扣款<br>- `false`: 不扣款 |
| `lateDeductionAmount` | Number | 0 | 遲到扣款金額（元）<br>每次遲到扣除的金額 |

## 勞保等級對照

系統會根據員工薪資類型和金額自動分配適當的勞保等級：

### 月薪員工等級分配

| 月薪範圍 | 勞保等級 | 投保薪資 |
|---------|---------|---------|
| ≥ 80,000 元 | 28 | 最高級距 |
| ≥ 70,000 元 | 26 | 高級距 |
| ≥ 60,000 元 | 24 | 中高級距 |
| ≥ 50,000 元 | 22 | 中級距 |
| ≥ 40,000 元 | 18 | 中低級距 |
| ≥ 30,000 元 | 14 | 低級距 |
| < 30,000 元 | 10 | 基本級距 |

### 日薪/時薪員工

- **日薪員工**：等級 8-12
- **時薪員工**：等級 5-10

## 使用範例

### 1. 新增員工時設定勞保資訊

```bash
curl -X POST http://localhost:3000/api/employees \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "王小明",
    "email": "wang@example.com",
    "salaryType": "月薪",
    "salaryAmount": 45000,
    "laborInsuranceLevel": 18,
    "autoDeduction": true,
    "autoOvertimeCalc": true,
    "lateDeductionEnabled": true,
    "lateDeductionAmount": 100
  }'
```

### 2. 更新員工勞保設定

```bash
curl -X PUT http://localhost:3000/api/employees/<id> \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <token>" \
  -d '{
    "laborInsuranceLevel": 22,
    "autoDeduction": true,
    "autoOvertimeCalc": false,
    "lateDeductionEnabled": true,
    "lateDeductionAmount": 150
  }'
```

### 3. 查詢員工完整薪資設定

```bash
curl -X GET http://localhost:3000/api/employees/<id> \
  -H "Authorization: Bearer <token>"
```

回應範例：
```json
{
  "_id": "emp123",
  "name": "王小明",
  "salaryType": "月薪",
  "salaryAmount": 45000,
  "laborPensionSelf": 1800,
  "employeeAdvance": 0,
  "laborInsuranceLevel": 18,
  "autoDeduction": true,
  "autoOvertimeCalc": true,
  "lateDeductionEnabled": true,
  "lateDeductionAmount": 100
}
```

## 薪資計算流程

系統會依照以下順序計算員工實領薪資：

```
1. 基本薪資（salaryAmount）
   ↓
2. 勞保費扣除（autoDeduction = true）
   - 根據 laborInsuranceLevel 查詢費率
   - 扣除勞保費自付額（workerFee）
   ↓
3. 健保費扣除（autoDeduction = true）
   - 扣除健保費自付額
   ↓
4. 勞退自提扣除
   - 扣除 laborPensionSelf 金額
   ↓
5. 加班費加算（autoOvertimeCalc = true）
   - 根據打卡記錄計算加班時數
   - 加算加班費
   ↓
6. 遲到扣款（lateDeductionEnabled = true）
   - 遲到次數 × lateDeductionAmount
   ↓
7. 預支薪資扣除
   - 扣除 employeeAdvance 金額
   ↓
8. 實領薪資
```

## 測試資料

執行種子腳本會自動生成包含勞保設定的測試資料：

```bash
cd server
node scripts/seed.js
```

生成的測試資料包括：

- **主管（3人）**：月薪 65K-100K，勞保等級 24-28
  - 90% 啟用自動扣費
  - 40% 啟用加班計算
  - 30% 設定遲到扣款

- **員工（6人）**：涵蓋月薪、日薪、時薪
  - 月薪：32K-50K，勞保等級 14-22
  - 日薪：1.3K-2.2K，勞保等級 8-12
  - 時薪：200-350元，勞保等級 5-10

## 前端整合

### 員工個人資料表單

在前端員工編輯表單中，應加入以下欄位：

```vue
<template>
  <el-form-item label="勞保等級">
    <el-select v-model="form.laborInsuranceLevel">
      <el-option 
        v-for="level in 28" 
        :key="level" 
        :label="`等級 ${level}`" 
        :value="level"
      />
    </el-select>
  </el-form-item>

  <el-form-item label="自動扣費">
    <el-switch v-model="form.autoDeduction" />
    <span class="tip">系統自動扣除勞健保費</span>
  </el-form-item>

  <el-form-item label="自動加班計算">
    <el-switch v-model="form.autoOvertimeCalc" />
    <span class="tip">根據打卡記錄自動計算加班費</span>
  </el-form-item>

  <el-form-item label="遲到扣款">
    <el-switch v-model="form.lateDeductionEnabled" />
  </el-form-item>

  <el-form-item 
    v-if="form.lateDeductionEnabled" 
    label="扣款金額"
  >
    <el-input-number 
      v-model="form.lateDeductionAmount" 
      :min="0" 
      :max="1000"
    />
    <span class="tip">元/次</span>
  </el-form-item>
</template>
```

## 業務規則

### 自動扣費規則

當 `autoDeduction = true` 時：
1. 每月薪資結算時自動扣除勞保費
2. 自動扣除健保費
3. 自動扣除勞退個人提繳（如有設定）
4. 扣款記錄自動產生並存入 PayrollRecord

當 `autoDeduction = false` 時：
1. 需要人資手動登記扣款金額
2. 適用於特殊員工（如兼職、試用期、留職停薪）

### 加班計算規則

當 `autoOvertimeCalc = true` 時：
1. 系統比對排班時間與實際打卡時間
2. 超出排班時間的部分計為加班
3. 依法定費率計算加班費：
   - 平日延長工時：1.33 倍
   - 平日第 9-10 小時：1.66 倍
   - 假日加班：2 倍

當 `autoOvertimeCalc = false` 時：
1. 需要手動登記加班時數
2. 需主管核准後才計算加班費

### 遲到扣款規則

當 `lateDeductionEnabled = true` 時：
1. 打卡時間晚於排班時間視為遲到
2. 每次遲到扣除 `lateDeductionAmount` 元
3. 遲到記錄保存於考勤系統
4. 月底結算時自動扣款

建議設定：
- 一般職員：50-100 元/次
- 管理職：100-150 元/次
- 關鍵職位：150-200 元/次

## 報表與查詢

### 勞保費用統計報表

查詢某月份的勞保費用統計：

```bash
curl -X GET "http://localhost:3000/api/reports/insurance?month=2024-01" \
  -H "Authorization: Bearer <token>"
```

### 加班費統計

查詢某月份的加班費統計：

```bash
curl -X GET "http://localhost:3000/api/reports/overtime?month=2024-01" \
  -H "Authorization: Bearer <token>"
```

### 遲到扣款明細

查詢某月份的遲到扣款明細：

```bash
curl -X GET "http://localhost:3000/api/reports/late-deduction?month=2024-01" \
  -H "Authorization: Bearer <token>"
```

## 常見問題 (FAQ)

### Q1: 如何調整員工的勞保等級？

A: 透過更新員工資料 API，修改 `laborInsuranceLevel` 欄位。建議根據員工薪資調整時同步更新。

### Q2: 自動扣費失敗怎麼辦？

A: 可暫時將 `autoDeduction` 設為 `false`，改為手動處理。待問題解決後再恢復自動扣費。

### Q3: 如何處理試用期員工的勞保？

A: 試用期員工建議設定較低的勞保等級，或將 `autoDeduction` 設為 `false`，待轉正後再調整。

### Q4: 加班計算不準確怎麼辦？

A: 請檢查：
1. 排班設定是否正確
2. 打卡記錄是否完整
3. 如仍有問題，可暫時關閉 `autoOvertimeCalc`，改為手動登記

### Q5: 遲到寬限時間如何設定？

A: 目前系統以排班時間為準，建議在排班時間上加入 5-10 分鐘緩衝。未來版本將加入寬限時間設定。

## 相關文件

- [薪資測試資料使用說明](./SALARY_TEST_DATA_GUIDE.md)
- [測試資料評估報告](./SEED_DATA_EVALUATION.md)
- [勞保功能實作總覽](./INSURANCE_IMPLEMENTATION_OVERVIEW.md)
- [員工模型欄位說明](../../docs/employee.md)

## 技術支援

如有問題，請聯絡：
- 系統管理員
- 人資部門
- IT 部門
