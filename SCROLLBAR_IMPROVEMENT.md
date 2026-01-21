# 橫向拉桿改善說明 (Horizontal Scrollbar Improvement)

## 問題描述
客戶反映在主管排班頁面，表格的橫向拉桿需要滑鼠靠近才會顯示，操作困難。

## 解決方案
修改 `/client/src/views/front/Schedule.vue` 中的 CSS 樣式，實現以下改善：

### 1. 滾動條永久顯示
- 新增 `overflow-x: scroll !important` 和 `overflow-y: scroll !important`
- 強制滾動條始終顯示，不會自動隱藏

### 2. 增加滾動條尺寸
- 橫向滾動條高度從 14px 增加到 18px
- 縱向滾動條寬度從 14px 增加到 18px
- 設定最小拖拉區域為 40px x 40px，更容易抓取

### 3. 更明顯的視覺設計
- 滑塊顏色改為主題青色 (#0891b2)，更顯眼
- 軌道背景色加深 (#e2e8f0)，增加對比度
- 新增邊框提升視覺層次
- 滑鼠懸停和拖拉時提供顏色回饋

### 4. 跨瀏覽器支援
- Webkit 瀏覽器 (Chrome, Safari, Edge): 使用 `::-webkit-scrollbar` 樣式
- Firefox: 使用 `scrollbar-color` 和 `scrollbar-width` 屬性

## 技術細節

### 變更前
```css
&::-webkit-scrollbar {
  height: 14px;
  width: 14px;
}

&::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 8px;
}

&::-webkit-scrollbar-thumb {
  background: #475569;
  border-radius: 8px;
  border: 2px solid #f1f5f9;
}
```

### 變更後
```css
/* 強制滾動條始終顯示 */
overflow-x: scroll !important;
overflow-y: scroll !important;
scrollbar-color: #475569 #f1f5f9; /* Firefox */
scrollbar-width: auto; /* Firefox */

&::-webkit-scrollbar {
  height: 18px; /* 增加尺寸 */
  width: 18px;
  -webkit-appearance: none;
}

&::-webkit-scrollbar-track {
  background: #e2e8f0; /* 更明顯的軌道顏色 */
  border-radius: 10px;
  border: 1px solid #cbd5e1; /* 新增邊框 */
}

&::-webkit-scrollbar-thumb {
  background: #0891b2; /* 主題青色，更顯眼 */
  border-radius: 10px;
  border: 3px solid #e2e8f0;
  min-height: 40px; /* 確保拖拉區域夠大 */
  min-width: 40px;
  
  &:hover {
    background: #0e7490; /* 懸停回饋 */
  }
  
  &:active {
    background: #164e63; /* 拖拉回饋 */
  }
}
```

## 效果
- ✅ 滾動條永久顯示，不需要滑鼠靠近
- ✅ 拖拉區域更大，更容易操作
- ✅ 視覺上更明顯，採用主題色彩
- ✅ 提供互動回饋（懸停和拖拉時顏色變化）

## 影響範圍
僅影響 `Schedule.vue` 中的表格滾動條樣式，不影響其他頁面或功能。
