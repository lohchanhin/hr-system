# 每月薪資調整項目功能說明

## 功能概述

此功能允許在員工個人資料中直接設定每月固定的薪資調整項目（增加或減少），無需每次都透過簽核申請流程。

## 使用場景

當員工有固定的每月薪資調整項目時，例如：
- 固定的健保費自付額
- 固定的夜班津貼
- 固定的績效獎金
- 債權扣押等固定扣款

可以直接在員工個人資料中設定這些項目，系統會在計算薪資時自動套用這些設定值。

## 設定方式

### 後台管理介面

1. 登入系統後，進入「員工管理」頁面
2. 點擊要編輯的員工的「編輯」按鈕
3. 切換到「薪資設定」標籤
4. 在「每月薪資調整項目」區塊中，填寫以下欄位：

#### 扣款項目
- **健保費自付額**：員工每月固定的健保費扣款金額
- **債權扣押**：法院命令的債權扣押金額
- **其他扣款**：其他固定扣款項目

#### 獎金/津貼項目
- **夜班補助津貼**：固定的夜班津貼
- **人力績效獎金**：固定的績效獎金
- **其他獎金**：其他固定獎金項目

#### 說明欄位
- **調整說明**：記錄薪資調整的原因或說明

5. 點擊「儲存員工資料」按鈕保存設定

## 薪資計算邏輯

### 優先順序

系統在計算薪資時，會依照以下優先順序取得調整項目的值：

1. **API 自訂參數**（customData）- 最高優先權
2. **員工個人設定**（monthlySalaryAdjustments）- 次優先
3. **預設值**（0）- 最低優先

這表示如果透過 API 手動指定某個調整項目的值，會覆蓋員工個人設定的值。

### 計算範例

假設員工張小明的設定如下：
```javascript
{
  name: "張小明",
  salaryAmount: 45000,
  monthlySalaryAdjustments: {
    healthInsuranceFee: 750,      // 固定健保費
    nightShiftAllowance: 2500,    // 固定夜班津貼
    performanceBonus: 3000,       // 固定績效獎金
    notes: "固定夜班津貼與績效獎金"
  }
}
```

當系統計算 2024年1月的薪資時：
```
基本薪資: 45,000 元
扣款項目:
  - 勞保費: 1,145 元（自動計算）
  - 健保費: 750 元（來自個人設定）
實領金額: 43,105 元

獎金項目:
  - 夜班津貼: 2,500 元（來自個人設定）
  - 績效獎金: 3,000 元（來自個人設定）
獎金合計: 5,500 元
```

## API 使用方式

### 取得員工資料（包含調整項目）

```bash
GET /api/employees/:id
```

回應範例：
```json
{
  "_id": "emp123",
  "name": "張小明",
  "salaryAmount": 45000,
  "monthlySalaryAdjustments": {
    "healthInsuranceFee": 750,
    "debtGarnishment": 0,
    "otherDeductions": 0,
    "nightShiftAllowance": 2500,
    "performanceBonus": 3000,
    "otherBonuses": 0,
    "notes": "固定夜班津貼與績效獎金"
  }
}
```

### 更新員工調整項目

```bash
PUT /api/employees/:id
Content-Type: application/json

{
  "monthlySalaryAdjustments": {
    "healthInsuranceFee": 800,
    "nightShiftAllowance": 2700,
    "performanceBonus": 3500,
    "notes": "2024年調整"
  }
}
```

### 計算薪資（自動套用個人設定）

```bash
POST /api/payroll/calculate/save
Content-Type: application/json

{
  "employeeId": "emp123",
  "month": "2024-01-01"
}
```

系統會自動從員工的 `monthlySalaryAdjustments` 取得調整項目的預設值。

### 計算薪資（覆蓋個人設定）

如需臨時覆蓋員工的個人設定：

```bash
POST /api/payroll/calculate/save
Content-Type: application/json

{
  "employeeId": "emp123",
  "month": "2024-01-01",
  "customData": {
    "healthInsuranceFee": 850,  // 覆蓋個人設定的 750
    "nightShiftAllowance": 3000  // 覆蓋個人設定的 2500
  }
}
```

## 資料庫結構

### Employee 模型新增欄位

```javascript
{
  monthlySalaryAdjustments: {
    // 扣款項目
    healthInsuranceFee: { type: Number, default: 0 },
    debtGarnishment: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    
    // 獎金/津貼項目
    nightShiftAllowance: { type: Number, default: 0 },
    performanceBonus: { type: Number, default: 0 },
    otherBonuses: { type: Number, default: 0 },
    
    // 說明備註
    notes: String
  }
}
```

## 優點與限制

### 優點

1. **簡化工作流程**：減少每月重複的簽核申請作業
2. **提高效率**：HR人員可直接在員工資料中設定固定調整項目
3. **保持彈性**：仍可透過 API 參數臨時覆蓋設定值
4. **向下相容**：不影響現有的薪資計算邏輯

### 限制

1. 此功能適用於「固定」的每月調整項目
2. 對於「變動」的調整項目（如臨時獎金），仍建議使用簽核流程
3. 設定值為每月固定金額，不支援比例計算

## 注意事項

1. **權限控制**：建議只有 HR 管理員或主管能編輯此欄位
2. **稽核追蹤**：所有變更會記錄在員工資料的更新時間戳記中
3. **備份**：重要的薪資調整項目建議定期備份
4. **檢查**：每月發薪前應檢查員工的調整項目設定是否正確

## 相關文件

- [薪資計算系統文件](./PAYROLL_README.md)
- [員工資料欄位說明](./employee.md)
- [API 文件](./PAYROLL_API.md)
