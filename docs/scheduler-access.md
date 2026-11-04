# 排班人員與小單位的使用班別

客戶 2026/10/23「迦南人資系統-重大調整」：

- R1「在系統管理者部門設定最小單位增加 **排班人員** 設定，該指定人員帳號進去後，才能看到排班頁面功能。即原本所謂之主管帳號將與排班功能切開，維持主管欄位，主要作為簽核使用」；對話補充「建立專屬排班帳號」「打破組織架構，可以設定是否排班者，如果是排班者可以排班的範圍」「篩選只能看到自己該看的班別」。
- R3「在小單位設定下面多一個，**使用排班班表**，可複選，該單位人員帳號登入後，僅能看到由此所選擇的排班表單（班別）」。
- R2 的「使用簽核表單」設定畫面也在同一頁（部門設定），表單的篩選規則見簽核表單的說明。

客戶 2026/10/31 更新（第 1 項「已完成-部分需調整」）與對話：「主管帳號(非排班)…他為（某員工）的主管，但因非設定為排班人員，所以登入後的左側列表應該無排班管理」；「如果現在兩個單位設同一個排班人員，可以用切換的去排班，就不用開兩個帳號了」；排班頁左上「直屬員工數」的「直屬」兩個字改為「排班」。

開發端的決定：一位排班人員可以被指定到任意多個小單位（不限範圍，可以跨部門、跨機構），在排班頁用部門、小單位篩選切換；**不會自動把現在的主管設成排班人員**。2026/11 起「排班權限」的**預設改成只有排班人員能排班**（`scheduler_only`）：沒被指定的主管沒有「排班管理」，但主管欄位照舊作為簽核使用（收到、簽核直屬部屬的單，看得到他們的假別餘額與調休存摺）；管理員明確存成「主管與排班人員」（`supervisor_and_scheduler`）就回到 dbcd121 的做法。小單位沒有選班別時代表全部班別。部門的「排班管理者」（`deptManager`）就是先前的排班指派功能，兩種模式都是整個部門的排班人員（見下方「部門的排班管理者」）。

## 誰可以排班、可以排誰

| 身分 | 可以排班 | 範圍 |
| --- | --- | --- |
| 管理員 | 是 | 全部 |
| 主管（預設：排班權限沒有存過，或存成「只有排班人員」） | 只有被指定為排班人員時 | 只有被指定的小單位 |
| 主管（排班權限存成「主管與排班人員」） | 是 | 自己與直屬部屬（dbcd121 的規則） |
| 小單位的「排班人員」（任何角色，含一般員工） | 是 | 被指定小單位的所有員工 |
| 部門的「排班管理者」（舊欄位 `deptManager`，兩種模式都一樣） | 是 | 整個部門：所有小單位，以及沒有小單位的員工 |
| 其他員工 | 否 | 只看得到自己的班表（我的排班） |

- 同時具備多種身分時範圍取**聯集**，例如主管又被指定為另一部門某小單位的排班人員，就同時排自己的直屬部屬（模式允許時）與那個小單位。
- 排班人員自己不一定在被指定的小單位裡；不在的話，排班頁不會列出自己，也不能排自己的班（自己的班表仍在「我的排班」看得到）。
- 員工資料的直屬主管（`Employee.supervisor`）**不受影響**，簽核的「主管」關卡找的就是它。部門與小單位的「部門主管」只是文字欄位，沒有任何功能讀取（小單位設定已不顯示，見下方「小單位設定的欄位」）。

### 唯讀範圍（和能不能排班分開）

排班範圍只決定排班頁與排班 API。簽核單明細、附件、假別餘額、調休存摺看的是登入者和員工的**關係**（`controllers/schedule/scheduleShared.js` 的 `resolveEmployeeReadAccess`），不論排班權限模式：

