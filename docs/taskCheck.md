# 功能檢查任務清單

## 考勤系統

### 系統管理員
- **功能使用流程**
  1. 以系統管理員角色登入後台，透過選單進入「出勤管理」相關畫面（`AttendanceManagementSetting.vue`、`AttendanceSetting.vue`）。
  2. 於「出勤管理」設定異常判定、分段打卡與加班規則，確認必要欄位（容許遲到分鐘、缺卡判斷時間等）皆完成填寫。
  3. 透過後台測試員工帳號授權，確認可呼叫 `/api/attendance-settings` 取得規則設定，班別資料改由 `ShiftScheduleSetting.vue` 操作 `/api/shifts`。
- **檢查清單**
  - [ ] 後台畫面 `AttendanceManagementSetting.vue` 成功載入 `GET /api/attendance-settings` 之設定資料。
  - [ ] 更新設定時請求 `PUT /api/attendance-settings/:id` 回傳 200，並由 `attendanceSettingController.updateSetting` 實際寫入。
  - [ ] 班別維護改於 `ShiftScheduleSetting.vue` 透過 `/api/shifts` 完成，確認新增後畫面重新整理即可顯示於班表。
  - [ ] 確認授權設定為管理員專屬（`authorizeRoles('admin')`），避免一般使用者誤觸。

### 主管
- **功能使用流程**
  1. 以主管帳號登入前台「出勤打卡」畫面（`Attendance.vue`）。
  2. 使用員工篩選條件查詢部屬出勤紀錄，必要資料包含查詢月份與員工姓名／編號。
  3. 若需補登紀錄，透過主管授權呼叫 `POST /api/attendance` 建立補登資料。
- **檢查清單**
  - [ ] 在 `Attendance.vue` 觸發 `GET /api/attendance?employee=:id` 後，由 `attendanceController.listRecords` 回傳部屬紀錄並包含 `employee` 資訊。
  - [ ] 補登打卡透過 `POST /api/attendance` 由 `attendanceController.createRecord` 成功建立，並於畫面重新整理後可見新紀錄。
  - [ ] 未指定 `employee` 參數時，確認 API 自動帶入主管本人或拒絕跨部門資料。
  - [ ] 確認主管僅能看到授權部門員工，避免越權存取。

### 一般員工
- **功能使用流程**
  1. 以一般員工角色登入前台「出勤打卡」畫面（`Attendance.vue`）。
  2. 透過「立即打卡」按鈕送出 `POST /api/attendance` 請求，系統自動帶入使用者 ID 與當前時間。
  3. 使用畫面篩選條件查看個人歷史紀錄，確保資料僅限本人。
- **檢查清單**
  - [ ] `Attendance.vue` 初始化時呼叫 `GET /api/attendance`，由 `attendanceController.listRecords` 僅回傳登入者資料。
  - [ ] 打卡成功後 API 回傳 201，畫面將新紀錄插入列表頂端。
  - [ ] 若缺少權限或重複打卡，系統須回覆錯誤訊息並提示使用者。
  - [ ] 行動裝置與桌面版流程一致，避免漏測多裝置操作。

## 排班系統

### 系統管理員
- **功能使用流程**
  1. 登入後台並進入「班表設定」畫面（`ShiftScheduleSetting.vue`）維護班別與假別代碼。
  2. 切換至前台「排班管理」頁（`Schedule.vue`），選擇部門後執行批次匯入或新增班表。
  3. 確認系統允許管理員存取所有部門，授權涵蓋 `/api/schedules`、`/api/schedules/batch`、`/api/schedules/export` 等 API。
