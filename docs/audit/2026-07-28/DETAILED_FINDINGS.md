# 詳細漏洞報告

證據狀態：`動態確認` 代表已在隔離 MongoDB 及本機 HTTP App 重現；`程式確認` 代表控制流可直接證明；`未驗證` 代表正式 VM 連線受阻，不得視為通過。

## P0-01 任意簽核人冒用

- 狀態：動態確認。
- 證據：`server/src/controllers/approvalRequestController.js:479` 使用 `req.body.employee_id || req.user.id`，再於 `:484` 以該值尋找核准人；`server/src/routes/approvalRoutes.js:56` 允許 employee 呼叫。
- 重現：employee Token 對他人待簽單送出 `{"employee_id":"<supervisor-id>","decision":"approve"}`。隔離測試回 `200`、狀態變 `approved`、日誌被記成 supervisor。
- 影響：可偽造請假、加班、薪資或其他簽核結果，並污染稽核軌跡。
- 修正：簽核 actor 只能取自重新載入 DB 後的 `req.user.id`；禁止 body/query 指定 actor。若 admin 需要代簽，另建明確 API、理由與不可竄改雙 actor 日誌。
- 回歸：employee 代 supervisor 應回 `403/404`；重複、併發、舊 Token、跨部門均不得改變資料。

## P0-02 任意員工打卡寫入

- 狀態：動態確認。
- 證據：`server/src/controllers/attendanceController.js:145` 直接採用 body `employee`，`:261` 直接保存；路由允許三種角色呼叫。
- 重現：employee Token 送出他人 ID 與 `action=outing`，隔離測試回 `201` 且他人名下增加一筆紀錄。`outing`/`breakIn` 也不經班表時窗檢查。
- 影響：工時、加班、遲到與薪資依據可被偽造。
- 修正：employee 固定為自身 ID；主管／管理員補登使用獨立端點與授權範圍，強制原因、原始值、修改值與覆核。
- 回歸：員工傳入他人 ID 應回 `403/404`；任意 timestamp、非當前班表、重複動作需被拒絕或進入補登簽核。

## P0-03 主管可刪除任意班表

- 狀態：動態確認。
- 證據：`server/src/routes/scheduleRoutes.js:62` 的 `DELETE /:id` 未套 `verifySupervisor`；`server/src/controllers/scheduleController.js:1882` 直接 `findByIdAndDelete`。
- 重現：supervisor Token 刪除非其部屬班表，回 `200` 且資料不存在。
- 影響：班表與後續工時／薪資依據可遭跨部門破壞。
- 修正：先載入班表與 employee，再使用同一物件授權政策驗證部屬／部門範圍；已發布或已結薪班表不可硬刪，只能版本化更正。
- 回歸：跨部門與非直屬班表應回 `404`；已發布班表需走更正流程並留存前版。

## P1-01 完整員工個資、薪資與銀行資料越權

- 狀態：動態確認。
- 證據：`server/src/index.js:112-120` 允許 employee GET；`employeeController.js:536-549` 預設無 projection、無分頁；`:736-799` 可依任意 ID 取完整文件。Employee 包含身分證、醫療、地址、薪資、銀行及保險資料。
- 重現：employee Token 的清單回 3 人，包含他人 `idNumber` 與 `salaryAmount`；依 admin ID 讀取也回 `200`。
- 影響：違反最小權限，涉及個資法敏感／特種個資及薪資機密。
- 法規：[個人資料保護法](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021)現行有效版本的目的限制、安全維護與特種個資要求。
- 修正：建立角色與用途別 DTO；employee 僅能讀自身必要欄位，主管僅直屬且排除薪資／銀行／醫療，admin 依職務再細分 HR、payroll、system admin。
- 回歸：跨員工、跨部門、猜 ID 均回 `404`，不得洩漏物件是否存在。

## P1-02 班表與簽核物件層授權缺失