| 關係 | 簽核單明細 | 附件 | 假別餘額 | 調休存摺 |
| --- | --- | --- | --- | --- |
| 本人、管理員、簽核人（單據上的參與者） | 是 | 是 | 是 | 是（含人資備註；簽核人看簽核明細附的存摺，不含備註） |
| 主管角色看直屬部屬（`Employee.supervisor` 是自己） | 任何表單（唯讀） | 是 | 是 | 是，含人資備註 |
| 只因為排班範圍看得到（小單位的排班人員、部門的排班管理者） | 只有請假、加班、換班單（表單性質 `leave`／`overtime`／`shift_change`；沒有性質的舊表單看名稱） | 否 | 是（請假單明細本來就附上） | 是，**不含人資備註** |
| 其他人 | 404 | 404 | 404 | 404 |

- 這是 2026/11 的修正：以前這些都用排班範圍判斷，切成「只有排班人員」時主管就看不到直屬部屬的單據與餘額；員工角色的排班人員反過來看得到被指定小單位員工的所有表單（含離職申請的原因與附件）。
- 排班頁的「相關簽核」（`GET /api/schedules/leave-approvals`）同一條規則：自己與直屬部屬的單全部列出，只因為排班範圍看得到的員工只列請假、加班、換班單。
- 國定假日休假紀錄、月班表（`/api/schedules/monthly`）仍看排班範圍（加上自己），它們只在排班頁使用。

## 設定畫面

**權限&機構&部門設定**（`OrgDepartmentSetting.vue`）：

- 小單位 > 排班設定：
  - **排班人員**：可複選、可搜尋，選單是所有在職員工（任何角色，顯示員工代號）；已指定的人之後離職或停用，仍顯示「（已停用）」讓管理員移除，被刪除的員工顯示「已刪除的員工」。
  - **排班人員**的說明：被指定的員工才看得到排班頁；簽核找的是員工資料設定的直屬主管，不受排班人員影響。
  - **使用班別**：可複選，選單**只列上班的班別**；沒有選代表全部班別。不用上班的班別（休息日、例假、國定假日、請假，以及沒有工作時間的班別）**一律可以使用，不必選**（2026/11 客戶要求，以前選了班別卻沒有休息類班別會提醒「排班時將無法排休」，這個提醒拿掉了）。
    - 舊設定選過的休息類班別照樣保留（存回去不影響，反正一律允許）；改了選擇時連同保留的一起送出，全部取消就是「全部班別」（存成空陣列）。
    - 修改小單位時**沒有動「使用班別」就不送這個欄位**，伺服器上的設定原封不動（選過的班別後來被刪除時，也不會讓其他欄位存不了檔）。
    - 已有設定、卻沒有任何上班的班別（選過的班別被刪除，或只選了休息類班別）時提醒「目前的設定沒有任何上班的班別…請重新選擇」；這時排班頁只能排休。
  - 小單位列表的欄位：小單位名稱、代碼、排班人員、使用班別（只摘要上班的班別，例如「N」；只剩休息類或已刪除的班別時顯示「沒有上班班別」）。
- 部門 > 排班設定 > **排班管理者**：保留原本的欄位，選單改成任何員工（可搜尋），說明它可以排整個部門；清空後存檔會真的拿掉（以前清空會被忽略，原本的人仍能排整個部門）。
- 部門 > 簽核表單 > **使用簽核表單**：可複選啟用中的表單（已選的停用表單顯示「（已停用）」）；沒有選代表全部表單。部門列表多一欄「使用簽核表單」（全部表單／N 張表單）。
- 機構、部門、小單位儲存失敗時，對話框保持開啟並顯示伺服器的中文原因（例如「使用班別包含不存在的班別，請重新選擇」「統一編號需為 8 碼數字」；Mongoose 驗證訊息去掉英文前綴，必填欄位沒填顯示「請填寫必填欄位」，連不上伺服器顯示網路異常）。以前失敗時畫面沒有任何提示。

**其他控制設定 > 排班權限**（`ScheduleAccessSetting.vue`，設定鍵 `scheduleAccessMode`）：

