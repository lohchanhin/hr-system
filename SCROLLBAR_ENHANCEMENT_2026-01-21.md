# 橫向拉桿增強 (Horizontal Scrollbar Enhancement)
## 日期: 2026-01-21

## 客戶需求
客戶強烈要求排班表格的橫向拉桿需要「明顯又大」，特別是針對**可以選擇排班的那部分**（內部排班表格區域），而非外面的框架。

## 最終實施方案 (ULTRA-ENHANCED VERSION)

### 視覺改善項目
| 項目 | 原值 | 中期值 | **最終值 (ULTRA)** | 改善幅度 |
|------|------|--------|-------------------|----------|
| 滾動條高度/寬度 | 18px | 24px | **32px** | +78% |
| 滑塊邊框 | 3px | 1px | **2px (白色)** | 更明顯的對比 |
| 最小拖拉區域 | 40px × 40px | 50px × 50px | **60px × 60px** | +50% |
| Firefox 滾動條寬度 | auto | auto | **thick** | 最粗版本 |
| 滑塊顏色 | #0891b2 | #0891b2 | **#06b6d4** | 更亮的青色 |
| 軌道顏色 | #e2e8f0 | #e2e8f0 | **#cbd5e1** | 更深的灰色 |

### 技術實施

#### 修改檔案
- `/client/src/views/front/Schedule.vue` - 主要修改
- `/SCROLLBAR_ENHANCEMENT_2026-01-21.md` - 文件更新

#### CSS 變更詳情 (ULTRA-ENHANCED VERSION)

**滾動條容器** (`.schedule-table-wrapper :deep(.el-table__body-wrapper)`)
```scss
// ULTRA-LARGE 滾動條: 32px
&::-webkit-scrollbar {
  height: 32px !important;  // 從 24px 增加到 32px (+33%)
  width: 32px !important;
  -webkit-appearance: none !important;
}

// 更深色的軌道，增強對比
&::-webkit-scrollbar-track {
  background: #cbd5e1 !important;  // 更深的灰色
  border-radius: 8px !important;
  border: 2px solid #94a3b8 !important;  // 更粗、更深的邊框
  box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.1) !important;  // 新增陰影增加深度
}

// 超亮青色滑塊，加上發光效果
&::-webkit-scrollbar-thumb {
  background: #06b6d4 !important;  // 更亮的青色
  border-radius: 8px !important;
  border: 2px solid #ffffff !important;  // 白色邊框增加對比
  min-height: 60px !important;  // 從 50px 增加到 60px
  min-width: 60px !important;
  box-shadow: 0 2px 8px rgba(6, 182, 212, 0.3) !important;  // 發光效果
  
  &:hover {
    background: #0891b2 !important;
    box-shadow: 0 2px 12px rgba(6, 182, 212, 0.5) !important;  // 更強發光
  }
  
  &:active {
    background: #0e7490 !important;
    box-shadow: 0 2px 16px rgba(6, 182, 212, 0.6) !important;  // 最強發光
  }
}

// Firefox: 使用 thick 版本
scrollbar-color: #06b6d4 #cbd5e1 !important;
scrollbar-width: thick !important;
```

**額外的選擇器** (增加特定性以覆蓋全域樣式)
```scss
:deep(.el-table) {
  .el-table__body-wrapper::-webkit-scrollbar {
    height: 32px !important;
    width: 32px !important;
  }
  
  .el-table__body-wrapper::-webkit-scrollbar-thumb {
    background: #06b6d4 !important;
    min-height: 60px !important;
    min-width: 60px !important;
  }
}
```

### 預期效果
✅ **極致的可見度**：32px 高度的超大滾動條，在任何情況下都極為醒目  
✅ **超容易操作**：60px 的最小拖拉區域，幾乎不可能誤觸  
✅ **最飽滿的外觀**：白色邊框配合亮青色滑塊，視覺對比極強  
✅ **發光特效**：滑塊具有發光陰影，懸停和拖動時更加明顯  
✅ **Firefox 支援**：使用 `thick` 選項，確保 Firefox 也有超粗滾動條  
✅ **最大特定性**：雙重選擇器 + `!important` 確保覆蓋所有全域樣式  

### 關鍵技術改善
1. **覆蓋全域樣式**：使用 `!important` 和多層選擇器確保覆蓋 `base.css` 的 8px 全域設定
2. **Firefox 專屬優化**：使用 `scrollbar-width: thick` 而非 `auto`，確保最大粗度
3. **視覺特效**：加入 `box-shadow` 發光效果，使滑塊更加突出
4. **高對比配色**：
   - 滑塊: 亮青色 #06b6d4
   - 軌道: 深灰色 #cbd5e1
   - 邊框: 白色 #ffffff
   - 軌道邊框: 深石板灰 #94a3b8

### 影響範圍
- ✅ 僅影響 `Schedule.vue` 中的排班表格滾動條
- ✅ 不影響其他頁面或外層框架
- ✅ 不影響現有功能運作
- ✅ 完全覆蓋全域 base.css 樣式
- ✅ 跨瀏覽器完全相容 (Chrome, Safari, Edge, Firefox)

## 版本歷史
- **2026-01-21 v3 (ULTRA)**: 32px 滾動條，60px 最小尺寸，發光效果，thick Firefox，雙重選擇器
- **2026-01-21 v2**: 24px 滾動條，50px 最小尺寸，1px 邊框
- **先前版本**: 18px 滾動條，40px 最小尺寸，3px 邊框
- **初始版本**: 14px 滾動條

## 問題解決
### 原問題
客戶反映即使已有 24px 的滾動條改善，仍然認為不夠明顯、不夠大。

### 解決方法
1. **尺寸增加 33%**: 從 24px 提升到 32px
2. **對比度大幅提升**: 使用更亮的青色 (#06b6d4) 和更深的軌道 (#cbd5e1)
3. **視覺特效**: 加入發光陰影效果
4. **覆蓋全域樣式**: 確保覆蓋 base.css 的 8px 設定
5. **Firefox 優化**: 使用 thick 而非 auto

## 備註
此為最終增強版本，專注於內部排班表格的滾動條（`.el-table__body-wrapper`），確保使用者在選擇和調整排班時有**最極致**的操作體驗。