- 狀態：動態／程式確認。
- 證據：`scheduleController.js:1459` 回傳全部班表並完整 populate employee，`:1509` 可讀任意 ID；`approvalRequestController.js:248-256` 可讀任意簽核，`:265/:276/:305` 信任 query `employee_id`。
- 重現：employee Token 的 `/api/schedules` 包含其他員工班表；簽核清單、待辦與歷史可將 `employee_id` 改成他人 ID。
- 影響：洩漏全公司排班、請假原因、附件與簽核意見；也可探測主管工作流。
- 修正：所有查詢先以 actor 建 scope，再附加 client filter；不要讓 client filter 取代 actor scope。populate 一律指定最小欄位。
- 回歸：self/direct-report/department/admin 矩陣逐一測 `401/403/404`。

## P1-03 公開附件與同源腳本／Token 竊取鏈

- 狀態：程式確認。
- 證據：`server/src/index.js:101` 將整個 `/upload` 公開；`approvalAttachmentUpload.js:30-43` 只信任 MIME header 且保留原始副檔名；`ApprovalDetailContent.vue:20-21` 直接以新頁開啟；`tokenService.js:30` 將 JWT 存在 localStorage。
- 重現：以 `Content-Type: image/png` 上傳內容為 HTML 且檔名為 `.html`，filter 可通過，Express static 會依 `.html` 同源提供。審核者點擊後，腳本可讀 localStorage Token。
- 影響：員工、主管或 admin Token 被竊、附件未授權下載、個資外洩。
- 修正：檔案存於 web root 外；檔案簽章／magic bytes 驗證、伺服器決定副檔名；下載必須經物件授權並設 `Content-Disposition: attachment`、`nosniff`、CSP；考慮 HttpOnly SameSite Cookie 或縮短 Token 暴露面。
- 回歸：偽造 MIME、雙副檔名、HTML/SVG、直接猜址、非關係人下載均失敗。

## P1-04 簽核、特休與多人操作缺乏交易及冪等性

- 狀態：程式確認。
- 證據：`approvalRequestController.js:476-533` 以讀取、修改、兩次 save 推進流程，無 compare-and-set；`:459-464` 先核准再扣特休；`:421-428` 扣假失敗只記 log，簽核仍保持 approved。
- 重現：兩個 approver 同時在同一版本送出，可各自讀到 pending；資料庫或扣假失敗可產生「已核准但未扣額度」。
- 影響：重複核准、部分成功、額度與簽核不一致。
- 修正：Mongo transaction + 版本欄位／條件更新；每個 command 帶 idempotency key；副作用使用 outbox 或可重試狀態機。
- 回歸：同時送簽、重複請求、DB 中斷、撤回重送、最後一關與扣假必須原子驗證。

## P1-05 薪資月份、請假天數與加班費計算錯誤

- 狀態：程式確認。
- 證據：`workHoursCalculationService.js:362/:490` 依 `createdAt` 歸月而非實際日期；`:398-401` 多日請假少算一天；`:582` 全部加班用固定 multiplier。`salaryConfig.js` 的預設加班倍率為簡化值。
- 影響：跨月／補送申請落錯薪資月、請假扣款偏低、平日第二段與休息日加班費錯誤，可能重複或漏算結薪。
- 法規：[勞基法第 24 條](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001)區分平日前 2 小時、後 2 小時及休息日費率；第 23 條要求工資明細及保存五年。
- 修正：以 occurrence period 建不可變明細；依日別、工時區段與薪資基礎分段計算，保存計算版本與來源。
- 回歸：月底夜班、晚送單、休息日 1/3/9/12 小時、重算同月份與四捨五入案例。

## P1-06 勞健保、職災與勞退級距過期且無歷史版本