- **檢查清單**
  - [ ] `AttendanceSetting.vue` 讀寫 `/api/attendance-settings` 時，由 `attendanceSettingController` 正確處理出勤規則的新增、更新與刪除。
  - [ ] 在 `Schedule.vue` 透過 `POST /api/schedules/batch`（`scheduleController.createSchedulesBatch`）建立班表後，表格呈現與資料庫一致。
  - [ ] 匯出班表時 `GET /api/schedules/export` 回傳預期格式，檔名符合月份與部門命名規則。
  - [ ] 管理員切換部門時，確認後端無權限錯誤，`authorizeRoles('supervisor', 'admin')` 設定正確。
  - [ ] 後台「班表總覽」頁（`ScheduleOverview.vue`）載入 `GET /api/schedules/overview` 時，回傳結構須包含 `month`、`days` 與巢狀 `organizations` → `departments` → `subDepartments` → `employees`。
  - [ ] 篩選條件（月份、機構、部門、小單位）更新後會重新呼叫 `/api/schedules/overview`，前端表格內容同步更新且呈現所有日期欄位。
  - [ ] 以非系統管理員身分請求 `/api/schedules/overview` 應獲得 403，驗證路由 `ScheduleOverview` 與選單項目僅授權 admin。
  - [ ] 後台選單新增「班表總覽」選項可導向 `/manager/schedule-overview`，重新整理後路由仍維持權限控制。

### 主管
- **功能使用流程**
  1. 主管登入前台並開啟「排班管理」頁（`Schedule.vue`）。
  2. 於左側部門樹選擇負責部門，設定查詢月份後載入班表與請假資訊。
  3. 透過單日編輯或拖曳方式更新部屬班別，必要資料包含員工、日期與班別代碼。
- **檢查清單**
  - [ ] `Schedule.vue` 讀取 `GET /api/schedules?month=YYYY-MM&supervisor=:id` 由 `scheduleController.listSchedules` 僅回傳所屬部門資料。
  - [ ] 編輯班表觸發 `PUT /api/schedules/:id`（`scheduleController.updateSchedule`）後，重新查詢可見最新資料。
  - [ ] `GET /api/schedules/summary` 呼叫 `scheduleController.listSupervisorSummary` 能顯示部門排班統計。
  - [ ] 更新時若遇員工請假或跨部門衝突，畫面能顯示 `scheduleController.createSchedulesBatch` 回傳之錯誤訊息。

### 一般員工
- **功能使用流程**
  1. 員工登入前台並開啟「我的班表」頁（`MySchedule.vue`）。
  2. 選擇查詢月份後，系統自動呼叫 `/api/schedules/monthly` 取得個人班表。
  3. 透過切換視圖或匯出功能（若被授權）下載個人班表。
- **檢查清單**
  - [ ] `MySchedule.vue` 呼叫 `GET /api/schedules/monthly?month=YYYY-MM` 時，由 `scheduleController.listMonthlySchedules` 僅回傳登入者資料。
  - [ ] 當月份無排班時，畫面顯示友善提示而非錯誤。
  - [ ] 匯出個人班表按鈕應受權限保護，無權匯出時不顯示或禁用。
  - [ ] 月份切換後自動重新抓取資料，確保 watch 事件觸發成功。

## 簽核系統

### 系統管理員
- **功能使用流程**
  1. 以系統管理員角色登入後台，於「簽核流程設定」畫面（`ApprovalFlowSetting.vue`）維護表單樣板、欄位與流程關卡。
  2. 建立或更新樣板時依序呼叫 `POST /api/approvals/forms`、`PUT /api/approvals/forms/:id` 與 `PUT /api/approvals/forms/:id/workflow`，確保階段條件與通知人員皆設定完成。
  3. 送出設定後透過 API 回覆確認 `approvalTemplateController`、`approvalRequestController` 中的權限驗證（`authorizeRoles('admin')`）通過，並再次載入列表驗證資料。
- **檢查清單**
  - [ ] `ApprovalFlowSetting.vue` 載入時呼叫 `GET /api/approvals/forms` 並正確呈現現有樣板。
  - [ ] 更新流程關卡後，後端 `approvalTemplateController.updateWorkflow` 實際寫入，重新整理仍維持設定。
  - [ ] 操作需具備 `authorizeRoles('admin')` 授權，未授權帳號應收到 403 並顯示提示。
  - [ ] 新增或刪除表單時，確認 `approvalRequestController` 無遺留舊流程引用，避免壞掉的簽核流程。

### 主管
- **功能使用流程**
  1. 主管登入前台 `views/front/Approval.vue`，切換至「待我簽核」頁籤載入 `GET /api/approvals/inbox` 工作清單。
  2. 開啟任一簽核案件後檢視申請明細與歷史紀錄，確認簽核順序與所需附件完整。
  3. 依案件狀態執行 `POST /api/approvals/:id/act`，選擇核可、退簽或否決並確認操作成功，必要時輸入原因。
