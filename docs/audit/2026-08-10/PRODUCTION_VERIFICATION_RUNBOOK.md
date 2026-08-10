# HR 系统生产环境可重现验收流程

日期：2026-08-10  
适用版本：`1d15e14` 或更新版本  
目标：用同一套步骤重复验证线上 API、权限、排班规则、Excel 汇入预览及前端冷启动。

## 安全边界

- 自动化只选取名称、帐号或员工编号包含 `CODEX_TEST_` 的测试员工。
- Excel 汇入固定使用 `mode=preview`，不会提交排班。
- 测试前后读取同一员工、同一月份的班表，并比较数量及记录 ID。
- 不执行删除、种子资料、结薪、核准、发布或 `commit` 汇入。
- 唯一的设定写入请求是尝试关闭强制周休；正确系统必须以 `400` 拒绝，脚本随即重新读取确认设定仍为开启。
- 不要把密码写进命令列、仓库、截图或测试报告。

## 一、自动化验收

### Linux / VM

```bash
cd ~/projects/hr-system/server
export HR_BASE_URL='http://220.130.79.215:3000'
export HR_ADMIN_USERNAME='admin'
read -rsp 'Admin password: ' HR_ADMIN_PASSWORD && echo
export HR_ADMIN_PASSWORD
npm run verify:production
unset HR_ADMIN_PASSWORD
```

### Windows PowerShell

```powershell
cd D:\工作资料\hr\hr-system-node\server
$env:HR_BASE_URL = 'http://220.130.79.215:3000'
$env:HR_ADMIN_USERNAME = 'admin'
$credential = Get-Credential -UserName 'admin' -Message 'HR production verification'
$env:HR_ADMIN_PASSWORD = $credential.GetNetworkCredential().Password
npm run verify:production
Remove-Item Env:HR_ADMIN_PASSWORD
```

可选参数：

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `HR_VERIFY_EMPLOYEE_MARKER` | `CODEX_TEST_` | 限定测试员工，防止误用客户资料 |
| `HR_VERIFY_MONTH` | `2099-12` | 隔离验证月份，格式必须为 `YYYY-MM` |
| `HR_VERIFY_SHIFT_CODE` | 自动选择第一个工作班 | 指定要验证的工作班代码 |

### 自动化步骤及预期结果

1. `GET /api/health`：回传 `200` 与 `{ "status": "OK" }`。
2. `POST /api/login`：管理员登入成功并取得 Token；输出不会显示密码或 Token。
3. `GET /api/attendance-settings`：存在 `laborRules`，强制一例一休为开启，班间隔至少 660 分钟。
4. 未带 Token 请求 `POST /api/schedules/import`：必须回传 `401`。
5. 带 Token 尝试设定 `strictCompanyWeeklyRest=false`：必须回传 `400`；重新读取仍为 `true`。
6. `GET /api/shifts`：验证旧班别语义，例如 `08-17(休1)` 仍是工作班，`休假／例假／国定假日／特休` 分类正确。
7. 搜寻 `CODEX_TEST_` 员工并选择有部门资料者；若没有测试员工，立即停止，不改用客户员工。
8. 读取隔离月份原班表数量及记录 ID。
9. 在记忆体产生一份只有一天工作班的公版 XLSX，并以 `mode=preview` 上传。
10. 预览必须回传 `200`、`scheduleDays=1`、`errors=[]`。
11. 再次读取班表；数量及记录 ID 必须与第 8 步完全相同。
12. 读取首页及其引用的 JS/CSS 资源，必须全部回传 `200`。

成功结尾应为：

```text
Verification complete: 11/11 checks passed.
No schedule import was committed and no existing record was deleted.
```

任何一步不符会显示 `[FAIL]`、停止执行并回传非零退出码，适合纳入部署脚本或 CI。

## 二、前端人工重现

### 冷启动及静态资源

1. 开启无痕窗口及开发者工具，Network 勾选 `Disable cache`。
2. 前往 `http://220.130.79.215:3000/?verify=<部署提交编号>`。
3. 预期显示登入页，不得白屏；Console 不得出现 JavaScript error。
4. 重新载入一次，预期结果相同；Network 中入口 JS、CSS 与 `/env.js` 均为 `200`。

### 劳动规则页面

1. 使用管理员帐号登入。
2. 进入「出勤设定」的劳动规则页。
3. 确认显示工时制度、班间隔、月加班上限及核准依据栏位。
4. 页面不得提供关闭公司强制一例一休的控制项。
5. 若启用 8 小时间隔例外、变形工时或延长加班额度但未填核准依据，储存必须失败并显示原因。

### 班表 Excel 预览

1. 进入 `/front/schedule`，确认有「汇入 Excel」按钮。
2. 选择 `CODEX_TEST_` 员工所属部门及隔离月份 `2099-12`。
3. 上传公版 `.xlsx`，先看预览，不按确认汇入。
4. 预期员工、日期、班别能正确映射；错误与警告须指出列号、日期及原因。
5. 离开弹窗后重新进入同月份，班表不得出现刚才预览的资料。

## 三、本地完整回归

```bash
cd server
npm test -- --runInBand

cd ../client
npm test -- --run
npm run build
```

验收基准：后端 `77` 个套件、`452` 项通过且失败为 `0`；前端 `43/43` 个测试档、`281/281` 项通过；生产 build 成功。

## 四、常见失败与重现判断

| 现象 | 判断方式 | 处理方向 |
|---|---|---|
| 汇入 API 为 `404` | 自动化停在授权或预览步骤 | VM 后端仍是旧版，执行 `git pull` 后重启 PM2 |
| 登入后没有劳动规则页 | API 有新栏位但页面没有 | 重新执行前端 `npm ci && npm run build` |
| 无痕冷启动白屏 | Console 出现 Element Plus chunk/cycle 错误 | 确认部署包含 `1d15e14`，清除旧静态资源与浏览器缓存 |
| 预览为 `401` | 登入 Token 无效或已过期 | 重新登入；确认 PM2 使用正确 `JWT_SECRET` |
| 预览为 `422` | 回应内有 `errors` 或 `violations` | 依列号检查员工、班别、既有排班或劳规冲突，不可跳过检核 |
| 找不到 `CODEX_TEST_` | 脚本在员工选择处停止 | 建立明显标记且有部门的测试员工后再执行 |
| 前后班表数量不同 | 非破坏性检查失败 | 立即停止验收并保留输出，检查线上是否错误进入 commit 路径 |

## 五、证据记录模板

```text
测试时间（Asia/Taipei）：
测试人员：
部署提交编号：
目标网址：
自动化结果：__ / 11 PASS
后端测试：__ / 452 PASS
前端测试：__ / 281 PASS
前端冷启动：PASS / FAIL
Console error 数量：
Excel 预览结果：
测试前班表数：
测试后班表数：
异常与截图位置：
```