- `scheduler_only`（**預設**，2026/11 起；排在第一個）：只有被指定的排班人員能排班，主管只負責簽核。沒被指定的主管選單裡沒有「排班管理」、改有「我的排班」；登入後進「出勤打卡」；直接開排班頁會提示沒有排班權限並帶到出勤打卡；排班相關 API 回 403。簽核、部門報表、直屬部屬的單據與餘額照舊（見上方「唯讀範圍」）。
- `supervisor_and_scheduler`：主管與排班人員都能排班（主管排自己與直屬部屬，dbcd121 的做法）。管理員明確存成這個值就一直有效，升級不會改掉。
- 切到「只有排班人員」前會確認；切回「主管與排班人員」不用確認。沒有存過時畫面顯示「目前沒有儲存過這個設定，使用預設值」。
- API（只有管理員）：`GET /api/other-control-settings/schedule-access` → `{ mode, modes, defaultMode, saved }`（`saved: false` 代表沒有存過、用的是預設值）；`PUT` 同路徑 `{ mode }` → 同樣的格式（`saved: true`），其他值回 400。設定存在其他控制設定的同一份文件（`OtherControlSetting`），沒有存過（或存了看不懂的值）就是預設值。
- **部署**：不需要資料轉換。正式環境沒有存過這個設定時，升級後主管就沒有「排班管理」（客戶要的行為）；要維持舊做法請在其他控制設定 > 排班權限存成「主管與排班人員」。啟動時記錄一行生效的模式，例如 `Schedule access mode: scheduler_only (default, not saved); supervisors without a scheduler assignment (no 排班管理, approvals unchanged): 12`（只算筆數，不修改資料；存成主管與排班人員時不算人數）。
- 指派或模式改變後，已登入的使用者**重新整理頁面**（或重新登入）後選單與排班頁才會跟著變；伺服器的權限檢查每次請求都即時生效。

## 小單位設定的欄位（2026/11 客戶：拿掉沒有功能的欄位）

客戶：「如果可以，可以將人力需求下面的排班拿掉，因為我們應該是使用最下方的使用班別」「避免他們混淆」「可以把一些沒有功能性的拿掉」。

逐一查過伺服器與前台（報表、薪資、勞健保、匯出入、排班、簽核、選單與標籤）讀取小單位的哪些欄位，結果：

| 對話框欄位 | 資料欄位 | 有功能讀取嗎 | 處理 |
| --- | --- | --- | --- |
| 所屬部門 | `department` | 是（組織架構、排班範圍、篩選） | 保留 |
| 小單位名稱 | `name` | 是（排班頁、報表、匯出、薪資單、個人資料） | 保留 |
| 代碼 | `code` | 是（員工批次匯入用代碼或名稱對應小單位，`employeeBulkImportController` 與員工管理的匯入對應） | 保留，加說明 |
| 排班人員、使用班別 | `schedulers`、`allowedShiftIds` | 是 | 保留 |
| 單位名稱 | `unitName` | 否（個人資料只在名稱是空的時候拿它當備用，但名稱是必填，用不到） | 不顯示 |
| 位置、連絡電話、負責人、部門主管 | `location`、`phone`、`responsiblePerson`、`manager` | 否（簽核找的是員工資料的直屬主管） | 不顯示 |
| 機構代碼、統一編號、勞保證號、健保編號、稅籍編號 | `institutionCode`、`uniformNumber`、`laborInsuranceNumber`、`healthInsuranceNumber`、`taxRegistrationNumber` | 否（薪資、勞健保、匯出都不讀小單位的證號） | 不顯示 |
| 人力需求數 | `headcount` | 否 | 不顯示 |
| 班表拉選 | `shift`（API 以 `shiftId` 收送）、`scheduleSetting` | 否：排班頁的預設、匯入、報表、種子資料都不用；排班可用的班別一律看「使用班別」 | 不顯示 |

- 小單位列表也拿掉「機構代碼」「統一編號」「人力需求」「負責人」「主管」欄與名稱下方的單位名稱。
- **資料不刪**：欄位留在 `SubDepartment` schema，API 照樣接受與回傳（含 `shiftId`）。對話框只送畫面上的欄位（`department`、`name`、`code`、`schedulers`，以及新增時或有改過的 `allowedShiftIds`），伺服器只更新有送的欄位，所以存檔不會清掉不顯示的舊資料。不需要啟動移轉。
- 部門與機構的對話框（2026/11）也只留有功能讀取的欄位：部門保留所屬機構、部門名稱、部門代碼、單位名稱、排班管理者、排班備註、使用簽核表單；機構保留機構名稱、系統代碼、單位名稱、機構代碼。拿掉的欄位資料一樣保留，存檔只送畫面上的欄位。

