# 排班人員與小單位的使用班別

客戶 2026/10/23「迦南人資系統-重大調整」：

- R1「在系統管理者部門設定最小單位增加 **排班人員** 設定，該指定人員帳號進去後，才能看到排班頁面功能。即原本所謂之主管帳號將與排班功能切開，維持主管欄位，主要作為簽核使用」；對話補充「建立專屬排班帳號」「打破組織架構，可以設定是否排班者，如果是排班者可以排班的範圍」「篩選只能看到自己該看的班別」。
- R3「在小單位設定下面多一個，**使用排班班表**，可複選，該單位人員帳號登入後，僅能看到由此所選擇的排班表單（班別）」。
- R2 的「使用簽核表單」設定畫面也在同一頁（部門設定），表單的篩選規則見簽核表單的說明。

開發端的決定：一位排班人員可以被指定到任意多個小單位（不限範圍）；**不會自動把現在的主管設成排班人員**，只是「加上」這個功能，主管原本的排班權限照舊（可以用下方的「排班權限」設定切開）；小單位沒有選班別時代表全部班別。

## 誰可以排班、可以排誰

| 身分 | 可以排班 | 範圍 |
| --- | --- | --- |
| 管理員 | 是 | 全部 |
| 主管（預設） | 是 | 自己與直屬部屬（原本的規則） |
| 主管（排班權限設成「只有排班人員」） | 只有被指定為排班人員時 | 只有被指定的小單位 |
| 小單位的「排班人員」（任何角色，含一般員工） | 是 | 被指定小單位的所有員工 |
| 部門的「排班管理者」（舊欄位 `deptManager`） | 是 | 整個部門：所有小單位，以及沒有小單位的員工 |
| 其他員工 | 否 | 只看得到自己的班表（我的排班） |

- 同時具備多種身分時範圍取**聯集**，例如主管又被指定為另一部門某小單位的排班人員，就同時排自己的直屬部屬與那個小單位。
- 排班人員自己不一定在被指定的小單位裡；不在的話，排班頁不會列出自己，也不能排自己的班（自己的班表仍在「我的排班」看得到）。
- 「部門主管」「主管」欄位與員工資料的直屬主管**不受影響**，仍然只作為簽核使用。
- 排班範圍同時用在排班頁的「相關簽核」、國定假日休假紀錄、簽核單明細（申請人在範圍內就看得到）、假別餘額與調休存摺（範圍內的員工），和原本「主管看直屬部屬」是同一個範圍函式。

## 設定畫面

**權限&機構&部門設定**（`OrgDepartmentSetting.vue`）：

- 小單位 > 排班設定：
  - **排班人員**：可複選、可搜尋，選單是所有在職員工（任何角色，顯示員工代號）；已指定的人之後離職或停用，仍顯示「（已停用）」讓管理員移除，被刪除的員工顯示「已刪除的員工」。
  - **使用班別**：可複選；沒有選代表全部班別。選了班別卻沒有任何不用上班的班別（休息日、例假、國定假日、請假）時提醒「排班時將無法排休」，仍可儲存。
  - 小單位列表多兩欄「排班人員」「使用班別」。
- 部門 > 排班規則 > **排班管理者**：保留原本的欄位，選單改成任何員工（可搜尋），說明它可以排整個部門。
- 部門 > 簽核表單 > **使用簽核表單**：可複選啟用中的表單（已選的停用表單顯示「（已停用）」）；沒有選代表全部表單。部門列表多一欄「使用簽核表單」（全部表單／N 張表單）。

**其他控制設定 > 排班權限**（`ScheduleAccessSetting.vue`，設定鍵 `scheduleAccessMode`）：

