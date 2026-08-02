# CODEX 线上测试资料清单

日期：2026-08-02

固定标记：`CODEX_TEST_20260802_`
状态：**保留，未经使用者明确指示不得删除**

## 清理原则

- 本轮主动建立的资料均应能以固定标记或下列 ID 识别。
- 不得仅依日期或建立者批次删除，以免误删客户资料。
- 清理前先备份 MongoDB，再逐 collection 预览 ID 与名称；使用者确认后另行执行。
- 本文件不包含任何测试帐号密码、管理员密码、JWT 或 SSH 凭证。

## 组织与人员

| 类型 | ID | 标记/名称 |
|---|---|---|
| Organization | `6a6f2b94953a62bef8440681` | `CODEX_TEST_20260802_ORG` |
| Department | `6a6f2bf6953a62bef8440692` | `CODEX_TEST_20260802_DEPT` |
| Subdepartment | `6a6f2c1a953a62bef84406c3` | `CODEX_TEST_20260802_SUBDEPT` |
| Supervisor | `6a6f2d30953a62bef84406f0` | username `CODEX_TEST_20260802_SUP` |
| Employee 01 | `6a6f2d8c953a62bef8440706` | username `CODEX_TEST_20260802_EMP01` |
| Employee 02 | `6a6f2d8d953a62bef844070a` | username `CODEX_TEST_20260802_EMP02` |

## 班别与排班

| 类型 | ID/范围 | 标记/用途 |
|---|---|---|
| Shift D | `6a6f2dd6953a62bef844079b` | 正常日班 |
| Shift E | `6a6f2dd6953a62bef84407be` | 正常晚班 |
| Shift LONG | `6a6f2dd7953a62bef84407e2` | 超过 12 小时拒绝测试 |
| Shift REST | `6a6f2dd7953a62bef8440807` | 休息日 |
| Shift REG | `6a6f2dd7953a62bef844082d` | 例假日 |
| Shift LIVE | `6a6f3063953a62bef8440deb` | `CODEX_TEST_20260802_LIVE_ATTENDANCE` |
| EMP01 2026-09-07 至 09-13 | `6a6f2e32953a62bef8440920` 至 `6a6f2e32953a62bef8440926` | 7 日规则与 finalized 流程 |
| EMP02 2026-10-19 至 10-25 | `6a6f2f67953a62bef8440b44` 至 `6a6f2f67953a62bef8440b4a` | dispute/finalized 流程 |
| EMP02 live schedule | `6a6f3063953a62bef8440dfa` | 线上打卡画面测试 |

## 出勤资料

| 类型 | ID | 备注 |
|---|---|---|
| AttendanceRecord | `6a6f30cc953a62bef8440e76` | 标记测试记录 |
| AttendanceRecord | `6a6f30cc953a62bef8440e7c` | 标记测试记录 |
| AttendanceRecord | `6a6f30cc953a62bef8440e82` | 标记测试记录 |
| UI actions | 以固定标记、测试员工与 live schedule 交叉筛选 | 包含外出/返回/休息测试；删除前必须先列出预览 |

## 签核表单与申请

| 类型 | ID | 标记/状态 |
|---|---|---|
| FormTemplate | `6a6f324a953a62bef8440f04` | `CODEX_TEST_20260802_請假` |
| FormField | `6a6f324a953a62bef8440f0e` | 测试栏位 |
| FormField | `6a6f324a953a62bef8440f13` | 测试栏位 |
| FormField | `6a6f324a953a62bef8440f18` | 测试栏位 |
| FormField | `6a6f324a953a62bef8440f1d` | 测试栏位 |
| FormField | `6a6f324a953a62bef8440f22` | 测试栏位 |
| ApprovalRequest | `6a6f32e4953a62bef8440f6d` | approved |
| ApprovalRequest | `6a6f3416953a62bef8441185` | canceled |
| ApprovalRequest | `6a6f3416953a62bef8441195` | rejected |
| FormField proof artifact | `6a6f3121953a62bef8440ed3` | 线上旧版挂载自动修补缺陷造成；附加于既有预设表单，保留待确认 |

签核附件随上述申请保存，清理时必须先确认请求 ID 与实际附件 metadata；不得依 `/upload` 目录时间直接删除。

## 薪资资料

| 类型 | ID | 备注 |
|---|---|---|
| PayrollRecord | `6a6f347cbaa5f3719df394ff` | EMP01，2026-09，标记测试薪资 |

## 数量核对建议

清理前应先执行只读查询，并核对：

1. 固定标记能命中的 organization、department、subdepartment、employee、form、field 与 shift 数量。
2. 下列 ID 均存在且所属员工为测试员工。
3. 所有拟删除 attachment 均属于清单中的申请。
4. proof artifact 只删除该栏位本身，不得删除它所在的既有表单。
5. 清理后重新核对客户员工、签核模板、薪资与班表总数未减少。

目前不执行清理。待使用者验收并明确说“删除测试资料”后，再依据本清单产生可预览、可回滚的清理脚本。
