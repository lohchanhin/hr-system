# 第一批上线阻断修正与评分报告

日期：2026-08-02

基准提交：`5c8b22e1019536da3155cbb1d337a20b7ecdec5d`

评估对象：本地 `main` 候选代码，尚未代表目标 VM 已部署

## 管理结论

本批已关闭公网评估中最紧急的固定管理员凭证风险，并完成认证会话、安全标头、请求限制、员工资料最小化分页，以及薪资总览分页与批次查询。综合工程评分由 **4.6/10** 提升为 **6.2/10**。

目前代码比基准明显安全且更适合几百至几千名员工的查询，但仍不符合正式上线闸门。主要原因是台湾劳动法规与费率尚未完整版本化、特权帐号没有 MFA、管理员职责尚未拆分、敏感读取没有不可修改审计、生产依赖仍有 High 风险、全量测试尚未全绿，以及目标环境尚未完成网域、TLS、备份还原与部署后动态验证。

这些分数是工程风险评估，不是 ISO 认证、渗透测试保证或台湾法律意见。

## 十分制评分

| 面向 | 修正前 | 当前代码 | 说明 |
|---|---:|---:|---|
| 功能完整度 | 7.0 | 7.4 | HR、排班、打卡、签核、薪资功能广，但部分流程与全量回归仍有缺口 |
| 台湾 HR 法规与业务逻辑 | 5.0 | 5.0 | 本批未完成变形工时、费率历史版本、补休/特休完整状态机及法规/内规分层 |
| 身分认证与会话安全 | 3.0 | 7.2 | 移除固定管理员、强化 JWT、即时帐号/角色检查与限流；仍缺 MFA、会话清单与 refresh token 轮替 |
| 权限与个资保护 | 5.0 | 6.8 | 员工清单改为最小字段；仍有单一超级管理员、敏感读取审计与附件生命周期缺口 |
| API 与输入安全 | 4.0 | 6.8 | 加入 CSP/安全标头、请求上限、通用错误、查询跳脱与 ID 验证；尚未覆盖所有 controller |
| 效能与扩展能力 | 4.5 | 6.5 | 员工及薪资分页、稳定排序、批次签核查询；薪资仍是同步逐员计算，前端主 chunk 仍过大 |
| 模组化与维护性 | 5.0 | 5.6 | 新增环境与 HTTP middleware 边界；大型 controller/Vue 元件仍待拆分 |
| 测试与发布保证 | 5.5 | 6.4 | 本批 125/125 通过且无新增前端失败；全量测试仍有既有失败与测试隔离问题 |
| 维运、审计与备份 | 3.5 | 4.5 | 新增 request ID、慢请求日志与启动防呆；仍缺集中审计、监控告警及可证明的还原演练 |
| 正式上线准备度 | 3.5 | 5.5 | 代码阻断项大幅减少；网域/TLS、秘密轮替、依赖、MFA、审计及部署验证尚未完成 |
| **综合平均** | **4.6** | **6.2** | 各面向等权平均，四舍五入至小数一位 |

## 本批完成内容

### 认证与帐号

- 生产环境不再使用固定 `admin/password` fallback。
- 没有管理员时，仅能透过明确的 bootstrap 环境变量建立首位管理员；密码至少 15 字元且拒绝常见占位值。
- 非测试环境的 `JWT_SECRET` 必须至少 32 bytes，且拒绝常见或占位值，否则服务停止启动。
- JWT 固定为 `HS256`，验证 `issuer`、`audience`、期限与权限版本。
- 每个受保护请求重新检查帐号是否存在、是否停用/离职/留停、角色与 `authVersion` 是否仍一致。
- 改密、角色、任职状态或帐号启用状态改变后，旧 Token 自动失效。
- 登入加入来源与帐号来源组合限流，并统一失败讯息，降低帐号枚举风险。
- 密码比对改用 constant-time 比较；登出只接受可验证的 Bearer Token。
- 防止移除或停用最后一个可用管理员。

### HTTP 与 API 基线

