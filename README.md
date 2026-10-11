# HR 系統 (Human Resource Management System)

[![CI Status](https://github.com/<OWNER>/<REPO>/actions/workflows/node.yml/badge.svg)](https://github.com/<OWNER>/<REPO>/actions/workflows/node.yml)

## 專案簡介

本專案是一套功能完整的人力資源管理系統，專為中小企業打造，提供員工管理、考勤追蹤、薪資計算、請假簽核等核心人事功能。系統採用前後端分離架構，確保程式碼模組化與可維護性。

### 技術架構

本系統分為前端與後端兩個獨立的 Node.js 專案：

- **前端 (`client/`)** 
  - 框架：Vue 3 (Composition API)
  - 建置工具：Vite 6.x
  - UI 框架：Element Plus
  - 狀態管理：Pinia
  - 路由：Vue Router
  - 日期處理：Day.js
  - Excel 處理：SheetJS (xlsx)

- **後端 (`server/`)**
  - 框架：Express 4.x
  - 資料庫：MongoDB (Mongoose ODM)
  - 認證：JWT (JSON Web Tokens)
  - 密碼加密：bcryptjs
  - 檔案上傳：Multer
  - PDF 生成：PDFKit
  - Excel 生成：ExcelJS

### 系統特色

- ✅ **完整的人事流程管理**：涵蓋從員工到職到離職的完整生命週期
- ✅ **靈活的簽核系統**：支援多層級審核流程，可自定義簽核關卡
- ✅ **智能考勤管理**：支援多種打卡方式，自動計算加班與缺勤
- ✅ **精準薪資計算**：整合勞健保計算，支援銀行轉帳檔匯出
- ✅ **多種排班模式**：支援固定班、輪班、跨日班等多種工作型態
- ✅ **報表與分析**：提供各式統計報表，協助管理決策
- ✅ **權限分級控管**：支援管理員、主管、員工等多種角色權限

## 核心功能模組

### 1. 員工管理 (Employee Management)
- **完整員工檔案**：基本資料、聯絡資訊、緊急聯絡人、學歷、工作經歷
- **人事異動**：到職、調職、離職管理
- **組織架構**：機構、部門、小組三層級組織設定
- **職位設定**：職稱、職業別、兼職狀態管理
- **員工狀態**：正職、試用、停薪、離職等狀態追蹤
- **照片上傳**：支援員工照片管理

### 2. 考勤管理 (Attendance Management)
- **多種打卡方式**：
  - 手動打卡：上班簽到、下班簽退、外出、返回
  - 批次匯入：支援 Excel/CSV 格式的考勤機資料匯入
  - 中文格式支援：自動識別「上午/下午」、「上班簽到/下班簽退」
- **時間計算**：
  - 自動計算工作時數、加班時數
  - 支援跨日班別（如夜班）
  - 彈性處理不同時區
- **異常處理**：
  - 遲到、早退、缺勤標記
  - 打卡異常申報與審核
  - 補打卡申請流程

### 3. 排班管理 (Shift Scheduling)
- **班別設定**：
  - 自定義班別名稱、上下班時間
  - 休息時間設定
  - 跨日班別支援（例如：22:00-06:00）
  - 夜班津貼計算
- **排班功能**：
  - 月曆式排班介面
  - 批次排班：快速設定整月或整週班表
  - 班表複製：複製上月或其他員工班表
  - 排班規則設定：預設週休二日、臨時調班控管
- **部門排班**：
  - 部門層級排班管理
  - 指定排班管理者
  - 排班備註與特殊需求記錄

### 4. 請假與簽核 (Leave & Approval)
- **假別管理**：
  - 年假、病假、事假、婚假、喪假、產假等
  - 可自定義假別與規則
  - 假期額度追蹤與扣除
- **簽核流程**：
  - 多層級審核機制（申請人 → 主管 → 人資 → 核准）
  - 可設定必簽關卡與選簽關卡
  - 支援退簽與補件
  - 簽核逾時提醒
  - 簽核記錄完整保存
- **表單設計**：
  - 自定義表單欄位
  - 欄位驗證規則設定
  - 表單樣板管理

### 5. 薪資管理 (Payroll Management)
- **薪資計算**：
  - 基本薪資、加班費、津貼、獎金計算
  - 自動扣除請假扣款
  - 勞保、健保、勞退自動計算（支援 28 級距）
  - 夜班津貼計算
  - 支援每月固定薪資調整項目設定
- **薪資單生成**：
  - 員工薪資明細表
  - 可匯出 PDF 或 Excel 格式
- **月薪資總覽**：
  - 完整的員工薪資列表
  - 統計資料彙總（總人數、薪資總額、實發總額、扣款總額）
  - 支援 Excel 匯出（臺灣企銀、台中銀行、個人獎金紙條格式）
  - 支援 PDF 匯出
  - 支援篩選條件（機構、部門、單位、員工）
- **銀行轉帳檔**：
  - 支援台灣銀行格式
  - 支援台中銀行格式
  - 批次產生員工薪資轉帳檔
- **保險管理**：
  - 勞保、健保投保級距自動對應
  - 保險費用計算
  - 保險異動記錄

### 6. 報表中心 (Reports)
- **考勤報表**：
  - 個人出勤統計
  - 部門出勤彙總
  - 異常考勤明細
- **薪資報表**：
  - 月薪資總表
  - 部門薪資統計
  - 年度薪資分析
- **請假報表**：
  - 個人請假統計
  - 部門請假分析
  - 假期使用狀況
- **匯出功能**：
  - Excel 格式匯出
  - PDF 格式匯出
  - 自定義報表欄位

### 7. 系統管理 (System Administration)
- **權限管理**：
  - 角色權限設定（Admin、Supervisor、Employee）
  - 功能權限控管
  - 資料存取權限設定
- **組織管理**：
  - 機構設定與維護
  - 部門新增、編輯、刪除
  - 小組管理
- **參數設定**：
  - 系統參數調整
  - 假別規則設定
  - 考勤規則設定
  - 薪資規則設定

## 專案架構 (Project Structure)

```
hr-system/
├── client/                      # 前端應用程式
│   ├── public/                  # 靜態資源
│   ├── src/
│   │   ├── api.js              # API 請求封裝
│   │   ├── assets/             # 圖片、樣式等資源
│   │   ├── components/         # Vue 元件
│   │   │   ├── attendance/     # 考勤相關元件
│   │   │   ├── employee/       # 員工管理元件
│   │   │   ├── payroll/        # 薪資管理元件
│   │   │   ├── schedule/       # 排班管理元件
│   │   │   └── ...
│   │   ├── constants/          # 常數定義
│   │   ├── router/             # 路由設定
│   │   ├── stores/             # Pinia 狀態管理
│   │   ├── utils/              # 工具函數
│   │   ├── views/              # 頁面元件
│   │   │   ├── Login.vue       # 登入頁面
│   │   │   ├── Layout.vue      # 主要佈局
│   │   │   ├── ModernLayout.vue # 現代化佈局
│   │   │   └── ...
│   │   ├── App.vue             # 根元件
│   │   └── main.js             # 應用程式入口
│   ├── tests/                  # 前端測試
│   ├── .env.example            # 環境變數範例
│   ├── index.html              # HTML 模板
│   ├── package.json            # 前端依賴
│   └── vite.config.js          # Vite 設定
│
├── server/                      # 後端應用程式
│   ├── scripts/                # 腳本工具
│   │   ├── seed.js             # 測試資料生成
│   │   └── ...
│   ├── src/
│   │   ├── config/             # 設定檔
│   │   │   └── database.js     # 資料庫連線設定
│   │   ├── controllers/        # 控制器層
│   │   │   ├── attendanceController.js
│   │   │   ├── employeeController.js
│   │   │   ├── payrollController.js
│   │   │   ├── scheduleController.js
│   │   │   └── ...
│   │   ├── middleware/         # 中介層
│   │   │   ├── auth.js         # 認證中介層
│   │   │   ├── errorHandler.js # 錯誤處理
│   │   │   └── ...
│   │   ├── models/             # 資料模型 (Mongoose Schema)
│   │   │   ├── Employee.js     # 員工模型
│   │   │   ├── AttendanceRecord.js # 考勤記錄
│   │   │   ├── ShiftSchedule.js    # 班表
│   │   │   ├── PayrollRecord.js    # 薪資記錄
│   │   │   ├── Approval.js         # 簽核流程
│   │   │   ├── Department.js       # 部門
│   │   │   ├── Organization.js     # 機構
│   │   │   └── ...
│   │   ├── routes/             # API 路由
│   │   │   ├── authRoutes.js       # 認證路由
│   │   │   ├── employeeRoutes.js   # 員工 API
│   │   │   ├── attendanceRoutes.js # 考勤 API
│   │   │   ├── scheduleRoutes.js   # 排班 API
│   │   │   ├── payrollRoutes.js    # 薪資 API
│   │   │   ├── approvalRoutes.js   # 簽核 API
│   │   │   └── ...
│   │   ├── services/           # 業務邏輯層
│   │   │   ├── attendanceService.js
│   │   │   ├── payrollService.js
│   │   │   └── ...
│   │   ├── utils/              # 工具函數
│   │   ├── seedUtils.js        # Seed 工具
│   │   └── index.js            # 應用程式入口
│   ├── tests/                  # 後端測試
│   ├── .env.example            # 環境變數範例
│   ├── jest.config.js          # Jest 測試設定
│   └── package.json            # 後端依賴
│
├── docs/                        # 文件資料夾
│   ├── PAYROLL_README.md        # 薪資系統文件
│   ├── PAYROLL_API.md           # 薪資 API 文件
│   ├── SALARY_CALCULATION_GUIDE.md # 薪資計算指南
│   ├── TEST_DATA_GUIDE.md       # 測試資料說明
│   ├── attendance-import.md     # 考勤匯入說明
│   ├── employee.md              # 員工欄位說明
│   └── ...
│
├── scripts/                     # 專案級腳本
│   └── auto_merge.sh            # 自動合併腳本
│
├── .github/                     # GitHub 設定
│   └── workflows/               # CI/CD 工作流程
│       └── node.yml             # Node.js CI
│
├── .gitignore                   # Git 忽略檔案
├── Procfile                     # Heroku 部署設定
├── package.json                 # 根目錄依賴（用於同時啟動前後端）
└── README.md                    # 專案說明文件（本檔案）
```

### 架構說明

#### 前端架構
- **Vue 3 Composition API**：使用最新的 Vue 3 組合式 API，提高程式碼可讀性與重用性
- **Vite**：極速的開發伺服器與建置工具
- **Element Plus**：豐富的 UI 元件庫，提供一致的使用者體驗
- **Pinia**：輕量級狀態管理，替代 Vuex
- **模組化設計**：按功能模組組織元件，易於維護與擴充

#### 後端架構
- **MVC 架構**：Model-View-Controller 分層設計
  - **Models**：定義資料結構與資料庫操作
  - **Controllers**：處理 HTTP 請求與回應
  - **Services**：封裝業務邏輯
- **RESTful API**：遵循 REST 設計原則
- **中介層設計**：認證、授權、錯誤處理等功能模組化
- **依賴注入**：降低模組間耦合度

#### 資料庫設計
- **MongoDB**：NoSQL 文件型資料庫
- **Mongoose ODM**：提供 Schema 驗證與模型操作
- **集合（Collections）**：
  - `employees` - 員工資料
  - `attendancerecords` - 考勤記錄
  - `shiftschedules` - 排班資料
  - `payrollrecords` - 薪資記錄
  - `approvals` - 簽核流程
  - `departments` - 部門資料
  - `organizations` - 機構資料
  - 等多個集合...

## API 使用指南 (API Guide)

### 認證機制

系統使用 JWT (JSON Web Token) 進行身份認證。

#### 登入取得 Token

```bash
curl -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"password"}'
```

**回應範例：**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "username": "admin",
    "role": "admin"
  }
}
```

#### 使用 Token 存取 API

在後續的 API 請求中，需在 HTTP Header 加入 Authorization：

```bash
Authorization: Bearer <your-token-here>
```

### 核心 API 端點

#### 1. 員工管理 API

**列出所有員工**
```bash
GET /api/employees
Authorization: Bearer <token>
```

**取得單一員工資料**
```bash
GET /api/employees/:id
Authorization: Bearer <token>
```

**建立新員工**
```bash
POST /api/employees
Authorization: Bearer <token>
Content-Type: application/json