## 資料欄位

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `SubDepartment.schedulers` | `[ObjectId → Employee]`，預設 `[]` | 排班人員 |
| `SubDepartment.allowedShiftIds` | `[String]`（`AttendanceSetting.shifts` 的 `_id`），預設 `[]` | 使用班別，空陣列 = 全部；不用上班的班別不論有沒有選都可以用 |
| `Department.allowedFormIds` | `[ObjectId → FormTemplate]`，預設 `[]` | 使用簽核表單，空陣列 = 全部 |
| `Department.deptManager` | `String`（員工 `_id`） | 舊欄位「排班管理者」，視為整個部門的排班人員（兩種排班權限模式都一樣） |

- 新增、修改小單位與部門時，伺服器檢查格式與是否存在（員工、班別設定、表單），重複的去掉；**沒有送的欄位不會被清掉**（舊版畫面修改其他欄位時不影響設定）。
- 舊資料沒有這些欄位，讀到時就是「沒有指定／全部」，所以**不需要補資料的啟動移轉**。啟動時只記錄一行有設定「排班管理者」的部門數（`Departments whose schedule manager (deptManager) can now schedule the whole department: N`），不修改資料。
- **行為變更**：以前「排班管理者」只用在部門報表；現在被設定的人也能排整個部門的班。部署前可以先在部門設定檢查這個欄位。

### 部門的排班管理者（`deptManager`）

- 開發端確認（2026/11）：部門的「排班管理者」**就是先前的排班指派功能**，所以兩種模式都把他當成整個部門的排班人員，`scheduler_only` 也不會關掉。審查時提出的「舊資料裡被設成排班管理者的主管，切成只有排班人員後仍有排班管理」是預期的行為。
- 要讓某位主管不再排整個部門：在部門設定清掉「排班管理者」，改在小單位指定排班人員。
- 啟動時只記錄有設定排班管理者的部門數（`Departments whose schedule manager (deptManager) can now schedule the whole department: N`），不修改資料。部門報表的權限照舊（主管是部門的排班管理者時可以看該部門的報表）。

## 伺服器

`server/src/services/scheduleAccessService.js`：

- `getScheduleAccess(user)` → `{ canSchedule, mode, supervisorScope, subDepartmentIds, departmentIds, wholeDepartmentIds, employeeIds, isAdmin }`
  - `employeeIds`：可以排的員工（主管範圍與排班人員範圍的聯集）；管理員是全部，這裡留空陣列，請看 `isAdmin`。
  - `subDepartmentIds`：被指定的小單位，加上「排班管理者」部門底下的所有小單位；`wholeDepartmentIds`：擔任排班管理者的部門；`departmentIds`：兩者涉及的部門（排班頁的部門篩選）。這三個只列排班人員的指派，不含主管範圍。
  - `mode`：只有主管需要讀設定，其他角色是 `null`。
