# 部門可使用的簽核表單、無上級主管時的簽核人

客戶 2026/10/23「迦南人資系統-重大調整」裡和簽核有關的兩項：

- **R2**「在部門設定下面多一個，使用簽核表單，可複選，該單位人員帳號登入後，僅能看到由此所選擇的簽核表單」（「設定部門表單顯示」「按部門顯示對應簽核」）。
- **R5**「避免主管沒辦法當自己主管」：以前申請人一定不會是自己的簽核人、員工也不能當自己的主管，所以最上層主管自己請假時，「申請者的主管」那一關找不到人，送不出去（`REQUIRED_APPROVER_MISSING`）。

## R2 部門的「使用簽核表單」

部門設定（權限&機構&部門設定 → 部門）的「使用簽核表單」可以複選啟用中的表單，存在 `Department.allowedFormIds`（表單 `_id` 陣列，預設空白）。畫面在部門設定裡（見 [排班人員](scheduler-access.md) 的部門設定說明），這裡說明它的效果：

| 誰 | 看得到、能送出的表單 |
| --- | --- |
| 部門有勾選表單的員工、主管 | 只有勾選的那些（而且是啟用中的） |
| 部門沒有勾選任何表單 | 全部啟用中的表單（和以前一樣） |
| 沒有所屬部門的員工、部門資料找不到 | 全部 |
| 管理員 | 全部（表單設計、簽核流程設定不受影響） |

- 依的是**申請人自己的部門**（員工資料的「部門」），小單位不另外設定。
- `GET /api/approvals/forms`：一般員工、主管只回部門開放的表單，回應標頭 `X-Form-Visibility: department`（沒篩選時是 `all`）；申請頁看到 `department` 時在表單選單下方提示「目前只列出您所屬部門開放使用的表單；找不到需要的表單請洽管理員」。
- 不能用的表單：`GET /api/approvals/forms/:id`、`/forms/:id/fields`、`/forms/:id/workflow`（有關卡時）回 403 `FORM_NOT_ALLOWED`；**送出（`POST /api/approvals`）與退回後重新送出（`POST /api/approvals/:id/resubmit`）也回 403**，訊息例如「您所屬的部門未開放使用【加班申請】，請改選其他表單；如需使用請洽管理員」，什麼都不會存。
- 已經送出的單據不受影響：簽核、開啟明細、撤回都照常；簽核人看別的部門員工送來的單據也照常。退回的單如果表單已經不開放，申請人只能撤回。
- 申請頁：重新載入清單後原本選的表單不見了（停用或部門不再開放），或送出時收到 403，會清掉選擇並在上方說明原因（「「加班申請」已不在可申請的表單中（可能已停用，或您所屬的部門未開放使用），請改選其他表單」或伺服器的訊息）。
- 每次都即時讀部門設定（沒有快取），管理員改了部門設定，員工重新整理就生效。
- 勾選的表單之後被刪除：清單裡就少那一張；如果勾選的全部被刪掉，這個部門的員工會看不到任何表單，請到部門設定重新勾選或清空。

程式：`server/src/services/formVisibilityService.js`（`getFormVisibilityForUser`、`isFormAllowed`），`approvalTemplateController`（清單、樣板、欄位、流程預覽）、`approvalRequestController`（建立、重新送出）。

## R5 無上級主管時的簽核人

決定：**主管關卡找不到可簽核的主管時，改送可設定的「最高層簽核人」**；預設是所有在職的系統管理員（不含申請人），任一位核准即可。只有連最高層簽核人都沒有時，才維持原本的錯誤。

- **什麼時候改送**：流程裡「必簽」的主管關卡（「申請者的主管」或「指定主管」），而且找不到可簽核的主管：
  - 申請人沒有設定直屬主管（`no-supervisor`）；
  - 主管就是申請人本人（`only-applicant`，例如管理員的主管欄位填了自己）；
  - 直屬主管已離職、停用或留職停薪（`supervisor-inactive`）；
  - 指定的主管已離職、停用，或不具主管身分（`manager-unavailable`）。
  - **不改送**：選填（非必簽）的主管關卡照舊自動略過；關卡設定本身錯誤（`invalid-config`）、其他類型的關卡（標籤、角色、部門…）找不到人時照舊回報錯誤。
- **改送給誰**（`services/approverResolution.resolveStepApprovers`）：
  1. 其他控制設定的 `topLevelApproverIds`（管理員在「簽核流程設定 → 通用流程規則 → 無上級主管時的簽核人（全部表單共用）」挑選，最多 50 位）裡可簽核的人，不含申請人；
  2. 沒有設定、或設定的人都不能簽（離職、停用、留職停薪、就是申請人本人，例如院長自己請假）時：所有可簽核的系統管理員，不含申請人；
  3. 兩者都沒有人：維持原本的 400 `REQUIRED_APPROVER_MISSING`（「申請人尚未設定直屬主管」等原因）。
