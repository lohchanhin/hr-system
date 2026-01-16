# 月薪資總覽 PDF 匯出功能

## 功能概述

本功能允許使用者從後台月薪資總覽頁面將薪資資料匯出為 PDF 格式，方便列印和分享。

## 使用方式

### 前端操作

1. 登入系統後，進入「薪資管理設定」頁面
2. 選擇「月薪資總覽」標籤
3. 選擇要匯出的月份
4. （可選）使用篩選條件：
   - 機構
   - 部門
   - 單位
   - 員工姓名
5. 點擊「下載 PDF」按鈕
6. 系統會自動下載 PDF 檔案

### 匯出內容

PDF 檔案包含以下資訊：

#### 標題區
- 報表名稱：Monthly Payroll Overview
- 匯出月份

#### 統計資料
- 總人數
- 薪資總額
- 實發總額
- 扣款總額

#### 明細表格
包含以下欄位：
- Employee ID（員工編號）
- Name（姓名）
- Department（部門）
- Base Salary（基本薪資）
- Overtime（加班費）
- Night Shift（夜班津貼）
- Bonus（獎金，含績效獎金、其他獎金、固定津貼）
- Deductions（扣款，含勞保、健保、勞退、請假扣款、其他扣款）
- Net Pay（實發薪資）
- Total（總計）

#### 頁腳
- 生成時間

## API 端點

### 匯出月薪資總覽 PDF

```
GET /api/payroll/export/pdf
```

#### 請求參數

| 參數名稱 | 類型 | 必填 | 說明 |
|---------|------|------|------|
| month | string | 是 | 月份，格式：YYYY-MM-DD (例如：2024-01-01) |
| organization | string | 否 | 機構 ID，用於篩選特定機構 |
| department | string | 否 | 部門 ID，用於篩選特定部門 |
| subDepartment | string | 否 | 單位 ID，用於篩選特定單位 |
| employeeId | string | 否 | 員工 ID，用於匯出特定員工 |

#### 請求範例

```bash
# 匯出所有員工的薪資
curl -X GET "http://localhost:3000/api/payroll/export/pdf?month=2024-01-01" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  --output payroll.pdf

# 匯出特定部門的薪資
curl -X GET "http://localhost:3000/api/payroll/export/pdf?month=2024-01-01&department=DEPT_ID" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  --output payroll.pdf
```

#### 回應

成功時返回 PDF 文件（application/pdf）

錯誤時返回 JSON：
```json
{
  "error": "錯誤訊息"
}
```

## 技術實作細節

### 後端實作

#### 檔案位置
- 服務：`server/src/services/payrollPdfExportService.js`
- 控制器：`server/src/controllers/payrollController.js`（`exportMonthlyPayrollOverviewPdf` 函數）
- 路由：`server/src/routes/payrollRoutes.js`

#### 主要功能

1. **資料查詢與計算**
   - 根據篩選條件查詢員工
   - 查詢已存在的薪資記錄
   - 自動計算沒有薪資記錄的員工薪資
   - 整合考勤資料、加班資料、夜班津貼等

2. **PDF 生成**
   - 使用 pdfkit 套件
   - A4 橫向格式
   - 自動分頁處理
   - 包含表格和統計資料

3. **資料來源**
   - PayrollRecord 集合（已儲存的薪資記錄）
   - 即時計算（沒有記錄時）
   - 考勤系統資料
   - 簽核系統獎金資料

### 前端實作

#### 檔案位置
- 元件：`client/src/components/backComponents/SalaryManagementSetting.vue`

#### 主要功能

1. **UI 元件**
   - PDF 匯出按鈕（藍色）
   - Excel 匯出按鈕（綠色）
   - 載入狀態指示

2. **下載流程**
   - 構建查詢參數
   - 發送 API 請求
   - 接收 Blob 資料
   - 觸發瀏覽器下載

## 注意事項

1. **字體支援**
   - 目前使用 PDFKit 預設字體
   - 標題和欄位名稱使用英文以確保相容性
   - 員工姓名和部門名稱會正常顯示中文（如果資料庫中有）

2. **資料準確性**
   - PDF 匯出使用與前端顯示相同的計算邏輯
   - 包含夜班津貼等動態計算資料
   - 沒有薪資記錄的員工會自動計算

3. **效能考量**
   - 大量員工時可能需要較長時間
   - 建議使用篩選條件縮小範圍
   - PDF 生成在伺服器端完成

4. **分頁處理**
   - 自動分頁（每頁最多約 20-25 筆）
   - 新頁面會重新顯示表頭

## 未來改進方向

1. **字體增強**
   - 加入中文字體支援
   - 標題和欄位名稱使用中文

2. **自訂格式**
   - 允許使用者選擇欄位
   - 調整表格樣式
   - 加入公司 Logo

3. **增強功能**
   - 加入圖表
   - 支援多頁摘要
   - 加入簽名欄位

4. **效能優化**
   - 快取機制
   - 背景任務處理
   - 進度提示

## 相關文件

- [薪資系統文件](PAYROLL_README.md)
- [薪資 API 文件](PAYROLL_API.md)
- [個人薪資單匯出](INDIVIDUAL_PAYROLL_EXPORT.md)