- `getScheduleAccessSummary(user)`：同上但不展開員工名單（選單、個人資料、權限檢查用）。`getScheduleAccessForRequest(req)`／`getScheduleAccessSummaryForRequest(req)`：同一個請求只查一次。
- `DEFAULT_SCHEDULE_ACCESS_MODE = 'scheduler_only'`；`getScheduleAccessModeState()` → `{ mode, saved }`；`describeScheduleAccessForStartup()` → `{ mode, saved, supervisorsWithoutAssignment }`（啟動記錄用）。
- `buildScheduleViewEmployeeFilter(access, actorId, role, includeSelf)`：排班頁名單（`GET /api/employees/schedule`）與上方「排班員工數」（`GET /api/schedules/summary`）共用的員工條件。
- **資料庫斷線時 fail closed**：斷線時不查（mongoose 會把查詢排隊最久 10 秒），排班權限模式用預設值（只有排班人員）、排班人員指派當作沒有，所以斷線期間主管與排班人員都不能排班（`requireScheduleAccess` 回 403／503）；寫入班表前的使用班別檢查（`findDisallowedShiftAssignments`、匯入用的 `loadUnitShiftRules`）丟出 `ScheduleAccessUnavailableError`，新增、批次、修改回 503 `SCHEDULE_ACCESS_UNAVAILABLE`。以前斷線時當作「主管與排班人員」、小單位不限班別（fail open）。
- 唯讀範圍（`scheduleShared.js`）：`getDirectReportIds(req)`（主管角色的直屬部屬，同一個請求只查一次）、`resolveEmployeeReadAccess(req, employeeId)` → `'self'｜'admin'｜'supervisor'｜'scheduler'｜null`、`isSchedulerVisibleForm(form)`。
- `getAllowedShiftIdsFor({ subDepartmentIds })` → 班別 `_id` 陣列，空陣列 = 全部（任一小單位沒有設定就是全部，否則取聯集，再加上所有不用上班的班別）。
- `loadUnitShiftRules(subDepartmentIds)` → 小單位 → `{ name, allowedShiftIds, nonWorkShiftIds }`（只列有設定的小單位；有設定時讀一次班別設定，找出不用上班的班別，判斷同 `shiftSemanticService.isNonWorkShift`）；`isShiftAllowedByRules(rules, subDepartmentId, shiftId)`：沒有設定、有選到、或是不用上班的班別就允許。新增、批次、修改班表（`findDisallowedShiftAssignments`）與匯入都用這兩個函式。
- `isEmployeeInScheduleScope(access, actorId, employee)`：依員工資料逐筆判斷（新增、修改、刪除班表的檢查用）。

權限檢查改成看「排班權限」而不是角色（`middleware/scheduleAccess.js` 的 `requireScheduleAccess`）：

- `/api/schedules` 的所有寫入（新增、批次、修改、刪除、批次刪除、發布、完成發布、匯入、日期備忘錄）、匯出、排班檢核與完整性檢查：有排班權限的人（員工角色的排班人員也可以）。員工回覆自己的班表不需要排班權限。
- 新增、修改、刪除班表（`middleware/supervisor.js`）：請求裡的每位員工都要在範圍內（`employee` 與 `schedules[].employee` 都檢查；以前批次新增同時帶 `employee` 時只檢查它，`schedules[]` 裡範圍外的員工也會寫進去）；修改、刪除既有班表時，原本那位員工也要在範圍內。
- `DELETE /api/schedules/older-than`（刪除某日以前的全公司班表，畫面沒有用到）：**只有管理員**（以前任何有排班權限的人帶一位範圍內的員工就能清掉全公司的舊班表）。
- `GET /api/schedules/summary`（排班頁上方的「排班員工數／未排班員工／請假中員工」）：有排班權限的人，**管理員也開放**（以前管理員回 403，排班頁的統計一直是 0）。人數就是排班頁目前看的員工：與名單同一個條件（`buildScheduleViewEmployeeFilter`），再加上畫面選的部門、小單位；管理員是所選部門、小單位的所有員工。主管勾「包含自己」時加上自己；排班人員自己在被指定的小單位裡就和名單一樣算進去。以前只算直屬部屬，也不看部門、小單位的篩選。
- `GET /api/sub-departments`：管理員、主管與排班人員（排班頁的單位篩選）；寫入只有管理員。
- `GET /api/employees/schedule`（排班頁名單）：只有主管身分時維持原本的查詢；排班人員是範圍內的員工；沒有排班權限只有自己。
- `GET /api/schedules/monthly`、`/leave-approvals`、國定假日休假紀錄：看得到自己，再加上排班範圍。國定假日休假紀錄的匯出與登記處理方式開放給排班人員（不含自己）。
- 完整性檢查（`/validate`、`/incomplete`、`/can-finalize`）：非管理員只檢查自己可以排的員工（以前主管可以查任何部門）。
- `GET /api/menu`：排班人員（任何角色）有「排班管理」；沒有排班權限的主管（預設）沒有，改在第二個位置放「我的排班」（以前要在排班頁勾「包含自己」才有，看不到排班頁的主管就沒有地方看自己的班表）；讀不到排班權限時主管也不顯示排班管理（fail closed）。
- `GET /api/profile` 與登入回應多 `scheduleAccess: { canSchedule, supervisorScope, subDepartmentIds, departmentIds, wholeDepartmentIds }`。
- `GET /api/dept-managers`（排班管理者／排班人員的選單）：所有員工（任何角色），附 `employeeId`、`role`、`active`（離職、留職停薪或停用帳號是 `false`）。

