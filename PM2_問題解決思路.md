# PM2 啟動後前端無法顯示 - 解決思路總結

## 您遇到的問題

1. ✅ PM2 顯示 "Server running on port 3000"
2. ❌ 訪問 `localhost:3000` 看不到前端頁面
3. ❓ 為什麼 port 3000 是後端 port，卻要訪問它來看前端？
4. ❓ 前後端如何交互？

> 🖥️ **虛擬機部署特別注意：** 如果您在虛擬機中部署，可能遇到網路、防火牆或訪問權限問題。請參閱 [虛擬機部署疑難排解指南](docs/PM2_VM_TROUBLESHOOTING.md)。

## 立即解答

### 問題 1：為什麼訪問後端 port 3000？

**答案：在 PM2 生產模式下，port 3000 同時提供前端和後端服務**

```
開發模式（npm run dev）:
- 前端 Vite 伺服器: localhost:5173
- 後端 Express 伺服器: localhost:3000
- 兩個獨立的進程

PM2 生產模式（npm run pm2:start）:
- 只有一個 Express 伺服器: localhost:3000
- 它同時處理：
  ✓ /api/* 請求 → API 資料
  ✓ 其他請求 → 前端靜態檔案 (來自 client/dist/)
```

### 問題 2：為什麼看不到前端？

**最常見的原因：忘記建置前端！**

PM2 只會啟動後端伺服器，**不會自動建置前端**。如果沒有執行 `npm run build`，就不會有 `client/dist/` 目錄，後端無法提供前端檔案。

### 問題 3：前後端如何交互？

**簡單來說：透過 HTTP 請求**

```
1. 瀏覽器訪問 http://localhost:3000
   ↓
2. 後端返回 index.html (前端頁面)
   ↓
3. 瀏覽器載入 index.html，執行前端 JavaScript
   ↓
4. 前端 JavaScript 發起 API 請求 (例如: fetch('/api/employees'))
   ↓
5. 同一個後端伺服器處理 API 請求
   ↓
6. 返回 JSON 資料給前端
   ↓
7. 前端接收資料並更新頁面
```

所有請求都發往 port 3000，後端根據路徑決定返回前端檔案還是 API 資料。

## 完整解決步驟

### 步驟 1：確認前端已建置

```bash
# 檢查 client/dist/ 目錄是否存在
ls -la client/dist/

# 如果不存在或為空，執行建置
npm run build
```

**這是最關鍵的一步！** 必須先有 `client/dist/` 才能訪問前端。

### 步驟 2：確認環境設定

```bash
# 檢查 server/.env 是否存在
cat server/.env

# 必須包含以下設定：
PORT=3000
MONGODB_URI=mongodb://localhost:27017/hr-system
JWT_SECRET=your-super-secret-jwt-key
NODE_ENV=production
```

### 步驟 3：確認 MongoDB 運行

```bash
# 檢查 MongoDB 狀態
sudo systemctl status mongod

# 如果沒運行，啟動它
sudo systemctl start mongod
```

### 步驟 4：啟動 PM2

```bash
# 停止舊的 PM2 進程（如果有）
npm run pm2:delete

# 啟動 PM2
npm run pm2:start

# 確認狀態
npm run pm2:status
```

### 步驟 5：查看日誌

```bash
# 查看 PM2 日誌，確認是否有錯誤
npm run pm2:logs

# 應該看到類似訊息：
# Server running on port 3000
# Connected to MongoDB
```

### 步驟 6：訪問應用程式

在瀏覽器中訪問：
```
http://localhost:3000
```

應該會看到登入頁面。

## 快速診斷檢查清單

如果還是看不到前端，按以下順序檢查：