- **申請人永遠不是自己的簽核人**：上面每一步都排除申請人。
- **任一位核准即可**：改送的關卡 `all_must_approve` 一律是 false（流程設定的「需全員同意」不適用）。
- **看得到的地方**：
  - 申請頁的流程預覽：該關下方顯示「無上級主管，改由系統管理員簽核（任一位核准即可）（申請人沒有設定直屬主管）」（`GET /forms/:id/workflow` 的每一關多 `fallback_text`、`fallback_reason`，`resolved_count` 是改送的人數；不含姓名）。
  - 單據的那一關（簽核頁明細、排班頁相關簽核的明細）：同樣的說明（關卡上存 `fallback: { reason, reason_text, source, text }`，`source` 是 `setting` 或 `admins`；「最高層簽核人」或「系統管理員」）。
  - 簽核紀錄多一行「無上級主管改送」：「第1關（申請者的主管）（申請人沒有設定直屬主管）：無上級主管，改由系統管理員簽核（任一位核准即可）」。
- 建立與退回後重新送出都會重新解析（主管補設定之後重送，就回到主管簽核）。改送的關卡和後一關簽核人、設定完全相同時照舊合併成一關（說明保留）。
- 不影響已經送出的單據；部署後不需要資料轉換（設定沒有值 = 系統管理員）。

### 設定 API（只有管理員）

| 路徑 | 說明 |
| --- | --- |
| `GET /api/approvals/top-level-approvers` | `{ ids, approvers: [{ id, name, employeeId, role, eligible, ineligibleReason }], admins: [{ id, name, employeeId, role }], maxCount }`；`admins` 是沒有指定時會改送的系統管理員，`eligible: false` 的人（之後離職、停用）簽核時會略過，畫面提醒換人 |
| `PUT /api/approvals/top-level-approvers` | `{ ids: [員工 _id] }`，空陣列 = 改回系統管理員；格式不對、找不到的員工、不能簽核的人（例如「離職主任（已離職）不能簽核」）回 400 中文訊息，最多 50 位 |

存在其他控制設定文件（`othercontrolsettings`，`key: 'default'`）的 `data.topLevelApproverIds`；讀不到設定（例如資料庫暫時有問題）時當作沒設定，改送系統管理員。

## 部署

不需要資料轉換：`Department.allowedFormIds` 預設空白（全部表單，和以前一樣），`topLevelApproverIds` 沒有值（系統管理員）。部署步驟不變：`git pull` → `npm ci` → 建置前端 → `pm2 restart`。

**行為變更（請告知人資）**：以前「申請者的主管」找不到人時申請會失敗，現在會改送系統管理員（或指定的最高層簽核人）；直屬主管離職而還沒更新員工資料時，單據會送到管理員那裡，而不是送不出去。

## 對應的測試

- 伺服器：`formVisibility.test.js`（部門篩選、沒勾選、沒部門、管理員；樣板、欄位 403；404 先於部門檢查）、`approvalWorkflow.test.js`（建立：改送管理員、設定的人、申請人不簽自己的單、設定的人就是申請人時改送管理員、主管離職與指定主管失效、選填關卡照舊略過、重新送出重新解析、合併關卡保留說明、連改送都沒有人時維持原本錯誤；部門表單 403 與重新送出 403）、`workflowPreview.test.js`（預覽的改送說明與部門 403）、`topLevelApprovers.test.js`（改送規則、設定 API 的權限與驗證）、`approvalRoutesAuthorization.test.js`、`approvalEngine.integration.test.js`（直屬主管離職：改送管理員，沒有管理員時維持原本錯誤）、真實 MongoDB 的 `formsApprovalsComp.integration.test.js`（護理部只看得到請假單、加班單 403、行政部與沒部門的人全部、管理員全部、改部門設定立即生效；院長層級的護理長自己請假送到系統管理員、任一位核准、預覽先說明、指定最高層簽核人、最高層簽核人自己請假改送管理員、管理員沒有主管時送給另一位管理員、都沒有人時維持原本錯誤）。
- 前端：`approvalFormVisibility.spec.js`（部門篩選提示、表單不見的說明、送出 403 後更新清單、流程預覽的改送說明）、`approvalFlowSettingTopLevel.spec.js`（無上級主管時的簽核人：說明、可選的人、儲存、改回預設、離職提醒、讀取失敗）、`approvalDetailContent.spec.js`、`approvalForm.spec.js`、`approvalDetailUtil.spec.js`。