- 狀態：程式確認。
- 證據：`laborInsuranceService.js:3-31` 仍含 11,100 至 45,800 的舊表；`:39-52` 由同一表推導健保及勞退；`:127` 官方擷取仍為 TODO；`LaborInsuranceRate.js:4` 僅以 level 唯一，沒有生效日期。
- 影響：2026 最低工資 29,500 元與最新級距不符，歷史薪資重算也會被新表覆蓋。
- 法規／資料：[勞動部最低工資](https://www.mol.gov.tw/1607/28162/28166/28180/70460/76761/76833/post)、[勞保局 2026 表](https://www.bli.gov.tw/0100493.html)、[健保署 2026 資料](https://info.nhi.gov.tw/IODE0000/IODE0000S09?id=285)。
- 修正：按制度分表，加入 `effectiveFrom/effectiveTo/source/version/hash`；PayrollRecord 快照實際套用版本與費率。
- 回歸：跨生效日、追溯調薪、眷屬數、部分工時、勞／就／災／健保與勞退各自驗證。

## P1-07 特休法定生命週期不完整

- 狀態：程式確認。
- 證據：`annualLeaveService.js:147-170` 由 admin 手填且換年清零；`:79-104` 查詢硬編碼 `form_data.leaveType` 並按 createdAt 年度；沒有年資自動給假、遞延、到期折薪、取消返還或未休工資通知。
- 影響：法定天數、勞工排假權、遞延與未休工資可能錯誤；核准撤銷後額度無法復原。
- 法規：[勞基法第 38 條](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001)規定年資天數、勞工排定、遞延與未休工資及通知。
- 修正：使用 leave grant/ledger，不覆寫餘額；每筆取得、使用、返還、到期折薪均可追溯。
- 回歸：到職滿 6 月、跨週年、離職、遞延一次、取消／退回／重送、半日與小時假。

## P1-08 法規規則與公司內規未分層、缺少適用制度

- 狀態：程式確認。
- 證據：`laborRuleValidationService.js:10-14` 固定 11h/12h/6 日/4h/46h；`:329-359` 固定週一到週日一例一休；`:91-100` 以班別文字判斷例／休。
- 影響：合法的二／四／八週變形工時、54/138 小時及輪班 8 小時例外無法設定；班別改名又可能繞過限制。
- 法規：[勞基法第 30、30-1、32、34、36 條](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001)。
- 修正：建立 `WorkTimeRegime` 與 `PolicyVersion`，記錄適用組織、職類、生效期間、工會／勞資會議同意、主管機關備查；班別使用 enum `work/rest_day/regular_rest/holiday/leave`。
- 回歸：一般工時與二／四／八週制度分開測；例外無核准時拒絕、有有效核准時才允許。

## P1-09 加班累計可因 BSON 型別與併發而漏算

- 狀態：程式確認，需在修正時加入整合測試。
- 證據：`laborRuleValidationService.js:567-568` 以 Date range 查 Mixed `form_data.<fieldId>`；前端 JSON 送出後通常保存 ISO string。`:586-620` 先查已核准總數再判斷，沒有額度保留或 transaction。
- 影響：字串日期不匹配 Date query；兩筆同時送出可各自通過 46 小時限制。
- 修正：將 occurrence start/end、分鐘數與類型正規化成 Schema 欄位並建索引；送簽時以 ledger 原子保留額度。
- 回歸：BSON Date／歷史 string migration、同時兩筆跨 46/54/138、撤回釋放額度。

## P1-10 正式備份與復原能力未能驗證

- 狀態：未驗證。
- 證據：私網及公開 SSH 均不可達；工作區找不到 Mongo dump/archive。先前曾發生資料庫空庫事件，故不能以「服務運行」替代復原證據。
- 影響：再次刪庫、磁碟故障或誤部署時，RPO/RTO 不明。
- 修正：建立自動備份、異地世代、加密、失敗告警；每月至少在隔離環境實際 restore 並比對 collection/count/hash。
- 回歸／驗收：需產出最近成功備份、保留世代、restore log、抽樣資料一致性與負責人簽核。

## P2-01 登入與 Token 生命週期不足

- 證據：`authRoutes.js:63-97` 無 rate limit／lockout；`index.js:40-41` fallback `admin/password`；`auth.js:13-24` 只信任 Token 角色，不重新查 DB；密碼變更只 blacklist 當前 Token。`Employee.js:283-284` 用一般字串比較 hash。
- 影響：暴力破解、預設帳密、權限降級後舊 Token 仍有效、其他工作階段不撤銷。
- 修正／測試：移除 fallback、首次啟動明確 bootstrap；rate limit/MFA；`tokenVersion` 或 session store；timing-safe compare；測角色變更、密碼重設與全裝置登出。

## P2-02 無上限查詢、未跳脫 Regex 與過度 populate

- 證據：`employeeController.js:509/:520`、`scheduleController.js:1937` 直接 `new RegExp`；員工清單無預設分頁；多處 populate 完整 Employee。JSON body 上限為 50 MB。
- 影響：資料外洩面擴大，惡意正規表示式、大回應與大型 body 可耗盡 CPU／記憶體。
- 修正／測試：escape regex 或使用索引化搜尋；強制 page/pageSize 上限；projection；body 按路由降到合理值；加入 413、timeout 與慢查詢監控。

## P2-03 Mass assignment 與驗證繞過

- 證據：insurance、dept schedule、organization、holiday move、payroll、salary setting 控制器將 `req.body` 直接交給 `findByIdAndUpdate`，且未一致啟用 `runValidators`。
- 影響：可寫入未預期欄位、跳過服務規則或 Schema validator。
- 修正／測試：每端點 allowlist DTO，服務層執行不變條件；拒絕 `$`、`.` 與未知欄位。

## P2-04 缺少不可竄改的存取與異動稽核

- 證據：只有 ApprovalRequest 內嵌 logs；讀取薪資、銀行、附件、員工資料沒有 access log，管理員可刪除核心資料，沒有 append-only audit collection。
- 影響：無法回答誰在何時看過或改過敏感資料，也無法可靠追查事件。
- 修正／測試：集中 audit event，記 actor/subject/action/result/request ID/前後版本；一般管理 API 不可更新或刪除，集中送至受保護儲存。

## P2-05 附件保留、刪除與證明文件最小化不足

- 證據：上傳先寫磁碟再建立申請，失敗無 cleanup；沒有 owner、保留期限、刪除流程；分支把所有請假一律要求證明（`laborRuleValidationService.js:498-503`）。
- 影響：孤兒檔、醫療等敏感資料過度蒐集與永久保留。
- 法規：[勞工請假規則](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030006)允許雇主要求證明，不等於所有假別必須無差別蒐集；仍需符合個資最小必要性。
- 修正／測試：按假別與公司政策設定是否需要證明；暫存 upload session、成功綁定後 commit，逾期清理並保留刪除稽核。

## P2-06 依賴供應鏈弱點

- 證據：後端 production audit 為 8 High/6 Moderate，直接依賴含 express、mongoose、multer；前端 4 High，直接依賴 `xlsx` 且 npm 無修補版本。
- 影響：已知套件漏洞與檔案處理風險持續存在。
- 修正／測試：先在分支升級有 fix 的套件並跑全套測試；評估以 SheetJS 官方受支持版本或替代 library 移除 npm `xlsx`；CI 加 `npm audit --omit=dev` 門檻與 SBOM。

## P2-07 測試未全綠且時區契約不一致

- 證據：後端 15 suites/51 tests 失敗，前端 10 files/49 tests 失敗；多個日期在 Asia/Taipei 被前移一天。`publish` 新規則也讓既有主管建立班表案例回 `400`；路由 mock 缺 `checkCanFinalize` 導致整個 suite 無法載入。
- 影響：排班、假日、打卡匯入與跨月薪資可能在環境切換時錯一天；分支沒有可靠回歸門檻。
- 修正／測試：明確採 `Asia/Taipei` domain date 型別；日期與瞬間分開；CI 在 UTC 與 Asia/Taipei 各跑一次，合併前必須全綠。

## P3-01 Windows 測試腳本不可執行

- 證據：server `npm test` 使用 Unix `NODE_OPTIONS=... jest`，Windows 直接回「NODE_OPTIONS is not recognized」。
- 修正：使用 `cross-env` 或 Node wrapper，並在 Windows/Linux CI 驗證。

## P3-02 前端 bundle 過大

- 證據：build 成功，但主 JS 約 1,017 KB，`xlsx` 約 430 KB；Vite 發出超過 500 KB 警告。
- 影響：內網低規格終端首次解析與互動延遲。
- 修正：路由 lazy load、報表／xlsx 僅在需要時 dynamic import、拆分 vendor chunk；設 bundle budget。

## P3-03 監控與慢請求證據不足

- 證據：未見統一 request ID、結構化 5xx、>500 ms 慢請求、Mongo 慢查詢、備份失敗、磁碟與 PM2 restart 告警。
- 修正：加入結構化 log、request correlation、敏感欄位遮罩、延遲直方圖、錯誤率、磁碟／備份／重啟告警；稽核 log 與應用 debug log 分離。
