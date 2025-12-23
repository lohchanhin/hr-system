# 夜班津貼顯示為 0 的修復指南

## 問題描述
員工上了 14 天夜班，夜班固定津貼為 500 元，但系統顯示夜班津貼為 NT$ 0。

## 根本原因
班別資料庫中的夜班設定不完整：
- 班別已標記為 `isNightShift: true`（是夜班）
- 但是 `hasAllowance` 為 `false`（未啟用津貼）或 `fixedAllowanceAmount` 為 0（津貼金額未設定）

## 解決方案

### 方法一：執行自動修復腳本（推薦）

這個腳本會自動檢查並修復所有夜班的津貼設定。

#### 步驟：

1. 確保已安裝依賴套件：
```bash
cd server
npm install
```

2. 確保 `.env` 檔案中有正確的 MongoDB 連線設定：
```bash
# server/.env
MONGODB_URI=mongodb://localhost:27017/your-database-name
# 或者使用 MongoDB Atlas
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database-name
```

3. 執行修復腳本：
```bash
cd server
node scripts/fix-night-shift-allowance.js
```

4. 腳本會顯示執行結果：
```
✅ Connected to MongoDB
🔍 Checking night shift allowance configurations...

📝 Shift "夜班" (NIGHT): isNightShift=true but hasAllowance=false
⚠️  Shift "夜班" (NIGHT): hasAllowance=true but fixedAllowanceAmount=0
   Fixing: Set fixedAllowanceAmount to 500 (default NT$500 per night shift)

📊 Summary:
   Settings checked: 1
   Shifts fixed: 1

✅ Fixed night shift allowance configurations!
   Default values set:
   - Fixed allowance: NT$500 per night shift

   You can adjust this value through the UI if needed.

✅ Disconnected from MongoDB
```

5. 重新整理薪資管理頁面，夜班津貼應該會正確顯示

### 方法二：手動透過 UI 修復

如果您希望手動設定津貼金額：

1. 登入系統後台
2. 前往 **排班與班別管理設定**
3. 切換到 **班別** 分頁
4. 找到夜班班別，點擊 **編輯**
5. 確認以下設定：
   - ☑️ **是否為夜班** = 是
   - ☑️ **是否有夜班津貼** = 是
   - **固定津貼金額** = 500（或您希望的金額）
6. 點擊 **儲存**
7. 重新計算該月份的薪資

## 驗證修復

修復後，在薪資管理頁面查看員工詳細資料：

### 修復前：
```
夜班統計
├─ 夜班天數: 14 天
├─ 夜班時數: 98.00 小時
└─ 夜班津貼: NT$ 0 ⚠️
   └─ 根據排班計算
```

### 修復後：
```
夜班統計
├─ 夜班天數: 14 天
├─ 夜班時數: 98.00 小時
└─ 夜班津貼: NT$ 7,000 ✅
   └─ 根據排班計算
```

計算方式：14 天 × NT$ 500/天 = NT$ 7,000

## 調整津貼金額

如果您希望調整預設的津貼金額（例如改為 400 元或 600 元）：

1. 開啟 `server/scripts/fix-night-shift-allowance.js`
2. 找到第 68 行：
```javascript
shift.fixedAllowanceAmount = 500; // Default NT$500 per night shift
```
3. 將 500 改為您希望的金額
4. 重新執行腳本

## 未來預防

系統已經加入驗證機制，當您新增或編輯班別時：
- 如果啟用「是否為夜班」，系統會自動啟用「是否有夜班津貼」
- 如果啟用「是否有夜班津貼」但未設定「固定津貼金額」，系統會顯示錯誤：
  **"啟用夜班津貼時，固定津貼金額必須大於 0"**

這可以防止未來再次發生相同的問題。

## 疑難排解

### 問題 1：執行腳本時出現 "MONGODB_URI is not defined"
**解決方法**：確保 `server/.env` 檔案存在且包含正確的 MongoDB 連線字串

### 問題 2：執行腳本後津貼仍然是 0
**可能原因**：
1. 薪資資料已經被計算並儲存，需要重新計算
2. 班別設定沒有正確儲存

**解決方法**：
1. 檢查資料庫中的 AttendanceSetting 集合，確認班別設定已更新
2. 在薪資管理頁面，重新計算該月份的薪資

### 問題 3：某些員工的津貼正確，某些不正確
**可能原因**：不同員工被分配到不同的班別，某些班別的津貼設定正確，某些不正確

**解決方法**：
1. 執行腳本會修復所有標記為夜班的班別
2. 檢查員工的排班記錄，確認他們被分配到正確的夜班班別

## 技術細節

### 資料模型
```javascript
// AttendanceSetting.shifts[]
{
  name: "夜班",
  code: "NIGHT",
  startTime: "22:00",
  endTime: "06:00",
  isNightShift: true,      // 標記為夜班
  hasAllowance: true,       // 啟用津貼
  fixedAllowanceAmount: 500 // 每班固定津貼金額
}
```

### 計算邏輯
```javascript
// nightShiftAllowanceService.js
for (const schedule of schedules) {
  const shift = shiftMap.get(schedule.shiftId);
  
  // 只計算標記為夜班且啟用津貼的班別
  if (shift.isNightShift && shift.hasAllowance) {
    const allowanceAmount = shift.fixedAllowanceAmount; // 例如 500
    totalAllowance += allowanceAmount; // 累加
  }
}

// 14 天夜班 × 500 元/天 = 7,000 元
```

## 相關檔案
- 修復腳本：`server/scripts/fix-night-shift-allowance.js`
- 津貼計算服務：`server/src/services/nightShiftAllowanceService.js`
- 班別控制器：`server/src/controllers/shiftController.js`
- 資料模型：`server/src/models/AttendanceSetting.js`
- 前端界面：`client/src/components/backComponents/ShiftScheduleSetting.vue`
