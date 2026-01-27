# 排班 PDF 匯出修復 - 前後對比
# Schedule PDF Export Fix - Before & After Comparison

## 修復前的問題 / Issues Before Fix

### 問題 1: 繁體中文亂碼 / Issue 1: Garbled Chinese Characters

**現象 / Symptoms**:
- PDF 匯出時繁體中文顯示為方框 □□□ 或亂碼
- 無法正確閱讀員工姓名和班別名稱

**原因 / Root Cause**:
```javascript
// 修復前的程式碼 / Before fix
const doc = new PDFDocument();
doc.fontSize(16).text('Schedules', { align: 'center' });
// 沒有註冊中文字型！/ No Chinese font registered!
```

### 問題 2: 班別名稱顯示為 ObjectID / Issue 2: Shift Names as ObjectID

**現象 / Symptoms**:
- 班別名稱顯示類似：`507f1f77bcf86cd799439011`
- 應該顯示：`早班`、`晚班`、`夜班` 等

**原因 / Root Cause**:
```javascript
// 修復前的程式碼 / Before fix - PDF
doc.text(`${s.employee?.name ?? ''}\t${s.date}\t${s.shiftId}\t${s.shiftName}`);
//                                                    ^^^^^^^^ 輸出 ObjectID

// 修復前的程式碼 / Before fix - Excel
ws.columns = [
  { header: 'Shift ID', key: 'shiftId' },    // ObjectID 欄位
  { header: 'Shift Name', key: 'shiftName' }
];
ws.addRow({
  shiftId: s.shiftId,  // 會顯示 ObjectID
  shiftName: s.shiftName
});
```

### 問題 3: 版面配置不佳 / Issue 3: Poor Layout

**現象 / Symptoms**:
- 使用 tab 字元對齊，在不同環境顯示不一致
- 沒有分頁支援，長資料會超出頁面
- 英文介面，不符合繁體中文使用習慣

---

## 修復後的改善 / Improvements After Fix

### 改善 1: 正確顯示繁體中文 / Fix 1: Correct Chinese Display

**實作 / Implementation**:
```javascript
// 修復後的程式碼 / After fix
import path from 'path';
import fs from 'fs';

// 字型路徑設定
const DEFAULT_FONT_PATH = path.join(__dirname, '../../fonts/NotoSansCJKtc-Regular.otf');
const CHINESE_FONT_PATH = process.env.PDF_CHINESE_FONT_PATH || DEFAULT_FONT_PATH;

// PDF 生成時註冊字型
const doc = new PDFDocument();
try {
  if (fs.existsSync(CHINESE_FONT_PATH)) {
    doc.registerFont('NotoSansCJK', CHINESE_FONT_PATH);
    doc.font('NotoSansCJK');
  }
} catch (error) {
  // 錯誤處理
}

// 使用繁體中文標題
doc.fontSize(16).text('排班表', { align: 'center' });
```

**效果 / Result**:
- ✅ 繁體中文正確顯示，無亂碼
- ✅ 員工姓名清晰可讀
- ✅ 所有標題和欄位名稱使用繁體中文

### 改善 2: 顯示實際班別名稱 / Fix 2: Display Actual Shift Names

**實作 / Implementation**:
```javascript
// 修復後的程式碼 / After fix - PDF
schedules.forEach((s) => {
  doc.text(s.employee?.name ?? '', tableLeft, y, { width: colWidths.name });
  doc.text(s.date, tableLeft + colWidths.name, y, { width: colWidths.date });
  doc.text(s.shiftName || '未指定', ...);  // 只使用 shiftName！
});

// 修復後的程式碼 / After fix - Excel
ws.columns = [
  { header: '員工姓名', key: 'employee', width: 20 },
  { header: '日期', key: 'date', width: 15 },
  { header: '班別名稱', key: 'shiftName', width: 15 }  // 移除 shiftId 欄位
];
ws.addRow({
  employee: s.employee?.name ?? '',
  date: s.date,
  shiftName: s.shiftName || '未指定'  // 只使用 shiftName
});
```

**效果 / Result**:
- ✅ PDF 只顯示班別名稱（如：早班、晚班）
- ✅ Excel 移除了 ObjectID 欄位
- ✅ 空值時顯示 '未指定' 而非空白

### 改善 3: 改善版面配置 / Fix 3: Improved Layout

