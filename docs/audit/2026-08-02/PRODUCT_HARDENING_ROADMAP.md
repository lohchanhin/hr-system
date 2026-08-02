# HR 产品安全与模块化整改路线图

日期：2026-08-02

执行进度请见[第一批上线阻断修正与评分报告](REMEDIATION_AND_SCORECARD.md)。其中标记为“代码已修”的项目仍须完成目标环境部署与动态验证。

## 产品目标

本系统建议以“台湾中小型机构 HR 模组化单体”继续演进，不急于拆成微服务。目标基线为：

- 应用安全以 OWASP ASVS 5.0 Level 2 为验收基准。
- API 风险以 OWASP API Security Top 10 2023 建立测试矩阵。
- 开发流程采用 NIST SP 800-218 SSDF。
- 组织、人员、流程与技术控制纳入 ISO/IEC 27001:2022 风险管理；代码通过不等于取得 ISO 认证。
- 台湾劳动法、个资法及公司内规分别版本化，正式结论由台湾劳务/法务确认。

“没有任何漏洞”无法由一次测试保证。可验收目标应改为：所有已知 P0/P1 关闭、ASVS L2 控制有证据、关键逻辑具自动化性质测试、持续监控可发现新风险，并有可演练的备份与回滚。

## 建议架构

保留 Express + MongoDB + Vue，重整为有边界的模组化单体：

| 模组 | 责任 | 不可跨越的边界 |
|---|---|---|
| Identity & Access | 帐号、凭证、MFA、会话、角色与权限版本 | 不保存 HR 明细；其他模组不得自行解析角色决定物件范围 |
| Workforce | 员工主档、组织、部门、任职状态 | 薪资与银行字段以独立权限/DTO 提供，不由通用员工清单回传 |
| Scheduling | 班表草稿、发布、确认、调班 | 只产生排班事实；法规判定调用 Rules 模组 |
| Time & Attendance | 打卡、异常、补登、工时账本 | 人工修正必须独立权限、理由与审计事件 |
| Leave & Approval | 表单、流程、请假、加班、撤回与重送 | 状态机与冪等键统一；不直接修改薪资快照 |
| Rules & Compliance | 工时制度、法定规则、公司政策、有效期间 | 输入事实、输出规则代码与证据；规则不可依显示名称判断 |
| Payroll | 计薪批次、计算快照、调整与结清 | 只使用已冻结工时/请假事实与版本化费率；不得即时重算全员后直接覆盖历史 |
| Benefits | 劳保、就保、职灾、劳退、健保费率版本 | 每笔费率有来源、生效/失效日及版本 |
| Documents | 私有档案、扫描、保留、删除与授权下载 | 不允许 data URL 或任意外部 URL 作为正式附件存储 |
| Audit & Operations | 不可修改稽核、request ID、告警、备份与恢复 | 一般管理员不可删除或覆盖审计事件 |

每个模组采用相同层次：`routes -> controller -> application service -> domain policy -> repository`。Controller 只负责 HTTP DTO；授权、规则、交易与查询范围必须由可测试的 application/domain service 执行。

跨模组写入使用事务或 outbox：例如签核核准先记录不可重复的领域事件，再由特休与薪资消费者处理；失败可重试且有补偿状态，不能靠两个独立 `save()` 假装原子交易。

## Phase 0：立即止血（当天）

| 工作 | 验收 |
|---|---|
| 限制公网 `3000`、轮替管理员密码与 JWT secret | 未授权来源无法连线；旧 Token 全部失效 |
| 移除固定预设管理员 | 生产缺少 bootstrap secret 时启动失败；首次使用后 secret 失效 |
| 备份与日志保全 | MongoDB 备份在隔离环境成功还原，集合数、文件数与索引核对一致 |
| 冻结正式资料破坏性操作 | 部署与资料修复都有变更单、执行人、回滚点与核对结果 |

## Phase 1：安全基线（第 1 个 Sprint）

1. 加入 `helmet` 等效安全标头、关闭 `X-Powered-By`、敏感 API `no-store`；网域上线时启用 TLS、HTTP 跳转与 HSTS。
2. 登入依帐号与来源双维度限流，加入退避、失败审计与告警；特权角色启用 MFA。
3. JWT 改为短效 access token + 可撤销会话；Token 使用 `jti` 与权限版本，停用、离职、降权、改密可撤销全部会话。
4. 通用 JSON 限制降至业务需要的大小；档案一律 multipart 并设置独立限制。
5. 建立统一错误 middleware，不回传 Mongoose、正则、路径或 stack；查询参数使用 schema 验证并跳脱 regex。
6. 修正生产依赖；无修补的 `xlsx` 隔离在后台工作程序或替换，并建立例外期限。