{
  "username": "john.doe",
  "password": "password123",
  "name": "John Doe",
  "employeeId": "E001",
  "email": "john@example.com",
  "department": "部門ID",
  "role": "employee",
  "jobTitle": "工程師",
  "baseSalary": 40000
}
```

**更新員工資料**
```bash
PUT /api/employees/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "John Smith",
  "email": "johnsmith@example.com"
}
```

**刪除員工**
```bash
DELETE /api/employees/:id
Authorization: Bearer <token>
```

#### 2. 考勤管理 API

**員工打卡**
```bash
POST /api/attendance
Authorization: Bearer <token>
Content-Type: application/json

{
  "action": "clockIn"  // 可選值: clockIn, clockOut, breakStart, breakEnd
}
```

**取得員工考勤記錄**
```bash
GET /api/attendance?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <token>
```

**批次匯入考勤資料**
```bash
POST /api/attendance/import
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <Excel or CSV file>
```

#### 3. 排班管理 API

**建立班別**
```bash
POST /api/shifts
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "早班",
  "startTime": "09:00",
  "endTime": "18:00",
  "breakTime": 60,
  "crossDay": false
}
```

**指派員工排班**
```bash
POST /api/schedules
Authorization: Bearer <token>
Content-Type: application/json

{
  "employee": "員工ID",
  "date": "2024-01-15",
  "shiftId": "班別ID"
}
```

**查詢月班表**
```bash
GET /api/schedules/monthly?month=2024-01
Authorization: Bearer <token>
```

**批次排班**
```bash
POST /api/schedules/batch
Authorization: Bearer <token>
Content-Type: application/json

