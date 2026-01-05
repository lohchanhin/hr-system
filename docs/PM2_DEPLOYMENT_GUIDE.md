# PM2 部署指南與前端訪問說明

## 問題解答

### 1. PM2 啟動後，要訪問哪一個前端 port？

**答案：訪問後端的 port 3000**

當使用 PM2 啟動專案時，實際上是啟動了**後端伺服器**（而非前端開發伺服器）。這時的架構如下：

```
PM2 啟動 → 後端伺服器 (port 3000) → 提供 API + 前端靜態檔案
```

#### 訪問方式：

```
http://localhost:3000
```

#### 為什麼不是 port 5173？

- **Port 5173** 是 Vite 開發伺服器的 port，只在**開發模式**下使用（`npm run dev`）
- **Port 3000** 是後端 Express 伺服器的 port，在**生產模式**下使用（PM2 部署）

#### 工作原理：

1. 使用 `npm run build` 建置前端，會產生靜態檔案到 `client/dist/` 目錄
2. PM2 啟動後端伺服器（`server/src/index.js`）
3. 後端伺服器透過 `express.static()` 提供前端靜態檔案：
   ```javascript
   // server/src/index.js 第 87 行
   app.use(express.static(distPath));
   ```
4. 所有非 API 請求都會返回前端的 `index.html`

### 2. 前端的 vite.config 是否需要修改不要寫死 hr-system-... 路徑？

**答案：需要改善，目前的設定不夠彈性**

#### 現況分析：

在 `client/vite.config.js` 第 28 行：
```javascript
const API_BASE_URL =
  env.VITE_API_BASE_URL ||
  (mode === 'development'
    ? 'http://localhost:3000'
    : 'https://hr-system-d7fc5ea7aab1.herokuapp.com') // 確保 prod 不會是空字串
```

**問題點：**
- Heroku 網址被寫死在程式碼中（`hr-system-d7fc5ea7aab1.herokuapp.com`）
- 如果部署到其他環境（VPS、Docker、其他 PaaS），需要修改程式碼
- 不符合「環境變數優先」的最佳實踐

#### 建議的修改方式：

**方案一：完全依賴環境變數（推薦）**

```javascript
// vite.config.js
const API_BASE_URL =
  env.VITE_API_BASE_URL ||
  (mode === 'development'
    ? 'http://localhost:3000'
    : '') // 生產環境使用相對路徑（與前端同源）
```

**優點：**
- 生產環境使用相對路徑，前後端部署在同一個 domain 時不需要額外設定
- 如需跨域，透過 `.env` 設定 `VITE_API_BASE_URL` 即可

**方案二：保留 fallback 但使用環境變數**

如果擔心沒設定環境變數時系統無法運作，可以在文件中明確說明：

```javascript
const API_BASE_URL =
  env.VITE_API_BASE_URL ||
  (mode === 'development'
    ? 'http://localhost:3000'
    : '/') // 使用相對路徑
```

## PM2 完整部署流程

### 步驟 1：安裝依賴
```bash
npm install
```

### 步驟 2：設定環境變數

建立 `server/.env` 檔案：
```bash
cd server
cp .env.example .env
```

編輯 `.env`：
```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/hr-system
JWT_SECRET=your-super-secret-jwt-key
NODE_ENV=production
```

### 步驟 3：建置前端
```bash
npm run build
```

這會執行 `client/` 目錄下的建置，產生靜態檔案到 `client/dist/`。

### 步驟 4：啟動 PM2
```bash
npm run pm2:start
```

或直接使用 PM2：
```bash
pm2 start ecosystem.config.cjs
```

### 步驟 5：驗證部署

1. 檢查 PM2 狀態：
   ```bash
   npm run pm2:status
   # 或
   pm2 status
   ```

2. 查看日誌：
   ```bash
   npm run pm2:logs
   # 或
   pm2 logs hr-system
   ```

3. 訪問應用程式：
   ```
   http://localhost:3000
   ```

