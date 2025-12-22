<!-- src/Components/backComponents/SalaryManagementSetting.vue -->

<template>
    <div class="salary-management-setting">
      <h2>薪資管理設定</h2>
  
      <el-tabs v-model="activeTab" type="card">
        <!-- 1) 職等與底薪 -->
        <el-tab-pane label="職等與底薪" name="grade">
          <div class="tab-content">
            <el-button type="primary" @click="openGradeDialog()">新增職等</el-button>
            <el-table :data="gradeList" style="margin-top: 20px;">
              <el-table-column prop="gradeName" label="職等名稱" width="180" />
              <el-table-column prop="baseSalary" label="基本薪資" width="120" />
              <el-table-column prop="description" label="說明" />
              <el-table-column label="操作" width="180">
                <template #default="{ row, $index }">
                  <el-button type="primary" @click="openGradeDialog($index)">編輯</el-button>
                  <el-button type="danger" @click="deleteGrade($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>
  
            <!-- 新增/編輯 職等 Dialog -->
            <el-dialog v-model="gradeDialogVisible" title="職等設定" width="400px">
              <el-form :model="gradeForm" label-width="100px">
                <el-form-item label="名稱">
                  <el-input v-model="gradeForm.gradeName" placeholder="如：職等A / 初階 / 資深…" />
                </el-form-item>
                <el-form-item label="基本薪資">
                  <el-input-number v-model="gradeForm.baseSalary" :min="0" />
                </el-form-item>
                <el-form-item label="說明">
                  <el-input v-model="gradeForm.description" />
                </el-form-item>
              </el-form>
              <span slot="footer" class="dialog-footer">
                <el-button @click="gradeDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveGrade">儲存</el-button>
              </span>
            </el-dialog>
          </div>
        </el-tab-pane>
  
        <!-- 2) 調薪與異動規則 -->
        <el-tab-pane label="調薪與異動" name="adjust">
          <div class="tab-content">
            <el-form :model="adjustForm" label-width="180px">
              <el-form-item label="歷史薪資保留(個月)">
                <el-input-number v-model="adjustForm.historyMonths" :min="0" />
                <small>保留多久前的薪資紀錄</small>
              </el-form-item>
              <el-form-item label="調薪生效日規則">
                <el-select v-model="adjustForm.effectiveRule">
                  <el-option label="次月一號" value="nextMonth1" />
                  <el-option label="當月同日" value="sameDay" />
                  <el-option label="依簽核通過日" value="approvalDate" />
                </el-select>
              </el-form-item>
              <el-form-item label="是否需多層簽核">
                <el-switch v-model="adjustForm.needMultiApproval" />
              </el-form-item>
              <el-form-item label="薪資差異補發 / 補扣">
                <el-switch v-model="adjustForm.needRetroactive" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveAdjustRules">儲存調薪規則</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
  
        <!-- 3) 發放與銀行帳戶 -->
        <el-tab-pane label="發放與帳戶" name="payment">
          <div class="tab-content">
            <el-form :model="paymentForm" label-width="160px">
              <el-form-item label="預設銀行代碼">
                <el-select v-model="paymentForm.defaultBank" placeholder="選擇銀行">
                  <el-option label="台灣銀行 (004)" value="004" />
                  <el-option label="台新銀行 (812)" value="812" />
                  <el-option label="中國信託 (822)" value="822" />
                  <el-option label="國泰世華 (013)" value="013" />
                </el-select>
              </el-form-item>
              <el-form-item label="發薪帳戶維護">
                <el-button type="primary" @click="openAccountDialog()">管理帳戶</el-button>
              </el-form-item>
              <el-form-item label="薪資轉帳批次格式">
                <el-select v-model="paymentForm.batchFormat">
                  <el-option label="自訂格式 A" value="formatA" />
                  <el-option label="自訂格式 B" value="formatB" />
                </el-select>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="savePaymentSetting">儲存發放設定</el-button>
              </el-form-item>
            </el-form>
          </div>
  
          <!-- 帳戶管理Dialog (示例) -->
          <el-dialog v-model="accountDialogVisible" title="銀行帳戶維護" width="600px">
            <el-table :data="accountList">
              <el-table-column prop="employeeName" label="員工姓名" width="120" />
              <el-table-column prop="bankCode" label="銀行代碼" width="100" />
              <el-table-column prop="accountNumber" label="帳號" />
              <el-table-column label="操作" width="120">
                <template #default="{ row, $index }">
                  <el-button type="primary" @click="editAccount($index)">編輯</el-button>
                </template>
              </el-table-column>
            </el-table>
            <span slot="footer" class="dialog-footer">
              <el-button @click="accountDialogVisible = false">關閉</el-button>
            </span>
          </el-dialog>
        </el-tab-pane>
  
        <!-- 4) 其他設定 (扶養親屬、法院扣押...) -->
        <el-tab-pane label="其他設定" name="others">
          <div class="tab-content">
            <el-form :model="otherForm" label-width="180px">
              <el-form-item label="扶養親屬資料 (是否納入撫養額)">
                <el-switch v-model="otherForm.includeDependents" />
              </el-form-item>
              <el-form-item label="法院扣押處理">
                <el-switch v-model="otherForm.courtGarnishment" />
                <small>若啟用，需在員工資料內填寫扣押比例或金額</small>
              </el-form-item>
              <el-form-item label="薪資差異調整 (歷史月份)">
                <el-input-number v-model="otherForm.diffAdjustmentMonths" :min="0" />
                <small>允許調整多少個月前的薪資紀錄</small>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveOtherSetting">儲存其他設定</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
  
        <!-- 5) 月薪資總覽 -->
        <el-tab-pane label="月薪資總覽" name="monthlyOverview">
          <div class="tab-content">
            <!-- Title with explanation button -->
            <div class="overview-header">
              <h3>月薪資總覽</h3>
              <el-button 
                type="info" 
                :icon="QuestionFilled" 
                @click="showExplanationDialog = true"
                size="small"
              >
                薪資計算說明
              </el-button>
            </div>

            <!-- Filter controls -->
            <el-form :inline="true" class="filter-form">
              <el-form-item label="月份">
                <el-date-picker
                  v-model="overviewMonth"
                  type="month"
                  placeholder="選擇月份"
                  format="YYYY-MM"
                  value-format="YYYY-MM-01"
                  @change="fetchMonthlyOverview"
                />
              </el-form-item>
              <el-form-item label="機構">
                <el-select
                  v-model="filterOrganization"
                  placeholder="全部機構"
                  clearable
                  @change="fetchMonthlyOverview"
                >
                  <el-option
                    v-for="org in organizations"
                    :key="org._id"
                    :label="org.name"
                    :value="org._id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="部門">
                <el-select
                  v-model="filterDepartment"
                  placeholder="全部部門"
                  clearable
                  @change="fetchMonthlyOverview"
                >
                  <el-option
                    v-for="dept in departments"
                    :key="dept._id"
                    :label="dept.name"
                    :value="dept._id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="單位">
                <el-select
                  v-model="filterSubDepartment"
                  placeholder="全部單位"
                  clearable
                  @change="fetchMonthlyOverview"
                >
                  <el-option
                    v-for="sub in subDepartments"
                    :key="sub._id"
                    :label="sub.name"
                    :value="sub._id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="員工">
                <el-input
                  v-model="filterEmployeeName"
                  placeholder="搜尋員工姓名"
                  clearable
                  @input="filterOverviewData"
                  style="width: 200px"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="fetchMonthlyOverview">查詢</el-button>
              </el-form-item>
            </el-form>

            <el-card class="export-card" shadow="never">
              <template #header>
                <div class="export-card__header">
                  <div class="export-card__title">
                    <span style="margin-right: 12px">匯出格式</span>
                    <el-radio-group v-model="exportFormat" size="small">
                      <el-radio-button label="taiwan">臺灣企銀</el-radio-button>
                      <el-radio-button label="taichung">台中銀行</el-radio-button>
                      <el-radio-button label="bonusSlip">個人獎金紙條</el-radio-button>
                    </el-radio-group>
                  </div>
                  <div class="export-card__actions">
                    <el-button size="small" plain type="info" @click="showFormatPreview = !showFormatPreview">
                      {{ showFormatPreview ? '隱藏示意表格' : '顯示示意表格' }}
                    </el-button>
                    <el-button
                      type="primary"
                      size="small"
                      :loading="exportLoading"
                      @click="downloadPayrollExcel"
                    >
                      下載匯出
                    </el-button>
                  </div>
                </div>
              </template>

              <div v-if="showFormatPreview">
                <el-alert
                  title="以下為示意表格，實際匯出內容會套用當月薪資資料"
                  type="info"
                  show-icon
                  class="export-card__alert"
                />
                <el-table :data="currentFormatPreview" border stripe size="small" max-height="260">
                  <el-table-column
                    v-for="col in currentPreviewColumns"
                    :key="col.prop"
                    :prop="col.prop"
                    :label="col.label"
                    :width="col.width"
                    :align="col.align || 'center'"
                  />
                </el-table>
              </div>
            </el-card>

            <!-- Summary statistics -->
            <el-row :gutter="20" style="margin-bottom: 20px">
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">總人數</div>
                    <div class="stat-value">{{ filteredOverviewData.length }}</div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">薪資總額</div>
                    <div class="stat-value">{{ formatCurrency(totalBaseSalary) }}</div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">實發總額</div>
                    <div class="stat-value">{{ formatCurrency(totalNetPay) }}</div>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="6">
                <el-card>
                  <div class="stat-item">
                    <div class="stat-label">扣款總額</div>
                    <div class="stat-value">{{ formatCurrency(totalDeductions) }}</div>
                  </div>
                </el-card>
              </el-col>
            </el-row>

            <!-- Payroll overview table -->
            <el-table 
              :data="filteredOverviewData" 
              border 
              stripe 
              style="width: 100%"
              max-height="600"
            >
              <el-table-column prop="employeeId" label="員工編號" width="120" fixed />
              <el-table-column prop="name" label="姓名" width="100" fixed />
              <el-table-column prop="department" label="部門" width="120" />
              <el-table-column prop="subDepartment" label="單位" width="120" />
              <el-table-column prop="salaryType" label="薪資類型" width="100" />
              
              <!-- 工作時數資料 -->
              <el-table-column label="工作時數" align="center">
                <el-table-column prop="workDays" label="上班天數" width="100" align="right">
                  <template #default="{ row }">
                    {{ row.workDays || 0 }}
                  </template>
                </el-table-column>
                <el-table-column prop="actualWorkHours" label="實際工時" width="100" align="right">
                  <template #default="{ row }">
                    {{ (row.actualWorkHours || 0).toFixed(2) }}
                  </template>
                </el-table-column>
                <el-table-column prop="hourlyRate" label="時薪" width="100" align="right">
                  <template #default="{ row }">
                    {{ formatCurrency(row.hourlyRate) }}
                  </template>
                </el-table-column>
              </el-table-column>
              
              <!-- 請假資料 -->
              <el-table-column label="請假" align="center">
                <el-table-column prop="leaveHours" label="請假時數" width="100" align="right">
                  <template #default="{ row }">
                    {{ (row.leaveHours || 0).toFixed(2) }}
                  </template>
                </el-table-column>
                <el-table-column prop="leaveDeduction" label="請假扣款" width="100" align="right">
                  <template #default="{ row }">
                    {{ formatCurrency(row.leaveDeduction) }}
                  </template>
                </el-table-column>
              </el-table-column>
              
              <!-- 加班資料 -->
              <el-table-column label="加班" align="center">
                <el-table-column prop="overtimeHours" label="加班時數" width="100" align="right">
                  <template #default="{ row }">
                    {{ (row.overtimeHours || 0).toFixed(2) }}
                  </template>
                </el-table-column>
                <el-table-column prop="overtimePay" label="加班費" width="100" align="right">
                  <template #default="{ row }">
                    {{ formatCurrency(row.overtimePay) }}
                  </template>
                </el-table-column>
              </el-table-column>
              
              <!-- 夜班資料 -->
              <el-table-column label="夜班" align="center">
                <el-table-column prop="nightShiftDays" label="夜班天數" width="100" align="right">
                  <template #default="{ row }">
                    {{ row.nightShiftDays || 0 }}
                  </template>
                </el-table-column>
                <el-table-column prop="nightShiftHours" label="夜班時數" width="100" align="right">
                  <template #default="{ row }">
                    {{ (row.nightShiftHours || 0).toFixed(2) }}
                  </template>
                </el-table-column>
              </el-table-column>
              
              <el-table-column prop="baseSalary" label="基本薪資" width="120" align="right">
                <template #default="{ row }">
                  {{ formatCurrency(row.baseSalary) }}
                </template>
              </el-table-column>
              
              <el-table-column label="扣款項目" align="center">
                <el-table-column prop="laborInsuranceFee" label="勞保費" width="100" align="right">
                  <template #default="{ row }">
                    {{ formatCurrency(row.laborInsuranceFee) }}
                  </template>
                </el-table-column>
                <el-table-column prop="healthInsuranceFee" label="健保費" width="100" align="right">
                  <template #default="{ row }">
                    {{ formatCurrency(row.healthInsuranceFee) }}
                  </template>
                </el-table-column>
                <el-table-column prop="laborPensionSelf" label="勞退" width="100" align="right">
                  <template #default="{ row }">
                    {{ formatCurrency(row.laborPensionSelf) }}
                  </template>
                </el-table-column>
                <el-table-column prop="otherDeductions" label="其他扣款" width="100" align="right">
                  <template #default="{ row }">
                    {{ formatCurrency(row.otherDeductions) }}
                  </template>
                </el-table-column>
              </el-table-column>
              
              <el-table-column label="加項" align="center">
                <el-table-column prop="performanceBonus" label="績效獎金" width="100" align="right">
                  <template #default="{ row }">
                    {{ formatCurrency(row.performanceBonus) }}
                  </template>
                </el-table-column>
                <el-table-column prop="otherBonuses" label="其他獎金" width="100" align="right">
                  <template #default="{ row }">
                    {{ formatCurrency(row.otherBonuses) }}
                  </template>
                </el-table-column>
              </el-table-column>
              
              <el-table-column prop="totalPayment" label="實發金額" width="120" align="right" fixed="right">
                <template #default="{ row }">
                  <strong>{{ formatCurrency(row.totalPayment) }}</strong>
                </template>
              </el-table-column>
              
              <el-table-column label="操作" width="150" fixed="right">
                <template #default="{ row }">
                  <el-button type="primary" size="small" @click="showDetailDialog(row)">詳細</el-button>
                  <el-tag :type="row.hasPayrollRecord ? 'success' : 'info'" size="small">
                    {{ row.hasPayrollRecord ? '已計算' : '未計算' }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>

            <!-- Employee Detail Dialog -->
            <el-dialog
              v-model="detailDialogVisible"
              title="員工薪資詳細資料"
              width="90%"
              :close-on-click-modal="false"
            >
              <div v-if="selectedEmployee">
                <!-- Employee Info -->
                <el-card class="detail-card" shadow="never">
                  <template #header>
                    <div class="card-header">
                      <span>基本資訊</span>
                    </div>
                  </template>
                  <el-descriptions :column="3" border>
                    <el-descriptions-item label="員工編號">{{ selectedEmployee.employeeId }}</el-descriptions-item>
                    <el-descriptions-item label="姓名">{{ selectedEmployee.name }}</el-descriptions-item>
                    <el-descriptions-item label="部門">{{ selectedEmployee.department }}</el-descriptions-item>
                    <el-descriptions-item label="單位">{{ selectedEmployee.subDepartment }}</el-descriptions-item>
                    <el-descriptions-item label="薪資類型">{{ selectedEmployee.salaryType }}</el-descriptions-item>
                    <el-descriptions-item label="月份">{{ overviewMonth }}</el-descriptions-item>
                  </el-descriptions>
                </el-card>

                <!-- Work Hours Breakdown -->
                <el-card class="detail-card" shadow="never" style="margin-top: 20px">
                  <template #header>
                    <div class="card-header">
                      <span>工作時數統計</span>
                    </div>
                  </template>
                  <el-row :gutter="20">
                    <el-col :span="6">
                      <div class="stat-box">
                        <div class="stat-label">上班天數</div>
                        <div class="stat-value">{{ selectedEmployee.workDays || 0 }} 天</div>
                      </div>
                    </el-col>
                    <el-col :span="6">
                      <div class="stat-box">
                        <div class="stat-label">應出勤時數</div>
                        <div class="stat-value">{{ (selectedEmployee.scheduledHours || 0).toFixed(2) }} 小時</div>
                      </div>
                    </el-col>
                    <el-col :span="6">
                      <div class="stat-box">
                        <div class="stat-label">實際工時</div>
                        <div class="stat-value">{{ (selectedEmployee.actualWorkHours || 0).toFixed(2) }} 小時</div>
                      </div>
                    </el-col>
                    <el-col :span="6">
                      <div class="stat-box">
                        <div class="stat-label">時薪</div>
                        <div class="stat-value">{{ formatCurrency(selectedEmployee.hourlyRate) }}</div>
                      </div>
                    </el-col>
                  </el-row>

                  <!-- Daily Details -->
                  <div v-if="employeeDetailData?.dailyDetails?.length" style="margin-top: 20px">
                    <h4>每日出勤明細</h4>
                    <el-table :data="employeeDetailData.dailyDetails" border size="small" max-height="300">
                      <el-table-column prop="date" label="日期" width="120" />
                      <el-table-column prop="shiftName" label="班別" width="120" />
                      <el-table-column label="上班時間" width="100" align="center">
                        <template #default="{ row }">
                          <span v-if="row.clockInTime">{{ formatTime(row.clockInTime) }}</span>
                          <span v-else style="color: #999">-</span>
                        </template>
                      </el-table-column>
                      <el-table-column label="下班時間" width="100" align="center">
                        <template #default="{ row }">
                          <span v-if="row.clockOutTime">{{ formatTime(row.clockOutTime) }}</span>
                          <span v-else style="color: #999">-</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="scheduledHours" label="排班時數" width="100" align="right">
                        <template #default="{ row }">
                          {{ row.scheduledHours.toFixed(2) }}
                        </template>
                      </el-table-column>
                      <el-table-column prop="workedHours" label="實際工時" width="100" align="right">
                        <template #default="{ row }">
                          {{ row.workedHours.toFixed(2) }}
                        </template>
                      </el-table-column>
                      <el-table-column label="出勤狀態" width="100">
                        <template #default="{ row }">
                          <el-tag :type="row.hasAttendance ? 'success' : 'danger'" size="small">
                            {{ row.hasAttendance ? '已打卡' : '缺勤' }}
                          </el-tag>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </el-card>

                <!-- Leave Impact -->
                <el-card class="detail-card" shadow="never" style="margin-top: 20px">
                  <template #header>
                    <div class="card-header">
                      <span>請假統計</span>
                    </div>
                  </template>
                  <el-row :gutter="20">
                    <el-col :span="6">
                      <div class="stat-box">
                        <div class="stat-label">總請假時數</div>
                        <div class="stat-value">{{ (selectedEmployee.leaveHours || 0).toFixed(2) }} 小時</div>
                      </div>
                    </el-col>
                    <el-col :span="6">
                      <div class="stat-box">
                        <div class="stat-label">有薪假時數</div>
                        <div class="stat-value">{{ (selectedEmployee.paidLeaveHours || 0).toFixed(2) }} 小時</div>
                      </div>
                    </el-col>
                    <el-col :span="6">
                      <div class="stat-box">
                        <div class="stat-label">無薪假時數</div>
                        <div class="stat-value">{{ (selectedEmployee.unpaidLeaveHours || 0).toFixed(2) }} 小時</div>
                      </div>
                    </el-col>
                    <el-col :span="6">
                      <div class="stat-box">
                        <div class="stat-label">請假扣款</div>
                        <div class="stat-value">{{ formatCurrency(selectedEmployee.leaveDeduction) }}</div>
                      </div>
                    </el-col>
                  </el-row>

                  <!-- Leave Records -->
                  <div v-if="employeeDetailData?.leaveRecords?.length" style="margin-top: 20px">
                    <h4>請假記錄</h4>
                    <el-table :data="employeeDetailData.leaveRecords" border size="small">
                      <el-table-column prop="leaveType" label="假別" width="120" />
                      <el-table-column prop="startDate" label="開始日期" width="120" />
                      <el-table-column prop="endDate" label="結束日期" width="120" />
                      <el-table-column prop="days" label="天數" width="80" align="right">
                        <template #default="{ row }">
                          {{ row.days.toFixed(1) }}
                        </template>
                      </el-table-column>
                      <el-table-column prop="hours" label="時數" width="80" align="right">
                        <template #default="{ row }">
                          {{ row.hours.toFixed(2) }}
                        </template>
                      </el-table-column>
                      <el-table-column label="給薪狀態" width="100">
                        <template #default="{ row }">
                          <el-tag :type="row.isPaid ? 'success' : 'warning'" size="small">
                            {{ row.isPaid ? '有薪' : '無薪' }}
                          </el-tag>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </el-card>

                <!-- Overtime -->
                <el-card class="detail-card" shadow="never" style="margin-top: 20px">
                  <template #header>
                    <div class="card-header">
                      <span>加班統計</span>
                    </div>
                  </template>
                  <el-row :gutter="20">
                    <el-col :span="12">
                      <div class="stat-box">
                        <div class="stat-label">加班時數</div>
                        <div class="stat-value">{{ (selectedEmployee.overtimeHours || 0).toFixed(2) }} 小時</div>
                      </div>
                    </el-col>
                    <el-col :span="12">
                      <div class="stat-box">
                        <div class="stat-label">加班費</div>
                        <div class="stat-value">{{ formatCurrency(selectedEmployee.overtimePay) }}</div>
                      </div>
                    </el-col>
                  </el-row>

                  <!-- Overtime Records -->
                  <div v-if="employeeDetailData?.overtimeRecords?.length" style="margin-top: 20px">
                    <h4>加班記錄</h4>
                    <el-table :data="employeeDetailData.overtimeRecords" border size="small">
                      <el-table-column prop="date" label="日期" width="120" />
                      <el-table-column prop="hours" label="加班時數" width="100" align="right">
                        <template #default="{ row }">
                          {{ row.hours.toFixed(2) }}
                        </template>
                      </el-table-column>
                      <el-table-column prop="reason" label="原因" />
                    </el-table>
                  </div>
                </el-card>

                <!-- Night Shift Statistics -->
                <el-card class="detail-card" shadow="never" style="margin-top: 20px">
                  <template #header>
                    <div class="card-header">
                      <span>夜班統計</span>
                    </div>
                  </template>
                  <el-row :gutter="20">
                    <el-col :span="8">
                      <div class="stat-box">
                        <div class="stat-label">夜班天數</div>
                        <div class="stat-value">{{ selectedEmployee.nightShiftDays || 0 }} 天</div>
                      </div>
                    </el-col>
                    <el-col :span="8">
                      <div class="stat-box">
                        <div class="stat-label">夜班時數</div>
                        <div class="stat-value">{{ (selectedEmployee.nightShiftHours || 0).toFixed(2) }} 小時</div>
                      </div>
                    </el-col>
                    <el-col :span="8">
                      <div class="stat-box">
                        <div class="stat-label">夜班津貼</div>
                        <div class="stat-value">{{ formatCurrency(selectedEmployee.nightShiftAllowance) }}</div>
                        <div v-if="selectedEmployee.nightShiftCalculationMethod" class="stat-note">
                          <span v-if="selectedEmployee.nightShiftCalculationMethod === 'calculated'">根據排班計算</span>
                          <span v-else-if="selectedEmployee.nightShiftCalculationMethod === 'fixed'">固定津貼</span>
                          <span v-else-if="selectedEmployee.nightShiftCalculationMethod === 'no_schedules'">本月無夜班排班</span>
                          <span v-else-if="selectedEmployee.nightShiftCalculationMethod === 'no_shifts'">未設定夜班班別</span>
                          <span v-else>{{ selectedEmployee.nightShiftCalculationMethod }}</span>
                        </div>
                      </div>
                    </el-col>
                  </el-row>
                </el-card>

                <!-- Salary Calculation -->
                <el-card class="detail-card" shadow="never" style="margin-top: 20px">
                  <template #header>
                    <div class="card-header">
                      <span>薪資計算明細</span>
                    </div>
                  </template>
                  <el-table :data="salaryCalculationBreakdown" border>
                    <el-table-column prop="item" label="項目" width="200" />
                    <el-table-column prop="description" label="說明" />
                    <el-table-column prop="amount" label="金額" width="150" align="right">
                      <template #default="{ row }">
                        <span :style="{ color: row.type === 'deduction' ? 'red' : row.type === 'bonus' ? 'green' : 'inherit' }">
                          {{ row.type === 'deduction' ? '-' : '' }}{{ formatCurrency(row.amount) }}
                        </span>
                      </template>
                    </el-table-column>
                  </el-table>
                  <div style="margin-top: 20px; text-align: right; font-size: 18px; font-weight: bold">
                    <el-row :gutter="20">
                      <el-col :span="18">實發金額 (銀行A)：</el-col>
                      <el-col :span="6">{{ formatCurrency(selectedEmployee.netPay) }}</el-col>
                    </el-row>
                    <el-row :gutter="20" style="margin-top: 10px">
                      <el-col :span="18">獎金金額 (銀行B)：</el-col>
                      <el-col :span="6">{{ formatCurrency(selectedEmployee.totalBonus) }}</el-col>
                    </el-row>
                  </div>
                </el-card>
              </div>
              <template #footer>
                <el-button @click="detailDialogVisible = false">關閉</el-button>
              </template>
            </el-dialog>

            <!-- Salary Calculation Explanation Dialog -->
            <el-dialog
              v-model="showExplanationDialog"
              title="薪資計算說明"
              width="80%"
              :close-on-click-modal="false"
            >
              <div class="explanation-content">
                <!-- Section 1: Calculation Formula -->
                <el-card class="explanation-card" shadow="never">
                  <template #header>
                    <div class="explanation-card-header">
                      <el-icon><Tools /></el-icon>
                      <span>薪資計算公式</span>
                    </div>
                  </template>
                  <div class="formula-section">
                    <h4>基本計算公式</h4>
                    <div class="formula-box">
                      <p><strong>實發薪資（銀行A）=</strong></p>
                      <p class="formula-item">基本薪資</p>
                      <p class="formula-item">- 請假扣款</p>
                      <p class="formula-item">- 勞保費（員工自付額）</p>
                      <p class="formula-item">- 健保費（員工自付額）</p>
                      <p class="formula-item">- 勞退提繳（員工自提）</p>
                      <p class="formula-item">- 其他扣款（債權扣押、員工借支等）</p>
                    </div>
                    <div class="formula-box formula-box--spaced">
                      <p><strong>獎金總額（銀行B）=</strong></p>
                      <p class="formula-item">加班費</p>
                      <p class="formula-item">+ 夜班津貼</p>
                      <p class="formula-item">+ 績效獎金</p>
                      <p class="formula-item">+ 其他獎金</p>
                    </div>
                    
                    <h4 class="section-heading">基本薪資計算方式</h4>
                    <ul class="calculation-list">
                      <li><strong>月薪制：</strong>固定月薪金額</li>
                      <li><strong>日薪制：</strong>實際上班天數 × 日薪</li>
                      <li><strong>時薪制：</strong>實際工作時數 × 時薪</li>
                    </ul>
                  </div>
                </el-card>

                <!-- Section 2: Regular Deduction/Bonus Items -->
                <el-card class="explanation-card" shadow="never">
                  <template #header>
                    <div class="explanation-card-header">
                      <el-icon><Setting /></el-icon>
                      <span>定期扣薪/加薪項目設定</span>
                    </div>
                  </template>
                  <div class="setting-section">
                    <el-alert
                      title="這些項目是固定的月度調整，無需每次簽核，直接在員工個人資料中設定即可"
                      type="info"
                      :closable="false"
                      show-icon
                    />
                    
                    <h4 class="section-heading" style="margin-top: 15px;">設定位置</h4>
                    <div class="location-box">
                      <p><el-icon><Location /></el-icon> <strong>員工管理</strong> → 選擇員工 → 編輯 → <strong>每月薪資調整項目</strong>區塊</p>
                    </div>
                    
                    <h4 class="section-heading">扣薪項目（減少實發金額）</h4>
                    <ul class="item-list">
                      <li><strong>健保費自付額：</strong>員工每月固定負擔的健保費用</li>
                      <li><strong>債權扣押：</strong>法院判決需扣押的薪資金額</li>
                      <li><strong>其他扣款：</strong>其他固定扣款項目（如員工借支、制服費等）</li>
                    </ul>
                    
                    <h4 class="section-heading" style="margin-top: 15px;">加薪項目（增加獎金金額，匯入銀行B）</h4>
                    <ul class="item-list">
                      <li><strong>夜班補助津貼：</strong>固定夜班津貼</li>
                      <li><strong>人力績效獎金：</strong>固定績效獎金</li>
                      <li><strong>其他獎金：</strong>其他固定獎金項目</li>
                    </ul>
                  </div>
                </el-card>

                <!-- Section 3: Dynamic Approval Items -->
                <el-card class="explanation-card" shadow="never">
                  <template #header>
                    <div class="explanation-card-header">
                      <el-icon><Document /></el-icon>
                      <span>動態簽核項目</span>
                    </div>
                  </template>
                  <div class="approval-section">
                    <el-alert
                      title="這些項目需要通過簽核流程審批，系統會自動計算已核准的申請並影響薪資"
                      type="warning"
                      :closable="false"
                      show-icon
                    />
                    
                    <h4 class="section-heading" style="margin-top: 15px;">1. 請假扣款</h4>
                    <div class="approval-item">
                      <p><strong>簽核流程：</strong></p>
                      <ol>
                        <li>員工在前台提交請假申請（填寫假別、日期、時數等）</li>
                        <li>主管審核請假申請</li>
                        <li>審核通過後（status: approved），系統自動計算扣款</li>
                      </ol>
                      
                      <p class="section-heading" style="margin-top: 10px;"><strong>扣款計算：</strong></p>
                      <ul class="calculation-list">
                        <li><strong>有薪假（不扣款）：</strong>特休、年假、婚假、喪假、產假、陪產假</li>
                        <li><strong>半薪假（扣50%）：</strong>病假、生理假</li>
                        <li><strong>無薪假（全額扣款）：</strong>事假、其他無薪假</li>
                      </ul>
                      
                      <div class="formula-box">
                        <p><strong>扣款公式：</strong></p>
                        <p>時薪換算 = 月薪 ÷ 30天 ÷ 8小時（月薪制）</p>
                        <p>請假扣款 = 無薪假時數 × 時薪</p>
                        <p>病假扣款 = 病假時數 × 時薪 × 0.5</p>
                      </div>
                    </div>
                    
                    <h4 class="section-heading">2. 加班費</h4>
                    <div class="approval-item">
                      <p><strong>簽核流程：</strong></p>
                      <ol>
                        <li>員工提交加班申請（填寫加班日期、時數、原因）</li>
                        <li>主管審核加班申請</li>
                        <li>審核通過後，系統計算加班費（匯入銀行B）</li>
                      </ol>
                      
                      <p class="section-heading" style="margin-top: 10px;"><strong>計算公式：</strong></p>
                      <div class="formula-box">
                        <p>加班費 = 加班時數 × 時薪 × 1.5倍</p>
                        <p class="formula-note">
                          註：實際應依勞基法規定（平日1.33/1.66倍、休息日1.33/1.66倍、國定假日2倍）
                        </p>
                      </div>
                      
                      <p class="section-heading" style="margin-top: 10px;"><strong>前置條件：</strong></p>
                      <ul class="calculation-list">
                        <li>員工必須啟用「自動加班計算」（autoOvertimeCalc = true）</li>
                        <li>加班申請必須經簽核通過</li>
                      </ul>
                    </div>
                    
                    <h4 class="section-heading">3. 其他動態調整</h4>
                    <div class="approval-item">
                      <p>未來可擴展其他需要簽核的薪資調整項目，如：</p>
                      <ul class="calculation-list">
                        <li>臨時性獎金（需主管核准）</li>
                        <li>臨時性扣款（需人資核准）</li>
                        <li>補發/補扣薪資（需簽核調整）</li>
                      </ul>
                    </div>
                  </div>
                </el-card>

                <!-- Section 4: Bank Distribution -->
                <el-card class="explanation-card" shadow="never">
                  <template #header>
                    <div class="explanation-card-header">
                      <el-icon><CreditCard /></el-icon>
                      <span>銀行帳戶分配說明</span>
                    </div>
                  </template>
                  <div class="bank-section">
                    <el-row :gutter="20">
                      <el-col :span="12">
                        <div class="bank-card bank-a">
                          <h4><el-icon><Wallet /></el-icon> 銀行A（薪資帳戶）</h4>
                          <p><strong>用途：</strong>匯入實發薪資</p>
                          <p><strong>內容：</strong></p>
                          <ul>
                            <li>基本薪資（月薪/日薪/時薪）</li>
                            <li>扣除所有扣款項目後的淨額</li>
                          </ul>
                          <p style="margin-top: 10px;"><strong>扣款項目包括：</strong></p>
                          <ul>
                            <li>請假扣款</li>
                            <li>勞保費、健保費</li>
                            <li>勞退自提</li>
                            <li>債權扣押、員工借支</li>
                            <li>其他扣款</li>
                          </ul>
                        </div>
                      </el-col>
                      <el-col :span="12">
                        <div class="bank-card bank-b">
                          <h4><el-icon><Money /></el-icon> 銀行B（獎金帳戶）</h4>
                          <p><strong>用途：</strong>匯入獎金與津貼</p>
                          <p><strong>內容：</strong></p>
                          <ul>
                            <li>加班費（經簽核核准）</li>
                            <li>夜班津貼</li>
                            <li>績效獎金</li>
                            <li>其他獎金</li>
                          </ul>
                          <p style="margin-top: 10px;"><strong>特點：</strong></p>
                          <ul>
                            <li>不扣除任何費用</li>
                            <li>所有獎金項目總和</li>
                            <li>可能為零（無獎金時）</li>
                          </ul>
                        </div>
                      </el-col>
                    </el-row>
                    
                    <el-alert
                      title="設定銀行帳戶：薪資管理設定 → 發放與帳戶 → 發薪帳戶維護"
                      type="info"
                      :closable="false"
                      show-icon
                      class="info-alert-spacing"
                    />
                  </div>
                </el-card>

                <!-- Section 5: Data Sources -->
                <el-card class="explanation-card" shadow="never">
                  <template #header>
                    <div class="explanation-card-header">
                      <el-icon><DataAnalysis /></el-icon>
                      <span>資料來源說明</span>
                    </div>
                  </template>
                  <div class="data-source-section">
                    <h4>工作時數來源</h4>
                    <ol>
                      <li><strong>班表設定：</strong>排班系統（ShiftSchedule）記錄每位員工的排班</li>
                      <li><strong>出勤打卡：</strong>出勤記錄（AttendanceRecord）記錄實際上下班時間</li>
                      <li><strong>班別設定：</strong>定義工作時間、休息時間等</li>
                    </ol>
                    
                    <h4 class="section-heading" style="margin-top: 15px;">請假資料來源</h4>
                    <ol>
                      <li>來自簽核系統的「請假」表單</li>
                      <li>僅計算已核准（status: approved）的申請</li>
                      <li>包含假別、開始/結束日期、天數/時數</li>
                    </ol>
                    
                    <h4 class="section-heading" style="margin-top: 15px;">加班資料來源</h4>
                    <ol>
                      <li>來自簽核系統的「加班」表單</li>
                      <li>僅計算已核准（status: approved）的申請</li>
                      <li>包含加班日期、時數、原因</li>
                    </ol>
                  </div>
                </el-card>

                <!-- Section 6: Important Notes -->
                <el-card class="explanation-card" shadow="never">
                  <template #header>
                    <div class="explanation-card-header">
                      <el-icon><Warning /></el-icon>
                      <span>注意事項</span>
                    </div>
                  </template>
                  <div class="notes-section">
                    <el-alert
                      title="資料準確性"
                      type="warning"
                      :closable="false"
                      show-icon
                    >
                      <ul>
                        <li>確保班表已正確設定</li>
                        <li>確保員工有正確打卡</li>
                        <li>確保請假和加班申請已核准</li>
                        <li>每位員工必須設定正確的薪資類型和金額</li>
                      </ul>
                    </el-alert>
                    
                    <h4 class="section-heading">系統限制</h4>
                    <ul class="calculation-list">
                      <li><strong>一天8小時制：</strong>日薪和月薪換算時薪時，假設一天工作8小時</li>
                      <li><strong>一個月30天：</strong>月薪換算日薪/時薪時，假設一個月30天</li>
                      <li><strong>加班費倍率：</strong>目前簡化為統一1.5倍，未完全依照勞基法分級</li>
                      <li><strong>病假計算：</strong>簡化為0.5倍扣款，未考慮年度累計天數</li>
                    </ul>
                  </div>
                </el-card>
              </div>
              
              <template #footer>
                <el-button type="primary" @click="showExplanationDialog = false">關閉</el-button>
              </template>
            </el-dialog>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </template>
  
<script setup>
import { ref, onMounted, computed } from 'vue'
import { apiFetch } from '../../api'
import { 
  QuestionFilled, 
  Tools, 
  Setting, 
  Location, 
  Document, 
  CreditCard, 
  Wallet, 
  Money, 
  DataAnalysis, 
  Warning 
} from '@element-plus/icons-vue'
  
  // 目前所在的Tab
  // Changed from 'salaryItem' to 'grade' as the salary item tab was removed
  // (salary items were not used in payroll calculations or any business logic)
const activeTab = ref('grade')
const settingId = ref(null)

  // Explanation dialog
const showExplanationDialog = ref(false)
  
  // ============ (1) 職等與底薪 ============
  const gradeList = ref([
    { gradeName: '初階A', baseSalary: 28000, description: '新進職等' },
    { gradeName: '中階B', baseSalary: 35000, description: '需具2年以上經驗' },
    { gradeName: '高階C', baseSalary: 50000, description: '需具5年以上經驗' }
  ])
  const gradeDialogVisible = ref(false)
  let editGradeIndex = null
  
  const gradeForm = ref({
    gradeName: '',
    baseSalary: 0,
    description: ''
  })
  
  function openGradeDialog(index = null) {
    if (index !== null) {
      // 編輯模式
      editGradeIndex = index
      gradeForm.value = { ...gradeList.value[index] }
    } else {
      // 新增模式
      editGradeIndex = null
      gradeForm.value = {
        gradeName: '',
        baseSalary: 0,
        description: ''
      }
    }
    gradeDialogVisible.value = true
  }
  
  function saveGrade() {
    if (editGradeIndex === null) {
      gradeList.value.push({ ...gradeForm.value })
    } else {
      gradeList.value[editGradeIndex] = { ...gradeForm.value }
    }
    gradeDialogVisible.value = false
    persistSetting()
  }
  
  function deleteGrade(index) {
    gradeList.value.splice(index, 1)
    persistSetting()
  }
  
  // ============ (2) 調薪與異動規則 ============
  const adjustForm = ref({
    historyMonths: 24,         // 保留2年
    effectiveRule: 'nextMonth1',
    needMultiApproval: true,
    needRetroactive: true
  })
  
  function saveAdjustRules() {
    console.log('儲存調薪與異動規則:', adjustForm.value)
    persistSetting()
  }
  
  // ============ (3) 發放與銀行帳戶 ============
  const paymentForm = ref({
    defaultBank: '004',
    batchFormat: 'formatA'
  })
  const accountDialogVisible = ref(false)
  const accountList = ref([
    { employeeName: '王小明', bankCode: '004', accountNumber: '1234567890123' },
    { employeeName: '李主管', bankCode: '822', accountNumber: '0987654321' }
  ])
  
  function openAccountDialog() {
    accountDialogVisible.value = true
  }
  
  function editAccount(index) {
    // 示範：可再做更細節的「編輯單筆帳戶」Dialog
    alert(`編輯帳戶：${accountList.value[index].employeeName}`)
  }
  
  function savePaymentSetting() {
    console.log('儲存發放設定:', paymentForm.value)
    persistSetting()
  }
  
  // ============ (4) 其他設定 (扶養親屬、法院扣押...) ============
  const otherForm = ref({
    includeDependents: false,
    courtGarnishment: false,
    diffAdjustmentMonths: 3
  })
  
  function saveOtherSetting() {
    console.log('儲存其他薪資設定:', otherForm.value)
    persistSetting()
  }

  // ============ (5) 月薪資總覽 ============
  const overviewMonth = ref(new Date().toISOString().substring(0, 7) + '-01')
  const overviewData = ref([])
  const filterOrganization = ref('')
  const filterDepartment = ref('')
  const filterSubDepartment = ref('')
  const filterEmployeeName = ref('')
  const exportFormat = ref('taiwan')
  const showFormatPreview = ref(true)
  const exportLoading = ref(false)
  const organizations = ref([])
  const departments = ref([])
  const subDepartments = ref([])

  // Detail dialog
  const detailDialogVisible = ref(false)
  const selectedEmployee = ref(null)
  const employeeDetailData = ref(null)

  // Computed filtered data based on employee name search
  const filteredOverviewData = computed(() => {
    if (!filterEmployeeName.value) {
      return overviewData.value
    }
    const searchTerm = filterEmployeeName.value.toLowerCase()
    return overviewData.value.filter(item => 
      item.name.toLowerCase().includes(searchTerm) ||
      item.employeeId?.toLowerCase().includes(searchTerm)
    )
  })

  // Computed summary statistics
  const totalBaseSalary = computed(() => {
    return filteredOverviewData.value.reduce((sum, item) => sum + (item.baseSalary || 0), 0)
  })

  const totalNetPay = computed(() => {
    return filteredOverviewData.value.reduce((sum, item) => sum + (item.totalPayment || 0), 0)
  })

  const totalDeductions = computed(() => {
    return filteredOverviewData.value.reduce((sum, item) => {
      const deductions = (item.laborInsuranceFee || 0) +
                        (item.healthInsuranceFee || 0) +
                        (item.laborPensionSelf || 0) +
                        (item.otherDeductions || 0)
      return sum + deductions
    }, 0)
  })

  const formatPreviewColumns = {
    taiwan: [
      { label: '付款代號', prop: 'code', width: 100 },
      { label: '付款日期', prop: 'date', width: 120 },
      { label: '付款帳號', prop: 'account', width: 160 },
      { label: '收款戶名', prop: 'payee', width: 120 },
      { label: '收款行代碼', prop: 'bank', width: 100 },
      { label: '收款帳號', prop: 'payeeAccount', width: 160 },
      { label: '備註', prop: 'note' }
    ],
    taichung: [
      { label: '流水號', prop: 'serial', width: 100 },
      { label: '姓名', prop: 'name', width: 120 },
      { label: '轉入帳號', prop: 'account', width: 160 },
      { label: '轉入金額', prop: 'amount', width: 120, align: 'right' },
      { label: '核證總數', prop: 'checksum', width: 120 }
    ],
    bonusSlip: [
      { label: '員工編號', prop: 'employeeId', width: 120 },
      { label: '姓名', prop: 'name', width: 120 },
      { label: '部門', prop: 'department', width: 140 },
      { label: '銀行代碼', prop: 'bankCode', width: 100 },
      { label: '帳號末四碼', prop: 'accountTail', width: 110 },
      { label: '加班費', prop: 'overtime', width: 100, align: 'right' },
      { label: '績效獎金', prop: 'performance', width: 110, align: 'right' },
      { label: '其他獎金', prop: 'otherBonus', width: 110, align: 'right' },
      { label: '簽核調整', prop: 'adjustment', width: 110, align: 'right' },
      { label: '獎金合計', prop: 'total', width: 110, align: 'right' }
    ]
  }

  const formatPreviewData = {
    taiwan: [
      {
        code: '0001',
        date: '2024/05/31',
        account: '050-5206-123456789012',
        payee: '王曉明',
        bank: '050-5206',
        payeeAccount: '1234-5678-9012',
        note: '薪資'
      },
      {
        code: '0002',
        date: '2024/05/31',
        account: '050-5206-123456789012',
        payee: '李小華',
        bank: '050-5206',
        payeeAccount: '7890-1234-5678',
        note: '薪資'
      }
    ],
    taichung: [
      { serial: '1', name: '王曉明', account: '054-123-4567890', amount: '35,000', checksum: '35,000' },
      { serial: '2', name: '李小華', account: '054-987-6543210', amount: '32,000', checksum: '99,000' }
    ],
    bonusSlip: [
      {
        employeeId: 'E001',
        name: '王曉明',
        department: '工程部',
        bankCode: '004',
        accountTail: '9012',
        overtime: '1,200',
        performance: '2,000',
        otherBonus: '800',
        adjustment: '0',
        total: '4,000'
      },
      {
        employeeId: 'E002',
        name: '李小華',
        department: '行政部',
        bankCode: '822',
        accountTail: '4321',
        overtime: '600',
        performance: '1,200',
        otherBonus: '500',
        adjustment: '-100',
        total: '2,200'
      }
    ]
  }

  const currentPreviewColumns = computed(() => formatPreviewColumns[exportFormat.value] || [])
  const currentFormatPreview = computed(() => formatPreviewData[exportFormat.value] || [])

  // Salary calculation breakdown for detail dialog
  const salaryCalculationBreakdown = computed(() => {
    if (!selectedEmployee.value) return []

    const breakdown = []
    const emp = selectedEmployee.value
    
    // Base salary calculation
    if (emp.salaryType === '時薪') {
      breakdown.push({
        item: '基本薪資計算',
        description: `${(emp.actualWorkHours || 0).toFixed(2)} 小時 × ${formatCurrency(emp.hourlyRate)}`,
        amount: emp.baseSalary || 0,
        type: 'income'
      })
    } else if (emp.salaryType === '日薪') {
      const dailyRate = emp.hourlyRate * 8
      breakdown.push({
        item: '基本薪資計算',
        description: `${emp.workDays || 0} 天 × ${formatCurrency(dailyRate)}`,
        amount: emp.baseSalary || 0,
        type: 'income'
      })
    } else {
      breakdown.push({
        item: '基本薪資',
        description: '月薪制',
        amount: emp.baseSalary || 0,
        type: 'income'
      })
    }
    
    // Leave deduction
    if (emp.leaveDeduction > 0) {
      breakdown.push({
        item: '請假扣款',
        description: `無薪假 ${(emp.unpaidLeaveHours || 0).toFixed(2)} 小時`,
        amount: emp.leaveDeduction,
        type: 'deduction'
      })
    }
    
    // Insurance and pension deductions
    if (emp.laborInsuranceFee > 0) {
      breakdown.push({
        item: '勞保費',
        description: '員工自付額',
        amount: emp.laborInsuranceFee,
        type: 'deduction'
      })
    }
    
    if (emp.healthInsuranceFee > 0) {
      breakdown.push({
        item: '健保費',
        description: '員工自付額',
        amount: emp.healthInsuranceFee,
        type: 'deduction'
      })
    }
    
    if (emp.laborPensionSelf > 0) {
      breakdown.push({
        item: '勞退提繳',
        description: '個人提繳',
        amount: emp.laborPensionSelf,
        type: 'deduction'
      })
    }
    
    // Other deductions
    if (emp.employeeAdvance > 0) {
      breakdown.push({
        item: '員工借支',
        description: '',
        amount: emp.employeeAdvance,
        type: 'deduction'
      })
    }
    
    if (emp.otherDeductions > 0) {
      breakdown.push({
        item: '其他扣款',
        description: '',
        amount: emp.otherDeductions,
        type: 'deduction'
      })
    }
    
    // Bonuses (separate - goes to Bank B)
    if (emp.overtimePay > 0) {
      breakdown.push({
        item: '加班費',
        description: `${(emp.overtimeHours || 0).toFixed(2)} 小時`,
        amount: emp.overtimePay,
        type: 'bonus'
      })
    }
    
    if (emp.nightShiftAllowance > 0) {
      let description = ''
      if (emp.nightShiftCalculationMethod === 'calculated') {
        description = `${emp.nightShiftDays || 0} 天夜班，共 ${(emp.nightShiftHours || 0).toFixed(2)} 小時`
      } else if (emp.nightShiftCalculationMethod === 'fixed') {
        description = '固定津貼'
      }
      breakdown.push({
        item: '夜班津貼',
        description,
        amount: emp.nightShiftAllowance,
        type: 'bonus'
      })
    }
    
    if (emp.performanceBonus > 0) {
      breakdown.push({
        item: '績效獎金',
        description: '',
        amount: emp.performanceBonus,
        type: 'bonus'
      })
    }
    
    if (emp.otherBonuses > 0) {
      breakdown.push({
        item: '其他獎金',
        description: '',
        amount: emp.otherBonuses,
        type: 'bonus'
      })
    }

    return breakdown
  })

  async function downloadPayrollExcel() {
    try {
      exportLoading.value = true
      const params = new URLSearchParams({ month: overviewMonth.value, format: exportFormat.value })
      const res = await apiFetch(`/api/payroll/export?${params}`, { method: 'POST' })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || '匯出失敗，請稍後再試')
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `payroll_${overviewMonth.value}_${exportFormat.value}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('匯出薪資Excel失敗:', error)
      alert(error.message || '匯出失敗，請稍後再試')
    } finally {
      exportLoading.value = false
    }
  }

  function formatCurrency(value) {
    if (value == null || isNaN(value)) return 'NT$ 0'
    return 'NT$ ' + Math.round(value).toLocaleString('zh-TW')
  }

  function formatTime(isoString) {
    if (!isoString) return '-'
    try {
      const date = new Date(isoString)
      // Use local time for display as users expect to see their local clock-in/out times
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      return `${hours}:${minutes}`
    } catch (error) {
      console.error('Error formatting time:', error)
      return '-'
    }
  }

  async function fetchMonthlyOverview() {
    try {
      const params = new URLSearchParams({ month: overviewMonth.value })
      if (filterOrganization.value) params.append('organization', filterOrganization.value)
      if (filterDepartment.value) params.append('department', filterDepartment.value)
      if (filterSubDepartment.value) params.append('subDepartment', filterSubDepartment.value)
      
      const res = await apiFetch(`/api/payroll/overview/monthly?${params}`)
      if (res.ok) {
        overviewData.value = await res.json()
      } else {
        console.error('Failed to fetch monthly overview')
        overviewData.value = []
      }
    } catch (error) {
      console.error('Error fetching monthly overview:', error)
      overviewData.value = []
    }
  }

  async function fetchOrganizations() {
    try {
      const res = await apiFetch('/api/organizations')
      if (res.ok) {
        organizations.value = await res.json()
      }
    } catch (error) {
      console.error('Error fetching organizations:', error)
    }
  }

  async function fetchDepartments() {
    try {
      const res = await apiFetch('/api/departments')
      if (res.ok) {
        departments.value = await res.json()
      }
    } catch (error) {
      console.error('Error fetching departments:', error)
    }
  }

  async function fetchSubDepartments() {
    try {
      const res = await apiFetch('/api/subdepartments')
      if (res.ok) {
        subDepartments.value = await res.json()
      }
    } catch (error) {
      console.error('Error fetching sub-departments:', error)
    }
  }

  async function showDetailDialog(employee) {
    selectedEmployee.value = employee
    detailDialogVisible.value = true
    
    // Fetch detailed work data
    try {
      const res = await apiFetch(`/api/payroll/complete-data/${employee._id}/${overviewMonth.value}`)
      if (res.ok) {
        employeeDetailData.value = await res.json()
      } else {
        console.error('Failed to fetch employee detail data')
        employeeDetailData.value = null
      }
    } catch (error) {
      console.error('Error fetching employee detail data:', error)
      employeeDetailData.value = null
    }
  }

  async function fetchSetting() {
    const res = await apiFetch('/api/salary-settings')
    if (res.ok) {
      const data = await res.json()
      if (data.length) {
        const s = data[0]
        settingId.value = s._id
        // Note: salaryItems removed - they were not integrated with payroll calculations 
        // or any business logic, only stored as metadata on employee records
        gradeList.value = s.grades || []
        Object.assign(adjustForm.value, s.adjust || {})
        Object.assign(paymentForm.value, s.payment || {})
        Object.assign(otherForm.value, s.other || {})
      }
    }
  }

  async function persistSetting() {
    const payload = {
      // Note: salaryItems removed - they were not integrated with payroll calculations 
      // or any business logic, only stored as metadata on employee records
      grades: gradeList.value,
      adjust: adjustForm.value,
      payment: paymentForm.value,
      other: otherForm.value
    }
    const url = settingId.value
      ? `/api/salary-settings/${settingId.value}`
      : '/api/salary-settings'
    const method = settingId.value ? 'PUT' : 'POST'
    const res = await apiFetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    if (res.ok) {
      const saved = await res.json()
      settingId.value = saved._id
    }
  }

  onMounted(() => {
    fetchSetting()
    fetchOrganizations()
    fetchDepartments()
    fetchSubDepartments()
    fetchMonthlyOverview()
  })
</script>
  
  <style scoped>
  .salary-management-setting {
    padding: 20px;
  }
  
  .tab-content {
    margin-top: 20px;
  }

  .filter-form {
    margin-bottom: 20px;
    padding: 15px;
    background-color: #f5f7fa;
    border-radius: 4px;
  }

  .stat-item {
    text-align: center;
    padding: 10px;
  }

  .stat-label {
    font-size: 14px;
    color: #909399;
    margin-bottom: 8px;
  }

  .stat-value {
    font-size: 24px;
    font-weight: bold;
    color: #303133;
  }

  .detail-card {
    margin-bottom: 15px;
  }

  .card-header {
    font-weight: bold;
    font-size: 16px;
  }

  .stat-box {
    text-align: center;
    padding: 15px;
    background-color: #f5f7fa;
    border-radius: 4px;
  }

  .stat-box .stat-note {
    font-size: 12px;
    color: #909399;
    margin-top: 4px;
  }

  .stat-box .stat-label {
    font-size: 14px;
    color: #909399;
    margin-bottom: 8px;
  }

  .stat-box .stat-value {
    font-size: 20px;
    font-weight: bold;
    color: #303133;
  }

  .export-card {
    margin-bottom: 20px;
  }

  .export-card__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .export-card__title {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .export-card__actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .export-card__alert {
    margin-bottom: 12px;
  }

  /* Overview header with explanation button */
  .overview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 2px solid #e4e7ed;
  }

  .overview-header h3 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: #303133;
  }

  /* Explanation dialog styles */
  .explanation-content {
    max-height: 70vh;
    overflow-y: auto;
  }

  .explanation-card {
    margin-bottom: 20px;
  }

  .explanation-card:last-child {
    margin-bottom: 0;
  }

  .explanation-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 600;
    color: #303133;
  }

  .formula-section,
  .setting-section,
  .approval-section,
  .bank-section,
  .data-source-section,
  .notes-section {
    padding: 10px 0;
  }

  .formula-box {
    background-color: #f5f7fa;
    padding: 15px;
    border-radius: 4px;
    border-left: 4px solid #409eff;
  }

  .formula-box p {
    margin: 5px 0;
    line-height: 1.8;
  }

  .calculation-list {
    list-style-type: none;
    padding-left: 0;
  }

  .calculation-list li {
    padding: 8px 0;
    padding-left: 20px;
    position: relative;
    line-height: 1.6;
  }

  .calculation-list li:before {
    content: "•";
    position: absolute;
    left: 0;
    color: #409eff;
    font-weight: bold;
  }

  .location-box {
    background-color: #ecf5ff;
    padding: 12px 15px;
    border-radius: 4px;
    border: 1px solid #b3d8ff;
  }

  .location-box p {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .item-list {
    list-style-type: none;
    padding-left: 0;
  }

  .item-list li {
    padding: 10px;
    margin-bottom: 8px;
    background-color: #f5f7fa;
    border-radius: 4px;
    line-height: 1.6;
  }

  .approval-item {
    padding: 15px;
    background-color: #fafafa;
    border-radius: 4px;
    margin-bottom: 15px;
  }

  .approval-item ol,
  .approval-item ul {
    margin: 10px 0;
    padding-left: 25px;
  }

  .approval-item li {
    margin: 8px 0;
    line-height: 1.6;
  }

  .bank-card {
    padding: 20px;
    border-radius: 8px;
    height: 100%;
  }

  .bank-card h4 {
    margin-top: 0;
    margin-bottom: 15px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
  }

  .bank-card p {
    margin: 10px 0;
  }

  .bank-card ul {
    margin: 5px 0;
    padding-left: 20px;
  }

  .bank-card li {
    margin: 5px 0;
    line-height: 1.6;
  }

  .bank-a {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .bank-b {
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    color: white;
  }

  .data-source-section h4 {
    margin-top: 20px;
    margin-bottom: 10px;
    color: #303133;
    font-size: 15px;
  }

  .data-source-section h4:first-child {
    margin-top: 0;
  }

  .data-source-section ol {
    padding-left: 25px;
  }

  .data-source-section li {
    margin: 8px 0;
    line-height: 1.6;
  }

  .notes-section ul {
    margin: 10px 0;
    padding-left: 20px;
  }

  .notes-section li {
    margin: 8px 0;
    line-height: 1.6;
  }

  /* Additional utility classes for explanation dialog */
  .formula-item {
    margin-left: 20px;
  }

  .formula-box--spaced {
    margin-top: 15px;
  }

  .section-heading {
    margin-top: 20px;
  }

  .section-heading:first-child {
    margin-top: 0;
  }

  .formula-note {
    margin-top: 5px;
    font-size: 12px;
    color: #909399;
  }

  .info-alert-spacing {
    margin-top: 20px;
  }
  </style>
