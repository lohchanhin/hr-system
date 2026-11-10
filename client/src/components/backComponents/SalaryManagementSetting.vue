<!-- src/Components/backComponents/SalaryManagementSetting.vue -->
<!--
  薪資管理：月薪資總覽（每位員工一列）、匯出（銀行匯款檔、獎金紙條、總覽 PDF、個人薪資表）、單一員工的薪資明細。
  畫面上的金額一律是伺服器算好的數字（/api/payroll/overview/monthly），這裡只做格式化與「把這一頁的列加總」，
  不重算任何一位員工的薪資：同一位員工在畫面、PDF、匯款檔才會是同一個數字。
-->

<template>
  <div class="salary-page">
    <PageHeader stats-below title="薪資管理">
      <template #stats>
        <span class="hr-stat" data-test="stat-count">
          <span class="hr-stat__label">人數</span>
          <strong class="hr-stat__value">{{ statHeadCount }}</strong>
        </span>
        <span class="hr-stat" data-test="stat-net-pay">
          <span class="hr-stat__label">實領（銀行A）</span>
          <strong class="hr-stat__value">{{ formatCurrency(statTotals.netPay) }}</strong>
        </span>
        <span class="hr-stat" data-test="stat-total-bonus">
          <span class="hr-stat__label">獎金（銀行B）</span>
          <strong class="hr-stat__value">{{ formatCurrency(statTotals.totalBonus) }}</strong>
        </span>
        <span class="hr-stat" data-test="stat-total-payment">
          <span class="hr-stat__label">實發合計</span>
          <strong class="hr-stat__value">{{ formatCurrency(statTotals.totalPayment) }}</strong>
        </span>
      </template>
      <template #actions>
        <div class="month-switch">
          <el-button :icon="ArrowLeft" aria-label="上個月" data-test="prev-month" @click="shiftMonth(-1)" />
          <el-date-picker
            v-model="overviewMonth"
            class="month-picker"
            type="month"
            format="YYYY/MM"
            value-format="YYYY-MM-01"
            :clearable="false"
            :editable="false"
            data-test="month-picker"
            @change="applyOverviewFilters"
          />
          <el-button :icon="ArrowRight" aria-label="下個月" data-test="next-month" @click="shiftMonth(1)" />
        </div>
      </template>
    </PageHeader>

    <div class="hr-toolbar">
      <el-select
        v-model="filterOrganization"
        class="filter-select"
        placeholder="全部機構"
        clearable
        data-test="filter-organization"
        @change="handleOrganizationChange"
      >
        <el-option v-for="org in organizations" :key="org._id" :label="org.name" :value="org._id" />
      </el-select>
      <el-select
        v-model="filterDepartment"
        class="filter-select"
        placeholder="全部部門"
        clearable
        data-test="filter-department"
        @change="handleDepartmentChange"
      >
        <el-option v-for="dept in departmentOptions" :key="dept._id" :label="dept.name" :value="dept._id" />
      </el-select>
      <el-select
        v-model="filterSubDepartment"
        class="filter-select"
        placeholder="全部單位"
        clearable
        data-test="filter-sub-department"
        @change="applyOverviewFilters"
      >
        <el-option v-for="sub in subDepartmentOptions" :key="sub._id" :label="sub.name" :value="sub._id" />
      </el-select>
      <el-input
        v-model="filterEmployeeName"
        class="filter-search"
        placeholder="搜尋姓名或員工編號"
        clearable
        :prefix-icon="Search"
        data-test="filter-employee"
        @input="scheduleOverviewSearch"
        @keyup.enter="applyOverviewFilters"
      />
      <div class="toolbar-actions">
        <el-button link :icon="QuestionFilled" data-test="open-explanation" @click="showExplanationDialog = true">
          薪資計算說明
        </el-button>
        <!-- 月中到職／離職的月薪比例、加班費倍率在「請假加班設定 › 加班與計薪」調整 -->
        <el-button link :icon="Setting" data-test="open-payroll-policy" @click="openPayrollPolicy">計薪設定</el-button>
        <el-dropdown trigger="click" @command="openExportDialog">
          <el-button type="primary" data-test="export-menu">
            匯出<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="item in EXPORT_FORMATS"
                :key="item.key"
                :command="item.key"
                :data-test="`export-item-${item.key}`"
              >
                {{ item.label }}（{{ item.fileType }}）
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 月薪資總覽：由左到右是 本薪 − 扣款 = 實領（銀行A）、各項獎金 = 獎金（銀行B）、實發合計 = 實領 + 獎金 -->
    <el-table
      v-loading="overviewLoading"
      :data="filteredOverviewData"
      border
      stripe
      show-summary
      :summary-method="summarizeOverview"
      class="payroll-table"
      style="width: 100%"
      max-height="max(360px, calc(100vh - 292px))"
      data-test="payroll-table"
    >
      <template #empty>
        <div v-if="overviewError" class="hr-empty" data-test="overview-error">
          <p>{{ overviewError }}</p>
          <el-button size="small" @click="fetchMonthlyOverview({ withSummary: true })">重新載入</el-button>
        </div>
        <div v-else class="hr-empty" data-test="overview-empty">
          {{ overviewLoading ? '載入中…' : `${monthLabel} 沒有符合條件的員工，請調整上方的篩選條件` }}
        </div>
      </template>

      <el-table-column prop="name" label="員工" width="190" fixed sortable>
        <template #default="{ row }">
          <div class="cell-main">{{ row.name }}</div>
          <div class="cell-sub cell-tags">
            <span>{{ row.employeeId || '-' }}</span>
            <el-tooltip v-if="salaryNotice(row)" :content="salaryNotice(row).tip" placement="top">
              <el-tag size="small" :type="salaryNotice(row).type" class="row-tag">{{ salaryNotice(row).label }}</el-tag>
            </el-tooltip>
            <el-tooltip v-if="row.hasPayrollRecord" content="金額以已儲存的薪資記錄為準" placement="top">
              <el-tag size="small" type="success" class="row-tag">已存檔</el-tag>
            </el-tooltip>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="部門／單位" min-width="150">
        <template #default="{ row }">
          <div class="cell-main">{{ departmentName(row.department) }}</div>
          <div v-if="row.subDepartment" class="cell-sub">{{ subDepartmentName(row.subDepartment) }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="salaryType" label="計薪" width="70" align="center" />

      <el-table-column label="出勤" align="center">
        <el-table-column prop="workDays" label="上班天數" width="92" align="right" sortable>
          <template #default="{ row }">{{ formatHours(row.workDays) }}</template>
        </el-table-column>
        <el-table-column prop="actualWorkHours" label="工時" width="84" align="right" sortable>
          <template #default="{ row }">{{ formatHours(row.actualWorkHours) }}</template>
        </el-table-column>
        <el-table-column prop="leaveHours" label="請假" width="76" align="right">
          <template #default="{ row }"><span :class="numberClass(row.leaveHours)">{{ formatHours(row.leaveHours) }}</span></template>
        </el-table-column>
        <el-table-column prop="overtimeHours" label="加班" width="76" align="right">
          <template #default="{ row }"><span :class="numberClass(row.overtimeHours)">{{ formatHours(row.overtimeHours) }}</span></template>
        </el-table-column>
      </el-table-column>

      <el-table-column label="薪資（銀行A）" align="center">
        <el-table-column prop="baseSalary" label="本薪" width="118" align="right" sortable>
          <template #default="{ row }">
            <span :class="numberClass(row.baseSalary)">{{ formatAmount(row.baseSalary) }}</span>
            <!-- 本薪已經扣掉請假扣款，這裡只是註明扣了多少，不是另一筆扣款 -->
            <div v-if="toNumber(row.leaveDeduction) > 0" class="cell-sub">已扣請假 {{ formatAmount(row.leaveDeduction) }}</div>
          </template>
        </el-table-column>
        <el-table-column
          v-for="column in DEDUCTION_COLUMNS"
          :key="column.prop"
          :prop="column.prop"
          :label="column.label"
          width="96"
          align="right"
        >
          <template #default="{ row }">
            <span :class="numberClass(row[column.prop])">{{ formatAmount(row[column.prop]) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="netPay" label="實領" width="118" align="right" sortable>
          <template #default="{ row }">
            <strong>{{ formatAmount(row.netPay) }}</strong>
            <!-- 扣款超過本薪：實領是 0，還沒扣到的金額列在下面 -->
            <div v-if="toNumber(row.deductionShortfall) > 0" class="cell-sub cell-sub--warning" data-test="deduction-shortfall">
              未扣 {{ formatAmount(row.deductionShortfall) }}
            </div>
          </template>
        </el-table-column>
      </el-table-column>

      <el-table-column label="獎金（銀行B）" align="center">
        <el-table-column
          v-for="column in BONUS_COLUMNS"
          :key="column.prop"
          :prop="column.prop"
          :label="column.label"
          width="96"
          align="right"
        >
          <template #default="{ row }">
            <span :class="numberClass(row[column.prop])">{{ formatAmount(row[column.prop]) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="totalBonus" label="獎金合計" width="118" align="right" sortable>
          <template #default="{ row }"><strong>{{ formatAmount(row.totalBonus) }}</strong></template>
        </el-table-column>
      </el-table-column>

      <el-table-column prop="totalPayment" label="實發合計" width="124" align="right" :fixed="isMobile ? false : 'right'" sortable>
        <template #default="{ row }"><strong>{{ formatAmount(row.totalPayment) }}</strong></template>
      </el-table-column>
      <el-table-column label="操作" width="132" :fixed="isMobile ? false : 'right'">
        <template #default="{ row }">
          <el-button link type="primary" data-test="row-detail" @click="showDetailDialog(row)">明細</el-button>
          <el-button
            link
            type="primary"
            :loading="isExportingIndividual(row)"
            data-test="row-export"
            @click="exportIndividualPayroll(row)"
          >
            薪資表
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="table-footer">
      <span class="hr-hint" data-test="totals-note">
        金額單位：NT$<template v-if="overviewPagination.totalPages > 1">；<template v-if="overviewSummary">上方統計是全部 {{ statHeadCount }} 人的合計，表格最下面的合計列是本頁 {{ filteredOverviewData.length }} 人</template><template v-else>上方統計與合計列是本頁 {{ filteredOverviewData.length }} 人的加總</template></template>
      </span>
      <el-pagination
        background
        :layout="isMobile ? 'prev, pager, next' : 'total, sizes, prev, pager, next'"
        :total="overviewPagination.total"
        :current-page="overviewPagination.page"
        :page-size="overviewPagination.pageSize"
        :page-sizes="[20, 50, 100]"
        @current-change="handleOverviewPageChange"
        @size-change="handleOverviewPageSizeChange"
      />
    </div>

    <!-- 匯出：先說清楚要匯出什麼（月份、格式、範圍、人數），沒有員工時不能匯出 -->
    <el-dialog
      v-model="exportDialog.visible"
      title="匯出"
      width="520px"
      :fullscreen="isMobile"
      :close-on-click-modal="!exportDialog.submitting"
      data-test="export-dialog"
    >
      <dl class="export-summary" data-test="export-summary">
        <div><dt>月份</dt><dd>{{ monthLabel }}</dd></div>
        <div><dt>格式</dt><dd>{{ exportFormatMeta.label }}（{{ exportFormatMeta.fileType }}）</dd></div>
        <div><dt>範圍</dt><dd>{{ exportScopeText }}</dd></div>
        <div>
          <dt>人數</dt>
          <dd>
            <template v-if="exportDialog.countLoading">計算中…</template>
            <template v-else-if="exportDialog.count === null">無法取得</template>
            <template v-else>{{ exportDialog.count }} 人</template>
          </dd>
        </div>
      </dl>
      <p v-if="exportScopeNote" class="hr-hint hr-hint--warning" data-test="export-scope-note">{{ exportScopeNote }}</p>
      <el-alert
        v-if="exportDialog.count === 0"
        type="warning"
        :closable="false"
        show-icon
        :title="`${monthLabel} 這個範圍沒有員工，沒有資料可以匯出`"
        data-test="export-nothing"
      />
      <template v-if="exportSample">
        <el-button link type="primary" class="sample-toggle" data-test="toggle-sample" @click="exportDialog.sampleVisible = !exportDialog.sampleVisible">
          {{ exportDialog.sampleVisible ? '收合格式範例' : '查看格式範例' }}
        </el-button>
        <div v-if="exportDialog.sampleVisible" data-test="export-sample">
          <p class="hr-hint">以下是欄位示意（假資料），實際內容為 {{ monthLabel }} 的薪資資料。</p>
          <el-table :data="exportSample.rows" border size="small" max-height="220">
            <el-table-column
              v-for="col in exportSample.columns"
              :key="col.prop"
              :prop="col.prop"
              :label="col.label"
              :min-width="col.width"
              :align="col.align || 'left'"
            />
          </el-table>
        </div>
      </template>
      <template #footer>
        <el-button :disabled="exportDialog.submitting" @click="exportDialog.visible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="exportDialog.submitting"
          :disabled="exportDialog.countLoading || exportDialog.count === 0"
          data-test="export-confirm"
          @click="confirmExport"
        >
          匯出
        </el-button>
      </template>
    </el-dialog>

    <!-- 單一員工的薪資明細 -->
    <el-dialog
      v-model="detailDialogVisible"
      title="薪資明細"
      width="960px"
      top="5vh"
      :fullscreen="isMobile"
      class="payroll-detail-dialog"
    >
      <div v-if="selectedEmployee" class="payroll-detail">
        <div class="detail-head">
          <!-- 明細只看一個人：姓名旁放頭像（總覽表格是上百列的數字，不放） -->
          <div class="payroll-person">
            <EmployeeAvatar :employee="selectedEmployee" :size="40" />
            <span>{{ selectedEmployee.name }}</span>
          </div>
          <div class="detail-meta">
            <span>{{ selectedEmployee.employeeId || '-' }}</span>
            <span v-if="selectedEmployee.organization">{{ organizationName(selectedEmployee.organization) }}</span>
            <span>{{ departmentName(selectedEmployee.department) }}<template v-if="selectedEmployee.subDepartment">／{{ subDepartmentName(selectedEmployee.subDepartment) }}</template></span>
            <span>{{ selectedEmployee.salaryType || '月薪' }}</span>
            <span data-test="detail-month">{{ monthLabel }}</span>
          </div>
        </div>

        <el-alert
          v-if="salaryNotice(selectedEmployee)"
          :type="salaryNotice(selectedEmployee).type === 'warning' ? 'warning' : 'info'"
          :closable="false"
          show-icon
          class="detail-alert"
          :title="salaryNotice(selectedEmployee).tip"
          data-test="detail-notice"
        />

        <el-tabs v-model="detailTab" class="detail-tabs">
          <el-tab-pane label="薪資計算" name="pay">
            <table class="pay-breakdown" data-test="pay-breakdown">
              <thead>
                <tr><th>項目</th><th>計算依據</th><th class="is-amount">金額</th></tr>
              </thead>
              <tbody>
                <tr
                  v-for="line in salaryBreakdown"
                  :key="line.key"
                  :class="[`is-${line.kind}`, { 'has-issue': line.hasIssue }]"
                  :data-test="`breakdown-${line.key}`"
                >
                  <td>
                    {{ line.item }}
                    <el-icon v-if="line.hasIssue" class="issue-icon"><WarningFilled /></el-icon>
                  </td>
                  <td class="is-description">{{ line.description }}</td>
                  <td class="is-amount">
                    <span :class="line.kind === 'total' || line.kind === 'grand' ? '' : numberClass(line.amount)">{{ formatSigned(line) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="insuranceLine" class="hr-hint" data-test="insurance-line">{{ insuranceLine }}</p>
            <p v-if="selectedEmployee.hoursSource === 'attendance'" class="hr-hint" data-test="hours-source-note">
              這筆薪資記錄是舊格式、沒有存時數：工時、請假、加班時數依目前的出勤資料，金額照薪資記錄。
            </p>
          </el-tab-pane>

          <el-tab-pane :label="`出勤（${formatHours(detailStats.workDays)} 天）`" name="attendance">
            <div class="detail-stats">
              <span class="hr-stat"><span class="hr-stat__label">上班天數</span><strong class="hr-stat__value">{{ formatHours(detailStats.workDays) }} 天</strong></span>
              <span class="hr-stat"><span class="hr-stat__label">應出勤</span><strong class="hr-stat__value">{{ formatHours(detailStats.scheduledHours) }} 小時</strong></span>
              <span class="hr-stat"><span class="hr-stat__label">實際工時</span><strong class="hr-stat__value">{{ formatHours(detailStats.actualWorkHours) }} 小時</strong></span>
              <span class="hr-stat"><span class="hr-stat__label">換算時薪</span><strong class="hr-stat__value">{{ formatRate(detailStats.hourlyRate) }}</strong></span>
            </div>
            <el-alert v-if="detailError" type="error" :closable="false" show-icon class="detail-alert" :title="detailError" data-test="detail-error">
              <el-button size="small" @click="showDetailDialog(selectedEmployee)">重新載入</el-button>
            </el-alert>
            <el-table
              v-else
              v-loading="detailLoading"
              :data="employeeDetailData?.dailyDetails || []"
              border
              size="small"
              max-height="360"
              :empty-text="detailLoading ? '載入中…' : '這個月沒有排班，請先到排班管理排班'"
            >
              <el-table-column label="日期" width="130">
                <template #default="{ row }">{{ formatScheduleDate(row.date, '-') }}（{{ weekdayOfDateKey(row.date) }}）</template>
              </el-table-column>
              <el-table-column prop="shiftName" label="班別" min-width="100" />
              <!-- 線上打卡與指紋匯入一起比對：上班取最早、下班取最晚，下方小字是該筆打卡的來源 -->
              <el-table-column label="上班" width="96" align="center">
                <template #default="{ row }">
                  <span v-if="row.clockInTime">{{ formatTaiwanTime(row.clockInTime, { fallback: '-' }) }}</span>
                  <span v-else class="is-zero">-</span>
                  <div v-if="row.clockInTime && row.clockInSource" class="punch-source">{{ attendanceSourceLabel(row.clockInSource) }}</div>
                </template>
              </el-table-column>
              <el-table-column label="下班" width="96" align="center">
                <template #default="{ row }">
                  <span v-if="row.clockOutTime">{{ formatTaiwanTime(row.clockOutTime, { fallback: '-' }) }}</span>
                  <span v-else class="is-zero">-</span>
                  <div v-if="row.clockOutTime && row.clockOutSource" class="punch-source">{{ attendanceSourceLabel(row.clockOutSource) }}</div>
                </template>
              </el-table-column>
              <el-table-column label="排班時數" width="92" align="right">
                <template #default="{ row }"><span :class="numberClass(row.scheduledHours)">{{ formatHours(row.scheduledHours) }}</span></template>
              </el-table-column>
              <el-table-column label="實際工時" width="92" align="right">
                <template #default="{ row }"><span :class="numberClass(row.workedHours)">{{ formatHours(row.workedHours) }}</span></template>
              </el-table-column>
              <el-table-column label="狀態" width="110">
                <template #default="{ row }">
                  <el-tag :type="dayStatus(row).type" size="small">{{ dayStatus(row).label }}</el-tag>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane :label="`請假（${formatHours(detailStats.leaveHours)} 小時）`" name="leave">
            <div class="detail-stats">
              <span class="hr-stat"><span class="hr-stat__label">請假</span><strong class="hr-stat__value">{{ formatHours(detailStats.leaveHours) }} 小時</strong></span>
              <span class="hr-stat"><span class="hr-stat__label">給薪</span><strong class="hr-stat__value">{{ formatHours(detailStats.paidLeaveHours) }} 小時</strong></span>
              <span class="hr-stat"><span class="hr-stat__label">不給薪</span><strong class="hr-stat__value">{{ formatHours(detailStats.unpaidLeaveHours) }} 小時</strong></span>
              <span class="hr-stat"><span class="hr-stat__label">請假扣款</span><strong class="hr-stat__value">{{ formatCurrency(selectedEmployee.leaveDeduction) }}</strong></span>
            </div>
            <el-table
              v-if="!detailError"
              v-loading="detailLoading"
              :data="employeeDetailData?.leaveRecords || []"
              border
              size="small"
              max-height="300"
              :empty-text="detailLoading ? '載入中…' : '這個月沒有已核准的請假'"
            >
              <el-table-column prop="leaveType" label="假別" min-width="110" />
              <el-table-column label="期間" min-width="200">
                <template #default="{ row }">{{ leavePeriod(row) }}</template>
              </el-table-column>
              <el-table-column label="本月時數" width="120" align="right">
                <template #default="{ row }">
                  {{ formatHours(row.hours) }}
                  <div v-if="row.totalHours !== undefined" class="cell-sub">整張 {{ formatHours(row.totalHours) }}</div>
                </template>
              </el-table-column>
              <el-table-column label="給薪" width="100">
                <template #default="{ row }">
                  <el-tag :type="leavePay(row).type" size="small">{{ leavePay(row).label }}</el-tag>
                </template>
              </el-table-column>
            </el-table>
            <p v-if="annualLeaveLine" class="hr-hint" data-test="annual-leave-line">{{ annualLeaveLine }}</p>
          </el-tab-pane>

          <el-tab-pane :label="`加班（${formatHours(detailStats.overtimeHours)} 小時）`" name="overtime">
            <div class="detail-stats">
              <span class="hr-stat"><span class="hr-stat__label">加班</span><strong class="hr-stat__value">{{ formatHours(detailStats.overtimeHours) }} 小時</strong></span>
              <span class="hr-stat"><span class="hr-stat__label">加班費</span><strong class="hr-stat__value">{{ formatCurrency(selectedEmployee.overtimePay) }}</strong></span>
            </div>
            <!-- 加班時數計算問題（例如疑似漏勾跨日） -->
            <el-alert
              v-if="selectedEmployee.overtimeIssues?.length"
              type="warning"
              :closable="false"
              show-icon
              class="detail-alert"
              title="加班時數可能被低估，請確認加班申請單是否漏勾「跨日」"
            >
              <ul class="issue-list">
                <li v-for="(issue, idx) in selectedEmployee.overtimeIssues" :key="idx">{{ issue }}</li>
              </ul>
            </el-alert>
            <el-table
              v-if="!detailError"
              v-loading="detailLoading"
              :data="employeeDetailData?.overtimeRecords || []"
              border
              size="small"
              max-height="300"
              :empty-text="detailLoading ? '載入中…' : '這個月沒有計入薪資的加班'"
            >
              <el-table-column label="日期" width="130">
                <template #default="{ row }">{{ formatScheduleDate(row.date, '-') }}</template>
              </el-table-column>
              <el-table-column label="日別" width="100">
                <template #default="{ row }">{{ overtimeDayLabel(row) }}</template>
              </el-table-column>
              <el-table-column label="時數" width="80" align="right">
                <template #default="{ row }">{{ formatHours(row.hours) }}</template>
              </el-table-column>
              <el-table-column label="加班費" width="100" align="right">
                <template #default="{ row }">{{ row.pay === undefined ? '-' : formatAmount(row.pay) }}</template>
              </el-table-column>
              <el-table-column label="計算" min-width="200">
                <template #default="{ row }">{{ overtimeSegments(row) }}</template>
              </el-table-column>
              <el-table-column prop="reason" label="原因" min-width="140" />
              <el-table-column label="" width="40" align="center">
                <template #default="{ row }">
                  <el-tooltip v-if="row.hasIssue" :content="row.issue || '此筆加班時數計算可能有誤'" placement="top">
                    <el-icon class="issue-icon"><WarningFilled /></el-icon>
                  </el-tooltip>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane :label="`夜班（${formatHours(selectedEmployee.nightShiftDays)} 天）`" name="night">
            <div class="detail-stats">
              <span class="hr-stat"><span class="hr-stat__label">夜班</span><strong class="hr-stat__value">{{ formatHours(selectedEmployee.nightShiftDays) }} 天</strong></span>
              <span class="hr-stat"><span class="hr-stat__label">夜班時數</span><strong class="hr-stat__value">{{ formatHours(selectedEmployee.nightShiftHours) }} 小時</strong></span>
              <span class="hr-stat"><span class="hr-stat__label">夜班津貼</span><strong class="hr-stat__value">{{ formatCurrency(selectedEmployee.nightShiftAllowance) }}</strong></span>
            </div>
            <p v-if="nightShiftMethodText" class="hr-hint">{{ nightShiftMethodText }}</p>
            <el-alert
              v-if="selectedEmployee.nightShiftConfigurationIssues?.length"
              type="error"
              :closable="false"
              show-icon
              class="detail-alert"
              title="夜班津貼的班別設定有問題，請到「班別設定」修正"
            >
              <ul class="issue-list">
                <li v-for="(issue, idx) in selectedEmployee.nightShiftConfigurationIssues" :key="idx">{{ issue }}</li>
              </ul>
            </el-alert>
            <el-table
              :data="nightShiftGroups"
              border
              size="small"
              empty-text="這個月沒有排夜班"
            >
              <el-table-column label="班別" min-width="140">
                <template #default="{ row }">{{ row.shiftName }}<template v-if="row.shiftCode">（{{ row.shiftCode }}）</template></template>
              </el-table-column>
              <el-table-column prop="count" label="班數" width="80" align="right" />
              <el-table-column label="每班工時" width="100" align="right">
                <template #default="{ row }">{{ formatHours(row.workHours) }}</template>
              </el-table-column>
              <el-table-column label="每班津貼" width="110" align="right">
                <template #default="{ row }"><span :class="numberClass(row.allowanceAmount)">{{ formatAmount(row.allowanceAmount) }}</span></template>
              </el-table-column>
              <el-table-column label="說明" min-width="180">
                <template #default="{ row }">
                  <span :class="{ 'has-issue-text': row.hasIssue }">{{ row.calculationDetail || row.allowanceType || '' }}</span>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>
      <template #footer>
        <el-button
          v-if="selectedEmployee"
          :loading="isExportingIndividual(selectedEmployee)"
          data-test="detail-export"
          @click="exportIndividualPayroll(selectedEmployee)"
        >
          匯出個人薪資表
        </el-button>
        <el-button @click="detailDialogVisible = false">關閉</el-button>
      </template>
    </el-dialog>

    <!-- 薪資計算說明：只寫系統實際的算法 -->
    <el-dialog v-model="showExplanationDialog" title="薪資計算說明" width="680px" :fullscreen="isMobile">
      <div class="explanation" data-test="explanation">
        <section v-for="block in EXPLANATION" :key="block.title">
          <h4>{{ block.title }}</h4>
          <ul>
            <li v-for="(line, idx) in block.lines" :key="idx">{{ line }}</li>
          </ul>
        </section>
      </div>
      <template #footer>
        <el-button @click="showExplanationDialog = false">關閉</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, reactive, getCurrentInstance } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown, ArrowLeft, ArrowRight, QuestionFilled, Search, Setting, WarningFilled } from '@element-plus/icons-vue'
import { apiFetch } from '../../api'
import {
  formatScheduleDate,
  formatTaiwanTime,
  taiwanDateKey,
  weekdayOfDateKey,
} from '../../utils/dateFormatter'
import { attendanceSourceLabel } from '../../utils/attendanceSource'
import { useIsMobile } from '../../utils/useIsMobile'
import PageHeader from '../PageHeader.vue'
import EmployeeAvatar from '../EmployeeAvatar.vue'

const isMobile = useIsMobile()

/* -------------------- 格式化 -------------------- */
function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

// 金額是整數元：1,234；負數 -1,234（Math.round(-0.4) 是 -0，要當成 0）
function formatAmount(value) {
  return (Math.round(toNumber(value)) || 0).toLocaleString('en-US')
}

// 帶幣別的金額：NT$ 1,234；負數 -NT$ 1,234
function formatCurrency(value) {
  const amount = Math.round(toNumber(value)) || 0
  return `${amount < 0 ? '-' : ''}NT$ ${Math.abs(amount).toLocaleString('en-US')}`
}

// 時數、天數：最多兩位小數，不留浮點數雜訊（7.999999 → 8、8.17 → 8.17）
function formatHours(value) {
  return String(Math.round(toNumber(value) * 100) / 100 || 0)
}

// 換算時薪可能有小數（月薪 ÷ 30 ÷ 8）：最多兩位小數
function formatRate(value) {
  const rate = Math.round(toNumber(value) * 100) / 100 || 0
  return `NT$ ${rate.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

// 0 用淡色、負數標示出來，一整排數字裡才看得出哪些有值
function numberClass(value) {
  const number = toNumber(value)
  return { 'is-zero': number === 0, 'is-negative': number < 0 }
}

/* -------------------- 月份與篩選 -------------------- */
const MONTH_START_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/

// 預設是台灣時間的這個月（用 UTC 取月份，每月 1 日早上 8 點前會是上個月）
function currentTaiwanMonthStart() {
  const todayKey = taiwanDateKey(new Date())
  return todayKey ? `${todayKey.slice(0, 7)}-01` : `${new Date().toISOString().slice(0, 7)}-01`
}

function addMonths(monthStart, delta) {
  const [year, month] = monthStart.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`
}

const overviewMonth = ref(currentTaiwanMonthStart())
const monthLabel = computed(() => (overviewMonth.value || '').slice(0, 7).replace('-', '/'))

const overviewData = ref([])
const overviewLoading = ref(false)
const overviewError = ref('')
const overviewPagination = reactive({
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
})
const filterOrganization = ref('')
const filterDepartment = ref('')
const filterSubDepartment = ref('')
const filterEmployeeName = ref('')
const organizations = ref([])
const departments = ref([])
const subDepartments = ref([])
const orgMap = computed(() => Object.fromEntries(organizations.value.map((o) => [o._id, o.name])))
const deptMap = computed(() => Object.fromEntries(departments.value.map((d) => [d._id, d.name])))
const subDeptMap = computed(() => Object.fromEntries(subDepartments.value.map((s) => [s._id, s.name])))

const idOf = (value) => String((value && typeof value === 'object' ? value._id : value) ?? '')

// 部門依機構、單位依部門縮小範圍，不會選到「這個機構沒有的部門」而查出空表
const departmentOptions = computed(() => (
  filterOrganization.value
    ? departments.value.filter((dept) => idOf(dept.organization) === filterOrganization.value)
    : departments.value
))
const subDepartmentOptions = computed(() => {
  if (filterDepartment.value) {
    return subDepartments.value.filter((sub) => idOf(sub.department) === filterDepartment.value)
  }
  if (!filterOrganization.value) return subDepartments.value
  const departmentIds = new Set(departmentOptions.value.map((dept) => dept._id))
  return subDepartments.value.filter((sub) => departmentIds.has(idOf(sub.department)))
})

// 表格直接顯示伺服器回傳的這一頁（篩選、搜尋、分頁都在伺服器做）
const filteredOverviewData = computed(() => overviewData.value)

function organizationName(id) {
  if (!id) return '-'
  return orgMap.value[id] || id
}
function departmentName(id) {
  if (!id) return '-'
  return deptMap.value[id] || id
}
function subDepartmentName(id) {
  if (!id) return '-'
  return subDeptMap.value[id] || id
}

/* -------------------- 總覽表格的欄位與合計 -------------------- */
// 從本薪扣掉、得到實領的項目（與伺服器 payrollService 的扣款項目相同；請假扣款已經算在本薪裡，不在這裡）
const DEDUCTION_COLUMNS = [
  { prop: 'laborInsuranceFee', label: '勞保費' },
  { prop: 'healthInsuranceFee', label: '健保費' },
  { prop: 'laborPensionSelf', label: '勞退自提' },
  { prop: 'employeeAdvance', label: '員工預支' },
  { prop: 'debtGarnishment', label: '債權扣押' },
  { prop: 'otherDeductions', label: '其他扣款' },
]
// 加起來是獎金合計（銀行B）的項目
const BONUS_COLUMNS = [
  { prop: 'overtimePay', label: '加班費' },
  { prop: 'nightShiftAllowance', label: '夜班津貼' },
  { prop: 'recurringAllowance', label: '定期津貼' },
  { prop: 'performanceBonus', label: '績效獎金' },
  { prop: 'otherBonuses', label: '其他獎金' },
]
const MONEY_PROPS = [
  'baseSalary',
  ...DEDUCTION_COLUMNS.map((column) => column.prop),
  'netPay',
  ...BONUS_COLUMNS.map((column) => column.prop),
  'totalBonus',
  'totalPayment',
]

// 這一頁各金額欄的加總：上方的統計數字與表格最下面的合計列用同一份，一定對得起來
const pageTotals = computed(() => {
  const totals = Object.fromEntries(MONEY_PROPS.map((prop) => [prop, 0]))
  filteredOverviewData.value.forEach((row) => {
    MONEY_PROPS.forEach((prop) => {
      totals[prop] += Math.round(toNumber(row[prop])) || 0
    })
  })
  return totals
})

// 上方的統計：伺服器算好的整個篩選結果（summary，不只這一頁）；舊版伺服器沒有 summary 時才用這一頁的加總
const overviewSummary = ref(null)
const statTotals = computed(() => {
  const totals = overviewSummary.value?.totals
  if (!totals) return pageTotals.value
  return Object.fromEntries(MONEY_PROPS.map((prop) => [prop, Math.round(toNumber(totals[prop])) || 0]))
})
const statHeadCount = computed(() => {
  const count = Number(overviewSummary.value?.headCount)
  return overviewSummary.value && Number.isFinite(count) ? count : overviewPagination.total
})

function summarizeOverview({ columns }) {
  return columns.map((column, index) => {
    if (index === 0) return overviewPagination.totalPages > 1 ? '本頁合計' : '合計'
    return MONEY_PROPS.includes(column.property) ? formatAmount(pageTotals.value[column.property]) : ''
  })
}

const EMPLOYMENT_NOTICE = {
  before_hire: { label: '尚未到職', tip: '這個月還沒到職，沒有本薪' },
  after_resignation: { label: '已離職', tip: '這個月已離職，沒有本薪' },
  leave_of_absence: { label: '留職停薪', tip: '這個月留職停薪，沒有本薪' },
}

// 月中到職、離職的本薪怎麼算：伺服器標出這次套用的計薪規則（employment.method，見 docs/payroll-policy.md）
function prorationText(employment) {
  if (employment?.method === 'days30') return '月薪按在職天數 ÷ 30 計算'
  if (employment?.method === 'calendarDays') return `月薪按在職天數 ÷ 當月 ${employment.basisDays || employment.daysInMonth} 天計算`
  if (employment?.method === 'none') return '計薪設定是不按比例，給整個月的月薪'
  return '月薪按在職天數比例計算'
}

// 需要人資留意的列：沒設定薪資金額、這個月不是整月在職
function salaryNotice(row) {
  if (!row) return null
  const employment = row.employment
  if (employment?.reason === 'partial_month') {
    return {
      label: '未滿月',
      type: 'info',
      tip: `這個月在職 ${employment.employedDays} 天（${formatScheduleDate(employment.startKey)}～${formatScheduleDate(employment.endKey)}），${prorationText(employment)}`,
    }
  }
  if (employment?.reason && EMPLOYMENT_NOTICE[employment.reason]) {
    return { ...EMPLOYMENT_NOTICE[employment.reason], type: 'info' }
  }
  // 換算時薪是 0 代表員工資料沒有薪資金額（已存檔的薪資記錄以記錄為準）
  if (!row.hasPayrollRecord && toNumber(row.hourlyRate) === 0 && toNumber(row.baseSalary) === 0) {
    return { label: '未設定薪資', type: 'warning', tip: '員工資料沒有設定薪資金額，請到「員工管理」編輯這位員工的薪資類型與金額' }
  }
  return null
}

/* -------------------- 讀取總覽 -------------------- */
// 伺服器的薪資 API 有些錯誤訊息是英文，換成看得懂的說法；本來就是中文的訊息照原樣顯示
const SERVER_MESSAGES = [
  [/No employees found/i, '沒有符合條件的員工，沒有資料可以匯出'],
  [/Employee not found/i, '找不到這位員工，可能已被刪除，請重新整理後再試'],
  [/month.*required|Invalid month/i, '月份格式不正確，請重新選擇月份'],
  [/Invalid (department|subDepartment|organization|employeeId)/i, '篩選條件不正確，請重新選擇'],
]

function translateServerMessage(message, fallback) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return fallback
  if (/[一-鿿]/.test(text)) return text
  const known = SERVER_MESSAGES.find(([pattern]) => pattern.test(text))
  return known ? known[1] : fallback
}

// 只顯示中文訊息：網路中斷時瀏覽器丟出的是英文（Failed to fetch），換成看得懂的說法
const messageOf = (error, fallback) => (/[一-鿿]/.test(error?.message || '') ? error.message : fallback)

async function readErrorMessage(res, fallback) {
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return translateServerMessage(body?.error || body?.message, fallback)
}

function scopeParams({ organization, department, subDepartment }) {
  const params = {}
  if (organization) params.organization = organization
  if (department) params.department = department
  if (subDepartment) params.subDepartment = subDepartment
  return params
}

const currentScope = () => ({
  organization: filterOrganization.value,
  department: filterDepartment.value,
  subDepartment: filterSubDepartment.value,
})

// withSummary：換月份、篩選、搜尋時請伺服器一起算整個篩選結果的合計（summary=true，500 人約 2～3 秒）；
// 只換頁、換每頁筆數時不帶，沿用上一次的合計
let overviewRequestGeneration = 0
async function fetchMonthlyOverview({ withSummary = false } = {}) {
  if (!MONTH_START_PATTERN.test(overviewMonth.value || '')) return
  const generation = ++overviewRequestGeneration
  overviewLoading.value = true
  overviewError.value = ''
  try {
    const params = new URLSearchParams({
      month: overviewMonth.value,
      page: String(overviewPagination.page),
      pageSize: String(overviewPagination.pageSize),
      ...scopeParams(currentScope()),
    })
    if (filterEmployeeName.value.trim()) params.append('q', filterEmployeeName.value.trim())
    if (withSummary) params.append('summary', 'true')

    const res = await apiFetch(`/api/payroll/overview/monthly?${params}`)
    if (generation !== overviewRequestGeneration) return
    if (!res.ok) throw new Error(await readErrorMessage(res, '薪資資料載入失敗，請稍後再試'))
    const payload = await res.json()
    if (generation !== overviewRequestGeneration) return
    overviewData.value = Array.isArray(payload) ? payload : (payload.items ?? [])
    const pagination = payload.pagination ?? {}
    overviewPagination.total = Number(pagination.total ?? overviewData.value.length)
    overviewPagination.page = Number(pagination.page ?? overviewPagination.page)
    overviewPagination.pageSize = Number(pagination.pageSize ?? overviewPagination.pageSize)
    overviewPagination.totalPages = Number(pagination.totalPages ?? 1)
    // 只有一頁時伺服器一定附上 summary；超過一頁又沒有要求時是 null，沿用上一次的（同一個月份與篩選）
    if (payload?.summary) overviewSummary.value = payload.summary
    else if (withSummary || overviewPagination.totalPages <= 1) overviewSummary.value = null
  } catch (error) {
    // 換了篩選條件之後才回來的舊請求不處理；讀取失敗要說出來，不能只留一張空表
    if (generation !== overviewRequestGeneration) return
    overviewData.value = []
    overviewPagination.total = 0
    overviewPagination.totalPages = 1
    overviewSummary.value = null
    overviewError.value = messageOf(error, '薪資資料載入失敗，請確認網路連線後再試')
  } finally {
    if (generation === overviewRequestGeneration) overviewLoading.value = false
  }
}

let overviewSearchTimer = null
function applyOverviewFilters() {
  clearTimeout(overviewSearchTimer)
  overviewPagination.page = 1
  fetchMonthlyOverview({ withSummary: true })
}

function shiftMonth(delta) {
  if (!MONTH_START_PATTERN.test(overviewMonth.value || '')) return
  overviewMonth.value = addMonths(overviewMonth.value, delta)
  applyOverviewFilters()
}

function handleOrganizationChange() {
  if (filterDepartment.value && !departmentOptions.value.some((dept) => dept._id === filterDepartment.value)) {
    filterDepartment.value = ''
  }
  handleDepartmentChange()
}

function handleDepartmentChange() {
  if (filterSubDepartment.value && !subDepartmentOptions.value.some((sub) => sub._id === filterSubDepartment.value)) {
    filterSubDepartment.value = ''
  }
  applyOverviewFilters()
}

function handleOverviewPageChange(page) {
  overviewPagination.page = page
  fetchMonthlyOverview()
}

function handleOverviewPageSizeChange(pageSize) {
  overviewPagination.pageSize = pageSize
  overviewPagination.page = 1
  fetchMonthlyOverview()
}

function scheduleOverviewSearch() {
  overviewPagination.page = 1
  clearTimeout(overviewSearchTimer)
  overviewSearchTimer = setTimeout(() => fetchMonthlyOverview({ withSummary: true }), 300)
}

async function fetchList(url, target) {
  try {
    const res = await apiFetch(url)
    if (!res.ok) return
    const data = await res.json()
    target.value = Array.isArray(data) ? data : []
  } catch (error) {
    // 篩選選單讀不到不影響薪資總覽，選單維持空白
    console.error(`讀取 ${url} 失敗`, error)
  }
}

/* -------------------- 匯出 -------------------- */
// 四種匯出都套用畫面上的機構、部門、單位（銀行匯款檔與獎金紙條以前一律匯出全公司）；姓名搜尋不套用
const EXPORT_FORMATS = [
  { key: 'taiwan', label: '臺灣企銀匯款檔', fileType: 'Excel', extension: 'xlsx' },
  { key: 'taichung', label: '台中銀行匯款檔', fileType: 'Excel', extension: 'xlsx' },
  { key: 'bonusSlip', label: '個人獎金紙條', fileType: 'Excel', extension: 'xlsx' },
  { key: 'pdf', label: '月薪資總覽', fileType: 'PDF', extension: 'pdf' },
]

// 匯出檔的欄位示意（假資料），放在匯出視窗裡按「查看格式範例」才顯示
const EXPORT_SAMPLES = {
  taiwan: {
    columns: [
      { label: '付款代號', prop: 'code', width: 90 },
      { label: '付款日期', prop: 'date', width: 110 },
      { label: '付款帳號', prop: 'account', width: 180 },
      { label: '收款戶名', prop: 'payee', width: 100 },
      { label: '收款行代碼', prop: 'bank', width: 110 },
      { label: '收款帳號', prop: 'payeeAccount', width: 150 },
      { label: '備註', prop: 'note', width: 80 },
    ],
    rows: [
      { code: '0001', date: '2024/05/31', account: '050-5206-123456789012', payee: '王曉明', bank: '050-5206', payeeAccount: '1234-5678-9012', note: '薪資' },
      { code: '0002', date: '2024/05/31', account: '050-5206-123456789012', payee: '李小華', bank: '050-5206', payeeAccount: '7890-1234-5678', note: '薪資' },
    ],
  },
  taichung: {
    columns: [
      { label: '流水號', prop: 'serial', width: 80 },
      { label: '姓名', prop: 'name', width: 100 },
      { label: '轉入帳號', prop: 'account', width: 160 },
      { label: '轉入金額', prop: 'amount', width: 110, align: 'right' },
      { label: '核證總數', prop: 'checksum', width: 110, align: 'right' },
    ],
    rows: [
      { serial: '1', name: '王曉明', account: '054-123-4567890', amount: '35,000', checksum: '35,000' },
      { serial: '2', name: '李小華', account: '054-987-6543210', amount: '32,000', checksum: '99,000' },
    ],
  },
  bonusSlip: {
    columns: [
      { label: '員工編號', prop: 'employeeId', width: 100 },
      { label: '姓名', prop: 'name', width: 100 },
      { label: '部門', prop: 'department', width: 110 },
      { label: '銀行代碼', prop: 'bankCode', width: 90 },
      { label: '帳號末四碼', prop: 'accountTail', width: 110 },
      // 欄位順序與伺服器 payrollExportService 的獎金紙條一致（獎金合計是第 12 欄）
      { label: '加班費', prop: 'overtime', width: 90, align: 'right' },
      { label: '夜班津貼', prop: 'nightShift', width: 100, align: 'right' },
      { label: '績效獎金', prop: 'performance', width: 100, align: 'right' },
      { label: '其他獎金', prop: 'otherBonus', width: 100, align: 'right' },
      { label: '定期津貼', prop: 'recurring', width: 100, align: 'right' },
      { label: '簽核調整', prop: 'adjustment', width: 100, align: 'right' },
      { label: '獎金合計', prop: 'total', width: 100, align: 'right' },
      { label: '備註', prop: 'note', width: 100 },
    ],
    rows: [
      { employeeId: 'E001', name: '王曉明', department: '工程部', bankCode: '004', accountTail: '9012', overtime: '1,200', nightShift: '1,000', performance: '2,000', otherBonus: '800', recurring: '1,500', adjustment: '0', total: '6,500', note: '' },
      { employeeId: 'E002', name: '李小華', department: '行政部', bankCode: '822', accountTail: '4321', overtime: '600', nightShift: '0', performance: '1,200', otherBonus: '500', recurring: '0', adjustment: '-100', total: '2,200', note: '' },
    ],
  },
}

const exportDialog = reactive({
  visible: false,
  format: 'taiwan',
  count: null,
  countLoading: false,
  sampleVisible: false,
  submitting: false,
})

const exportFormatMeta = computed(() => EXPORT_FORMATS.find((item) => item.key === exportDialog.format) || EXPORT_FORMATS[0])
const exportSample = computed(() => EXPORT_SAMPLES[exportDialog.format] || null)
// 這次匯出實際會套用的範圍（與畫面上的機構、部門、單位相同）
const exportScope = computed(() => currentScope())

const exportScopeText = computed(() => {
  const scope = exportScope.value
  const parts = [
    scope.organization ? organizationName(scope.organization) : '',
    scope.department ? departmentName(scope.department) : '',
    scope.subDepartment ? subDepartmentName(scope.subDepartment) : '',
  ].filter(Boolean)
  return parts.length ? parts.join('／') : '全公司'
})

// 畫面上有、但這次匯出不會套用的條件（姓名搜尋），要先講清楚
const exportScopeNote = computed(() => (
  filterEmployeeName.value.trim() ? '姓名／員工編號的搜尋不會套用到匯出，會匯出上面範圍內的所有員工。' : ''
))

let exportCountGeneration = 0
async function loadExportCount() {
  const generation = ++exportCountGeneration
  const scope = exportScope.value
  const sameAsScreen = !filterEmployeeName.value.trim()
    && !overviewLoading.value
    && !overviewError.value
    && JSON.stringify(scopeParams(scope)) === JSON.stringify(scopeParams(currentScope()))
  if (sameAsScreen) {
    exportDialog.count = overviewPagination.total
    exportDialog.countLoading = false
    return
  }
  exportDialog.count = null
  exportDialog.countLoading = true
  try {
    // 只要人數：同一支總覽 API 取 1 筆，讀它回傳的總數
    const params = new URLSearchParams({ month: overviewMonth.value, page: '1', pageSize: '1', ...scopeParams(scope) })
    const res = await apiFetch(`/api/payroll/overview/monthly?${params}`)
    if (generation !== exportCountGeneration) return
    if (!res.ok) throw new Error('count failed')
    const payload = await res.json()
    if (generation !== exportCountGeneration) return
    const total = Number(payload?.pagination?.total ?? (Array.isArray(payload) ? payload.length : NaN))
    exportDialog.count = Number.isFinite(total) ? total : null
  } catch {
    if (generation === exportCountGeneration) exportDialog.count = null
  } finally {
    if (generation === exportCountGeneration) exportDialog.countLoading = false
  }
}

function openExportDialog(format) {
  if (!EXPORT_FORMATS.some((item) => item.key === format)) return
  if (!MONTH_START_PATTERN.test(overviewMonth.value || '')) {
    ElMessage.warning('請先選擇月份')
    return
  }
  exportDialog.format = format
  exportDialog.sampleVisible = false
  exportDialog.visible = true
  loadExportCount()
}

// 下載：伺服器回錯誤（JSON）時顯示原因，不會存成一個打不開的檔案
async function downloadFile(url, options, filename, fallback) {
  const res = await apiFetch(url, options)
  if (!res.ok) throw new Error(await readErrorMessage(res, fallback))
  const contentType = res.headers?.get?.('content-type') || ''
  if (contentType.includes('application/json')) throw new Error(await readErrorMessage(res, fallback))
  const blob = await res.blob()
  if (!blob || blob.size === 0) throw new Error('伺服器回傳空白檔案，請稍後再試')
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 立刻釋放有些瀏覽器會來不及開始下載
  setTimeout(() => URL.revokeObjectURL?.(objectUrl), 1000)
}

async function confirmExport() {
  if (exportDialog.submitting || exportDialog.countLoading) return
  if (exportDialog.count === 0) {
    ElMessage.warning(`${monthLabel.value} 這個範圍沒有員工，沒有資料可以匯出`)
    return
  }
  const meta = exportFormatMeta.value
  const monthKey = overviewMonth.value.slice(0, 7)
  exportDialog.submitting = true
  try {
    if (meta.key === 'pdf') {
      const params = new URLSearchParams({ month: overviewMonth.value, ...scopeParams(exportScope.value) })
      await downloadFile(`/api/payroll/export/pdf?${params}`, undefined, `月薪資總覽_${monthKey}.pdf`, '匯出 PDF 失敗，請稍後再試')
    } else {
      const params = new URLSearchParams({ month: overviewMonth.value, format: meta.key, ...scopeParams(exportScope.value) })
      await downloadFile(`/api/payroll/export?${params}`, { method: 'POST' }, `${meta.label}_${monthKey}.xlsx`, '匯出失敗，請稍後再試')
    }
    ElMessage.success(`已匯出 ${monthLabel.value} ${meta.label}`)
    exportDialog.visible = false
  } catch (error) {
    ElMessage.error(messageOf(error, '匯出失敗，請確認網路連線後再試'))
  } finally {
    exportDialog.submitting = false
  }
}

// 個人薪資表：同一位員工下載中再按一次不重複送出
const exportingIndividualIds = ref(new Set())
const isExportingIndividual = (employee) => exportingIndividualIds.value.has(String(employee?._id ?? ''))

async function exportIndividualPayroll(employee) {
  if (!employee || !employee._id || !employee.name) {
    ElMessage.error('員工資料不完整，無法匯出薪資表')
    return
  }
  const id = String(employee._id)
  if (exportingIndividualIds.value.has(id)) return
  exportingIndividualIds.value = new Set(exportingIndividualIds.value).add(id)
  try {
    const params = new URLSearchParams({ employeeId: id, month: overviewMonth.value })
    if (employee.organization) {
      const orgName = organizationName(employee.organization)
      if (orgName && orgName !== '-') params.append('organizationName', orgName)
    }
    // 檔名只留中英文、數字與底線
    const sanitizedName = employee.name.replace(/[^a-zA-Z0-9一-龥_]/g, '_')
    await downloadFile(
      `/api/payroll/export/individual?${params}`,
      undefined,
      `個人薪資表_${sanitizedName}_${overviewMonth.value.slice(0, 7)}.xlsx`,
      '匯出個人薪資表失敗，請稍後再試',
    )
    ElMessage.success(`已匯出 ${employee.name} 的個人薪資表`)
  } catch (error) {
    ElMessage.error(messageOf(error, '匯出個人薪資表失敗，請確認網路連線後再試'))
  } finally {
    const next = new Set(exportingIndividualIds.value)
    next.delete(id)
    exportingIndividualIds.value = next
  }
}

/* -------------------- 薪資明細 -------------------- */
const detailDialogVisible = ref(false)
const detailTab = ref('pay')
const selectedEmployee = ref(null)
const employeeDetailData = ref(null)
const detailLoading = ref(false)
const detailError = ref('')

let detailRequestGeneration = 0
async function showDetailDialog(employee) {
  if (!employee?._id) return
  const generation = ++detailRequestGeneration
  // 金額一律用總覽那一列（伺服器整理過的最後數字）；這支 API 只拿每日出勤、請假、加班的記錄
  selectedEmployee.value = employee
  employeeDetailData.value = null
  detailError.value = ''
  detailTab.value = 'pay'
  detailDialogVisible.value = true
  detailLoading.value = true
  try {
    const res = await apiFetch(`/api/payroll/complete-data/${employee._id}/${overviewMonth.value}`)
    if (generation !== detailRequestGeneration) return
    if (!res.ok) throw new Error(await readErrorMessage(res, '出勤、請假與加班記錄載入失敗，請稍後再試'))
    const data = await res.json()
    // 連續點兩位員工時，先點的那位比較晚回來也不能蓋掉後點的
    if (generation !== detailRequestGeneration) return
    employeeDetailData.value = data
  } catch (error) {
    if (generation !== detailRequestGeneration) return
    employeeDetailData.value = null
    detailError.value = messageOf(error, '出勤、請假與加班記錄載入失敗，請確認網路連線後再試')
  } finally {
    if (generation === detailRequestGeneration) detailLoading.value = false
  }
}

// 出勤、請假、加班的時數統計：明細 API 回來後用它的數字，和分頁裡列出的記錄是同一個來源
// （已存檔的薪資記錄沒有存這些時數，總覽那一列會是 0）；還沒回來或讀取失敗時先用總覽那一列
const DETAIL_STAT_KEYS = ['workDays', 'scheduledHours', 'actualWorkHours', 'hourlyRate', 'leaveHours', 'paidLeaveHours', 'unpaidLeaveHours', 'overtimeHours']
const detailStats = computed(() => {
  const row = selectedEmployee.value || {}
  const detail = employeeDetailData.value
  return Object.fromEntries(DETAIL_STAT_KEYS.map((key) => [key, detail?.[key] ?? row[key]]))
})

function baseSalaryDescription(emp) {
  // 已存檔的薪資記錄：金額是存檔當時的數字，不是現在依出勤算出來的
  if (emp.hasPayrollRecord) return '已儲存的薪資記錄'
  const parts = []
  const type = emp.salaryType || '月薪'
  if (type === '時薪') {
    parts.push(`時薪 ${formatRate(emp.hourlyRate)}，實際工時 ${formatHours(emp.actualWorkHours)} 小時，給薪的請假時數另計`)
  } else if (type === '日薪') {
    parts.push(`日薪制，出勤 ${formatHours(emp.workDays)} 天，給薪的請假另計`)
  } else {
    parts.push('月薪制')
    if (emp.employment?.reason === 'partial_month') {
      const { method, employedDays, basisDays, daysInMonth } = emp.employment
      if (method === 'none') parts.push(`在職 ${employedDays} 天，不按比例`)
      else if (method === 'calendarDays') parts.push(`在職 ${employedDays} 天 ÷ 當月 ${basisDays || daysInMonth} 天`)
      else if (method === 'days30') parts.push(`在職 ${employedDays} 天 ÷ 30`)
      else parts.push(`在職 ${employedDays} 天按比例`)
    }
  }
  if (toNumber(emp.leaveDeduction) > 0) {
    parts.push(`已扣請假 ${formatCurrency(emp.leaveDeduction)}（不給薪 ${formatHours(emp.unpaidLeaveHours)} 小時）`)
  }
  return parts.join('；')
}

const NIGHT_SHIFT_METHOD_TEXT = {
  calculated: '依班表上的夜班與班別設定的津貼計算',
  fixed: '固定津貼',
  configuration_error: '有夜班但津貼是 0：班別設定有問題',
  no_allowance_configured: '有夜班但班別沒有設定津貼金額',
  no_schedules: '這個月沒有排夜班',
  no_shifts: '尚未設定夜班班別',
}

const nightShiftMethodText = computed(() => NIGHT_SHIFT_METHOD_TEXT[selectedEmployee.value?.nightShiftCalculationMethod] || '')

// 夜班明細每一班一筆，同一個班別合併成一列（班數 × 每班津貼）
const nightShiftGroups = computed(() => {
  const groups = new Map()
  ;(selectedEmployee.value?.nightShiftBreakdown || []).forEach((shift) => {
    const key = [shift.shiftName, shift.shiftCode, shift.allowanceAmount, shift.calculationDetail].join('|')
    const group = groups.get(key)
    if (group) group.count += 1
    else groups.set(key, { ...shift, count: 1 })
  })
  return [...groups.values()]
})

// 扣款超過本薪時實領是 0，沒扣到的金額（deductionShortfall）要講出來；已存檔的薪資記錄也一樣（以前存檔後就看不到）
function netPayDescription(emp) {
  if (toNumber(emp.deductionShortfall) > 0) {
    const text = `扣款超過本薪，還有 ${formatCurrency(emp.deductionShortfall)} 沒有扣到`
    return emp.hasPayrollRecord ? `${text}（已儲存的薪資記錄）` : text
  }
  if (emp.hasPayrollRecord) return '已儲存的薪資記錄'
  return '本薪 − 以上扣款'
}

// 薪資計算：本薪 − 扣款 = 實領（銀行A）；各項獎金 = 獎金合計（銀行B）；實發合計 = 兩者相加。每個數字都是伺服器回傳的
const salaryBreakdown = computed(() => {
  const emp = selectedEmployee.value
  if (!emp) return []
  const lines = []
  // 已存檔的薪資記錄：扣款與獎金是存檔當時的數字，不寫「依員工資料設定」這類現在的計算依據
  const stored = Boolean(emp.hasPayrollRecord)
  const deductionDescriptions = stored ? {} : {
    laborInsuranceFee: emp.insuranceRate
      ? `投保級距第 ${emp.insuranceRate.level} 級，投保薪資 ${formatCurrency(emp.insuranceRate.insuredSalary)}`
      : '依本薪對照勞保級距的員工負擔',
    healthInsuranceFee: '員工資料設定的自付額',
    laborPensionSelf: '員工資料設定的自提金額',
    employeeAdvance: '員工資料設定',
    debtGarnishment: '員工資料設定',
    otherDeductions: toNumber(emp.lateEarlyDeduction) > 0 ? `含遲到早退扣款 ${formatCurrency(emp.lateEarlyDeduction)}` : '員工資料設定，加上遲到早退扣款',
  }
  const nightIssue = toNumber(emp.nightShiftAllowance) === 0 && toNumber(emp.nightShiftDays) > 0
  const bonusDescriptions = {
    overtimePay: toNumber(emp.overtimeHours) > 0 ? `已核准加班 ${formatHours(emp.overtimeHours)} 小時` : '',
    nightShiftAllowance: toNumber(emp.nightShiftDays) > 0
      ? `夜班 ${formatHours(emp.nightShiftDays)} 天${nightIssue ? '，但津貼是 0，請檢查班別設定' : ''}`
      : '',
    recurringAllowance: (emp.recurringAllowanceBreakdown || []).map((item) => `${item.item} ${formatCurrency(item.amount)}`).join('、'),
    performanceBonus: '',
    otherBonuses: '',
  }

  lines.push({ key: 'baseSalary', kind: 'income', item: '本薪', description: baseSalaryDescription(emp), amount: emp.baseSalary })
  DEDUCTION_COLUMNS.forEach((column) => {
    lines.push({ key: column.prop, kind: 'deduction', item: column.label, description: deductionDescriptions[column.prop], amount: emp[column.prop] })
  })
  lines.push({
    key: 'netPay',
    kind: 'total',
    item: '實領金額（銀行A）',
    description: netPayDescription(emp),
    amount: emp.netPay,
    hasIssue: toNumber(emp.deductionShortfall) > 0,
  })
  BONUS_COLUMNS.forEach((column) => {
    lines.push({
      key: column.prop,
      kind: 'bonus',
      item: column.label,
      description: bonusDescriptions[column.prop],
      amount: emp[column.prop],
      hasIssue: column.prop === 'nightShiftAllowance' && nightIssue,
    })
  })
  lines.push({ key: 'totalBonus', kind: 'total', item: '獎金合計（銀行B）', description: '以上獎金與津貼', amount: emp.totalBonus })
  lines.push({ key: 'totalPayment', kind: 'grand', item: '實發合計', description: '實領金額 + 獎金合計', amount: emp.totalPayment })
  return lines
})

// 扣款項目前面加負號，其他照原樣
function formatSigned(line) {
  const amount = Math.round(toNumber(line.amount)) || 0
  return formatCurrency(line.kind === 'deduction' && amount !== 0 ? -amount : amount)
}

const insuranceLine = computed(() => {
  const rate = selectedEmployee.value?.insuranceRate
  if (!rate) return ''
  const parts = [`勞保投保級距第 ${rate.level} 級`, `投保薪資 ${formatCurrency(rate.insuredSalary)}`]
  if (rate.employerFee !== undefined) parts.push(`雇主負擔 ${formatCurrency(rate.employerFee)}`)
  if (rate.ordinaryRate !== undefined) parts.push(`普通費率 ${rate.ordinaryRate}%`)
  if (rate.employmentInsuranceRate !== undefined) parts.push(`就保費率 ${rate.employmentInsuranceRate}%`)
  return parts.join('｜')
})

const annualLeaveLine = computed(() => {
  const annual = selectedEmployee.value?.annualLeave
  if (!annual) return ''
  const remaining = annual.remainingHours ?? (toNumber(annual.totalHours) - toNumber(annual.usedHours))
  const parts = [`特休 ${formatHours(annual.totalHours)} 小時`, `已用 ${formatHours(annual.usedHours)}`, `剩餘 ${formatHours(remaining)}`]
  if (annual.expiryDate) parts.push(`期限 ${formatScheduleDate(annual.expiryDate, '-')}`)
  return parts.join('｜')
})

const NON_WORK_DAY_LABELS = { rest_day: '休息日', regular_rest: '例假', holiday: '國定假日', leave: '請假' }

// 每日出勤的狀態：不用上班的日子、還沒到的日子不是缺勤
function dayStatus(row) {
  if (row.hasAttendance) return { label: '已出勤', type: 'success' }
  if (toNumber(row.scheduledHours) === 0) return { label: NON_WORK_DAY_LABELS[row.semanticType] || '不用上班', type: 'info' }
  const todayKey = taiwanDateKey(new Date())
  if (row.date > todayKey) return { label: '尚未到', type: 'info' }
  if (row.clockInTime && !row.clockOutTime) {
    return row.date === todayKey ? { label: '上班中', type: 'primary' } : { label: '缺下班卡', type: 'warning' }
  }
  if (row.date === todayKey) return { label: '今日未打卡', type: 'info' }
  return { label: '缺勤', type: 'danger' }
}

function leavePeriod(row) {
  const start = formatScheduleDate(row.startDate, '')
  const end = formatScheduleDate(row.endDate, '')
  if (!start && !end) return '-'
  return start === end || !end ? start : `${start}～${end}`
}

// 給薪方式看伺服器的 payRate（1 全薪、0.5 半薪、0 不給薪）；舊版伺服器只有 isPaid
function leavePay(row) {
  const rate = Number(row.payRate)
  if (!Number.isFinite(rate)) return row.isPaid ? { label: '給薪', type: 'success' } : { label: '不給薪', type: 'info' }
  if (rate >= 1) return { label: '全薪', type: 'success' }
  if (rate <= 0) return { label: '不給薪', type: 'info' }
  return { label: rate === 0.5 ? '半薪' : `給薪 ${Math.round(rate * 100)}%`, type: 'warning' }
}

const OVERTIME_DAY_LABELS = { workday: '平日', rest_day: '休息日', national_holiday: '國定假日' }
const overtimeDayLabel = (row) => OVERTIME_DAY_LABELS[row.dayType] || (row.dayType ? String(row.dayType) : '-')

// 伺服器算好的各段倍率（例如 平日前2小時 2 小時 ×1.33）
function overtimeSegments(row) {
  if (!Array.isArray(row.rateSegments) || !row.rateSegments.length) return ''
  return row.rateSegments
    .map((segment) => `${segment.label} ${formatHours(segment.hours)} 小時 ×${formatHours(segment.multiplier)}`)
    .join('；')
}

/* -------------------- 計薪設定 -------------------- */
// 計薪規則（月中到職／離職的比例、加班費倍率、新進員工自動計算加班費）在「請假加班設定」的「加班與計薪」頁籤
const router = getCurrentInstance()?.appContext.config.globalProperties.$router
function openPayrollPolicy() {
  router?.push({ name: 'LeaveOvertimeSetting', query: { tab: 'payroll' } })
}

/* -------------------- 薪資計算說明 -------------------- */
// 內容對照伺服器的算法（services/payrollService.js、workHoursCalculationService.js、config/salaryConfig.js），改算法時要一起改
const showExplanationDialog = ref(false)
const EXPLANATION = [
  {
    title: '實領金額（銀行A）',
    lines: [
      '實領金額 = 本薪 − 勞保費 − 健保費 − 勞退自提 − 員工預支 − 債權扣押 − 其他扣款，最低為 0。',
      '月薪：月薪金額 − 請假扣款；月中到職或離職依「計薪設定」按比例（預設按在職天數 ÷ 30）。日薪：（出勤天數 + 給薪請假天數）× 日薪。時薪：（實際工時 + 給薪請假時數）× 時薪。',
      '請假扣款（只有月薪）= 不給薪時數 × 月薪 ÷ 30 ÷ 8。特休、婚假、喪假、公假等全薪；病假、生理假半薪；事假、家庭照顧假等不給薪；對照不到的假別視為不給薪。',
      '勞保費依本薪對照勞保級距的員工負擔；健保費、勞退自提、員工預支、債權扣押、其他扣款是「員工管理」裡每位員工的設定；遲到早退扣款（預設未啟用）計入其他扣款。',
    ],
  },
  {
    title: '獎金合計（銀行B）',
    lines: [
      '獎金合計 = 加班費 + 夜班津貼 + 定期津貼 + 績效獎金 + 其他獎金，不扣任何費用。',
      '加班費：只計已核准的加班申請，而且該員工已開啟「自動計算加班費」（員工管理 › 薪資與假勤）。倍率在「計薪設定」調整，預設是勞基法的平日前 2 小時 ×4/3、之後 ×5/3；休息日前 2 小時 ×4/3、第 3–8 小時 ×5/3、第 9–12 小時 ×8/3；國定假日 8 小時內加發一日工資，超過 8 小時的前 2 小時 ×4/3、再 2 小時 ×5/3。',
      '夜班津貼：班表上有夜班津貼的班別，每一班發「班別設定」裡的固定金額，再加上本月核准的夜班獎金申請。',
      '定期津貼：員工資料勾選的薪資項目金額。績效獎金、其他獎金：員工資料的每月金額，加上本月核准的「獎金申請」。',
    ],
  },
  {
    title: '資料來源',
    lines: [
      '出勤：班表與打卡記錄（線上打卡與指紋匯入一起比對，上班取最早、下班取最晚）。',
      '請假、加班、獎金：只計簽核已核准的申請。',
      '畫面上的數字是依目前資料即時試算；標示「已存檔」的員工以已儲存的薪資記錄為準。',
      '銀行帳號在「員工管理」每位員工的薪資帳戶設定。',
    ],
  },
]

onMounted(() => {
  fetchList('/api/organizations', organizations)
  fetchList('/api/departments', departments)
  fetchList('/api/sub-departments', subDepartments)
  fetchMonthlyOverview({ withSummary: true })
})

onBeforeUnmount(() => {
  clearTimeout(overviewSearchTimer)
  // 離開頁面後才回來的請求不再處理
  overviewRequestGeneration += 1
  detailRequestGeneration += 1
  exportCountGeneration += 1
})
</script>

<style scoped>
.month-switch {
  display: flex;
  align-items: center;
  gap: var(--hr-space-sm);
}

.month-switch :deep(.month-picker) {
  flex: 1 1 140px;
  width: 140px;
  min-width: 0;
}

.month-switch :deep(.el-button) {
  margin-left: 0;
}

.filter-select {
  width: 170px;
}

.filter-search {
  width: 210px;
}

/* 工具列右側的動作：寬度不夠換行時仍然靠右 */
.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hr-space-sm);
  margin-left: auto;
}

.toolbar-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.payroll-table :deep(.el-table__cell) {
  padding: 6px 0;
}

.payroll-table :deep(.el-table__footer .cell) {
  font-weight: var(--hr-font-weight-semibold);
}

.cell-main {
  color: var(--hr-gray-900);
}

.cell-sub {
  font-size: 12px;
  line-height: 1.4;
  color: var(--hr-gray-500);
}

.cell-sub--warning {
  color: #b45309;
}

.cell-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
}


.is-zero {
  color: var(--hr-gray-400);
}

.is-negative {
  color: var(--hr-error);
}

.table-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hr-space-sm);
  padding: var(--hr-space-sm) 0;
}