## 不同環境的訪問方式

### 開發模式（npm run dev）

```bash
npm run dev
```

- **前端**：http://localhost:5173 （Vite 開發伺服器）
- **後端**：http://localhost:3000 （Express API 伺服器）
- 前端會透過 Vite proxy 轉發 API 請求到後端

### 生產模式（PM2）

```bash
npm run build
npm run pm2:start
```

- **統一訪問**：http://localhost:3000
- 後端伺服器同時提供 API 和前端靜態檔案

### Heroku 部署

- **訪問網址**：https://your-app-name.herokuapp.com
- 需要在 Heroku 設定環境變數：
  ```bash
  heroku config:set MONGODB_URI=mongodb+srv://...
  heroku config:set JWT_SECRET=your-secret
  heroku config:set NODE_ENV=production
  ```

## 常見問題

### Q1：為什麼 PM2 啟動後看不到前端？

**檢查清單：**
1. 是否已執行 `npm run build`？
2. `client/dist/` 目錄是否存在？
3. 後端伺服器是否正常啟動？（檢查 `pm2 logs`）
4. PORT 設定是否正確？

### Q2：修改前端程式碼後沒有生效？

PM2 模式下需要重新建置：
```bash
npm run build
npm run pm2:restart
```

### Q3：開發時想同時看前端和後端？

使用開發模式：
```bash
npm run dev
```

這會同時啟動前後端開發伺服器，支援熱重載。

### Q4：如何在不同環境使用不同的 API 網址？

建立 `client/.env.production`：
```env
VITE_API_BASE_URL=https://your-production-api.com
```

或在部署時設定環境變數：
```bash
export VITE_API_BASE_URL=https://api.example.com
npm run build
```

## PM2 常用指令

```bash
# 啟動
npm run pm2:start

# 停止
npm run pm2:stop

# 重啟
npm run pm2:restart

# 刪除
npm run pm2:delete

# 查看狀態
npm run pm2:status

# 查看日誌
npm run pm2:logs

# 監控
pm2 monit

# 開機自動啟動
pm2 startup
pm2 save
```

## 建議的 vite.config.js 修改

```javascript
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // 明確定義 fallback：dev 走 localhost:3000，prod 使用相對路徑
  const API_BASE_URL =
    env.VITE_API_BASE_URL ||
    (mode === 'development'
      ? 'http://localhost:3000'
      : '') // 生產環境使用相對路徑，與前端同源

  const resolveSrc = () => {
    try {
      return fileURLToPath(new URL('./src', import.meta.url))
    } catch (error) {
      if (error?.code === 'ERR_INVALID_URL_SCHEME') {
        return path.resolve(process.cwd(), 'src')
      }
      throw error
    }
  }

  const config = {
    plugins: [vue(), vueDevTools()],
    resolve: {
      alias: {
        '@': resolveSrc(),
      },
    },
    define: {
      __API_BASE_URL__: JSON.stringify(API_BASE_URL),
    },
    test: {
      environment: 'jsdom',
    },
  }

  if (mode === 'development') {
    config.server = {
      proxy: {
        '/api': {
          target: API_BASE_URL,
          changeOrigin: true,
        },
      },
    }
  }

  return config
})
```

## 總結

1. **PM2 啟動後訪問 `http://localhost:3000`**，這是後端伺服器 port，同時提供 API 和前端靜態檔案
2. **不需要訪問 port 5173**，那是開發模式專用
3. **建議修改 vite.config.js**，移除寫死的 Heroku 網址，改用環境變數或相對路徑
4. **生產環境部署流程**：`npm run build` → `npm run pm2:start` → 訪問 port 3000

## 參考資料

- [PM2 官方文件](https://pm2.keymetrics.io/)
- [Vite 環境變數與模式](https://vitejs.dev/guide/env-and-mode.html)
- [Express 靜態檔案](https://expressjs.com/en/starter/static-files.html)
