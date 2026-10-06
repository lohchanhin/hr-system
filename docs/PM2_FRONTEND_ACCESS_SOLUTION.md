# PM2 啟動後前端無法顯示的解決思路

## 問題描述

您遇到的情況：
1. ✅ PM2 顯示 "Server running on port 3000"
2. ❌ 訪問 `localhost:3000` 卻看不到前端頁面
3. ❓ 困惑為什麼 port 3000 是後端 port，卻要用來訪問前端
4. ❓ 不清楚前後端如何交互

## 核心概念解答

### Q1: 為什麼 port 3000 可以同時提供前端和後端？

這是 **單一伺服器模式**（生產環境的標準做法）：

```
開發模式（npm run dev）：
前端 Vite Server (port 5173) ←→ 後端 Express (port 3000)
[兩個獨立的進程]

生產模式（PM2）：
瀏覽器 → 後端 Express (port 3000) → {
    /api/* 請求 → 處理 API 邏輯
    其他請求 → 返回前端靜態檔案 (client/dist/)
}
[只有一個進程]
```

**關鍵點：**
- Port 3000 確實是後端的 port
- 但在生產模式下，後端**同時**負責提供前端靜態檔案
- 這樣的設計讓部署更簡單（只需一個 port、一個伺服器）

### Q2: 前端和後端如何交互？

#### 開發模式的交互方式：
```
瀏覽器 (http://localhost:5173)
    ↓ 訪問前端頁面
Vite 開發伺服器 (port 5173)
    ↓ 前端發起 API 請求 (/api/...)
    ↓ Vite Proxy 轉發
Express 後端 (port 3000)
    ↓ 處理並返回資料
前端接收並渲染
```

#### PM2 生產模式的交互方式：
```
瀏覽器 (http://localhost:3000)
    ↓
Express 後端 (port 3000)
    ├─ GET /login → 返回 index.html (前端頁面)
    ├─ GET /api/employees → 返回 JSON (API 資料)
    ├─ GET /static/js/app.js → 返回 JS 檔案
    └─ GET /static/css/style.css → 返回 CSS 檔案

前端 JavaScript 在瀏覽器執行後
    ↓ 發起 API 請求 (fetch /api/...)
同一個 Express 伺服器處理 API
    ↓ 返回 JSON 資料
前端接收並更新頁面
```

**重點：前後端交互通過 HTTP 請求完成，在 PM2 模式下，所有請求都發往同一個 port (3000)**

## 前端無法顯示的可能原因與診斷步驟

### 診斷步驟 1：確認前端是否已建置

PM2 只會啟動後端伺服器，**不會自動建置前端**。

```bash
# 檢查 client/dist/ 目錄是否存在
ls -la client/dist/

# 如果目錄不存在或為空，需要先建置
npm run build
```

**預期結果：**
```
client/dist/
├── index.html
├── assets/
│   ├── index-xxx.js
│   ├── index-xxx.css
│   └── ...
└── ...
```

**如果沒有建置，這就是問題所在！** 後端無法提供不存在的前端檔案。

### 診斷步驟 2：確認後端是否正確載入靜態檔案

檢查 `server/src/index.js` 的設定（約在第 58-96 行）：

```javascript
// 1. 確認 distPath 路徑正確
const distPath = path.join(__dirname, '..', '..', 'client', 'dist');

// 2. 確認有設定 static middleware
app.use(express.static(distPath));
```

**測試方法：**
```bash
# 在 server/src/ 目錄下執行，確認路徑解析正確
node -e "
const path = require('path');
const __dirname = path.resolve('./');
const distPath = path.join(__dirname, '..', '..', 'client', 'dist');
console.log('distPath:', distPath);
console.log('exists:', require('fs').existsSync(distPath));
"
```

### 診斷步驟 3：檢查 PM2 日誌

```bash
# 查看 PM2 即時日誌
npm run pm2:logs

# 或直接使用 PM2 指令
pm2 logs hr-system --lines 100
```

**需要注意的日誌訊息：**
```
✅ 正常啟動：
Server running on port 3000
Connected to MongoDB
Admin user already exists

❌ 有問題：
Error: ENOENT: no such file or directory
Cannot find module
Connection refused
```

### 診斷步驟 4：測試後端是否正常運作

```bash
# 測試健康檢查 API
curl http://localhost:3000/api/health

# 預期返回：
{"status":"OK"}

# 測試是否能取得前端 index.html
curl http://localhost:3000/

# 預期返回：
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    ...
```

### 診斷步驟 5：檢查環境變數

確認 `server/.env` 檔案存在且正確設定：

```bash
# 查看 .env 檔案
cat server/.env

# 必須包含：
PORT=3000
MONGODB_URI=mongodb://localhost:27017/hr-system
JWT_SECRET=your-super-secret-jwt-key
NODE_ENV=production
```