- **檢查清單**
  - [ ] 「待我簽核」頁籤能正確過濾屬於主管的案件，API 回應來源為 `approvalRequestController.listInbox`。
  - [ ] 執行核可/退簽/否決後，`approvalRequestController.act` 返回 200 並於列表中移除或更新狀態。
  - [ ] 動作需符合 `authorizeRoles('employee', 'supervisor', 'admin')` 授權規範，未授權操作返回 403 並顯示訊息。
  - [ ] 退簽時確認回傳資料包含下一步處理人與備註，避免流程卡住。

### 一般員工
- **功能使用流程**
  1. 一般員工登入 `views/front/Approval.vue` 的「申請表單」頁籤，選擇適用的簽核樣板並填寫必填欄位。
  2. 送出表單時呼叫 `POST /api/approvals` 建立簽核申請，系統顯示送出結果與下一位簽核人。
  3. 於「我的申請」頁籤透過 `GET /api/approvals` 查看案件進度，若發生錯誤（欄位缺失或流程設定問題）需依提示修正後重送。
- **檢查清單**
  - [ ] 建立申請時 `approvalRequestController.create` 成功返回案件編號，畫面呈現提交成功訊息。
  - [ ] 查詢列表時確認僅顯示登入者的申請，`authorizeRoles('employee', 'supervisor', 'admin')` 授權涵蓋所有可申請角色。
  - [ ] 當後端回傳驗證錯誤（400/422）或流程不存在（404）時，前端顯示清楚錯誤與重新送出機制。
  - [ ] 撤回或重新送件需觸發對應 API，並確認錯誤處理不會導致表單資料遺失。

## 報表匯出

### 系統管理員
- **功能使用流程**
  1. 登入前台並開啟「部門報表」頁（`DepartmentReports.vue`）。
  2. 選取報表類型（預設出勤統計）、月份、部門與匯出格式。
  3. 送出匯出請求，呼叫 `GET /api/reports/department/attendance/export`（`reportController.exportDepartmentAttendance`）取得檔案。
- **檢查清單**
  - [ ] `DepartmentReports.vue` 預覽按鈕可載入 `application/json` 回應並呈現摘要資料。
  - [ ] 匯出 Excel/PDF 時 `reportController.exportDepartmentAttendance` 能依 `format` 參數回傳檔案，HTTP 標頭包含正確 `content-disposition`。
  - [ ] 未填月份或部門時 API 回傳 400，畫面提示使用者補齊條件。
  - [ ] 管理員可跨部門匯出，驗證返回資料與排班、出勤資料一致。

### 主管
- **功能使用流程**
  1. 以主管身份進入「部門報表」頁（`DepartmentReports.vue`），系統自動限制可選部門為所屬部門。
  2. 選擇月份後先執行預覽，確認統計資料無誤。
  3. 需要正式資料時再執行匯出，下載檔案後轉交管理層。
- **檢查清單**
  - [ ] 主管選擇非所屬部門時，`exportDepartmentAttendance` 回傳 403 並在畫面顯示禁止訊息。
  - [ ] 預覽資料與 `GET /api/schedules/summary` 結果一致，避免統計錯誤。
  - [ ] 匯出後檔名包含部門與月份，符合 `DepartmentReports.vue` 內的命名規則。
  - [ ] 匯出請求具備授權標頭（token），確保前端在 apiFetch 時帶入。

### 一般員工
- **功能使用流程**
  1. 嘗試以一般員工角色進入「部門報表」頁時，路由守衛應導向 403 頁面。
  2. 若透過網址直接呼叫 `GET /api/reports/department/attendance/export`，應回傳 403 禁止存取。
  3. 若需報表資料，改由主管匯出後提供。
- **檢查清單**
  - [ ] 路由 `DepartmentReports` 的 `meta.roles` 未包含 `employee`，測試一般員工登入後確實被導向 `/403`。
  - [ ] 直接呼叫匯出 API，`reportController.exportDepartmentAttendance` 依 `authorizeRoles('admin', 'supervisor')` 拒絕，HTTP 狀態為 403。
  - [ ] 測試腳本覆蓋此權限情境（如新增 e2e 檢查），避免權限放寬。
  - [ ] 文件告知員工向主管申請報表，確保流程一致。