.table-footer .hr-hint {
  margin-top: 0;
}

/* 匯出視窗 */
.export-summary {
  margin: 0 0 var(--hr-space-sm);
}

.export-summary > div {
  display: flex;
  gap: var(--hr-space-md);
  padding: 6px 0;
  border-bottom: 1px solid var(--hr-gray-100);
}

.export-summary dt {
  flex: 0 0 56px;
  color: var(--hr-gray-500);
}

.export-summary dd {
  margin: 0;
  color: var(--hr-gray-900);
}

.sample-toggle {
  margin-top: var(--hr-space-sm);
}

/* 薪資明細 */
.detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hr-space-sm) var(--hr-space-lg);
  margin-bottom: var(--hr-space-sm);
}

/* 薪資明細的姓名：頭像 + 姓名 */
.payroll-person {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--hr-font-size-base);
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-900);
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px var(--hr-space-md);
  font-size: 13px;
  color: var(--hr-gray-600);
}

.detail-alert {
  margin-bottom: var(--hr-space-sm);
}

.detail-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hr-space-sm);
  margin-bottom: var(--hr-space-sm);
}

.pay-breakdown {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--hr-font-size-sm);
}

.pay-breakdown th,
.pay-breakdown td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--hr-gray-200);
  text-align: left;
  vertical-align: top;
}