```bash
# 1. ✅ 前端是否已建置？
ls -la client/dist/index.html
# 如果檔案不存在 → 執行 npm run build

# 2. ✅ MongoDB 是否運行？
sudo systemctl status mongod
# 如果未運行 → sudo systemctl start mongod

# 3. ✅ 環境變數是否設定？
cat server/.env
# 如果不存在 → cp server/.env.example server/.env

# 4. ✅ PM2 是否正常啟動？
npm run pm2:status
# 如果顯示 errored → 查看 npm run pm2:logs

# 5. ✅ 後端 API 是否正常？
curl http://localhost:3000/api/health
# 應該返回 {"status":"OK"}

# 6. ✅ 能否取得前端首頁？
curl http://localhost:3000/ | grep "<html"
# 應該返回 HTML 內容

# 7. 🖥️ 虛擬機特有檢查：
# 檢查防火牆
sudo ufw status  # Ubuntu/Debian
sudo firewall-cmd --list-ports  # CentOS/RHEL

# 檢查監聽位址
sudo netstat -tlnp | grep :3000
# 應該看到 0.0.0.0:3000 而非 127.0.0.1:3000

# 測試網路訪問
curl -I http://localhost:3000/
# 如果成功，再從宿主機測試 http://[VM_IP]:3000/
```

## 開發 vs 生產模式對照表

| 項目 | 開發模式 | PM2 生產模式 |
|------|---------|-------------|
| **啟動指令** | `npm run dev` | `npm run build` + `npm run pm2:start` |
| **前端 Port** | 5173 | - (由後端提供) |
| **後端 Port** | 3000 | 3000 |
| **訪問網址** | `localhost:5173` | `localhost:3000` |
| **前端建置** | 不需要 | **必須先執行** `npm run build` |
| **熱重載** | ✅ 自動更新 | ❌ 需手動重新建置 |
| **修改程式碼後** | 自動生效 | 需執行 `npm run build` + `npm run pm2:restart` |

## 常見錯誤與解決方法

### 錯誤 1：看到 "Cannot GET /" 或空白頁

**原因：** 前端沒有建置

**解決：**
```bash
npm run build
npm run pm2:restart
```

### 錯誤 2：PM2 狀態顯示 "errored"

**原因：** 後端啟動失敗（通常是 MongoDB 連接問題或環境變數缺失）

**解決：**
```bash
# 查看錯誤訊息
npm run pm2:logs

# 常見解決方法：
# 1. 啟動 MongoDB: sudo systemctl start mongod
# 2. 檢查 server/.env 設定
# 3. 確認 PORT 沒被其他程式佔用
```

### 錯誤 3：修改前端程式碼沒有生效

**原因：** PM2 不會自動重新建置前端

**解決：**
```bash
# 每次修改前端程式碼後
npm run build
npm run pm2:restart
```

**提示：** 如果頻繁修改，建議使用開發模式：
```bash
npm run dev
```

## 詳細文件參考

如需更詳細的說明、架構圖解和進階診斷方法，請參考：

1. **[PM2 前端無法顯示完整診斷指南](docs/PM2_FRONTEND_ACCESS_SOLUTION.md)** ⭐ 推薦
   - 詳細的診斷步驟
   - 架構圖解
   - 完整的錯誤排除方法

2. **[PM2 虛擬機部署疑難排解](docs/PM2_VM_TROUBLESHOOTING.md)** 🖥️ 虛擬機專用
   - 防火牆設定
   - 網路模式配置
   - SELinux 處理
   - Nginx 反向代理設定

3. **[PM2 部署指南](docs/PM2_DEPLOYMENT_GUIDE.md)**
   - PM2 部署完整流程
   - 環境變數設定
   - 常用指令說明

4. **[PM2 常見問題](docs/PM2_FAQ.md)**
   - 快速問答
   - Port 使用說明
   - Vite 設定建議

5. **[專案 README](README.md)**
   - 完整的專案說明
   - 功能介紹
   - API 使用指南

## 關鍵重點總結

1. **PM2 模式下訪問 port 3000，不是 5173**
   - Port 3000 同時提供前端和後端
   - Port 5173 只在開發模式使用

2. **必須先建置前端**
   - 執行 `npm run build` 產生 `client/dist/`
   - 這是最常被忽略的步驟！

3. **前後端在同一個 port 交互**
   - 所有請求都發往 port 3000
   - 後端根據路徑決定返回內容

4. **開發時用開發模式，部署時用 PM2**
   - 開發：`npm run dev` (快速、熱重載)
   - 生產：`npm run build` + `npm run pm2:start` (穩定、效能好)

---

**如果問題仍未解決，請查看 [完整診斷指南](docs/PM2_FRONTEND_ACCESS_SOLUTION.md) 或建立 Issue 尋求協助。**