- 加入 Helmet、CSP、frame protection、`nosniff`、referrer policy 与 permissions policy。
- 移除 `X-Powered-By`，API 一律回传 `Cache-Control: no-store`。
- JSON 默认限制为 2 MB，urlencoded 默认限制为 256 KB，并限制参数数量。
- malformed JSON、超大请求、API 404 与未处理错误回传通用格式，不泄漏 stack、路径或数据库错误。
- 每个请求产生 `X-Request-Id`；超过 500 ms 的请求记录方法、路径、状态与耗时。
- 仅在明确设定受信任 proxy hops 时启用 `trust proxy`；HSTS 默认等网域与 HTTPS 完成后才开启。

### 员工与薪资查询

- `GET /api/employees` 默认每页 20、最高 100，稳定依姓名、员工编号与 `_id` 排序。
- 员工清单只回传列表所需字段，不再回传身分证、薪资、银行、医疗与住址资料。
- 搜寻字串限制长度并跳脱正则；角色、状态及 ObjectId 筛选先验证。
- 编辑员工时另行读取完整详情，维持原编辑功能而不扩大清单资料面。
- 打卡汇入改用专用最小字段选项端点，并设定 5,000 笔上限。
- 薪资总览默认每页 20、最高 100，并支援服务器端员工搜寻与稳定排序。
- 当前页的签核资料改为一次批次查询，复用工时与夜班计算资料，并限制同时计算 5 人。
- 前端员工与薪资页面加入服务器端分页、载入状态、条件保留与过期请求防护。

## API 相容性变化

以下为刻意的 response contract 变化，部署时前后端必须一起更新：

```json
GET /api/employees
{
  "employees": [],
  "pagination": { "total": 0, "page": 1, "pageSize": 20, "totalPages": 1 },
  "summary": { "active": 0 }
}
```

```json
GET /api/payroll/overview/monthly
{
  "items": [],
  "pagination": { "total": 0, "page": 1, "pageSize": 20, "totalPages": 1 }
}
```

- 新增 `GET /api/employees/attendance-import-options`，仅管理员可用。
- 排班人员继续使用 `GET /api/employees/schedule`，不会读取完整员工主档。
- 新签发 Token 含 `issuer/audience/authVersion`；部署后现有 Token 会失效，使用者必须重新登入。

## 测试证据

| 项目 | 结果 |
|---|---|
| 本批后端差异测试 | **125/125 通过**，11 个 suite 全绿 |
| 后端全量 | 415 tests：387 pass、17 fail、11 skip；70 suites 中 62 pass、7 fail、1 skip |
| 后端基准对照 | 同机基准为 394 tests：348 pass、35 fail、11 skip；本批修复多项 payroll 回归并增加安全测试 |
| 前端全量 | 274 tests：229 pass、45 fail |
| 前端基准对照 | 基准为 227 pass、47 fail；**新增失败 0，既有失败减少 2** |
| 生产构建 | Vite build 成功，1,536 modules transformed |
| 依赖审计（production） | 后端 8 High / 6 Moderate；前端 4 High；均无 Critical |
| 依赖审计（含开发工具） | 后端与前端工具链均仍有 1 Critical，须在 CI 整改 |

剩余后端失败集中在考勤 Excel mock/时区、夜班测试资料、随机种子、Windows 路径与测试顺序隔离；照片上传测试单独执行可通过。前端剩余失败集中在既有排班日期假设、仪表板、布局与签核流程。它们不是本批新增回归，但仍会降低发布保证，不能视为已验收。

生产构建仍警告 `index` chunk 约 1,017 kB、`xlsx` chunk 约 430 kB，后续应拆分路由与重型依赖。

## 原发现处置状态