### 診斷步驟 6：確認 MongoDB 連線

```bash
# 檢查 MongoDB 是否運行
sudo systemctl status mongod

# 或測試連線
mongosh mongodb://localhost:27017/hr-system

# 如果無法連線，需要先啟動 MongoDB
sudo systemctl start mongod
```

## 完整的解決方案步驟

基於以上診斷，完整的啟動流程應該是：

### 步驟 1：確保環境準備就緒

```bash
# 1. 確認 MongoDB 正在運行
sudo systemctl status mongod
# 如果沒運行：sudo systemctl start mongod

# 2. 確認專案依賴已安裝
npm install

# 3. 確認環境變數設定完成
ls server/.env
# 如果不存在：cp server/.env.example server/.env
# 然後編輯 server/.env 設定必要參數
```

### 步驟 2：建置前端（重要！）

```bash
# 建置前端，產生靜態檔案到 client/dist/
npm run build

# 確認建置成功
ls -la client/dist/
```

**這一步非常關鍵！** 如果跳過這步，PM2 啟動後無法提供前端頁面。

### 步驟 3：啟動 PM2

```bash
# 啟動 PM2
npm run pm2:start

# 確認啟動成功
npm run pm2:status
```

**預期輸出：**
```
┌────┬────────────┬─────────────┬─────────┬─────────┬──────────┐
│ id │ name       │ mode        │ ↺       │ status  │ cpu      │
├────┼────────────┼─────────────┼─────────┼─────────┼──────────┤
│ 0  │ hr-system  │ fork        │ 0       │ online  │ 0%       │
└────┴────────────┴─────────────┴─────────┴─────────┴──────────┘
```

### 步驟 4：訪問應用程式

```bash
# 在瀏覽器中訪問
http://localhost:3000

# 應該會看到登入頁面
```

### 步驟 5：如果還是看不到，檢查瀏覽器

1. **打開瀏覽器開發者工具** (F12)
2. **查看 Console 標籤**：是否有 JavaScript 錯誤？
3. **查看 Network 標籤**：
   - 刷新頁面，查看是否成功載入 `index.html`
   - 是否成功載入 JS 和 CSS 檔案
   - 如果返回 404，表示前端檔案沒有正確建置

## 常見錯誤情境與解決方法

### 錯誤 1：看到「Cannot GET /」或 404 頁面

**原因：** 前端沒有建置，或 `client/dist/` 目錄為空

**解決方法：**
```bash
npm run build
npm run pm2:restart
```

### 錯誤 2：頁面空白，Console 顯示 API 錯誤

**原因：** 前端有載入，但無法連接後端 API

**解決方法：**
1. 檢查 MongoDB 是否運行
2. 檢查 `server/.env` 設定
3. 查看 PM2 日誌：`npm run pm2:logs`

### 錯誤 3：PM2 狀態顯示「errored」或「stopped」

**原因：** 後端啟動失敗

**解決方法：**
```bash
# 查看詳細錯誤訊息
pm2 logs hr-system --err --lines 50

# 常見原因：
# 1. PORT 被佔用 → 修改 server/.env 中的 PORT
# 2. MongoDB 未連接 → 確認 MONGODB_URI 正確
# 3. 環境變數缺失 → 確認 server/.env 完整
```

### 錯誤 4：修改前端程式碼後沒有生效

**原因：** PM2 不會自動重新建置前端

**解決方法：**
```bash
# 每次修改前端程式碼後，必須重新建置
npm run build
npm run pm2:restart
```

**提示：** 如果頻繁修改程式碼，建議使用開發模式：
```bash
npm run dev
# 這樣修改會立即生效，不需要手動建置
```

## 開發模式 vs PM2 模式對比

| 比較項目 | 開發模式 (`npm run dev`) | PM2 模式 (`npm run pm2:start`) |
|---------|-------------------------|-------------------------------|
| **前端 Port** | 5173 (Vite) | - (由後端提供) |
| **後端 Port** | 3000 | 3000 |
| **訪問網址** | http://localhost:5173 | http://localhost:3000 |
| **熱重載** | ✅ 自動重載 | ❌ 需手動重啟 |
| **前端建置** | 不需要 | ✅ 必須先 `npm run build` |
| **適用場景** | 本地開發、快速測試 | 生產部署、正式環境 |
| **修改程式碼後** | 自動更新 | 需重新建置 + 重啟 |

## 架構圖解

### 開發模式架構
```
┌─────────────┐         ┌──────────────┐
│  瀏覽器      │         │  Vite Dev    │
│  :5173      │◄────────│  Server      │
└─────────────┘         │  :5173       │
      │                 └──────────────┘
      │ API 請求              │
      │ (/api/...)            │ Proxy 轉發
      ▼                       ▼
┌──────────────────────────────────┐
│  Express 後端                     │
│  :3000                           │
│  - 處理 API 請求                  │
│  - 連接 MongoDB                  │
└──────────────────────────────────┘
```