**使用班別**：非管理員新增、批次、修改班表與匯入時，上班的班別必須是該小單位開放的班別（小單位以班表上的為準，沒有就用員工所屬小單位；沒有設定的小單位不限制）；不用上班的班別（休息日、例假、國定假日、請假、沒有工作時間的班別）一律允許，舊設定有沒有選到都一樣。不允許時回 400 `SHIFT_NOT_ALLOWED`，訊息例如「「B1 病房」沒有開放使用這個班別，請改選小單位設定的使用班別」；匯入則逐格列為錯誤「「B1 病房」沒有開放使用「D」這個班別」。只檢查這次真的換了班別的格子，之後才改設定的既有班表照樣能存。管理員不受限制。

## 前台

- 路由（`client/src/router/index.js`）：排班頁與預覽頁（`meta.allowScheduler`）依個人資料的 `scheduleAccess.canSchedule` 決定能不能進入：員工角色的排班人員可以進入；沒有排班權限的主管提示「您沒有排班權限，請聯絡管理員在小單位設定排班人員」並**帶到出勤打卡**（以前停在沒有任何連結的 403）；員工到 403。讀不到排班權限時除了管理員都不放行（提示「目前無法確認排班權限，請重新整理頁面後再試」；以前退回角色限制，等於假設主管都能排班）。管理員一律可以。
- 登入後的首頁（`utils/authNavigation.js`）：主管有排班權限才進排班頁，沒有（或讀不到）進出勤打卡；`Login.vue` 用登入回應的 `scheduleAccess`，已登入的人再開登入頁時路由守衛讀個人資料決定。以前主管一律進排班頁，被切開的主管登入後只看到 403，`/`、`/login`、`/manager/login` 也都繞回 403。
- 排班頁（`Schedule.vue`，範圍判斷在 `utils/scheduleScope.js`）：
  - 排班人員只看得到被指定的部門與小單位；被指定到不同部門（含不同機構）時部門篩選可以切換（原本部門固定在主管自己的部門，只有主管身分時照舊）。一個帳號排兩個單位就用部門、小單位篩選切換，不用開兩個帳號；切換後名單、班表與可用班別都跟著小單位走。
  - 部門選單的部門來自不同機構時，部門名稱後面附上機構名稱（例如「護理部（迦南醫院）」「護理部（迦南護理之家）」），同名的部門才分得出來（`GET /api/organizations` 只在這時候讀）。排班頁沒有另外的機構篩選。
  - 上方統計的第一格是「**排班員工數**」（以前叫「直屬員工數」）：排班頁目前看的員工（部門、小單位與排班範圍），不是直屬部屬；權限不足的提示改成「目前帳號只能調整排班範圍內員工的班表…」。
  - 管理員看全部：以前前台排班頁會把管理員自己的 id 當成主管篩選，只列出直屬於管理員的人（通常是空的）；現在不再帶這個篩選，部門篩選也可以切換。
  - 編輯功能（發布、套用、國定假日休假等）依排班權限顯示。
  - 班別下拉、套用班別與圖例只列正在看的小單位的使用班別（沒有設定就是全部），不用上班的班別一律列出（`utils/scheduleScope.js` 的 `restrictShifts`／`isNonWorkShift`，判斷與伺服器相同）；既有班表的班別名稱與顏色照樣用完整的班別設定顯示。換到另一個小單位時，原本選的「套用班別」不在可用班別內就清掉。