{
  "employees": ["員工ID1", "員工ID2"],
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "shiftId": "班別ID"
}
```

#### 4. 請假與簽核 API

**提交請假申請**
```bash
POST /api/approvals
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "leave",
  "leaveType": "annual",
  "startDate": "2024-01-15",
  "endDate": "2024-01-17",
  "reason": "個人事務",
  "days": 3
}
```

**取得待審核列表**
```bash
GET /api/approvals/pending
Authorization: Bearer <token>
```

**審核申請單**
```bash
POST /api/approvals/:id/review
Authorization: Bearer <token>
Content-Type: application/json

{
  "action": "approve",  // approve, reject, return
  "comment": "同意"
}
```

**查詢申請記錄**
```bash
GET /api/approvals?status=approved&startDate=2024-01-01
Authorization: Bearer <token>
```

#### 5. 薪資管理 API

**初始化勞健保級距表**
```bash
POST /api/payroll/insurance/initialize
Authorization: Bearer <token>
```

**計算並儲存員工薪資**
```bash
POST /api/payroll/calculate/save
Authorization: Bearer <token>
Content-Type: application/json

{
  "employeeId": "員工ID",
  "month": "2024-01-01",
  "customData": {
    "healthInsuranceFee": 710,
    "nightShiftAllowance": 2700,
    "bonus": 5000
  }
}
```

**取得員工薪資記錄**
```bash
GET /api/payroll/employee/:employeeId?month=2024-01
Authorization: Bearer <token>
```

**匯出銀行轉帳檔**
```bash
POST /api/payroll/export?month=2024-01&bankType=taiwan
Authorization: Bearer <token>
Content-Type: application/json

