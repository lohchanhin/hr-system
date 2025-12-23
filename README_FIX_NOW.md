# 修復夜班津貼顯示為 0 的問題

## 問題
您的員工上了 14 天夜班，夜班固定津貼為 500 元，但系統顯示夜班津貼為 NT$ 0，應該顯示 NT$ 7,000。

## 解決方法

### 立即執行修復腳本

請在終端機執行以下命令：

```bash
cd server
node scripts/fix-night-shift-allowance.js
```

### 執行結果

腳本會自動檢查並修復所有夜班設定，您會看到類似以下的輸出：

```
✅ Connected to MongoDB
🔍 Checking night shift allowance configurations...

📝 Shift "夜班" (NIGHT): isNightShift=true but hasAllowance=false
⚠️  Shift "夜班" (NIGHT): hasAllowance=true but fixedAllowanceAmount=0
   Fixing: Set fixedAllowanceAmount to 500 (default NT$500 per night shift)

📊 Summary:
   Settings checked: 1
   Shifts fixed: 1
   Settings saved: 1

✅ Fixed night shift allowance configurations!
   Default values set:
   - Fixed allowance: NT$500 per night shift

✅ Disconnected from MongoDB
```

### 驗證修復

執行完腳本後：

1. 重新整理薪資管理頁面
2. 查看員工的詳細資料
3. 確認夜班津貼顯示為 **NT$ 7,000** (14 天 × 500 元)

## 為什麼會發生這個問題？

班別資料庫中的設定不完整：
- 班別已標記為夜班 (`isNightShift: true`)
- 但未啟用津貼 (`hasAllowance: false`) 或津貼金額為 0 (`fixedAllowanceAmount: 0`)

## 詳細說明

更詳細的說明和疑難排解，請參考：
- 中文完整指南：`docs/FIX_NIGHT_SHIFT_ALLOWANCE_ZERO.md`
- English README: `server/scripts/NIGHT_SHIFT_FIX_README.md`
- 完整摘要：`NIGHT_SHIFT_ALLOWANCE_FIX_SUMMARY.md`

## 需要協助？

如果執行腳本後仍有問題：
1. 檢查 MongoDB 連線是否正常
2. 確認 `.env` 檔案中的 `MONGODB_URI` 設定正確
3. 查看詳細疑難排解指南：`docs/FIX_NIGHT_SHIFT_ALLOWANCE_ZERO.md`