## 沒有改的部分

- 部門報表的權限不變：仍只開放主管與管理員，主管是部門的「排班管理者」時可以看該部門的報表（原本的規則）；小單位的排班人員不因此取得報表權限。
- 班表總覽（後台）仍只有管理員。
- 簽核：「主管」關卡找員工資料的直屬主管，待簽清單、核准、退回都不看排班權限，所以預設模式下沒被指定為排班人員的主管照樣收到、簽核直屬部屬的請假單，在簽核明細與核准視窗看得到申請人的假別餘額與調休存摺。
- 主管看直屬部屬的其他功能（員工清單 `GET /api/employees`、出勤紀錄、員工資料與照片、部門報表）本來就只看角色與直屬主管，不受排班權限影響。

## 測試

- `server/tests/scheduleAccessService.test.js`：各種身分的範圍、排班權限模式（預設 `scheduler_only`、明確存過的 `supervisor_and_scheduler`、`saved`）、啟動記錄、資料庫斷線時 fail closed、名單條件、使用班別。
- `server/tests/schedulerAccessRoutes.test.js`：員工角色的排班人員（兩個不同部門的小單位）看得到、排得到的員工；預設模式下沒被指定的主管（選單、個人資料、排班 API 都擋下）與切回「主管與排班人員」；管理員；批次新增逐筆檢查範圍、`older-than` 只有管理員、「相關簽核」只給排班人員請假加班換班單、排班員工數跟著部門小單位篩選；使用班別；部門的使用簽核表單。
- `server/tests/approvalReadScope.test.js`：預設模式下主管看得到直屬部屬的任何簽核單、附件、假別餘額；排班人員只看得到請假、加班、換班單，附件不給。`server/tests/compensatoryLeaveNote.test.js`：人資備註只給本人、管理員與直屬主管。
- `server/tests/menu.test.js`、`server/tests/scheduleSummary.test.js`：主管的選單（預設模式有我的排班、讀不到排班權限時 fail closed）、排班員工數。
- 測主管排直屬部屬的舊測試（`schedule.test.js`、`schedule.unit.test.js`、`supervisorSchedule.test.js`、`holidayLedgerController.test.js`、`holidayLedgerMount.test.js`）改成先存成「主管與排班人員」（`tests/helpers/scheduleAccessModeMocks.js`），因為那已經不是預設。
- `server/tests/holidayLedgerController.test.js`：國定假日休假紀錄的排班人員範圍。
- `server/tests/schedulerAccess.integration.test.js`：真的 Express app + 真的 MongoDB（單機）的端到端測試，預設略過；執行方式同其他整合測試：`APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:<port> npm test -- tests/schedulerAccess.integration.test.js`。
- `server/tests/unitShiftRules.test.js`：使用班別只限制上班的班別，不用上班的班別一律允許（含舊設定選過休息日、讀不到班別設定時）。
- `server/tests/unitShiftRules.integration.test.js`：真的 app + 真的 MongoDB（預設略過，執行方式同上）：小單位只送畫面上的欄位存檔不清掉舊欄位；只選大夜的小單位新增、批次、修改與匯入休息類班別都可以，白班照樣擋下。
- 前台：`client/src/utils/__tests__/scheduleScope.test.js`、`client/tests/routerScheduleAccess.spec.js`（含登入後首頁、沒有排班權限的主管帶到出勤打卡）、`client/tests/login.spec.js`、`client/tests/router.spec.js`、`client/tests/scheduleDashboard.spec.js`（排班員工數）、`client/tests/scheduleSchedulerScope.spec.js`（含跨兩個機構的排班人員切換）、`client/tests/scheduleUnitRestShifts.spec.js`（排班頁一律列出不用上班的班別）、`client/tests/orgDepartmentSetting.spec.js`（小單位對話框與列表只留有功能的欄位、只送畫面上的欄位、儲存失敗顯示伺服器的中文訊息）、`client/tests/scheduleAccessSetting.spec.js`。