{
  "paymentDate": "20240110",
  "paymentAccount": "52012170505",
  "paymentAccountName": "公司名稱",
  "bankCode": "050",
  "branchCode": "5206"
}
```

#### 6. 報表 API

**取得考勤報表**
```bash
GET /api/reports/attendance?month=2024-01&department=部門ID
Authorization: Bearer <token>
```

**取得薪資報表**
```bash
GET /api/reports/payroll?month=2024-01
Authorization: Bearer <token>
```

**匯出 Excel 報表**
```bash
GET /api/reports/export?type=attendance&month=2024-01&format=xlsx
Authorization: Bearer <token>
```

### 錯誤處理

API 遵循標準 HTTP 狀態碼：

- **200 OK**：請求成功
- **201 Created**：資源建立成功
- **400 Bad Request**：請求參數錯誤
- **401 Unauthorized**：未認證或 Token 無效
- **403 Forbidden**：權限不足
- **404 Not Found**：資源不存在
- **500 Internal Server Error**：伺服器錯誤

**錯誤回應格式：**
```json
{
  "error": "錯誤訊息",
  "message": "詳細說明",
  "statusCode": 400
}
```

## 使用情境範例

1. 管理員登入
   ```bash
   curl -X POST http://localhost:3000/api/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"password"}'
   ```
   前端：登入頁輸入管理員帳密。
2. 建立員工
   ```bash
   curl -X POST http://localhost:3000/api/employees \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer <token>" \
     -d '{"username":"mary","password":"pass","role":"employee"}'
   ```
   前端：「員工管理」>「新增」。
3. 設定班別
   ```bash
   curl -X POST http://localhost:3000/api/shifts \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer <token>" \
     -d '{"name":"早班","startTime":"09:00","endTime":"18:00"}'
   ```
   前端：「排班與班別管理設定」>「班別設定」。
4. 排班指派
   ```bash
   curl -X POST http://localhost:3000/api/schedules \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer <token>" \
     -d '{"employee":"<員工ID>","date":"2023-05-01","shiftId":"<班別ID>"}'
   ```
   前端：「排班管理」頁面選取員工與日期。
5. 員工登入
   ```bash
   curl -X POST http://localhost:3000/api/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"mary","password":"pass"}'
   ```
   前端：登入頁輸入員工帳密。
6. 員工打卡
   ```bash
   curl -X POST http://localhost:3000/api/attendance \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer <token>" \
     -d '{"action":"clockIn"}'
   ```
   前端：「出勤打卡」頁面點擊「上班簽到」。
7. 申請請假
   ```bash
   curl -X POST http://localhost:3000/api/approvals \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer <token>" \
     -d '{"formId":"<請假單ID>","data":{"start":"2023-05-02","end":"2023-05-03","type":"SICK"}}'
   ```
   前端：「申請中心」選擇請假表單送出。
8. 主管審核
   ```bash
   curl -X GET http://localhost:3000/api/approvals/inbox \
     -H "Authorization: Bearer <token>"
   ```
   前端：「待辦簽核」列表核准或退回。
9. 產生薪資報表
   ```bash
   curl http://localhost:3000/api/reports \
     -H "Authorization: Bearer <token>"
   ```
   前端：「報表中心」下載薪資報表。
10. 管理員登出
    ```bash
    curl -X POST http://localhost:3000/api/logout \
      -H "Authorization: Bearer <token>"
    ```
    前端：右上角選單點選「登出」。

### 班別設定

班別用於描述員工的工作時段，協助排班與出勤判定。常見欄位包括：

- **名稱**：顯示用的班別名稱，例如「早班」。
- **startTime**：上班時間（HH:mm）。
- **endTime**：下班時間（HH:mm）。
- **breakTime**：中場休息總時長。
- **crossDay**：是否跨日。

### 部門排班規則

部門層級除了基本資訊外，亦可設定排班規則，確保各部門的出勤策略與換班流程保持一致：

- **defaultTwoDayOff**：是否預設週休二日，供新排班時快速帶入休假節奏。
- **tempChangeAllowed**：是否允許臨時調班，用於控制換班審核流程。
- **deptManager**：排班管理者（由後端 `/api/dept-managers` 提供的清單），負責審核或調整班表。
- **scheduleNotes**：排班備註，用於記錄部門特殊需求或調班說明。

建立或更新部門時，以上欄位會與基本資訊一併提交至 `/api/departments`：

```bash
curl -X POST http://localhost:3000/api/departments \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name":"客服部",
    "organization":"<ORG_ID>",
    "defaultTwoDayOff":true,
    "tempChangeAllowed":false,
    "deptManager":"<EMP_ID>",
    "scheduleNotes":"需提前一週完成換班申請"
  }'
```

前端可在「機構與部門設定」>「部門管理」的編輯視窗中調整上述規則，儲存後即會同步至後端資料庫。

#### 操作範例

API 範例：

\`\`\`bash
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
\`\`\`

前端操作：於「排班與班別管理設定」>「班別設定」頁籤，使用「新增班別」建立，或在表格中點選「編輯」、「刪除」維護資料。

（目前尚未提供其他班別設定文件）

## 快速開始 (Quick Start)

### 環境需求

- **Node.js**: 20.x 或以上版本
- **MongoDB**: 4.x 或以上版本
- **npm**: 9.x 或以上版本

### 安裝步驟

#### 1. 複製專案

```bash
git clone https://github.com/lohchanhin/hr-system.git
cd hr-system
```

#### 2. 安裝依賴套件

在專案根目錄執行（會同時安裝前後端套件）：

```bash
npm install
```

或分別安裝：

```bash
# 安裝後端套件
cd server
npm install

# 安裝前端套件
cd ../client
npm install
```

#### 3. 設定後端環境變數

進入 `server/` 目錄，複製環境變數範例檔：

```bash
cd server
cp .env.example .env
```

編輯 `.env` 檔案，設定以下必要參數：

```env
# 伺服器埠號
PORT=3000

# MongoDB 連線字串
MONGODB_URI=mongodb://localhost:27017/hr-system

