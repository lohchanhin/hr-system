# HR 系統

本專案是一套簡易的人力資源管理系統，分成前端與後端兩個獨立的 Node.js 專案：

- **`client/`** – 基於 Vite 與 Vue 3 的前端程式碼，採用 Element Plus UI 元件庫。
- **`server/`** – 使用 Express 建立的 REST API，資料存放於 MongoDB。

前端透過 `/api` 路徑向後端發送請求，後端提供 JSON 格式的回應並處理資料庫存取。

## 功能概述

後端提供多個模組以處理常見 HR 流程，包括：

- **員工管理** – 建立與查詢員工資料。
- **出勤紀錄** – 記錄上下班、外出及休息時間。
- **請假申請** – 申請與審核各類假別。
- **排班管理** – 儲存與查詢班表。
- **薪資紀錄** – 追蹤每月薪資發放。
- **保險管理** – 管理員工保險相關資料。
- **報表產生** – 匯出各式統計或管理報表。
- **審核流程** – 提供申請單的審核與簽核機制。

## 專案結構

```
/
├── client/  # Vue 3 前端
└── server/  # Express REST API
```

兩個目錄皆為獨立的 Node.js 專案，開發前需分別安裝相依套件並啟動。

## 伺服器端 (`server/`)

1. 進入 `server/` 目錄安裝套件：
   ```bash
   npm install
   ```
2. 依照 `.env.example` 建立 `.env`，設定以下變數：
   - `PORT` – 伺服器埠號
   - `MONGODB_URI` – MongoDB 連線字串
   - `JWT_SECRET` – (必填) JWT 簽章密鑰
3. 啟動開發伺服器（使用 nodemon）：
   ```bash
   npm run dev
   ```
4. 執行單元測試：
   ```bash
   npm test
   ```

首次啟動時會自動建立幾個測試帳號並同步產生對應的員工紀錄，預設密碼均為 `password`：

| 帳號          | 角色         |
|---------------|-------------|
| `user`        | employee    |
| `supervisor`  | supervisor  |
| `hr`          | hr          |
| `admin`       | admin       |

更詳細說明請參閱 [`server/README.md`](server/README.md)。

## 前端 (`client/`)

1. 進入 `client/` 目錄安裝套件：
   ```bash
   npm install
   ```
2. 啟動 Vite 開發伺服器：
   ```bash
   npm run dev
   ```
3. 需要時可建立正式版：
   ```bash
   npm run build
   ```

更多注意事項請見 [`client/README.md`](client/README.md)。

## 開始使用

前後端皆啟動後，開啟瀏覽器造訪前端網址（預設 http://localhost:5173 ），即可使用提供的測試帳號登入並與後端 API 互動。


## 自動合併腳本

若要在提交 Pull Request 前自動合併最新的 `main` 分支，可執行 `scripts/auto_merge.sh`：

```bash
./scripts/auto_merge.sh
```

此腳本會抓取遠端 `main` 並以偏好遠端變更的策略嘗試合併。若仍有衝突無法解決，腳本會中止並提示需手動處理。
