# HR 系統
[![CI Status](https://github.com/<OWNER>/<REPO>/actions/workflows/node.yml/badge.svg)](https://github.com/<OWNER>/<REPO>/actions/workflows/node.yml)

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
| `admin`       | admin       |

啟動時也會建立一個名為「示範機構」的機構，以及預設的「人力資源部」與「招聘組」區
域，便於前端選單立即取得資料。

更詳細說明請參閱 [`server/README.md`](server/README.md)。

## 同時啟動前後端

在專案根目錄執行下列指令，可一次啟動後端與 Vite 前端開發伺服器：

```bash
npm run dev
```

此指令透過 `concurrently` 同時執行 `server` 與 `client` 目錄內的 `npm run dev`。

## 前端 (`client/`)

1. 進入 `client/` 目錄安裝套件：
   ```bash
   npm install
   ```
2. (選擇性) 在 `client/.env` 設定 `VITE_API_BASE_URL` 以指定後端 API 位址，預設可使用 `http://localhost:3000`
3. 啟動 Vite 開發伺服器：
   ```bash
   npm run dev
   ```
4. 需要時可建立正式版：
   ```bash
   npm run build
   ```

更多注意事項請見 [`client/README.md`](client/README.md)。

## 開始使用

在根目錄執行 `npm run dev` 同時啟動前端與後端後，開啟瀏覽器造訪前端網址（預設 http://localhost:5173 ），即可使用提供的測試帳號登入並與後端 API 互動。


## 部署至 Heroku

此專案在 `Procfile` 指定啟動後端：

```Procfile
web: npm start --prefix server
```

推送到 Heroku 時會自動執行 `heroku-postbuild` 腳本：

```json
"heroku-postbuild": "npm run build --prefix client"
```

後端會在啟動時提供 `client/dist` 靜態檔案，任何不以 `/api` 開頭的請求都會回傳前端的 `index.html`。


## 相關文件

若需瞭解新增員工所需填寫的完整欄位，請參考 [`docs/employee.md`](docs/employee.md)。

## 權限&機構&部門設定

以下提供後台管理三項基本設定的主要 API 路徑，並說明各路徑預期使用角色：

| 功能               | API 路徑           | 需要角色          |
|--------------------|-------------------|-----------------|
| 機構設定           | `/api/menu`        | 任一登入角色 |
| 部門／單位維護     | `/api/departments` | `admin`       |
| 帳號與權限管理     | `/api/users`       | `admin`       |

在前端畫面中，可於「人事管理與系統設定」頁籤找到上述功能。具備管理權限的使用者才能透過這些介面新增或修改機構、部門及帳號資料，其他角色僅能讀取相關資訊。


## 簽核流程

### 建立流程

1. 在「表單樣板」建立申請表格，定義欄位與驗證規則。
2. 於「流程設定」新增關卡，依序指定簽核角色或特定人員，例如主管、人資。
3. 儲存並發布後即可套用於請假、出差等申請。

### 簽核與退簽

- 送出申請後系統會依設定的關卡順序逐一通知簽核者。
- 簽核者可核准或退回；退簽會將流程回到前一關並保留操作紀錄。
- 每關可設定逾時天數，超過時系統會自動退回上一關或標記逾時。

### 範例

```json
{
  "template": "leave",
  "steps": [
    { "id": "submitter" },
    { "id": "supervisor", "timeout": 3 },
    { "id": "hr", "timeout": 2 }
  ]
}
```

> 流程依賴員工資料的 `supervisor` 欄位以取得第一層主管，未設定主管將無法送出申請。


## 執行測試

在專案根目錄執行下列指令即可依序跑完 Server 與 Client 的測試：

```bash
npm test
```

此命令會依照 `package.json` 內的設定，先執行 `server` 目錄的測試，再執行 `client` 目錄的測試。範例輸出：

```bash
> hr-system-root@ test
> npm --prefix server test && npm --prefix client test
...
```

## CI 狀態與啟用方式

專案已設定 GitHub Actions，會在推送與 Pull Request 時自動執行 Server 與 Client 的測試。
若 Fork 本專案，請至 GitHub 倉庫的 **Actions** 分頁啟用此流程。

## 自動合併腳本

若要在提交 Pull Request 前自動合併最新的 `main` 分支，可執行 `scripts/auto_merge.sh`：

```bash
./scripts/auto_merge.sh
```

此腳本會抓取遠端 `main` 並以偏好遠端變更的策略嘗試合併。若仍有衝突無法解決，腳本會中止並提示需手動處理。

## 授權

本專案目前未提供授權，所有權利保留。