.pay-breakdown th {
  font-weight: var(--hr-font-weight-medium);
  color: var(--hr-gray-500);
  background: var(--hr-gray-50);
}

.pay-breakdown .is-amount {
  width: 140px;
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.pay-breakdown .is-description {
  color: var(--hr-gray-600);
}

.pay-breakdown tr.is-total td,
.pay-breakdown tr.is-grand td {
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-900);
  background: var(--hr-gray-50);
}

.pay-breakdown tr.is-grand td {
  font-size: var(--hr-font-size-base);
  border-top: 2px solid var(--hr-gray-300);
}

.pay-breakdown tr.has-issue td,
.has-issue-text {
  color: #b45309;
}

.issue-icon {
  margin-left: 4px;
  vertical-align: middle;
  color: var(--hr-warning);
}

.issue-list {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.6;
}

/* 每日出勤明細：打卡來源（線上 / 指紋匯入） */
.punch-source {
  font-size: 12px;
  color: var(--hr-gray-500);
  line-height: 1.2;
}

/* 薪資計算說明 */
.explanation h4 {
  margin: var(--hr-space-md) 0 6px;
  font-size: var(--hr-font-size-base);
  color: var(--hr-gray-900);
}

.explanation section:first-child h4 {
  margin-top: 0;
}

.explanation ul {
  margin: 0;
  padding-left: 20px;
  font-size: var(--hr-font-size-sm);
  line-height: 1.7;
  color: var(--hr-gray-700);
}

@media (max-width: 767px) {
  .month-switch {
    width: 100%;
  }

  .filter-select,
  .filter-search {
    flex: 1 1 140px;
    width: auto;
  }

  .pay-breakdown .is-amount {
    width: 110px;
  }

  .pay-breakdown th,
  .pay-breakdown td {
    padding: 7px 6px;
  }
}
</style>
