# PM2 部署問題解答

## 您的問題

### 1. PM2 啟動之後，要訪問哪一個前端 port？

**答案：訪問 http://localhost:3000**

當您使用 `npm run pm2:start` 啟動專案後：
- ✅ **請訪問 port 3000**（後端伺服器）
- ❌ **不要訪問 port 5173**（那是開發模式才會使用的 Vite 開發伺服器）

### 為什麼是 port 3000？

PM2 模式是「生產環境部署」，工作流程如下：

1. 先執行 `npm run build` 建置前端 → 產生靜態檔案到 `client/dist/`
2. PM2 啟動**後端伺服器**（port 3000）
3. 後端伺服器**同時**提供：
   - `/api/*` 路徑 → 處理 API 請求
   - 其他路徑 → 提供前端靜態檔案（來自 `client/dist/`）

所以您只需要訪問一個 port（3000），就能同時存取前端和後端。

### 完整操作步驟：

```bash
# 1. 建置前端
npm run build

# 2. 啟動 PM2
npm run pm2:start

# 3. 瀏覽器訪問
# → http://localhost:3000
```

### 不同模式的 port 對照表：

| 模式 | 指令 | 前端 port | 後端 port | 說明 |
|------|------|-----------|-----------|------|
| 開發模式 | `npm run dev` | 5173 | 3000 | 前後端分離，各自獨立運行 |
| PM2 生產模式 | `npm run pm2:start` | - | 3000 | 統一由後端提供前端和 API |

---

### 2. 前端的 vite.config 是否需要修改不要寫死 hr-system-... 路徑？

**答案：是的，我已經幫您修改了！**

#### 原本的問題：

在 `client/vite.config.js` 中，Heroku 網址被寫死：

```javascript
const API_BASE_URL =
  env.VITE_API_BASE_URL ||
  (mode === 'development'
    ? 'http://localhost:3000'
    : 'https://hr-system-d7fc5ea7aab1.herokuapp.com') // ❌ 寫死的網址
```

這樣的問題：
- 如果部署到其他環境（VPS、Docker），需要修改程式碼
- 不符合「環境變數優先」的最佳實踐

#### 修改後的解決方案：

```javascript
const API_BASE_URL =
  env.VITE_API_BASE_URL ||
  (mode === 'development'
    ? 'http://localhost:3000'
    : '') // ✅ 生產環境使用相對路徑
```

#### 為什麼這樣更好？

1. **同源部署不需額外設定**：
   - PM2 模式下，前端和後端都在 port 3000
   - 使用相對路徑（空字串）即可正常運作
   - 不需要設定 `VITE_API_BASE_URL`

2. **跨域部署很彈性**：
   - 如果前後端分離部署（例如前端在 CDN、後端在 VPS）
   - 只需要設定環境變數：`VITE_API_BASE_URL=https://api.example.com`
   - 不用改程式碼

3. **適合多種部署環境**：
   - Heroku：設定 `VITE_API_BASE_URL` 環境變數
   - VPS/Docker：預設同源即可
   - 開發環境：自動使用 localhost:3000

#### 後端 CORS 也一併改善：

原本的 `server/src/index.js` 也有寫死的 Heroku 網址：

```javascript
// ❌ 原本
app.use(cors({
  origin: [
    "https://hr-system-d7fc5ea7aab1.herokuapp.com", // 寫死
    "http://localhost:5173"
  ]
}));
```

改成支援環境變數：

```javascript
// ✅ 改善後
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000"
];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: "GET,POST,PUT,DELETE,OPTIONS"
}));
```

---

## 環境變數設定說明

### 前端環境變數（client/.env）

```bash
# 不設定 → 使用預設值（開發: localhost:3000, 生產: 相對路徑）
# 或設定特定網址（跨域部署時需要）
VITE_API_BASE_URL=https://your-backend-api.com
```

### 後端環境變數（server/.env）

```bash
PORT=3000
MONGODB_URI=mongodb://localhost:27017/hr-system
JWT_SECRET=your-super-secret-jwt-key
NODE_ENV=production

# 選用：如果前端在不同 domain，需要設定 CORS
FRONTEND_URL=https://your-frontend-domain.com
```

---

## 常見情境

### 情境 1：本地開發
```bash
npm run dev
```
- 前端：http://localhost:5173
- 後端：http://localhost:3000
- 不需要設定環境變數

### 情境 2：本地 PM2 部署（模擬生產環境）
```bash
npm run build
npm run pm2:start
```
- 訪問：http://localhost:3000
- 不需要設定 `VITE_API_BASE_URL`

### 情境 3：Heroku 部署
```bash
# 設定 Heroku 環境變數
heroku config:set MONGODB_URI=mongodb+srv://...
heroku config:set JWT_SECRET=your-secret

# 如果前端另外部署，才需要設定
heroku config:set VITE_API_BASE_URL=https://your-frontend.com
heroku config:set FRONTEND_URL=https://your-frontend.com
```

### 情境 4：VPS 部署（Nginx 反向代理）
- 前後端都在同一個 domain
- 不需要設定跨域相關環境變數
- Nginx 統一處理路由

---

## 驗證部署是否成功

```bash
# 1. 檢查 PM2 狀態
npm run pm2:status

# 2. 查看日誌
npm run pm2:logs

# 3. 測試 API
curl http://localhost:3000/api/health

# 4. 瀏覽器訪問
# → http://localhost:3000
# → 應該能看到登入畫面
```

---

## 參考文件

- [PM2 部署指南（詳細版）](./PM2_DEPLOYMENT_GUIDE.md)
- [主要 README](../README.md)
- 前端環境變數範例：`client/.env.example`
- 後端環境變數範例：`server/.env.example`
