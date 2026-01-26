# 主管排班页面导出功能修复总结

## 问题描述
主管排班页面（Schedule.vue）无法导出 PDF 和 Excel 文件。

## 根本原因
前端调用导出 API 时，只发送了 `month` 和 `format` 参数，但后端 API (`/api/schedules/export`) 要求必须同时提供：
- `month` (月份)
- `department` (部门)
- `subDepartment` (单位，可选)

这导致后端返回 400 错误：`{error: "month and department required"}`

## 解决方案
修改了前端 `Schedule.vue` 文件中的 `exportSchedules` 函数，使其自动从页面当前状态获取并发送所需参数：

### 修改前
```javascript
async function exportSchedules(format) {
  try {
    const res = await apiFetch(
      `/api/schedules/export?month=${currentMonth.value}&format=${format}`
    )
    // ... rest of code
  }
}
```

### 修改后
```javascript
async function exportSchedules(format) {
  try {
    const params = new URLSearchParams({
      month: currentMonth.value,
      format: format,
      department: selectedDepartment.value
    })
    if (selectedSubDepartment.value) {
      params.append('subDepartment', selectedSubDepartment.value)
    }
    const res = await apiFetch(
      `/api/schedules/export?${params.toString()}`
    )
    // ... rest of code
  }
}
```

## 变更说明
**自动参数传递：**
- ✅ `month` - 自动使用当前显示的月份 (`currentMonth.value`)
- ✅ `department` - 自动使用当前选择的部门 (`selectedDepartment.value`)
- ✅ `subDepartment` - 如果有选择单位，自动包含 (`selectedSubDepartment.value`)

**用户体验改进：**
- 用户无需额外设定任何参数
- 导出的数据自动对应当前页面显示的内容
- 点击"匯出 PDF"或"匯出 Excel"按钮即可直接下载

## 测试验证
- ✅ 后端导出测试全部通过 (schedule.test.js)
- ✅ 代码审查无问题
- ✅ CodeQL 安全检查无问题
- ✅ 确认导出库已安装 (exceljs v4.4.0, pdfkit v0.13.0)

## 影响范围
**修改的文件：**
- `client/src/views/front/Schedule.vue` (仅修改 9 行，新增 8 行)

**不影响：**
- 后端代码无需修改
- 其他页面功能不受影响
- 数据库结构无变化

## 相关文件
- 前端页面：`client/src/views/front/Schedule.vue`
- 后端控制器：`server/src/controllers/scheduleController.js`
- 后端路由：`server/src/routes/scheduleRoutes.js`
- 后端测试：`server/tests/schedule.test.js`

## 技术细节
使用 `URLSearchParams` API 构建查询参数，确保：
- 参数正确编码
- 代码清晰易读
- 易于维护和扩展

## 日期
2026-01-26