**實作 / Implementation**:
```javascript
// 使用正確的欄位定位
const tableLeft = 50;
const colWidths = { name: 150, date: 150, shift: 150 };
let y = doc.y;

// 表頭
doc.text('員工姓名', tableLeft, y, { width: colWidths.name, underline: true });
doc.text('日期', tableLeft + colWidths.name, y, { width: colWidths.date, underline: true });
doc.text('班別名稱', tableLeft + colWidths.name + colWidths.date, y, { width: colWidths.shift, underline: true });

// 資料行 + 自動分頁
schedules.forEach((s) => {
  doc.text(s.employee?.name ?? '', tableLeft, y, { width: colWidths.name });
  doc.text(s.date, tableLeft + colWidths.name, y, { width: colWidths.date });
  doc.text(s.shiftName || '未指定', tableLeft + colWidths.name + colWidths.date, y, { width: colWidths.shift });
  y += 18;
  
  // 自動分頁
  if (y > 700) {
    doc.addPage();
    y = 50;
    // 重繪表頭...
  }
});
```

**效果 / Result**:
- ✅ 欄位對齊一致，不受環境影響
- ✅ 支援自動分頁處理長資料
- ✅ 欄位寬度適當，不會重疊或截斷

---

## 對比總結 / Comparison Summary

| 項目 / Item | 修復前 / Before | 修復後 / After |
|------------|----------------|---------------|
| 中文顯示 / Chinese Display | ❌ 亂碼方框 | ✅ 正確顯示 |
| 班別名稱 / Shift Name | ❌ ObjectID | ✅ 實際名稱 |
| PDF 標題 / PDF Title | ❌ "Schedules" | ✅ "排班表" |
| Excel 工作表 / Excel Sheet | ❌ "Schedules" | ✅ "排班表" |
| 欄位標題 / Column Headers | ❌ 英文 | ✅ 繁體中文 |
| 版面配置 / Layout | ❌ Tab 對齊 | ✅ 座標定位 |
| 分頁支援 / Pagination | ❌ 無 | ✅ 自動分頁 |
| 空值處理 / Null Handling | ❌ 空白 | ✅ "未指定" |

---

## 使用範例 / Usage Examples

### PDF 匯出 / PDF Export

**修復前輸出 / Before Fix Output**:
```
Schedules
Employee        Date        Shift ID                    Shift Name
□□          2024/01/01  507f1f77bcf86cd799439011    □□
□□          2024/01/02  507f191e810c19729de860ea    □□
```

**修復後輸出 / After Fix Output**:
```
排班表
月份：2024-01

員工姓名          日期              班別名稱
張三            2024/01/01        早班
李四            2024/01/02        晚班
王五            2024/01/03        夜班
```

### Excel 匯出 / Excel Export

**修復前欄位 / Before Fix Columns**:
```
| Employee | Date       | Shift ID                 | Shift Name |
|----------|------------|--------------------------|------------|
| □□      | 2024/01/01 | 507f1f77bcf86cd799439011 | □□        |
```

**修復後欄位 / After Fix Columns**:
```
| 員工姓名 | 日期       | 班別名稱 |
|----------|------------|----------|
| 張三     | 2024/01/01 | 早班     |
| 李四     | 2024/01/02 | 晚班     |
| 王五     | 2024/01/03 | 夜班     |
```

---

## 測試驗證 / Testing Verification

### 修復前 / Before Fix
- ❌ 中文無法正常顯示
- ❌ 只能看到 ObjectID
- ❌ 使用者體驗差

### 修復後 / After Fix
- ✅ 測試腳本通過
- ✅ 整合測試通過
- ✅ 手動測試確認中文正確顯示
- ✅ 班別名稱正確顯示
- ✅ 版面配置整齊美觀

---

## 檔案變更摘要 / File Changes Summary

### 核心修改 / Core Changes
- `server/src/controllers/scheduleController.js` (主要修復)

### 測試檔案 / Test Files
- `server/scripts/test-schedule-pdf.js`
- `server/scripts/test-schedule-export-integration.js`

### 文件 / Documentation
- `docs/SCHEDULE_PDF_EXPORT_FIX.md`
- `docs/SCHEDULE_PDF_EXPORT_COMPARISON.md` (本檔案)

### 設定檔 / Configuration
- `server/.gitignore` (排除測試 PDF)

---

## 結論 / Conclusion

這次修復成功解決了兩個主要問題：
1. **繁體中文亂碼** - 透過註冊 Noto Sans CJK TC 字型
2. **ObjectID 顯示** - 改用 shiftName 欄位

同時也改善了整體使用者體驗：
- 全繁體中文介面
- 更好的版面配置
- 支援長資料的自動分頁

This fix successfully resolved two main issues:
1. **Garbled Chinese characters** - By registering Noto Sans CJK TC font
2. **ObjectID display** - By using shiftName field

Also improved overall user experience:
- Full Traditional Chinese interface
- Better layout alignment
- Automatic pagination for long data