| 原发现 | 状态 | 备注 |
|---|---|---|
| WEB-P0-01 固定管理员凭证 | 代码已修，待部署 | 部署前必须轮替正式管理员密码与 JWT secret |
| WEB-P1-01 员工清单过度回传 | 代码已修，待部署验证 | 已分页与投影；编辑详情仍按对象授权读取 |
| WEB-P1-02 HTTP 无 TLS | 未修 | 等客户网域、证书与 reverse proxy |
| WEB-P1-03 Token/CSP 纵深不足 | 部分修正 | 安全标头完成；Token 仍在 `localStorage` |
| WEB-P1-04 管理角色未分权 | 未修 | 需拆 `system/hr/payroll/attendance/auditor` 权限 |
| WEB-P1-05 敏感资料审计不足 | 部分修正 | 有 request ID，尚无 append-only AuditEvent |
| WEB-P1-06 法规规则不可版本化 | 未修 | 需 Rules & Compliance 模组 |
| WEB-P1-07 薪资保险休假规则缺口 | 未修 | 需费率与状态机版本化，并经台湾劳务/法务确认 |
| WEB-P2-01 登入自动化攻击 | 部分修正 | 已限流；特权帐号仍缺 MFA 与风险告警 |
| WEB-P2-02 旧 Token 不撤销 | 大幅修正 | 已用帐号状态、角色与 authVersion 即时撤销；尚无装置会话管理 |
| WEB-P2-03 正则/内部错误 | 部分修正 | 员工、薪资与通用 HTTP 层已修；其他 controller 仍须逐一收敛 |
| WEB-P2-04 50 MB 请求体 | 代码已修，待部署 | 默认降为 2 MB / 256 KB |
| WEB-P2-05 薪资 N+1 与无分页 | 大幅修正 | 已分页与批次查询；长期仍应改为背景计算 read model |
| WEB-P2-06 已知依赖漏洞 | 未修 | production 仍有 12 个 High，需逐项升级或书面例外 |
| WEB-P2-07 附件生命周期 | 未修 | 需统一 Documents 模组与内容扫描 |
| WEB-P2-08 全量测试未全绿 | 部分修正 | 无新增前端失败、差异测试全绿；全量仍失败 |
| WEB-P3-01 大型模组 | 部分修正 | 新增 config/middleware 边界，大型元件与 controller 尚待拆分 |

## 部署前必要动作

1. 先完成 MongoDB 一致性备份，并在隔离资料库验证可还原、文件数与索引一致。
2. 产生新的随机 JWT secret，例如 `openssl rand -base64 48`，不得沿用仓库或聊天中出现过的值。
3. 更换现有管理员密码；若数据库已有管理员，不需要保留 bootstrap 管理员环境变量。
4. 同步部署前端与后端，执行 `npm ci`、前端 production build，再以 PM2 重启服务。
5. 确认所有使用者必须重新登入；验证停用、降权与改密后旧 Token 立即回 `401`。
6. 网域与 reverse proxy 完成后设置精确 `FRONTEND_URL`、`TRUST_PROXY_HOPS=1`，确认全站 HTTPS 后才启用 `ENABLE_HSTS=true`。
7. 动态验证 CSP、CORS、`no-store`、限流、分页、员工详情、薪资总览及附件授权。
8. 正式开放前关闭公网直接访问 Node 端口，只允许 reverse proxy/VPN/明确来源。

## 下一批优先顺序

1. 清除 production High/Critical 依赖并建立自动 SBOM/依赖扫描。
2. 特权帐号 MFA、可撤销会话清单、登录失败审计与告警。
3. 管理职责拆分与敏感资料 append-only 审计。
4. 台湾法规/公司内规版本化、费率历史、补休与特休状态机。
5. 修复全量测试的时区、fixture、mock 隔离及 Windows 路径问题，CI 必须全绿。
6. 薪资改为冻结事实与背景计算；拆分大型 Vue/controller 及前端 chunk。
7. Documents 模组、附件内容检查、病毒扫描、保留与删除政策。

## 参考基准

- [公网部署非破坏性安全评估](PUBLIC_DEPLOYMENT_PENTEST.md)
- [产品安全与模块化整改路线图](PRODUCT_HARDENING_ROADMAP.md)
- [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x03-introduction/)
- [NIST SP 800-218 SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final)
- [ISO/IEC 27001:2022](https://www.iso.org/standard/27001)