# JWT 密鑰（請務必更改為隨機字串）
JWT_SECRET=your-super-secret-jwt-key-change-this

# JWT 過期時間
JWT_EXPIRES_IN=7d

# 環境設定
NODE_ENV=development
```

#### 4. 設定前端環境變數（選用）

進入 `client/` 目錄，建立 `.env` 檔案：

```bash
cd client
touch .env
```

編輯 `.env` 檔案（選用）：

```env
# API 基礎路徑（開發環境可省略，預設會使用 Vite proxy）
VITE_API_BASE_URL=http://localhost:3000
```

#### 5. 生成測試資料

在專案根目錄或 server 目錄執行：

```bash
node server/scripts/seed.js
```

此腳本會自動建立：
- 9 位測試帳號（3 位主管 + 6 位員工）
- 完整的組織架構（2 個機構、4 個部門、12 個小組）
- 最近 60 天的考勤記錄
- 請假、加班、獎金申請記錄
- 2 個月的薪資記錄

**預設管理員帳號：**
- 帳號：`admin`
- 密碼：`password`

> 💡 所有測試帳號密碼均為 `password`，完整帳號清單會輸出到 `server/scripts/seed-accounts.json`

#### 6. 初始化勞健保級距表（重要）

```bash
curl -X POST http://localhost:3000/api/payroll/insurance/initialize
```

或在系統啟動後，透過管理介面進行初始化。

#### 7. 啟動應用程式

**方式一：同時啟動前後端（推薦）**

在專案根目錄執行：

```bash
npm run dev
```

**方式二：分別啟動**

終端機 1 - 啟動後端：
```bash
cd server
npm run dev
```

終端機 2 - 啟動前端：
```bash
cd client
npm run dev
```

#### 8. 存取應用程式

**開發模式：**
- **前端界面**：http://localhost:5173 （Vite 開發伺服器）
- **後端 API**：http://localhost:3000
- **API 文件**：參見 `/server/README.md` 或各 API 路由檔案

**生產模式（PM2）：**
- **統一訪問**：http://localhost:3000 （後端伺服器同時提供 API 和前端靜態檔案）

> 💡 **重要提示**：使用 PM2 啟動後，請訪問 port 3000 而非 5173。詳見 [PM2 部署指南](docs/PM2_DEPLOYMENT_GUIDE.md)。

使用預設管理員帳號 (`admin` / `password`) 登入系統即可開始使用。

### 開發模式

```bash
# 同時啟動前後端開發伺服器（支援熱重載）
npm run dev
```

### 建置正式版

```bash
# 建置前端靜態檔案
npm run build

# 方式一：使用 PM2 啟動（推薦用於正式環境）
npm run pm2:start

# 方式二：直接啟動
npm start
```

**使用 PM2 的優點**：
- 自動重啟機制
- 日誌管理
- 進程監控
- 開機自動啟動

> 📖 **詳細說明**：請參閱 [PM2 部署指南](docs/PM2_DEPLOYMENT_GUIDE.md)，包含：
> - PM2 啟動後的前端訪問方式
> - 環境變數設定最佳實踐
> - 常見問題排除
> - 完整部署流程

詳見「[使用 PM2 部署](#使用-pm2-部署推薦用於正式環境)」章節。

### 執行測試

```bash
# 執行所有測試（前端 + 後端）
npm test

# 僅執行後端測試
npm test --prefix server

# 僅執行前端測試
npm test --prefix client
```


## 部署指南 (Deployment)

### 部署至 Heroku

本專案已設定好 Heroku 部署所需的檔案。

#### 準備工作

1. 安裝 [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli)
2. 登入 Heroku：
   ```bash
   heroku login
   ```

#### 部署步驟

1. **建立 Heroku 應用程式**

   ```bash
   heroku create your-hr-system-name
   ```

2. **設定環境變數**

   ```bash
   # 設定 MongoDB 連線字串（建議使用 MongoDB Atlas）
   heroku config:set MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/hr-system
   
   # 設定 JWT 密鑰
   heroku config:set JWT_SECRET=your-super-secret-key-for-production
   
   # 設定 JWT 過期時間
   heroku config:set JWT_EXPIRES_IN=7d
   
   # 設定 Node 環境
   heroku config:set NODE_ENV=production
   ```

3. **推送程式碼到 Heroku**

   ```bash
   git push heroku main
   ```

   Heroku 會自動執行以下操作：
   - 安裝前後端依賴套件
   - 執行 `heroku-postbuild` 腳本建置前端
   - 啟動後端伺服器（根據 `Procfile` 設定）

4. **初始化資料**

   ```bash
   # 初始化勞健保級距表
   heroku run node server/scripts/initInsurance.js
   
   # （選用）生成測試資料
   heroku run node server/scripts/seed.js
   ```

5. **開啟應用程式**

   ```bash
   heroku open
   ```

#### Heroku 設定說明

**Procfile**：定義應用程式啟動指令
```
web: npm start --prefix server
```

**package.json**：定義建置流程
```json
{
  "scripts": {
    "heroku-postbuild": "npm run build --prefix client"
  }
}
```

後端會自動提供 `client/dist` 靜態檔案，所有非 `/api` 開頭的請求都會導向前端應用程式。

### 使用 PM2 部署（推薦用於正式環境）

> 📖 **完整指南**：詳細的 PM2 部署說明、訪問方式和疑難排解，請參閱 [PM2 部署指南](docs/PM2_DEPLOYMENT_GUIDE.md)。

本專案已配置 PM2 (Process Manager 2) 來管理 Node.js 應用程式的生命週期。PM2 提供了自動重啟、日誌管理、負載平衡等企業級功能。

**重要提醒**：
- PM2 啟動後，請訪問 **http://localhost:3000**（後端伺服器 port）
- 不需要訪問 port 5173（那是開發模式專用）
- 後端伺服器會同時提供 API 和前端靜態檔案

#### 前置準備

1. **安裝依賴套件**
   ```bash
   npm install
   ```

2. **建置前端**
   ```bash
   npm run build
   ```

3. **設定環境變數**
   
   確保 `server/.env` 檔案存在並包含必要的環境變數：
   ```bash
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/hr
   JWT_SECRET=your-secure-jwt-secret
   NODE_ENV=production
   ```

#### PM2 指令

在專案根目錄下執行以下指令：

```bash
# 啟動應用程式
npm run pm2:start