验收：预设凭证不可登入；失败登入产生限流；安全标头自动测试通过；High/Critical 生产依赖为 0，或有有期限、负责人及缓解措施的书面例外。

## Phase 2：权限、个资与审计（第 2 个 Sprint）

1. 把 `admin` 拆为 `system_admin`、`hr_admin`、`payroll_admin`、`attendance_manager`、`auditor`，并保留员工与主管的物件范围规则。
2. 所有 API 使用明确 input/output DTO；员工清单默认 20 笔，只回清单字段，敏感详情按资料域另开端点。
3. 建立中央授权 policy service，统一验证 actor、action、resource 与 organization/department scope。
4. 建立 append-only `AuditEvent`：actor、权限快照、动作、物件、结果、request ID、IP、时间及变更摘要；定期外部封存。
5. 证照、训练、签核与照片统一进入 Documents 模组，加入 MIME/magic bytes、病毒扫描、保留期限及孤儿清理。

验收：三角色加细分管理员的 API 矩阵全绿；薪资/银行资料每次读取都有审计；一般系统管理员无法读取薪资。

## Phase 3：法规与业务正确性（第 3-4 个 Sprint）

1. 建立 `WorkRulePolicy`：制度类型、适用组织/职类、法定程序证据、生效日、失效日及版本。
2. 班别使用稳定代码区分工作日、休息日、例假、国定假日与请假，不再以名称包含“例／休”判定。
3. 建立逐分钟工时账本，处理跨日、跨月、时区及实际发生日；排班、打卡、加班与薪资共用同一事实来源。
4. 加班支持一般 46 小时与合法 54/138 小时例外、每日 12 小时、班间 11/8 小时例外及相关证据。
5. 建立补休与特休状态机：取得、使用、撤回回补、到期、递延、终止结清与工资快照。
6. 费率与级距全部版本化；旧月份永远使用当月版本，重算产生新版本而不覆盖历史。

验收：黄员、刘员案例及一般/二周/四周/八周制度均有固定 `Asia/Taipei` 自动化测试；每个判定回传规则代码、政策版本、日期范围与证据。

## Phase 4：效能与可扩展性（第 4-5 个 Sprint）

1. 员工、签核、班表、薪资全部服务器端分页、投影、稳定排序及查询上限。
2. 薪资总览改为“冻结事实 -> 背景计算 -> 可分页 read model”，不在 GET 请求中逐员工重算。
3. 为常用组织/部门/月份/状态查询建立复合索引，并以 `explain()` 与慢查询日志验证。
4. 前端拆分 5,521 行员工元件及大型路由 chunk；每个业务模组独立 store、API client 与页面边界。
5. 加入 request ID、结构化日志、p50/p95/p99、错误率、Mongo 延迟、queue lag、磁碟与备份告警。

验收：1,000-3,000 名员工资料下，普通清单 p95 < 300 ms；复杂薪资预览改为背景任务并显示进度；任何同步 API p95 超过 500 ms 都会告警。

## Phase 5：发布与持续保证

CI 必须包含：

- 单元、整合、角色授权、性质测试与前端回归全部通过，禁止带失败测试发布。
- SAST、secret scan、依赖扫描、SBOM 与许可证检查。
- staging DAST 与 ASVS 5.0 L2 证据矩阵。
- MongoDB 隔离恢复演练、升级/回滚演练及资料核对脚本。
- 台湾劳务/法务对工时制度、假别、薪资与保险版本签核。

发布采用小批次迁移、feature flag 与可观察回滚。授权修复、审计事件及历史薪资不可因回滚而恢复不安全旧行为。

## 上线闸门

正式开放前必须同时满足：

1. 所有 P0/P1 已修正并有自动化与动态证据，或由资料负责人、资安与法务共同书面接受风险。
2. 正式网域、TLS、HSTS、备份、告警与事件应变联系人完成。
3. 生产依赖无未处理 High/Critical；全量测试为绿色。
4. 角色职责分离、敏感读取审计与附件生命周期可实际演示。
5. 台湾法规矩阵由具资格人员确认适用制度与有效日期。

## 标准来源

- OWASP Application Security Verification Standard 5.0.0: https://owasp.org/www-project-application-security-verification-standard/
- OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0x03-introduction/
- NIST SP 800-218 SSDF 1.1: https://csrc.nist.gov/pubs/sp/800/218/final
- ISO/IEC 27001:2022: https://www.iso.org/standard/27001
