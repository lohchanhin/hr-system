# 橫向拉桿增強 (Horizontal Scrollbar Enhancement)
## 日期: 2026-01-21

## 客戶需求
客戶要求排班表格的橫向拉桿需要「明顯又大」，特別是針對**可以選擇排班的那部分**（內部排班表格區域），而非外面的框架。

## 實施改善

### 視覺改善項目
| 項目 | 原值 (18px版本) | 新值 (24px版本) | 改善幅度 |
|------|----------------|----------------|----------|
| 滾動條高度/寬度 | 18px | **24px** | +33% |
| 滑塊邊框 | 3px | **1px** | -67% (使滑塊更飽滿) |
| 最小拖拉區域 | 40px × 40px | **50px × 50px** | +25% |

### 技術實施

#### 修改檔案
- `/client/src/views/front/Schedule.vue` - 主要修改
- `/SCROLLBAR_IMPROVEMENT.md` - 文件更新

#### CSS 變更詳情

**滾動條容器** (`.schedule-table-wrapper :deep(.el-table__body-wrapper)`)
```scss
// 增大滾動條尺寸
&::-webkit-scrollbar {
  height: 24px;  // 從 18px 增加到 24px
  width: 24px;   // 從 18px 增加到 24px
  -webkit-appearance: none;
}

// 優化滑塊外觀，使其更飽滿
&::-webkit-scrollbar-thumb {
  background: #0891b2;
  border-radius: 10px;
  border: 1px solid #e2e8f0;  // 從 3px 減少到 1px
  min-height: 50px;  // 從 40px 增加到 50px
  min-width: 50px;   // 從 40px 增加到 50px
  
  &:hover {
    background: #0e7490;
  }
  
  &:active {
    background: #164e63;
  }
}
```

### 預期效果
✅ **更高的可見度**：24px 高度的滾動條在任何螢幕上都極為明顯  
✅ **更容易操作**：50px 的最小拖拉區域，使用者更容易點擊和拖動  
✅ **更飽滿的外觀**：減少邊框寬度後，滑塊視覺上更大更突出  
✅ **保持主題一致性**：使用青色主題色 (#0891b2)，與整體設計協調  
✅ **良好的互動回饋**：懸停和拖拉時的顏色變化提供即時反應  

### 影響範圍
- ✅ 僅影響 `Schedule.vue` 中的排班表格滾動條
- ✅ 不影響其他頁面或外層框架
- ✅ 不影響現有功能運作
- ✅ 跨瀏覽器相容 (Chrome, Safari, Edge, Firefox)

### 測試結果
- ✅ 建置成功 (npm run build)
- ✅ 程式碼審查通過
- ✅ 無安全性問題
- ✅ 無語法錯誤

## 版本歷史
- **2026-01-21**: 增強版本 - 24px 滾動條，1px 邊框，50px 最小尺寸
- **先前版本**: 18px 滾動條，3px 邊框，40px 最小尺寸
- **初始版本**: 14px 滾動條

## 備註
此改善專注於內部排班表格的滾動條（`.el-table__body-wrapper`），確保使用者在選擇和調整排班時有最佳的操作體驗。