- `supervisor_and_scheduler`（預設，與原本相同）：主管與排班人員都能排班。
- `scheduler_only`：只有被指定的排班人員能排班，主管只負責簽核。切換前會確認；沒被指定的主管選單裡不再有「排班管理」，進入排班頁會被擋下，排班相關 API 回 403。
- API（只有管理員）：`GET /api/other-control-settings/schedule-access` → `{ mode, modes, defaultMode }`；`PUT` 同路徑 `{ mode }`，其他值回 400。設定存在其他控制設定的同一份文件（`OtherControlSetting`），沒有存過就是預設值。
- 指派或模式改變後，已登入的使用者**重新整理頁面**（或重新登入）後選單與排班頁才會跟著變；伺服器的權限檢查每次請求都即時生效。

## 資料欄位

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `SubDepartment.schedulers` | `[ObjectId → Employee]`，預設 `[]` | 排班人員 |
| `SubDepartment.allowedShiftIds` | `[String]`（`AttendanceSetting.shifts` 的 `_id`），預設 `[]` | 使用班別，空陣列 = 全部 |
| `Department.allowedFormIds` | `[ObjectId → FormTemplate]`，預設 `[]` | 使用簽核表單，空陣列 = 全部 |
| `Department.deptManager` | `String`（員工 `_id`） | 舊欄位，視為整個部門的排班人員 |

- 新增、修改小單位與部門時，伺服器檢查格式與是否存在（員工、班別設定、表單），重複的去掉；**沒有送的欄位不會被清掉**（舊版畫面修改其他欄位時不影響設定）。
- 舊資料沒有這些欄位，讀到時就是「沒有指定／全部」，所以**不需要補資料的啟動移轉**。啟動時只記錄一行有設定「排班管理者」的部門數（`Departments whose schedule manager (deptManager) can now schedule the whole department: N`），不修改資料。
- **行為變更**：以前「排班管理者」只用在部門報表；現在被設定的人也能排整個部門的班。部署前可以先在部門設定檢查這個欄位。

## 伺服器

`server/src/services/scheduleAccessService.js`：

- `getScheduleAccess(user)` → `{ canSchedule, mode, supervisorScope, subDepartmentIds, departmentIds, wholeDepartmentIds, employeeIds, isAdmin }`
  - `employeeIds`：可以排的員工（主管範圍與排班人員範圍的聯集）；管理員是全部，這裡留空陣列，請看 `isAdmin`。
  - `subDepartmentIds`：被指定的小單位，加上「排班管理者」部門底下的所有小單位；`wholeDepartmentIds`：擔任排班管理者的部門；`departmentIds`：兩者涉及的部門（排班頁的部門篩選）。這三個只列排班人員的指派，不含主管範圍。
  - `mode`：只有主管需要讀設定，其他角色是 `null`。
- `getScheduleAccessSummary(user)`：同上但不展開員工名單（選單、個人資料、權限檢查用）。`getScheduleAccessForRequest(req)`／`getScheduleAccessSummaryForRequest(req)`：同一個請求只查一次。
- `getAllowedShiftIdsFor({ subDepartmentIds })` → 班別 `_id` 陣列，空陣列 = 全部（任一小單位沒有設定就是全部，否則取聯集）。
- `isEmployeeInScheduleScope(access, actorId, employee)`：依員工資料逐筆判斷（新增、修改、刪除班表的檢查用）。

權限檢查改成看「排班權限」而不是角色（`middleware/scheduleAccess.js` 的 `requireScheduleAccess`）：