# 查看應用程式狀態
npm run pm2:status

# 查看即時日誌
npm run pm2:logs

# 重新啟動應用程式
npm run pm2:restart

# 停止應用程式
npm run pm2:stop

# 刪除應用程式
npm run pm2:delete
```

#### PM2 配置說明

PM2 配置檔案位於 `ecosystem.config.cjs`，包含以下設定：

- **應用程式名稱**：`hr-system`
- **啟動腳本**：`./server/src/index.js`
- **運行模式**：fork（單實例）
- **自動重啟**：啟用
- **日誌檔案**：
  - 標準輸出：`./logs/pm2-out.log`
  - 錯誤輸出：`./logs/pm2-error.log`

#### PM2 進階功能

**開機自動啟動**
```bash
# 生成啟動腳本
npx pm2 startup

# 儲存當前 PM2 進程列表
npx pm2 save
```

**監控和管理**
```bash
# 即時監控 CPU 和記憶體使用
npx pm2 monit

# 查看詳細資訊
npx pm2 describe hr-system

# 清空日誌
npx pm2 flush
```

**多實例運行（叢集模式）**

如需使用叢集模式提升效能，可修改 `ecosystem.config.cjs`：
```javascript
{
  instances: 4,  // 或使用 'max' 來使用所有 CPU 核心
  exec_mode: 'cluster'
}
```

### 部署至其他平台

#### Docker 部署

建立 `Dockerfile`：

```dockerfile
# 多階段建置
FROM node:20-alpine AS builder

# 建置前端
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# 建置後端
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --production
COPY server/ ./

# 最終映像
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/dist ./client/dist
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "src/index.js"]
```

建立 `docker-compose.yml`：

```yaml
version: '3.8'
services:
  mongodb:
    image: mongo:7
    restart: always
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: password
    volumes:
      - mongodb_data:/data/db
    ports:
      - "27017:27017"

  hr-system:
    build: .
    restart: always
    environment:
      - PORT=3000
      - MONGODB_URI=mongodb://admin:password@mongodb:27017/hr-system?authSource=admin
      - JWT_SECRET=your-secret-key
      - NODE_ENV=production
    ports:
      - "3000:3000"
    depends_on:
      - mongodb

volumes:
  mongodb_data:
