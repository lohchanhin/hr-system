# PDF 薪資匯出繁體中文支援實作總結
# PDF Payroll Export Traditional Chinese Support Implementation Summary

## 問題描述 / Problem Statement

後台薪資 PDF 匯出功能需要顯示繁體中文而且不能有亂碼，格式也要和 Excel 一樣，唯一區別是 Excel 和 PDF 罷了。

The backend salary PDF export needs to display Traditional Chinese characters without garbled text, and the format should be the same as the Excel export - the only difference should be that one is Excel and the other is PDF.

## 解決方案 / Solution

### 1. 字型支援 / Font Support

- **選擇字型 / Font Choice**: Noto Sans CJK TC (Traditional Chinese)
  - 來源：Google Noto Fonts
  - 大小：約 16MB
  - 格式：OpenType (.otf)
  
- **字型管理 / Font Management**:
  - 字型檔案存放於 `server/fonts/` 目錄
  - 使用 `.gitignore` 排除字型檔案（避免版本庫過大）
  - 提供自動化安裝腳本 `setup-fonts.sh`
  - 支援環境變數 `PDF_CHINESE_FONT_PATH` 自訂字型路徑

### 2. PDF 內容本地化 / PDF Content Localization

所有文字從英文改為繁體中文：

All text changed from English to Traditional Chinese:

- **標題 / Title**: "月薪資總覽" (Monthly Payroll Overview)
- **表格標題 / Table Headers**:
  - 員工編號 (Employee ID)
  - 姓名 (Name)
  - 部門 (Department)
  - 底薪 (Base Salary)
  - 加班費 (Overtime Pay)
  - 夜班津貼 (Night Shift Allowance)
  - 獎金 (Bonus)
  - 扣款 (Deductions)
  - 實領 (Net Pay)
  - 總計 (Total)

- **統計資訊 / Summary Statistics**:
  - 員工人數 (Number of Employees)
  - 底薪總計 (Base Salary Total)
  - 實領總計 (Net Pay Total)
  - 扣款總計 (Deductions Total)

- **頁尾 / Footer**: "產生時間" (Generated Time) 使用台灣時區

### 3. 格式對齊 / Format Alignment

與 Excel 匯出保持一致：

Consistent with Excel export:

- 相同的欄位結構和順序
- 相同的資料內容（薪資各項目）
- 相同的數字格式化（NT$ 和千位分隔符）
- 使用 `zh-TW` locale 進行數字格式化

### 4. 程式碼改進 / Code Improvements

- **錯誤處理 / Error Handling**:
  - 載入字型失敗時顯示詳細的中英雙語錯誤訊息
  - 啟動時檢查字型檔案是否存在

- **配置管理 / Configuration Management**:
  - 支援環境變數覆蓋預設字型路徑
  - 提供清楚的配置說明文件

- **安裝腳本 / Installation Script**:
  - 支援 wget 和 curl 兩種下載工具
  - 加入超時和重試機制
  - 驗證下載的檔案類型
  - 詳細的中英雙語提示訊息

## 測試驗證 / Testing & Verification

### 單元測試 / Unit Tests
- ✓ 所有現有測試通過
- ✓ PDF 基本結構生成測試
- ✓ 篩選條件測試
- ✓ 日期驗證測試

### 整合測試 / Integration Tests
- ✓ 生成測試 PDF 檔案成功
- ✓ 使用 `pdftotext` 提取文字驗證中文字元正確顯示
- ✓ 確認無亂碼或方框字元

### 手動測試腳本 / Manual Test Scripts
1. `scripts/test-pdf-generation.js` - 檢查字型檔案存在
2. `scripts/generate-test-pdf.js` - 生成包含測試資料的 PDF

## 部署說明 / Deployment Instructions

### 初次部署 / Initial Deployment

1. **安裝字型 / Install Font**:
   ```bash
   cd server
   ./setup-fonts.sh
   ```

2. **驗證安裝 / Verify Installation**:
   ```bash
   node scripts/test-pdf-generation.js
   ```

3. **測試生成 / Test Generation**:
   ```bash
   node scripts/generate-test-pdf.js
   ```

### 環境變數（可選）/ Environment Variables (Optional)

```bash
# 自訂字型路徑 / Custom font path
export PDF_CHINESE_FONT_PATH=/path/to/your/font.otf
```

### 注意事項 / Important Notes

- 字型檔案大小約 16MB，確保伺服器有足夠空間
- 部署到新環境時務必執行字型安裝腳本
- 如果字型載入失敗，檢查檔案權限和路徑

## 檔案清單 / File List

### 修改的檔案 / Modified Files
- `server/src/services/payrollPdfExportService.js` - 主要 PDF 生成服務
- `server/.gitignore` - 排除字型檔案
- `server/README.md` - 更新安裝說明

### 新增的檔案 / New Files
- `server/fonts/README.md` - 字型目錄說明文件
- `server/setup-fonts.sh` - 字型安裝腳本
- `server/scripts/test-pdf-generation.js` - 字型驗證測試
- `server/scripts/generate-test-pdf.js` - PDF 生成測試

## 安全性 / Security

- ✓ 已通過 CodeQL 安全掃描（0 個警告）
- ✓ 字型檔案從官方 GitHub 倉庫下載
- ✓ 安裝腳本包含檔案類型驗證
- ✓ 不涉及使用者輸入或外部資料處理

## 效能影響 / Performance Impact

- 字型檔案在模組載入時註冊，僅載入一次
- PDF 生成時間與英文版本相同
- 字型檔案大小對記憶體影響：約 16MB

## 未來改進建議 / Future Improvements

1. 考慮使用字型子集化（subsetting）減少檔案大小
2. 增加更多 PDF 樣式選項（例如：粗體、斜體）
3. 支援多語言切換（可選英文或中文）
4. 增加 PDF 匯出的單元測試覆蓋率

## 結論 / Conclusion

成功實作了後台薪資 PDF 匯出的繁體中文支援，完全解決了亂碼問題，並與 Excel 匯出格式保持一致。實作包含完整的錯誤處理、配置管理、測試腳本和部署文件。

Successfully implemented Traditional Chinese support for backend salary PDF export, completely solving the garbled text issue and maintaining consistency with Excel export format. The implementation includes comprehensive error handling, configuration management, test scripts, and deployment documentation.