- `/api/schedules` 的所有寫入（新增、批次、修改、刪除、批次刪除、發布、完成發布、匯入、日期備忘錄）、匯出、排班檢核與完整性檢查：有排班權限的人（員工角色的排班人員也可以）。員工回覆自己的班表不需要排班權限。
- 新增、修改、刪除班表（`middleware/supervisor.js`）：每位員工都要在範圍內；修改、刪除既有班表時，原本那位員工也要在範圍內。
- `GET /api/schedules/summary`（主管統計）：有排班權限的非管理員（管理員維持原本不開放），統計直屬部屬與被指定小單位的員工。
- `GET /api/sub-departments`：管理員、主管與排班人員（排班頁的單位篩選）；寫入只有管理員。
- `GET /api/employees/schedule`（排班頁名單）：只有主管身分時維持原本的查詢；排班人員是範圍內的員工；沒有排班權限只有自己。
- `GET /api/schedules/monthly`、`/leave-approvals`、國定假日休假紀錄：看得到自己，再加上排班範圍。國定假日休假紀錄的匯出與登記處理方式開放給排班人員（不含自己）。
- 完整性檢查（`/validate`、`/incomplete`、`/can-finalize`）：非管理員只檢查自己可以排的員工（以前主管可以查任何部門）。
- `GET /api/menu`：排班人員（任何角色）有「排班管理」；被切開的主管沒有。
- `GET /api/profile` 與登入回應多 `scheduleAccess: { canSchedule, supervisorScope, subDepartmentIds, departmentIds, wholeDepartmentIds }`。
- `GET /api/dept-managers`（排班管理者／排班人員的選單）：所有員工（任何角色），附 `employeeId`、`role`、`active`（離職、留職停薪或停用帳號是 `false`）。

**使用班別**：非管理員新增、批次、修改班表與匯入時，班別必須是該小單位開放的班別（小單位以班表上的為準，沒有就用員工所屬小單位；沒有設定的小單位不限制）。不允許時回 400 `SHIFT_NOT_ALLOWED`，訊息例如「「B1 病房」沒有開放使用這個班別，請改選小單位設定的使用班別」；匯入則逐格列為錯誤「「B1 病房」沒有開放使用「D」這個班別」。只檢查這次真的換了班別的格子，之後才改設定的既有班表照樣能存。管理員不受限制。

## 前台

- 路由（`client/src/router/index.js`）：排班頁與預覽頁（`meta.allowScheduler`）依個人資料的 `scheduleAccess.canSchedule` 決定能不能進入：員工角色的排班人員可以進入，被切開的主管不能（提示「您沒有排班權限，請聯絡管理員在小單位設定排班人員」）；讀不到排班權限時維持原本「主管、管理員」的限制。管理員一律可以。
- 排班頁（`Schedule.vue`，範圍判斷在 `utils/scheduleScope.js`）：
  - 排班人員只看得到被指定的部門與小單位；被指定到不同部門時部門篩選可以切換（原本部門固定在主管自己的部門，只有主管身分時照舊）。
  - 管理員看全部：以前前台排班頁會把管理員自己的 id 當成主管篩選，只列出直屬於管理員的人（通常是空的）；現在不再帶這個篩選，部門篩選也可以切換。
  - 編輯功能（發布、套用、國定假日休假等）依排班權限顯示。
  - 班別下拉、套用班別與圖例只列正在看的小單位的使用班別（沒有設定就是全部）；既有班表的班別名稱與顏色照樣用完整的班別設定顯示。換到另一個小單位時，原本選的「套用班別」不在可用班別內就清掉。

## 沒有改的部分

- 部門報表的權限不變：仍只開放主管與管理員，主管是部門的「排班管理者」時可以看該部門的報表（原本的規則）；小單位的排班人員不因此取得報表權限。
- 班表總覽（後台）仍只有管理員。

## 測試

- `server/tests/scheduleAccessService.test.js`：各種身分的範圍、排班權限模式、使用班別。
- `server/tests/schedulerAccessRoutes.test.js`：員工角色的排班人員（兩個不同部門的小單位）看得到、排得到的員工；主管的原本範圍與 `scheduler_only`；管理員；使用班別；部門的使用簽核表單；選單、個人資料。
- `server/tests/holidayLedgerController.test.js`：國定假日休假紀錄的排班人員範圍。
- `server/tests/schedulerAccess.integration.test.js`：真的 Express app + 真的 MongoDB（單機）的端到端測試，預設略過；執行方式同其他整合測試：`APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:<port> npm test -- tests/schedulerAccess.integration.test.js`。
- 前台：`client/src/utils/__tests__/scheduleScope.test.js`、`client/tests/routerScheduleAccess.spec.js`、`client/tests/scheduleSchedulerScope.spec.js`、`client/tests/orgDepartmentSetting.spec.js`、`client/tests/scheduleAccessSetting.spec.js`。