```

啟動容器：
```bash
docker-compose up -d
```

#### VPS 部署（使用 Nginx）

1. **安裝必要軟體**
   ```bash
   # 安裝 Node.js 20
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # 安裝 MongoDB
   # 參考：https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/
   
   # 安裝 Nginx
   sudo apt-get install nginx
   
   # 安裝 PM2（程序管理器）
   sudo npm install -g pm2
   ```

2. **部署應用程式**
   ```bash
   # 克隆專案
   git clone https://github.com/lohchanhin/hr-system.git
   cd hr-system
   
   # 安裝依賴
   npm install
   
   # 設定環境變數
   cd server
   cp .env.example .env
   nano .env  # 編輯設定檔
   
   # 建置前端
   cd ../client
   npm run build
   
   # 啟動後端（使用 PM2）
   cd ../server
   pm2 start src/index.js --name hr-system
   pm2 save
   pm2 startup
   ```

3. **設定 Nginx 反向代理**
   ```nginx
   # /etc/nginx/sites-available/hr-system
   server {
       listen 80;
       server_name your-domain.com;
   
       location /api {
           # 員工照片、簽核附件要經過這裡上傳：Nginx 預設只允許 1MB，超過會直接回 413（伺服器本身最多收 5MB 照片 + 資料）
           client_max_body_size 8m;
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   
       location / {
           root /path/to/hr-system/client/dist;
           try_files $uri $uri/ /index.html;
       }
   }
   ```
   
   啟用設定：
   ```bash
   sudo ln -s /etc/nginx/sites-available/hr-system /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

4. **設定 SSL（使用 Let's Encrypt）**
   ```bash
   sudo apt-get install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

### 環境變數參考

| 變數名稱 | 說明 | 必填 | 預設值 |
|---------|------|------|--------|
| `PORT` | 後端伺服器埠號 | 否 | 3000 |
| `MONGODB_URI` | MongoDB 連線字串 | 是 | - |
| `JWT_SECRET` | JWT 簽章密鑰 | 是 | - |
| `JWT_EXPIRES_IN` | JWT 過期時間 | 否 | 7d |
| `NODE_ENV` | 執行環境 | 否 | development |
| `VITE_API_BASE_URL` | 前端 API 基礎路徑 | 否 | （使用相對路徑） |

## 維護與疑難排解

### 常見問題

#### 1. 無法連線到 MongoDB

**問題**：應用程式啟動時顯示 "Failed to connect to MongoDB"

**解決方法**：
- 確認 MongoDB 服務是否正在執行：`sudo systemctl status mongod`
- 檢查 `.env` 中的 `MONGODB_URI` 是否正確
- 確認防火牆是否允許 MongoDB 埠號（預設 27017）
- 如使用 MongoDB Atlas，確認 IP 白名單設定

#### 2. JWT Token 驗證失敗

**問題**：登入後操作顯示 "Unauthorized" 或 "Invalid token"

**解決方法**：
- 確認 `.env` 中的 `JWT_SECRET` 在前後端是否一致
- 檢查 Token 是否已過期（預設 7 天）
- 確認 Authorization Header 格式：`Bearer <token>`
- 清除瀏覽器快取和 LocalStorage

#### 3. 前端無法連接後端 API

**問題**：前端顯示網路錯誤或 404

**解決方法**：
- 檢查後端是否正常啟動：`curl http://localhost:3000/api/health`
- 確認 Vite proxy 設定（`client/vite.config.js`）
- 檢查 CORS 設定（`server/src/index.js`）
- 確認防火牆設定

#### 4. 考勤資料匯入失敗

**問題**：上傳 Excel 檔案後顯示格式錯誤

**解決方法**：
- 確認檔案格式為 `.xlsx` 或 `.csv`
- 檢查必要欄位是否存在：`USERID`、`CHECKTIME`、`CHECKTYPE`
- 確認日期時間格式正確
- 參考 [考勤匯入說明文件](docs/attendance-import.md)

#### 5. 薪資計算不正確

**問題**：薪資金額與預期不符

**解決方法**：
- 確認已初始化勞健保級距表
- 檢查員工基本薪資設定
- 確認考勤記錄正確
- 檢查請假扣款設定
- 參考 [薪資計算指南](docs/SALARY_CALCULATION_GUIDE.md)

### 日誌查看

**後端日誌**：
```bash
# PM2 日誌
pm2 logs hr-system

# 直接啟動時的日誌輸出在終端機
```

**前端日誌**：
- 開啟瀏覽器開發者工具（F12）
- 查看 Console 標籤

### 資料庫備份

**備份 MongoDB**：
```bash
# 匯出整個資料庫
mongodump --uri="mongodb://localhost:27017/hr-system" --out=/path/to/backup

# 匯出特定集合
mongodump --uri="mongodb://localhost:27017/hr-system" --collection=employees --out=/path/to/backup
```

**還原 MongoDB**：
```bash
# 還原整個資料庫
mongorestore --uri="mongodb://localhost:27017/hr-system" /path/to/backup/hr-system

# 還原特定集合
mongorestore --uri="mongodb://localhost:27017/hr-system" --collection=employees /path/to/backup/hr-system/employees.bson
```

### 效能優化建議

1. **資料庫索引**：確保常用查詢欄位建立索引（員工編號、日期等）
2. **快取機制**：對於不常變動的資料（如部門、班別）可考慮使用 Redis 快取
3. **分頁處理**：大量資料查詢時務必使用分頁
4. **圖片優化**：員工照片建議壓縮後再上傳
5. **定期清理**：定期清理過期的 Token、舊的日誌檔案


## 相關文件 (Documentation)

### 部署文件
- **[PM2 部署指南](docs/PM2_DEPLOYMENT_GUIDE.md)**：PM2 部署完整說明、訪問方式、環境變數設定

### 功能文件
- **[員工欄位說明](docs/employee.md)**：新增員工時需填寫的完整欄位說明
- **[考勤匯入說明](docs/attendance-import.md)**：考勤資料批次匯入格式與操作指南
- **[測試資料說明](docs/TEST_DATA_GUIDE.md)**：測試資料的詳細說明與驗證方法

### 薪資系統文件
- **[薪資計算系統](docs/PAYROLL_README.md)**：薪資系統完整使用指南
- **[薪資 API 文件](docs/PAYROLL_API.md)**：薪資相關 API 詳細說明
- **[薪資計算指南](docs/SALARY_CALCULATION_GUIDE.md)**：薪資計算邏輯與規則說明
- **[每月薪資調整項目設定](docs/monthly-salary-adjustments.md)**：動態設定每月固定薪資調整項目
- **[月薪資總覽 PDF 匯出](docs/MONTHLY_PAYROLL_PDF_EXPORT.md)**：月薪資總覽 PDF 匯出功能說明

### 夜班津貼相關
- **[夜班津貼實作](docs/night-shift-allowance-implementation.md)**：夜班津貼計算實作說明
- **[夜班津貼驗證指南](docs/NIGHT_SHIFT_VERIFICATION_GUIDE.md)**：如何驗證夜班津貼計算正確性
- **[夜班津貼明細](docs/NIGHT_SHIFT_ALLOWANCE_BREAKDOWN.md)**：夜班津貼計算細節

### 前後端文件
- **[後端 README](server/README.md)**：後端專案詳細說明
- **[前端 README](client/README.md)**：前端專案詳細說明

## 開發指南 (Development Guide)

### 程式碼規範

#### JavaScript/Vue 程式碼風格
- 使用 ES6+ 語法
- 使用 2 空格縮排
- 變數命名使用 camelCase
- 常數使用 UPPER_SNAKE_CASE
- 元件名稱使用 PascalCase

#### Git 提交訊息規範
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type 類型：**
- `feat`: 新功能
- `fix`: 修復錯誤
- `docs`: 文件更新
- `style`: 程式碼格式調整
- `refactor`: 重構
- `test`: 測試相關
- `chore`: 建置流程或輔助工具變動

**範例：**
```
feat(attendance): 新增批次匯入考勤功能

- 支援 Excel 和 CSV 格式
- 自動識別欄位對應
- 提供匯入預覽功能

Closes #123
```

### 分支策略

- `main`: 正式版本分支
- `develop`: 開發分支
- `feature/*`: 功能開發分支
- `bugfix/*`: 錯誤修復分支
- `hotfix/*`: 緊急修復分支

### 測試指南

#### 後端測試
```bash
cd server

# 執行所有測試
npm test

# 執行特定測試檔案
npm test -- tests/employee.test.js

# 顯示測試覆蓋率
npm test -- --coverage
```

#### 前端測試
```bash
cd client

# 執行所有測試
npm test

# 執行測試並監聽變更
npm test -- --watch

# 顯示測試覆蓋率
npm test -- --coverage
```

### 新增功能開發流程

1. **建立功能分支**
   ```bash
   git checkout -b feature/new-feature-name
   ```

2. **後端開發**
   - 在 `server/src/models/` 建立或修改資料模型
   - 在 `server/src/controllers/` 新增控制器
   - 在 `server/src/routes/` 新增路由
   - 在 `server/src/services/` 新增業務邏輯（如需要）
   - 在 `server/tests/` 新增測試

3. **前端開發**
   - 在 `client/src/api.js` 新增 API 呼叫方法
   - 在 `client/src/components/` 新增或修改元件
   - 在 `client/src/views/` 新增或修改頁面
   - 在 `client/src/router/` 新增路由（如需要）
   - 在 `client/tests/` 新增測試

4. **測試與除錯**
   ```bash
   # 執行測試
   npm test
   
   # 手動測試
   npm run dev
   ```

5. **提交變更**
   ```bash
   git add .
   git commit -m "feat(scope): description"
   git push origin feature/new-feature-name
   ```

6. **建立 Pull Request**
   - 前往 GitHub 建立 PR
   - 填寫 PR 描述
   - 等待 CI 通過
   - 請求 Code Review

## 貢獻指南 (Contributing)

我們歡迎任何形式的貢獻！

### 如何貢獻

1. **Fork 專案**
2. **建立功能分支** (`git checkout -b feature/amazing-feature`)
3. **提交變更** (`git commit -m 'feat: Add amazing feature'`)
4. **推送到分支** (`git push origin feature/amazing-feature`)
5. **建立 Pull Request**

### Pull Request 檢查清單

- [ ] 程式碼遵循專案的程式碼風格
- [ ] 已新增或更新相關測試
- [ ] 所有測試都通過
- [ ] 已更新相關文件
- [ ] Commit 訊息遵循規範
- [ ] 沒有合併衝突

### 回報問題

如果發現錯誤或有功能建議，請：

1. 檢查 [Issues](https://github.com/lohchanhin/hr-system/issues) 是否已有類似問題
2. 如果沒有，建立新的 Issue
3. 提供詳細的問題描述、重現步驟、預期行為等資訊

## 權限&機構&部門設定

以下提供後台管理三項基本設定的主要 API 路徑，並說明各路徑預期使用角色：

| 功能               | API 路徑           | 需要角色          |
|--------------------|-------------------|-----------------|
| 機構設定           | `/api/menu`        | 任一登入角色 |
| 部門／單位維護     | `/api/departments` | `admin`       |
| 帳號與權限管理     | `/api/users`       | `admin`       |

在前端畫面中，可於「人事管理與系統設定」頁籤找到上述功能。具備管理權限的使用者才能透過這些介面新增或修改機構、部門及帳號資料，其他角色僅能讀取相關資訊。

## CI/CD

### GitHub Actions

專案已設定 GitHub Actions，會在推送與 Pull Request 時自動執行測試。

**工作流程檔案**：`.github/workflows/node.yml`

**觸發條件**：
- Push 到任何分支
- Pull Request 到 `main` 分支

**執行項目**：
- 安裝依賴套件
- 執行後端測試
- 執行前端測試
- 檢查程式碼品質

若 Fork 本專案，請至 GitHub 倉庫的 **Actions** 分頁啟用此流程。

## 授權 (License)

本專案目前未提供授權，所有權利保留。

## 支援與聯繫 (Support)

如有任何問題或建議，歡迎透過以下方式聯繫：

- **Issues**：[GitHub Issues](https://github.com/lohchanhin/hr-system/issues)
- **Email**：請透過 GitHub 個人檔案聯繫專案維護者

## 致謝 (Acknowledgments)

感謝所有貢獻者對本專案的支持與協助！

### 使用的開源專案

- [Vue.js](https://vuejs.org/) - 漸進式 JavaScript 框架
- [Express](https://expressjs.com/) - Node.js Web 應用框架
- [MongoDB](https://www.mongodb.com/) - NoSQL 資料庫
- [Element Plus](https://element-plus.org/) - Vue 3 UI 元件庫
- [Vite](https://vitejs.dev/) - 新世代前端建置工具

## 版本歷程 (Changelog)

請參閱 [Releases](https://github.com/lohchanhin/hr-system/releases) 頁面查看詳細的版本更新記錄。

---

**最後更新**：2025-12-26  
**版本**：1.0.0  
**維護者**：[lohchanhin](https://github.com/lohchanhin)