### PM2 生產模式架構
```
┌─────────────┐
│  瀏覽器      │
│  :3000      │
└─────────────┘
      │
      │ 所有請求都發往 3000
      ▼
┌──────────────────────────────────┐
│  Express 後端 (PM2 管理)          │
│  :3000                           │
│  ┌────────────────────────────┐  │
│  │ 靜態檔案服務                 │  │
│  │ (client/dist/)              │  │
│  │ - index.html                │  │
│  │ - JS/CSS 檔案               │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ API 服務                    │  │
│  │ - /api/employees           │  │
│  │ - /api/attendance          │  │
│  │ - ...                      │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ MongoDB 連接                │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

## 最佳實踐建議

### 1. 建立清晰的部署檢查清單

```bash
#!/bin/bash
# deploy-checklist.sh

echo "=== HR System PM2 部署檢查清單 ==="

# 1. 檢查 MongoDB
echo "1. 檢查 MongoDB..."
systemctl is-active mongod && echo "✅ MongoDB 運行中" || echo "❌ MongoDB 未運行"

# 2. 檢查環境變數
echo "2. 檢查環境變數..."
[ -f server/.env ] && echo "✅ server/.env 存在" || echo "❌ server/.env 不存在"

# 3. 檢查依賴
echo "3. 檢查依賴安裝..."
[ -d node_modules ] && echo "✅ 根目錄 node_modules 存在" || echo "❌ 需要執行 npm install"
[ -d server/node_modules ] && echo "✅ server/node_modules 存在" || echo "❌ 需要安裝後端依賴"
[ -d client/node_modules ] && echo "✅ client/node_modules 存在" || echo "❌ 需要安裝前端依賴"

# 4. 檢查前端建置
echo "4. 檢查前端建置..."
[ -d client/dist ] && [ -f client/dist/index.html ] && echo "✅ 前端已建置" || echo "❌ 需要執行 npm run build"

# 5. 檢查 PM2
echo "5. 檢查 PM2..."
command -v pm2 &> /dev/null && echo "✅ PM2 已安裝" || echo "❌ PM2 未安裝"

echo ""
echo "=== 部署指令 ==="
echo "npm install"
echo "npm run build"
echo "npm run pm2:start"
```

### 2. 開發時使用開發模式，部署時使用 PM2

**不要混用！** 開發時請使用：
```bash
npm run dev
```

部署到生產環境時才使用：
```bash
npm run build && npm run pm2:start
```

### 3. 定期備份資料庫

```bash
# 備份 MongoDB
mongodump --uri="mongodb://localhost:27017/hr-system" --out=/path/to/backup

# 還原
mongorestore --uri="mongodb://localhost:27017/hr-system" /path/to/backup/hr-system
```

## 總結

### 核心要點

1. **Port 3000 在 PM2 模式下同時提供前端和後端**
   - 這是標準的生產部署模式
   - 不需要兩個不同的 port

2. **前端必須先建置才能被 PM2 提供**
   - 執行 `npm run build` 產生 `client/dist/`
   - PM2 啟動後端，後端提供 `dist/` 中的靜態檔案

3. **前後端交互透過 HTTP 請求**
   - 前端 JavaScript 發起 `/api/*` 請求
   - 同一個 Express 伺服器處理 API 請求
   - 在 PM2 模式下，所有請求都走 port 3000

4. **診斷問題時按順序檢查**
   1. MongoDB 是否運行？
   2. 環境變數是否設定？
   3. 前端是否已建置？
   4. PM2 是否正常啟動？
   5. 瀏覽器 Console 是否有錯誤？

### 如果仍然無法解決

1. **收集以下資訊：**
   ```bash
   # 系統資訊
   node --version
   npm --version
   pm2 --version
   
   # PM2 狀態
   pm2 status
   pm2 logs hr-system --lines 50
   
   # 檔案結構
   ls -la client/dist/
   cat server/.env  # 注意：不要分享真實的密鑰！
   
   # 測試 API
   curl http://localhost:3000/api/health
   curl -I http://localhost:3000/
   ```

2. **查看相關文件：**
   - [PM2 部署指南](./PM2_DEPLOYMENT_GUIDE.md)
   - [PM2 常見問題](./PM2_FAQ.md)
   - [專案 README](../README.md)

3. **建立 Issue：**
   - 提供上述資訊
   - 描述具體的錯誤訊息
   - 說明已經嘗試過的解決方法

## 參考資料

- [Express Static Files](https://expressjs.com/en/starter/static-files.html)
- [PM2 官方文件](https://pm2.keymetrics.io/)
- [Vite Build 說明](https://vitejs.dev/guide/build.html)
