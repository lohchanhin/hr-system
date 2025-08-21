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

### 班別設定

班別用於描述員工的工作時段，協助排班與出勤判定。常見欄位包括：

- **名稱**：顯示用的班別名稱，例如「早班」。
- **startTime**：上班時間（HH:mm）。
- **endTime**：下班時間（HH:mm）。
- **breakTime**：中場休息總時長。
- **crossDay**：是否跨日。

#### 操作範例

API 範例：

```bash
# 建立班別
curl -X POST http://localhost:3000/api/shifts \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"早班","startTime":"09:00","endTime":"18:00","crossDay":false}'

# 編輯班別
curl -X PUT http://localhost:3000/api/shifts/<id> \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"晚班"}'

# 刪除班別
curl -X DELETE http://localhost:3000/api/shifts/<id> \
  -H "Authorization: Bearer <token>"
```

前端操作：於「排班與班別管理設定」>「班別設定」頁籤，使用「新增班別」建立，或在表格中點選「編輯」、「刪除」維護資料。

（目前尚未提供其他班別設定文件）

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

## 生成測試資料

請先在 `server/.env` 設定 `MONGODB_URI`，再執行以下指令產生預設資料：

```bash
node server/scripts/seed.js
```

此腳本會建立預設帳號（`user`、`supervisor`、`admin`，密碼皆為 `password`）以及示範機構「示範機構」（含「人力資源部」與「招聘組」）。更多詳情請參閱 [server/README.md](server/README.md)。

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


## 人員管理操作示例

以下示範如何以 JWT 認證方式呼叫 `user` 管理相關 API。

1. 使用系統預設帳號登入以取得 JWT：
   ```bash
   curl -X POST http://localhost:3000/api/login \\
     -H 'Content-Type: application/json' \\
     -d '{"username":"admin","password":"password"}'
   ```
   伺服器將回傳包含 `token` 欄位的 JSON。

2. 將取得的 Token 置於 `Authorization: Bearer <token>` 標頭，即可進行後續操作：
   ```bash
   # 列出帳號
   curl http://localhost:3000/api/users \\
     -H "Authorization: Bearer <token>"

   # 建立帳號
   curl -X POST http://localhost:3000/api/users \\
     -H "Authorization: Bearer <token>" \\
     -H 'Content-Type: application/json' \\
     -d '{"username":"newuser","password":"password","role":"employee"}'

   # 更新帳號
   curl -X PUT http://localhost:3000/api/users/<id> \\
     -H "Authorization: Bearer <token>" \\
     -H 'Content-Type: application/json' \\
     -d '{"password":"newpass"}'

  # 刪除帳號
  curl -X DELETE http://localhost:3000/api/users/<id> \\
    -H "Authorization: Bearer <token>"
  ```

  若 Token 逾時或角色非 `admin`，API 會回應 `401 Unauthorized` 或 `403 Forbidden`。

## 排班管理

排班流程範例如下：

1. 先建立班別設定，之後排班時可引用其 `id`：
   ```bash
   curl -X POST http://localhost:3000/api/shifts \\
     -H "Authorization: Bearer <token>" \\
     -H "Content-Type: application/json" \\
     -d '{"name":"早班","start":"09:00","end":"17:00"}'
   ```

2. 指派員工與日期到排班表，並指定班別：
   ```bash
   curl -X POST http://localhost:3000/api/schedules \\
     -H "Authorization: Bearer <token>" \\
     -H "Content-Type: application/json" \\
     -d '{"employee":"<員工ID>","date":"2023-05-01","shiftId":"<班別ID>"}'
   ```

3. 檢視某月班表：
   ```bash
   curl http://localhost:3000/api/schedules/monthly?month=2023-05 \\
     -H "Authorization: Bearer <token>"
   ```

班別設定提供可用的班別清單；排班時需在 `shiftId` 欄位填入對應班別的 `id` 才能顯示正確班別。前端「排班管理」頁面可選擇員工、點擊日期並從下拉選單挑選班別完成指派。

## 簽核流程

### 建立流程

1. 在「表單樣板」建立申請表格，定義欄位與驗證規則。
2. 於「流程設定」新增關卡，依序指定簽核角色或特定人員，例如主管、人資。
3. 儲存並發布後即可套用於請假、出差等申請。

### 簽核流程設定

登入後具備 `admin` 權限的使用者可透過以下步驟建立簽核流程：

1. 前往「表單樣板」頁面點選「新增」，或在既有樣板按「編輯」調整欄位與驗證規則。
2. 在樣板編輯畫面切換至「流程關卡設定」，點選「新增關卡」。

新增關卡時可設定下列欄位：

- **簽核類型**：選擇簽核者來源，如指定人員、角色或送出者的主管。
- **簽核對象**：依簽核類型指定特定帳號或角色。
- **範圍**：限制簽核對象適用的機構或部門範圍。
- **必簽**：勾選後此關卡必須通過才能進入下一關。
- **需全員同意**：若有多名簽核者，需全部核准才算通過。
- **允許退簽**：允許簽核者將申請退回上一關或申請人。

#### 操作範例

| 簽核類型 | 簽核對象    | 範圍     | 必簽 | 需全員同意 | 允許退簽 |
|----------|-------------|----------|------|------------|----------|
| 角色     | `supervisor`| 所屬部門 | ✓    | ✗          | ✓        |

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
