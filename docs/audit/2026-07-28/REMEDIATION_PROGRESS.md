# P0/P1 授權修復進度

日期：2026-07-28
分支：`codex/schedule-rules-validation`
範圍：稽核報告中的三項 P0，以及直接相關的物件層授權、敏感欄位最小化與簽核附件保護。未操作正式 VM 或正式資料。

## 已完成

| 項目 | 狀態 | 實作與驗證 |
|---|---|---|
| P0-01 冒用簽核人 | 已修正 | actor 僅取自驗證後身分；body/query 身分不一致回 `403`；非參與者單筆讀取回 `404`。隔離 MongoDB 驗證簽核狀態與決策均未改變。 |
| P0-02 替任意員工打卡 | 已修正 | 一般打卡端點強制綁定登入者本人；傳入他人 ID 回 `403`。隔離 MongoDB 驗證沒有新增出勤紀錄。 |
| P0-03 跨範圍刪除班表 | 已修正 | 刪除路由套用主管物件範圍驗證；主管只可操作本人或直屬部屬。隔離 MongoDB 驗證他人班表仍存在。 |
| P1-01 員工敏感資料越權 | 本輪範圍已修正 | 員工清單固定為本人；主管固定為本人及直屬部屬，並排除薪資、銀行、身分證及醫療欄位；單筆與特休查詢使用相同範圍。 |
| P1-02 班表與簽核物件授權 | 本輪範圍已修正 | 班表 list/get/monthly/leave-calendar/export 與簽核 list/inbox/history/get 均由伺服器端身分及直屬關係限縮；查詢參數不能擴大範圍。 |
| P1-03 簽核附件公開 | 存取面已修正 | 簽核附件加入副檔名、MIME、magic bytes、單檔 10 MB 與最多 5 檔驗證；靜態 `/upload/approvals` 被封鎖；下載需為申請人、簽核人或 admin，且檔案必須被該簽核單引用。 |
| P1-04 員工照片公開與生命週期 | 已修正 | 照片使用隨機檔名與私有目錄、5 MB 上限、MIME/magic bytes 雙重驗證；靜態新舊照片路徑均回 `404`，改由授權 API 讀取。新增、更新、刪除與失敗流程會清理未引用檔案，前端以帶 JWT 的 Blob URL 顯示並釋放物件 URL。 |
| P1-05 簽核併發與冪等性 | 本輪範圍已修正 | 簽核文件啟用 optimistic concurrency；同一關卡的重複或併發操作只允許一次提交，衝突回 `409`。送件支援 `Idempotency-Key` 與唯一索引；撤回可重複呼叫，退回後重送只提交一次。特休扣除以簽核單 ID 做原子去重。 |
| P1-06 班表日期跨時區偏移 | 已修正 | 班表日與月份範圍統一以 UTC 日曆日儲存與運算，避免 UTC+8 環境把 `YYYY-MM-DD` 寫成前一日 16:00Z 或月曆首日顯示成前一天。 |

前端簽核人選項改用 `/api/employees/options` 最小資料介面；附件改以帶驗證資訊的 API 取得 Blob，不再直接開啟公開 URL。

## 驗證結果

- 受影響後端聚焦回歸：16 個 suites、149 個 tests，全數通過。
- 本機隔離 MongoDB 動態測試：11 個 tests，全數通過，涵蓋跨員工越權、雙重核准、同鍵重複送件、特休重複扣除、撤回與重送。測試只允許 loopback MongoDB，使用隨機 `hr_security_test_*` 資料庫並在結束後刪除。
- 簽核與授權照片前端回歸：27 個 tests，全數通過；員工管理與照片工具回歸：32 個 tests，全數通過。
- 前端 production build：通過；仍有既有的大型 chunk 警告。
- `git diff --check`：通過，僅有工作區既有的 LF/CRLF 提示。

全量測試仍未全綠：

- 後端：68 個測試檔中 59 pass、8 fail、1 skip；394 個測試中 356 pass、27 fail、11 skip。
- 後端失敗檔：`ensureAdminUser`、`attendanceImport`、`payroll`、`nightShiftTestDataVerification`、`seedApprovalRequests`、`holidayController`、`menu`、`seedData`。
- 前端：91 個測試檔中 8 個含失敗；274 個測試中 227 pass、47 fail。
- 前端失敗檔：`approvalFlowSetting`、`layoutWidth`、`mySchedule`、`schedule`、`scheduleDashboard`、`scheduleOverview`、`EmployeeManagementBulkImport`、`EmployeeManagementDepartment`。

這些失敗主要集中在既有時區/日期預期、匯入 fixture、薪資與排班摘要、Windows 路徑、測試 mock 與 UI 斷言；不得視為本輪已修正。

## 尚未關閉

1. 簽核附件仍缺「已上傳但未送件」孤兒檔案的排程清理、保留期限、惡意檔案掃描與 web root 外實體儲存；靜態存取目前已由 middleware 封鎖。
2. 員工證照與訓練附件仍以 data URL 或外部 URL 儲存在員工文件，尚未納入私有檔案服務、內容掃描、大小限制與刪除生命週期。
3. 簽核狀態提交與特休扣除是兩個原子操作，已具冪等性與失敗紀錄，但 MongoDB 中斷時仍缺可持續重試的 outbox/補償工作；不得把「不重複扣除」視為完整跨文件交易。
4. admin 尚未細分 HR、payroll、system-admin；薪資與銀行資料的職務分離仍是 P1。
5. 薪資、加班費、特休、變形工時、保險級距與歷史版本等法規 P1 尚未修正。
6. 正式 VM 的 JWT secret 輪替、異常紀錄追查、備份與隔離還原必須由維運另行執行。
7. 2026-08-02 測試 `istratoradmin@192.168.1.99:22` 時，SSH 在 TCP/L2 層不可達；本機至 `192.168.1.254` 網關正常，未進入帳密驗證，也未修改 VM 或正式資料。

結論：三項已重現 P0 已封堵並完成本機動態驗證；本分支仍不應因本文件而直接視為可正式上線，剩餘 P1、全量測試失敗及正式維運控制仍須完成或書面接受風險。
