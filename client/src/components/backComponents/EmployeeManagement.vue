<!-- src/components/backComponents/EmployeeManagement.vue -->
<template>
  <el-tab-pane label="員工管理" name="employeeMgmt">
    <div class="employee-management">
      <!-- 添加現代化的頁面標題和統計信息 -->
      <div class="page-header">
        <div class="header-content">
          <h1 class="page-title">員工管理系統</h1>
          <p class="page-description">管理員工資料、權限設定、部門分配和薪資配置</p>
        </div>
        <div class="header-stats">
          <div class="stat-item">
            <div class="stat-number">{{ employeeList.length }}</div>
            <div class="stat-label">總員工數</div>
          </div>
          <div class="stat-item">
            <div class="stat-number">{{ activeEmployees }}</div>
            <div class="stat-label">在職員工</div>
          </div>
        </div>
      </div>

      <!-- 操作區域 -->
      <div class="content-header">
        <h2 class="section-title">員工列表</h2>

        <div class="content-actions">
          <!-- 🔍 搜尋欄位 -->
          <el-input v-model="searchQuery" placeholder="搜尋姓名、員工編號、Email" clearable class="search-input">
            <template #prefix>
              <i class="el-icon-search"></i>
            </template>
          </el-input>
          
          <!-- 🔍 部門篩選 -->
          <el-select v-model="departmentFilter" placeholder="篩選部門" clearable class="dept-filter-select">
            <el-option v-for="dept in departmentFilterOptions" :key="dept.value" :label="dept.label"
              :value="dept.value" />
          </el-select>

          <el-button type="primary" @click="openEmployeeDialog()" class="add-btn">
            <i class="el-icon-plus"></i>
            新增員工
          </el-button>
          <el-button type="success" plain class="import-btn" data-test="bulk-import-button"
            @click="openBulkImportDialog">
            <i class="el-icon-upload2"></i>
            批量匯入
          </el-button>
        </div>
      </div>


      <!-- 美化員工列表表格 -->
      <div class="table-container">
        <el-table :data="filteredEmployeeList" class="employee-table"
          :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
          :row-style="{ height: '64px' }">

          <el-table-column prop="name" label="員工資訊" min-width="200">
            <template #default="{ row }">
              <div class="employee-info">
                <el-avatar :size="40" :src="row.photo" class="employee-avatar">
                  {{ row.name ? row.name.charAt(0) : 'N' }}
                </el-avatar>
                <div class="employee-details">
                  <div class="employee-name">{{ row.name || '未設定' }}</div>
                  <div class="employee-id">{{ row.employeeNo || '無編號' }}</div>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="部門" width="180">
            <template #default="{ row }">
              <div class="department-info">
                <i class="el-icon-s-grid dept-icon"></i>
                <span>{{ departmentLabel(row.department) }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column prop="title" label="職稱" width="150">
            <template #default="{ row }">
              <el-tag v-if="row.title" type="info" class="title-tag">
                {{ getOptionLabel(titleOptions, row.title) }}
              </el-tag>
              <span v-else class="no-data">未設定</span>
            </template>
          </el-table-column>

          <el-table-column prop="role" label="系統權限" width="120">
            <template #default="{ row }">
              <el-tag :type="getRoleTagType(row.role)" class="role-tag">
                {{ getRoleLabel(row.role) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="employmentStatus" label="在職狀態" width="130">
            <template #default="{ row }">
              <el-tag :type="getStatusTagType(row.employmentStatus)" class="status-tag">
                {{ row.employmentStatus || '未設定' }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="聯絡方式" width="200">
            <template #default="{ row }">
              <div class="contact-info">
                <div v-if="row.email" class="contact-item">
                  <i class="el-icon-message"></i>
                  <span>{{ row.email }}</span>
                </div>
                <div v-if="row.phone" class="contact-item">
                  <i class="el-icon-phone"></i>
                  <span>{{ row.phone }}</span>
                </div>
                <div v-if="!row.email && !row.phone" class="no-data">
                  無聯絡資訊
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="特休餘額" width="120">
            <template #default="{ row }">
              <div v-if="row.annualLeave" class="annual-leave-info">
                <el-tag type="info" size="small">
                  剩餘 {{ (row.annualLeave?.totalDays || 0) - (row.annualLeave?.usedDays || 0) }} 天
                </el-tag>
              </div>
              <span v-else class="no-data">未設定</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row, $index }">
              <div class="action-buttons">
                <el-button type="primary" size="small" @click="openEmployeeDialog($index)" class="edit-btn">
                  <i class="el-icon-edit"></i>
                  編輯
                </el-button>
                <el-button v-if="row.role !== 'admin'" type="danger" size="small" @click="deleteEmployee($index)" class="delete-btn">
                  <i class="el-icon-delete"></i>
                  刪除
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 美化員工資料對話框 -->
      <el-dialog v-model="employeeDialogVisible" title="員工資料管理" width="1200px" class="employee-dialog"
        :close-on-click-modal="false">
        <el-form ref="formRef" :model="employeeForm" :rules="rules" label-width="140px" class="employee-form">
          <el-tabs v-model="employeeDialogTab" type="border-card" class="employee-tabs">
            <!-- 帳號/權限 -->
            <el-tab-pane name="account">
              <template #label>
                <div class="tab-label">
                  <i class="el-icon-user"></i>
                  <span>帳號權限</span>
                </div>
              </template>

              <div class="tab-content">
                <div class="form-section">
                  <div class="form-group">
                    <h3 class="form-group-title">登入資訊</h3>
                    <el-form-item label="登入帳號" required prop="username">
                      <el-input v-model="employeeForm.username" placeholder="請輸入登入帳號" />
                    </el-form-item>
                    <el-form-item label="登入密碼" required prop="password">
                      <el-input v-model="employeeForm.password" type="password" placeholder="請輸入密碼" show-password />
                    </el-form-item>
                  </div>

                  <div class="form-group">
                    <h3 class="form-group-title">權限設定</h3>
                    <el-form-item label="系統權限" required prop="role">
                      <el-radio-group v-model="employeeForm.role" class="role-radio-group">
                        <el-radio v-for="r in ROLE_OPTIONS" :key="r.value" :label="r.value" class="role-radio">
                          <div class="role-option">
                            <div class="role-name">{{ r.label }}</div>
                            <div class="role-desc">{{ getRoleDescription(r.value) }}</div>
                          </div>
                        </el-radio>
                      </el-radio-group>
                    </el-form-item>

                    <el-form-item label="權限職等">
                      <el-select v-model="employeeForm.permissionGrade" placeholder="選擇職等" class="code-select">
                        <el-option v-for="g in PERMISSION_GRADE_OPTIONS" :key="g.level"
                          :label="formatPermissionGradeLabel(g)" :value="g.level">
                          <div class="option-wrapper">
                            <div class="option-title">{{ g.level }}｜{{ g.description }}</div>
                          </div>
                        </el-option>
                      </el-select>
                    </el-form-item>
                  </div>
                </div>
              </div>
            </el-tab-pane>

            <!-- 簽核/標籤 -->
            <el-tab-pane name="approval">
              <template #label>
                <div class="tab-label">
                  <i class="el-icon-document-checked"></i>
                  <span>簽核設定</span>
                </div>
              </template>

              <div class="tab-content">
                <div class="form-section">
                  <div class="form-group">
                    <h3 class="form-group-title">簽核權限</h3>
                    <el-form-item label="簽核角色">
                      <el-radio-group v-model="employeeForm.signRole" class="sign-role-group">
                        <el-radio v-for="option in SIGN_ROLE_OPTIONS" :key="option.id" :label="option.id"
                          class="sign-role-radio">
                          <div class="option-wrapper">
                            <div class="option-title">{{ option.id }}｜{{ option.label }}</div>
                            <div class="option-desc">{{ option.description }}</div>
                          </div>
                        </el-radio>
                      </el-radio-group>
                    </el-form-item>

                    <el-form-item label="簽核層級">
                      <el-select v-model="employeeForm.signLevel" placeholder="選擇層級" class="code-select">
                        <el-option v-for="level in SIGN_LEVEL_OPTIONS" :key="level.id"
                          :label="formatSignLevelLabel(level)" :value="level.id">
                          <div class="option-wrapper">
                            <div class="option-title">{{ level.id }}｜{{ level.label }}</div>
                            <div class="option-desc">{{ level.description }}</div>
                          </div>
                        </el-option>
                      </el-select>
                    </el-form-item>

                    <el-form-item label="員工標籤">
                      <el-select v-model="employeeForm.signTags" multiple filterable allow-create default-first-option
                        placeholder="選擇或新增標籤" class="tag-select">
                        <el-option v-for="t in DEFAULT_TAGS" :key="t" :label="t" :value="t" />
                      </el-select>
                    </el-form-item>
                  </div>
                </div>
              </div>
            </el-tab-pane>

            <!-- 個人資訊 -->
            <el-tab-pane name="personal">
              <template #label>
                <div class="tab-label">
                  <i class="el-icon-user-solid"></i>
                  <span>個人資訊</span>
                </div>
              </template>

              <div class="tab-content">
                <div class="form-section">
                  <div class="form-group">
                    <h3 class="form-group-title">基本資料</h3>
                    <el-form-item label="個人照片" class="photo-upload-item">
                      <el-upload class="employee-photo-upload" v-model:file-list="employeeForm.photoList"
                        :http-request="handlePhotoRequest" :on-success="handlePhotoSuccess"
                        :on-remove="handlePhotoRemove" :on-exceed="handlePhotoExceed" list-type="picture-card"
                        :limit="1" accept="image/*" :disabled="photoUploading">
                        <div class="upload-placeholder">
                          <i class="el-icon-plus"></i>
                          <span>上傳照片</span>
                        </div>
                      </el-upload>
                    </el-form-item>
                    <div class="form-row">
                      <el-form-item label="員工編號">
                        <el-input v-model="employeeForm.employeeNo" placeholder="請輸入員工編號" />
                      </el-form-item>
                      <el-form-item label="員工姓名" required prop="name">
                        <el-input v-model="employeeForm.name" placeholder="請輸入員工姓名" />
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="性別" required prop="gender">
                        <el-select v-model="employeeForm.gender" placeholder="選擇性別">
                          <el-option label="男" value="M" />
                          <el-option label="女" value="F" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="生日">
                        <el-date-picker v-model="employeeForm.birthday" type="date" placeholder="選擇生日" />
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="身分證號">
                        <el-input v-model="employeeForm.idNumber" placeholder="請輸入身分證號" />
                      </el-form-item>
                      <el-form-item label="出生地">
                        <el-input v-model="employeeForm.birthplace" placeholder="請輸入出生地" />
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="血型">
                        <el-select v-model="employeeForm.bloodType" placeholder="選擇血型">
                          <el-option v-for="b in ABO_TYPES" :key="b" :value="b" :label="b" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="婚姻狀態">
                        <el-select v-model="employeeForm.maritalStatus" placeholder="選擇婚姻狀態">
                          <el-option label="未婚" value="未婚" />
                          <el-option label="已婚" value="已婚" />
                          <el-option label="離婚" value="離婚" />
                          <el-option label="喪偶" value="喪偶" />
                        </el-select>
                      </el-form-item>
                    </div>

                    <el-form-item label="語言能力">
                      <el-select v-model="employeeForm.languages" multiple filterable placeholder="選擇語言"
                        :disabled="!languageOptions.length">
                        <el-option v-for="option in languageOptions" :key="option.value" :label="option.label"
                          :value="option.value" />
                      </el-select>
                    </el-form-item>

                    <div class="form-row">
                      <el-form-item label="身心障礙等級">
                        <el-select v-model="employeeForm.disabilityLevel" placeholder="選擇等級" clearable
                          :disabled="!disabilityLevelOptions.length">
                          <el-option v-for="option in disabilityLevelOptions" :key="option.value" :label="option.label"
                            :value="option.value" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="身分註記">
                        <el-select v-model="employeeForm.identityCategory" multiple filterable collapse-tags
                          placeholder="選擇身份別" :disabled="!identityCategoryOptions.length">
                          <el-option v-for="option in identityCategoryOptions" :key="option.value" :label="option.label"
                            :value="option.value" />
                        </el-select>
                      </el-form-item>
                    </div>

                    <el-form-item label="扶養人數">
                      <el-input-number v-model="employeeForm.dependents" :min="0" />
                    </el-form-item>
                  </div>

                  <div class="form-group">
                    <h3 class="form-group-title">聯絡資訊</h3>
                    <div class="form-row">
                      <el-form-item label="Email" required prop="email">
                        <el-input v-model="employeeForm.email" placeholder="請輸入Email" />
                      </el-form-item>
                      <el-form-item label="行動電話">
                        <el-input v-model="employeeForm.phone" placeholder="請輸入行動電話" />
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="市內電話">
                        <el-input v-model="employeeForm.landline" placeholder="請輸入市內電話" />
                      </el-form-item>
                      <el-form-item label="LINE ID">
                        <el-input v-model="employeeForm.lineId" placeholder="請輸入LINE ID" />
                      </el-form-item>
                    </div>

                    <el-form-item label="戶籍地址">
                      <el-input v-model="employeeForm.householdAddress" placeholder="請輸入戶籍地址" />
                    </el-form-item>

                    <el-form-item label="聯絡地址">
                      <el-input v-model="employeeForm.contactAddress" placeholder="請輸入聯絡地址" />
                    </el-form-item>
                  </div>
                </div>
              </div>
            </el-tab-pane>

            <!-- 任職資訊 -->
            <el-tab-pane name="employment">
              <template #label>
                <div class="tab-label">
                  <i class="el-icon-office-building"></i>
                  <span>任職資訊</span>
                </div>
              </template>

              <div class="tab-content">
                <div class="form-section">
                  <div class="form-group">
                    <h3 class="form-group-title">組織架構</h3>
                    <div class="form-row">
                      <el-form-item label="所屬機構" required prop="organization">
                        <el-select v-model="employeeForm.organization" placeholder="選擇機構">
                          <el-option v-for="org in orgList" :key="org._id" :label="org.name" :value="org._id" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="所屬部門" required prop="department">
                        <el-select v-model="employeeForm.department" placeholder="選擇部門">
                          <el-option v-for="dept in filteredDepartments" :key="dept._id" :label="dept.name"
                            :value="dept._id" />
                        </el-select>
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="小單位">
                        <el-select v-model="employeeForm.subDepartment" placeholder="選擇小單位">
                          <el-option v-for="sd in filteredSubDepartments" :key="sd._id" :label="sd.name"
                            :value="sd._id" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="直屬主管">
                        <el-select v-model="employeeForm.supervisor" placeholder="選擇主管">
                          <el-option v-for="sup in supervisorList" :key="sup._id" :label="sup.name" :value="sup._id" />
                        </el-select>
                      </el-form-item>
                    </div>
                  </div>

                  <div class="form-group">
                    <h3 class="form-group-title">職務資訊</h3>
                    <div class="form-row">
                      <el-form-item label="職稱">
                        <el-select v-model="employeeForm.title" placeholder="選擇職稱" :disabled="!titleOptions.length">
                          <el-option v-for="option in titleOptions" :key="option.value" :label="option.label"
                            :value="option.value" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="執業職稱">
                        <el-select v-model="employeeForm.practiceTitle" placeholder="選擇執業職稱"
                          :disabled="!practiceTitleOptions.length">
                          <el-option v-for="option in practiceTitleOptions" :key="option.value" :label="option.label"
                            :value="option.value" />
                        </el-select>
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="兼職人員">
                        <el-switch v-model="employeeForm.isPartTime" active-text="是" inactive-text="否"
                          active-color="#10b981" />
                      </el-form-item>
                      <el-form-item label="需要打卡">
                        <el-switch v-model="employeeForm.isClocking" active-text="是" inactive-text="否"
                          active-color="#10b981" />
                      </el-form-item>
                    </div>
                  </div>

                  <div class="form-group">
                    <h3 class="form-group-title">聘用狀態</h3>
                    <div class="form-row">
                      <el-form-item label="在職狀態">
                        <el-select v-model="employeeForm.employmentStatus" placeholder="選擇狀態">
                          <el-option label="正職員工" value="正職員工" />
                          <el-option label="試用期員工" value="試用期員工" />
                          <el-option label="離職員工" value="離職員工" />
                          <el-option label="留職停薪" value="留職停薪" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="試用期">
                        <el-select v-model="employeeForm.probationDays" placeholder="選擇天數">
                          <el-option label="無" value="" />
                          <el-option label="30天" value="30" />
                          <el-option label="60天" value="60" />
                          <el-option label="90天" value="90" />
                        </el-select>
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="到職日期">
                        <el-date-picker v-model="employeeForm.hireDate" type="date" placeholder="選擇到職日期" />
                      </el-form-item>
                      <el-form-item label="起聘日期">
                        <el-date-picker v-model="employeeForm.appointDate" type="date" placeholder="選擇起聘日期" />
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="離職日期">
                        <el-date-picker v-model="employeeForm.resignDate" type="date" placeholder="選擇離職日期" />
                      </el-form-item>
                      <el-form-item label="解聘日期">
                        <el-date-picker v-model="employeeForm.dismissDate" type="date" placeholder="選擇解聘日期" />
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="再任起聘">
                        <el-date-picker v-model="employeeForm.reAppointDate" type="date" placeholder="選擇再任起聘日期" />
                      </el-form-item>
                      <el-form-item label="再任解聘">
                        <el-date-picker v-model="employeeForm.reDismissDate" type="date" placeholder="選擇再任解聘日期" />
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="聘任備註" class="full-width-item">
                        <el-input v-model="employeeForm.employmentNote" type="textarea" :rows="2"
                          placeholder="請輸入聘任備註" />
                      </el-form-item>
                    </div>
                  </div>
                </div>
              </div>
            </el-tab-pane>

            <!-- 更多資訊 -->
            <el-tab-pane name="more">
              <template #label>
                <div class="tab-label">
                  <i class="el-icon-more"></i>
                  <span>更多資訊</span>
                </div>
              </template>

              <div class="tab-content">
                <div class="form-section">
                  <!-- 身體檢查 -->
                  <div class="form-group">
                    <h3 class="form-group-title">身體檢查</h3>
                    <div class="form-row">
                      <el-form-item label="身高 (cm)">
                        <el-input-number v-model="employeeForm.height" :min="0" :max="250" :step="0.1" :precision="1"
                          :value-on-clear="null" controls-position="right" placeholder="請輸入身高" />
                      </el-form-item>
                      <el-form-item label="體重 (kg)">
                        <el-input-number v-model="employeeForm.weight" :min="0" :max="300" :step="0.1" :precision="1"
                          :value-on-clear="null" controls-position="right" placeholder="請輸入體重" />
                      </el-form-item>
                    </div>
                    <div class="form-row">
                      <el-form-item label="體檢血型">
                        <el-select v-model="employeeForm.medicalBloodType" placeholder="選擇血型" clearable>
                          <el-option v-for="blood in ABO_TYPES" :key="`medical-${blood}`" :label="blood"
                            :value="blood" />
                        </el-select>
                      </el-form-item>
                    </div>
                  </div>

                  <!-- 學歷資訊 -->
                  <div class="form-group">
                    <h3 class="form-group-title">學歷資訊</h3>
                    <div class="form-row">
                      <el-form-item label="教育程度">
                        <el-select v-model="employeeForm.educationLevel" placeholder="選擇教育程度"
                          :disabled="!educationLevelOptions.length">
                          <el-option v-for="option in educationLevelOptions" :key="option.value" :label="option.label"
                            :value="option.value" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="學校名稱">
                        <el-input v-model="employeeForm.schoolName" placeholder="請輸入學校名稱" />
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="主修科系">
                        <el-input v-model="employeeForm.major" placeholder="請輸入主修科系" />
                      </el-form-item>
                      <el-form-item label="畢業狀態">
                        <el-select v-model="employeeForm.graduationStatus" placeholder="選擇畢業狀態" clearable
                          @clear="onGraduationStatusClear" :disabled="!graduationStatusOptions.length">
                          <el-option v-for="option in graduationStatusOptions" :key="option.value" :label="option.label"
                            :value="option.value" />
                        </el-select>
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="畢業年度" class="full-width-item">
                        <el-input v-model="employeeForm.graduationYear" placeholder="請輸入畢業年度" />
                      </el-form-item>
                    </div>
                  </div>

                  <!-- 役別資訊 -->
                  <div class="form-group">
                    <h3 class="form-group-title">役別資訊</h3>
                    <div class="form-row">
                      <el-form-item label="役別類型">
                        <el-select v-model="employeeForm.serviceType" placeholder="選擇或輸入役別類型" filterable allow-create
                          default-first-option clearable>
                          <el-option v-for="type in SERVICE_TYPES" :key="type" :label="type" :value="type" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="軍種">
                        <el-input v-model="employeeForm.militaryBranch" placeholder="請輸入軍種" />
                      </el-form-item>
                    </div>

                    <div class="form-row">
                      <el-form-item label="軍階">
                        <el-input v-model="employeeForm.militaryRank" placeholder="請輸入軍階" />
                      </el-form-item>
                      <el-form-item label="退伍年">
                        <el-input-number v-model="employeeForm.dischargeYear" :min="1900" :max="CURRENT_YEAR + 10"
                          :step="1" :value-on-clear="null" controls-position="right" placeholder="請輸入退伍年" />
                      </el-form-item>
                    </div>
                  </div>

                  <!-- 緊急聯絡人 -->
                  <div class="form-group">
                    <h3 class="form-group-title">緊急聯絡人</h3>
                    <div class="emergency-contact">
                      <h4 class="contact-subtitle">聯絡人一</h4>
                      <div class="form-row">
                        <el-form-item label="姓名">
                          <el-input v-model="employeeForm.emergency1.name" placeholder="請輸入姓名" />
                        </el-form-item>
                        <el-form-item label="關係">
                          <el-select v-model="employeeForm.emergency1.relation" placeholder="選擇關係">
                            <el-option v-for="option in relationOptions" :key="`r1-${option.value}`"
                              :label="option.label" :value="option.value" />
                          </el-select>
                        </el-form-item>
                      </div>
                      <div class="form-row">
                        <el-form-item label="電話一">
                          <el-input v-model="employeeForm.emergency1.phone1" placeholder="請輸入電話" />
                        </el-form-item>
                        <el-form-item label="電話二">
                          <el-input v-model="employeeForm.emergency1.phone2" placeholder="請輸入電話" />
                        </el-form-item>
                      </div>
                    </div>

                    <div class="emergency-contact">
                      <h4 class="contact-subtitle">聯絡人二</h4>
                      <div class="form-row">
                        <el-form-item label="姓名">
                          <el-input v-model="employeeForm.emergency2.name" placeholder="請輸入姓名" />
                        </el-form-item>
                        <el-form-item label="關係">
                          <el-select v-model="employeeForm.emergency2.relation" placeholder="選擇關係">
                            <el-option v-for="option in relationOptions" :key="`r2-${option.value}`"
                              :label="option.label" :value="option.value" />
                          </el-select>
                        </el-form-item>
                      </div>
                      <div class="form-row">
                        <el-form-item label="電話一">
                          <el-input v-model="employeeForm.emergency2.phone1" placeholder="請輸入電話" />
                        </el-form-item>
                        <el-form-item label="電話二">
                          <el-input v-model="employeeForm.emergency2.phone2" placeholder="請輸入電話" />
                        </el-form-item>
                      </div>
                    </div>
                  </div>

                  <!-- 經歷管理 -->
                  <div class="form-group">
                    <h3 class="form-group-title">工作經歷</h3>
                    <div class="experience-list">
                      <div v-for="(exp, i) in employeeForm.experiences" :key="i" class="experience-item">
                        <div class="experience-header">
                          <h4 class="experience-title">經歷 {{ i + 1 }}</h4>
                          <el-button type="danger" size="small" @click="removeExperience(i)" class="remove-btn">
                            <i class="el-icon-delete"></i>
                            刪除
                          </el-button>
                        </div>
                        <div class="form-row">
                          <el-form-item label="單位名稱">
                            <el-input v-model="exp.unit" placeholder="請輸入單位名稱" />
                          </el-form-item>
                          <el-form-item label="職稱">
                            <el-input v-model="exp.title" placeholder="請輸入職稱" />
                          </el-form-item>
                        </div>
                        <div class="form-row">
                          <el-form-item label="到職年月">
                            <el-date-picker v-model="exp.start" type="month" placeholder="選擇到職年月" />
                          </el-form-item>
                          <el-form-item label="離職年月">
                            <el-date-picker v-model="exp.end" type="month" placeholder="選擇離職年月" />
                          </el-form-item>
                        </div>
                      </div>
                    </div>
                    <el-button type="primary" @click="addExperience" class="add-item-btn">
                      <i class="el-icon-plus"></i>
                      新增經歷
                    </el-button>
                  </div>

                  <!-- 證照資訊 -->
                  <div class="form-group">
                    <h3 class="form-group-title">證照</h3>
                    <div class="experience-list">
                      <div v-for="(license, i) in employeeForm.licenses" :key="`license-${i}`" class="experience-item">
                        <div class="experience-header">
                          <h4 class="experience-title">證照 {{ i + 1 }}</h4>
                          <el-button type="danger" size="small" @click="removeLicense(i)" class="remove-btn">
                            <i class="el-icon-delete"></i>
                            刪除
                          </el-button>
                        </div>
                        <div class="form-row">
                          <el-form-item label="證照名稱">
                            <el-input v-model="license.name" placeholder="請輸入證照名稱" />
                          </el-form-item>
                          <el-form-item label="證照字號">
                            <el-input v-model="license.number" placeholder="請輸入證照字號" />
                          </el-form-item>
                        </div>
                        <div class="form-row">
                          <el-form-item label="核發日期">
                            <el-date-picker v-model="license.startDate" type="date" placeholder="選擇核發日期" />
                          </el-form-item>
                          <el-form-item label="有效期限">
                            <el-date-picker v-model="license.endDate" type="date" placeholder="選擇有效期限" />
                          </el-form-item>
                        </div>
                        <div class="form-row">
                          <el-form-item label="證照檔案" class="full-width-item">
                            <el-upload v-model:file-list="license.fileList" action="#" multiple list-type="text"
                              :http-request="handleAttachmentRequest"
                              :on-success="(res, file, fileList) => handleAttachmentSuccess('licenses', i, res, file, fileList)"
                              :on-remove="(file, fileList) => handleAttachmentRemove('licenses', i, file, fileList)">
                              <el-button type="primary" plain>
                                <i class="el-icon-upload2"></i>
                                上傳檔案
                              </el-button>
                              <template #tip>
                                <div class="upload-tip">可上傳多個檔案，將以連結形式儲存</div>
                              </template>
                            </el-upload>
                          </el-form-item>
                        </div>
                      </div>
                    </div>
                    <el-button type="primary" @click="addLicense" class="add-item-btn">
                      <i class="el-icon-plus"></i>
                      新增證照
                    </el-button>
                  </div>

                  <!-- 教育訓練 -->
                  <div class="form-group">
                    <h3 class="form-group-title">教育訓練</h3>
                    <div class="experience-list">
                      <div v-for="(training, i) in employeeForm.trainings" :key="`training-${i}`"
                        class="experience-item">
                        <div class="experience-header">
                          <h4 class="experience-title">教育訓練 {{ i + 1 }}</h4>
                          <el-button type="danger" size="small" @click="removeTraining(i)" class="remove-btn">
                            <i class="el-icon-delete"></i>
                            刪除
                          </el-button>
                        </div>
                        <div class="form-row">
                          <el-form-item label="課程名稱">
                            <el-input v-model="training.course" placeholder="請輸入課程名稱" />
                          </el-form-item>
                          <el-form-item label="課程代碼">
                            <el-input v-model="training.courseNo" placeholder="請輸入課程代碼" />
                          </el-form-item>
                        </div>
                        <div class="form-row">
                          <el-form-item label="上課日期">
                            <el-date-picker v-model="training.date" type="date" placeholder="選擇日期" />
                          </el-form-item>
                          <el-form-item label="積分類別" class="full-width-item">
                            <el-select v-model="training.category" multiple collapse-tags placeholder="選擇積分類別">
                              <el-option v-for="option in creditCategoryOptions" :key="option.value"
                                :label="option.label" :value="option.value" />
                            </el-select>
                          </el-form-item>
                        </div>
                        <div class="form-row">
                          <el-form-item label="積分">
                            <el-input-number v-model="training.score" :min="0" :step="0.5" :value-on-clear="null" />
                          </el-form-item>
                          <el-form-item label="訓練檔案" class="full-width-item">
                            <el-upload v-model:file-list="training.fileList" action="#" multiple list-type="text"
                              :http-request="handleAttachmentRequest"
                              :on-success="(res, file, fileList) => handleAttachmentSuccess('trainings', i, res, file, fileList)"
                              :on-remove="(file, fileList) => handleAttachmentRemove('trainings', i, file, fileList)">
                              <el-button type="primary" plain>
                                <i class="el-icon-upload2"></i>
                                上傳檔案
                              </el-button>
                              <template #tip>
                                <div class="upload-tip">支援多檔上傳，將以連結形式儲存</div>
                              </template>
                            </el-upload>
                          </el-form-item>
                        </div>
                      </div>
                    </div>
                    <el-button type="primary" @click="addTraining" class="add-item-btn">
                      <i class="el-icon-plus"></i>
                      新增教育訓練
                    </el-button>
                  </div>
                </div>
              </div>
            </el-tab-pane>

            <!-- 薪資 -->
            <el-tab-pane name="salary">
              <template #label>
                <div class="tab-label">
                  <i class="el-icon-money"></i>
                  <span>薪資設定</span>
                </div>
              </template>

              <div class="tab-content">
                <div class="form-section">
                  <div class="form-group">
                    <h3 class="form-group-title">薪資資訊</h3>
                    <div class="form-row">
                      <el-form-item label="薪資類別">
                        <el-select v-model="employeeForm.salaryType" placeholder="選擇類別">
                          <el-option v-for="s in SALARY_TYPES" :key="s" :label="s" :value="s" />
                        </el-select>
                      </el-form-item>
                      <el-form-item label="薪資金額">
                        <el-input-number v-model="employeeForm.salaryAmount" :min="0" :step="1000"
                          :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                          :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')" />
                      </el-form-item>
                      <el-form-item label="勞退自提" prop="laborPensionSelf">
                        <el-input-number v-model="employeeForm.laborPensionSelf" :min="0" :step="100"
                          :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                          :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')" />
                      </el-form-item>
                      <el-form-item label="員工預支" prop="employeeAdvance">
                        <el-input-number v-model="employeeForm.employeeAdvance" :min="0" :step="100"
                          :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                          :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')" />
                      </el-form-item>
                      <el-form-item class="full-width-item" label="薪資項目" prop="salaryItems">
                        <el-select v-model="employeeForm.salaryItems" multiple collapse-tags collapse-tags-tooltip
                          placeholder="選擇薪資項目">
                          <el-option v-for="item in salaryItemOptions" :key="item.value" :label="item.label"
                            :value="item.value" />
                        </el-select>
                      </el-form-item>
                      <div v-if="selectedSalaryItemsForUI.length" class="form-row salary-item-amounts">
                        <el-form-item v-for="item in selectedSalaryItemsForUI" :key="item.value"
                          :label="item.label" class="salary-item-amount-item">
                          <el-input-number v-model="employeeForm.salaryItemAmounts[item.value]" :min="0" :step="100"
                            :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                            :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')" />
                        </el-form-item>
                      </div>
                    </div>
                  </div>

                  <div class="form-group">
                    <h3 class="form-group-title">銀行帳戶</h3>
                    <div class="account-section">
                      <h4 class="account-subtitle">薪資帳戶 A</h4>
                      <div class="form-row">
                        <el-form-item label="銀行代碼/名稱">
                          <el-input v-model="employeeForm.salaryAccountA.bank" placeholder="請輸入銀行資訊" />
                        </el-form-item>
                        <el-form-item label="帳號">
                          <el-input v-model="employeeForm.salaryAccountA.acct" placeholder="請輸入帳號" />
                        </el-form-item>
                      </div>
                    </div>

                    <div class="account-section">
                      <h4 class="account-subtitle">薪資帳戶 B</h4>
                      <div class="form-row">
                        <el-form-item label="銀行代碼/名稱">
                          <el-input v-model="employeeForm.salaryAccountB.bank" placeholder="請輸入銀行資訊" />
                        </el-form-item>
                        <el-form-item label="帳號">
                          <el-input v-model="employeeForm.salaryAccountB.acct" placeholder="請輸入帳號" />
                        </el-form-item>
                      </div>
                    </div>
                  </div>

                  <div class="form-group">
                    <h3 class="form-group-title">每月薪資調整項目</h3>
                    <el-alert type="info" :closable="false" style="margin-bottom: 16px;">
                      <p>以下項目將作為每月薪資計算的預設值，可直接在個人資料中設定，無需每次簽核。</p>
                    </el-alert>
                    
                    <div class="form-row">
                      <el-form-item label="健保費自付額" prop="monthlySalaryAdjustments.healthInsuranceFee">
                        <el-input-number v-model="employeeForm.monthlySalaryAdjustments.healthInsuranceFee" 
                          :min="0" :step="50"
                          :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                          :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')" />
                      </el-form-item>
                      <el-form-item label="債權扣押" prop="monthlySalaryAdjustments.debtGarnishment">
                        <el-input-number v-model="employeeForm.monthlySalaryAdjustments.debtGarnishment" 
                          :min="0" :step="100"
                          :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                          :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')" />
                      </el-form-item>
                      <el-form-item label="其他扣款" prop="monthlySalaryAdjustments.otherDeductions">
                        <el-input-number v-model="employeeForm.monthlySalaryAdjustments.otherDeductions" 
                          :min="0" :step="100"
                          :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                          :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')" />
                      </el-form-item>
                    </div>
                    
                    <div class="form-row">
                      <el-form-item label="人力績效獎金" prop="monthlySalaryAdjustments.performanceBonus">
                        <el-input-number v-model="employeeForm.monthlySalaryAdjustments.performanceBonus" 
                          :min="0" :step="100"
                          :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                          :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')" />
                      </el-form-item>
                      <el-form-item label="其他獎金" prop="monthlySalaryAdjustments.otherBonuses">
                        <el-input-number v-model="employeeForm.monthlySalaryAdjustments.otherBonuses" 
                          :min="0" :step="100"
                          :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                          :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')" />
                      </el-form-item>
                    </div>
                    
                    <div class="form-row">
                      <el-form-item label="調整說明" class="full-width-item" prop="monthlySalaryAdjustments.notes">
                        <el-input v-model="employeeForm.monthlySalaryAdjustments.notes" 
                          type="textarea" 
                          :rows="2"
                          placeholder="請輸入薪資調整的說明或備註" />
                      </el-form-item>
                    </div>
                  </div>

                  <div class="form-group">
                    <h3 class="form-group-title">特休管理</h3>
                    <el-alert type="info" :closable="false" style="margin-bottom: 16px;">
                      <p>設定員工年度特休天數。當員工申請特休並審核通過後，系統將自動扣減剩餘天數。</p>
                    </el-alert>
                    <div class="form-row">
                      <el-form-item label="年度特休總天數" prop="annualLeave.totalDays">
                        <el-input-number v-model="employeeForm.annualLeave.totalDays" :min="0" :max="365" :step="1"
                          placeholder="0" />
                        <span style="margin-left: 8px; color: #909399;">天</span>
                      </el-form-item>
                      <el-form-item label="特休時數" prop="annualLeave.totalHours">
                        <el-tag type="info" size="large">
                          {{ (employeeForm.annualLeave?.totalDays || 0) * 8 }} 小時
                        </el-tag>
                      </el-form-item>
                      <el-form-item label="已使用天數" prop="annualLeave.usedDays">
                        <el-input-number v-model="employeeForm.annualLeave.usedDays" :min="0" :step="1"
                          placeholder="0" />
                        <span style="margin-left: 8px; color: #909399;">天</span>
                      </el-form-item>
                      <el-form-item label="剩餘天數">
                        <el-tag type="success" size="large">
                          {{ (employeeForm.annualLeave?.totalDays || 0) - (employeeForm.annualLeave?.usedDays || 0) }} 天
                        </el-tag>
                      </el-form-item>
                    </div>
                    <div class="form-row">
                      <el-form-item label="年度" prop="annualLeave.year">
                        <el-input-number v-model="employeeForm.annualLeave.year" :min="2020" :max="2050" :step="1"
                          :placeholder="new Date().getFullYear().toString()" />
                      </el-form-item>
                      <el-form-item label="請假期限" prop="annualLeave.expiryDate">
                        <el-date-picker v-model="employeeForm.annualLeave.expiryDate" type="date" placeholder="選擇請假期限日期" />
                      </el-form-item>
                      <el-form-item label="積假" prop="annualLeave.accumulatedLeave">
                        <el-input-number v-model="employeeForm.annualLeave.accumulatedLeave" :min="0" :max="365" :step="0.5"
                          placeholder="0" />
                        <span style="margin-left: 8px; color: #909399;">天</span>
                      </el-form-item>
                    </div>
                    <div class="form-row">
                      <el-form-item label="備註" class="full-width-item" prop="annualLeave.notes">
                        <el-input v-model="employeeForm.annualLeave.notes" type="textarea" :rows="2"
                          placeholder="請輸入特休相關備註" />
                      </el-form-item>
                    </div>
                  </div>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-form>
        <template #footer>
          <div class="dialog-footer">
            <el-button @click="employeeDialogVisible = false" class="cancel-btn">取消</el-button>
            <el-button type="primary" @click="saveEmployee" class="save-btn">
              <i class="el-icon-check"></i>
              儲存員工資料
            </el-button>
          </div>
        </template>
      </el-dialog>

      <el-dialog v-model="bulkImportDialogVisible" title="批量匯入員工" width="720px" class="bulk-import-dialog"
        :close-on-click-modal="false" :before-close="handleBulkImportDialogBeforeClose">
        <div class="bulk-import-header">
          <el-alert type="info" show-icon :closable="false">
            <template #title>
              下載範本後依欄位填寫資料，或直接使用範本內建的 5 筆示範資料測試匯入流程。
            </template>
            <div class="template-link">
              <i class="el-icon-document"></i>
              <el-button type="primary" link data-test="bulk-import-template-download"
                @click="downloadBulkImportTemplate">
                下載匯入範本
              </el-button>
            </div>
          </el-alert>
        </div>

        <div class="bulk-import-upload">
          <el-upload drag action="" :auto-upload="false" accept=".xlsx,.xls,.csv" :file-list="bulkImportUploadFileList"
            :limit="1" :on-change="handleBulkImportFileChange" :on-remove="handleBulkImportFileRemove">
            <i class="el-icon-upload"></i>
            <div class="el-upload__text">
              將檔案拖曳至此或 <em>點此選擇</em>
            </div>
            <div class="el-upload__tip">支援 .xlsx、.xls、.csv 檔案格式，檔案大小請勿超過 5MB</div>
          </el-upload>
        </div>

        <div class="bulk-import-form">
          <h3 class="bulk-import-subtitle">欄位格式與必填說明</h3>
          <p class="bulk-import-description">
            系統已預先套用官方批量匯入 Excel 模板，請依下列欄位填寫資料後再上傳檔案。
          </p>
          <el-alert type="warning" show-icon class="bulk-import-required-alert" :closable="false">
            <template #title>必填欄位：{{ bulkImportRequiredFieldNames.join('、') }}</template>
            <div>若未提供必填欄位資料，匯入時將提示錯誤並中止處理。</div>
          </el-alert>

          <section v-for="section in bulkImportTemplateSections" :key="section.title" class="bulk-import-section">
            <h4 class="bulk-import-section-title">{{ section.title }}</h4>
            <el-table :data="section.fields" border size="small" class="bulk-import-table">
              <el-table-column prop="header" label="Excel 欄位 (英文)" width="220">
                <template #default="{ row }">
                  <code class="bulk-import-header-code">{{ row.header }}</code>
                </template>
              </el-table-column>
              <el-table-column prop="displayDescription" label="欄位說明" min-width="300">
                <template #default="{ row }">
                  {{ row.displayDescription || row.description || row.label || row.header }}
                </template>
              </el-table-column>
              <el-table-column label="是否必填" width="120" align="center">
                <template #default="{ row }">
                  <el-tag v-if="row.required" type="danger" size="small">必填</el-tag>
                  <span v-else class="bulk-import-optional-text">選填</span>
                </template>
              </el-table-column>
            </el-table>
          </section>

          <h3 class="bulk-import-subtitle bulk-import-options-title">匯入參數設定</h3>
          <el-form :model="bulkImportForm" label-width="150px">
            <el-form-item label="匯入預設權限" required>
              <el-select v-model="bulkImportForm.options.defaultRole" placeholder="請選擇預設權限">
                <el-option v-for="role in ROLE_OPTIONS" :key="role.value" :label="role.label" :value="role.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="預設登入密碼">
              <el-input v-model="bulkImportForm.options.resetPassword" type="password" show-password
                placeholder="未設定則由後端自動產生" />
            </el-form-item>
            <el-form-item label="寄發通知信">
              <el-switch v-model="bulkImportForm.options.sendWelcomeEmail" />
            </el-form-item>
          </el-form>
        </div>

        <div class="bulk-import-result" v-if="bulkImportPreview.length || bulkImportErrors.length">
          <el-alert v-if="bulkImportErrors.length" type="warning" :closable="false" show-icon class="bulk-import-error">
            <template #title>匯入時發現以下問題，請確認後重新處理：</template>
            <ul class="error-list">
              <li v-for="(error, idx) in bulkImportErrors" :key="idx">{{ error }}</li>
            </ul>
          </el-alert>

          <div v-if="bulkImportPreview.length" class="bulk-import-preview">
            <h4>匯入預覽</h4>
            <el-table :data="bulkImportPreview" size="small" height="240">
              <el-table-column prop="employeeNo" label="員工編號" width="140" />
              <el-table-column prop="name" label="姓名" width="140" />
              <el-table-column prop="department" label="部門" min-width="120" />
              <el-table-column prop="role" label="權限" width="120" />
              <el-table-column prop="email" label="Email" min-width="160" />
            </el-table>
          </div>
        </div>

        <template #footer>
          <el-button @click="handleBulkImportDialogCancel">取消</el-button>
          <el-button type="primary" :loading="bulkImportLoading" :disabled="!isBulkImportReady || bulkImportLoading"
            @click="submitBulkImport">
            開始匯入
          </el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="referenceMappingDialogVisible" :title="referenceMappingDialogMessage || '補齊參照對應'"
        width="640px" class="reference-mapping-dialog" :close-on-click-modal="false">
        <p class="reference-mapping-tip">
          請為下列資料選擇對應的既有項目，或設定忽略後重新嘗試匯入。
        </p>

        <!-- 外層先用 v-if 包住，裡面再單純 v-for -->
        <div v-if="referenceMappingDialogVisible">
          <!-- ✅ 用預先算好的 sections 來畫，避免模板裡層層 ?. -->
          <div v-for="section in referenceMappingSectionsForUI" :key="section.type" class="reference-mapping-section"
            v-if="section && Array.isArray(section.values) && section.values.length">
            <h4 class="reference-mapping-title">
              {{ getReferenceMappingLabel(section.type) }}對應
            </h4>

            <div v-for="entry in section.values" :key="getReferenceEntryKey(entry)" class="reference-mapping-item">
              <div class="reference-mapping-info">
                <span class="reference-mapping-value">
                  {{ entry.value || '（空值）' }}
                </span>
                <span class="reference-mapping-rows">
                  出現於第 {{ (entry.rows || []).join('、') }} 列
                </span>
              </div>

              <el-radio-group v-model="getRefSel(section.type, getReferenceEntryKey(entry)).mode"
                class="reference-mapping-mode">
                <el-radio label="map">指定既有資料</el-radio>
                <el-radio label="ignore">忽略此次匯入</el-radio>
              </el-radio-group>

              <el-select v-if="getRefSel(section.type, getReferenceEntryKey(entry)).mode === 'map'"
                v-model="getRefSel(section.type, getReferenceEntryKey(entry)).targetId" placeholder="請選擇既有項目"
                class="reference-mapping-select" filterable clearable>
                <el-option v-for="option in section.options" :key="option.id"
                  :label="buildReferenceOptionLabel(section.type, option)" :value="option.id" />
              </el-select>
            </div>
          </div>

          <!-- ✅ 單一空狀態邏輯，避免重複條件 -->
          <div v-if="!hasPendingReferenceMappings" class="reference-mapping-empty">
            所有參照皆已處理，請重新送出匯入。
          </div>
        </div>

        <template #footer>
          <el-button @click="referenceMappingDialogVisible = false" :disabled="referenceMappingSubmitting">
            稍後再處理
          </el-button>
          <el-button type="primary" :loading="referenceMappingSubmitting" @click="confirmReferenceMappings">
            套用設定後重新匯入
          </el-button>
        </template>
      </el-dialog>


    </div>
  </el-tab-pane>
</template>

<script setup>
import { ref, onMounted, computed, watch, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch, importEmployeesBulk } from '../../api'
import { REQUIRED_FIELDS } from './requiredFields'

// 常數定義
const CURRENT_YEAR = new Date().getFullYear()

// 👉 搜尋查詢字串
const searchQuery = ref('')

// 👉 目前選擇的部門（下拉選單綁這個）
const departmentFilter = ref(null)

// 👉 下拉選單的部門列表
const departmentFilterOptions = computed(() => {
  const map = new Map()

  // 依照「員工有出現過的部門」動態建立清單
  for (const emp of employeeList.value) {
    if (emp && emp.department) {
      // 這裡用你在 template 已經使用的 departmentLabel() 來取顯示名稱
      const label = departmentLabel(emp.department)
      if (label && !map.has(emp.department)) {
        map.set(emp.department, label)
      }
    }
  }

  return Array.from(map.entries()).map(([value, label]) => ({
    value,
    label,
  }))
})

// 👉 真正丟給表格用的資料
const filteredEmployeeList = computed(() => {
  let result = employeeList.value

  // 搜尋過濾
  if (searchQuery.value && searchQuery.value.trim()) {
    const query = searchQuery.value.trim().toLowerCase()
    result = result.filter(emp => {
      const name = (emp.name || '').toLowerCase()
      const employeeNo = (emp.employeeNo || emp.employeeId || '').toLowerCase()
      const email = (emp.email || '').toLowerCase()
      return name.includes(query) || employeeNo.includes(query) || email.includes(query)
    })
  }

  // 部門過濾
  if (departmentFilter.value) {
    result = result.filter(emp => emp.department === departmentFilter.value)
  }

  return result
})


// ========= 新增：Excel/CSV 讀取與預覽核心 =========

// --- 取代 loadXLSX：三段式保底載入（window -> import -> CDN） ---
async function loadXLSX() {
  // 1) 若全域已存在（例如你用 <script> 先載），直接用
  if (typeof window !== 'undefined' && window && window.XLSX && window.XLSX.utils) {
    return window.XLSX
  }

  // 2) 嘗試 ESM/CJS 動態載入（SSR / Vite / Webpack 正常路）
  try {
    const mod = await import(/* @vite-ignore */ 'xlsx')
    const XLSX = (mod && (mod.default || mod.XLSX)) ? (mod.default || mod.XLSX) : mod
    if (XLSX && XLSX.utils && XLSX.read) return XLSX
  } catch (_) {
    // 忽略，繼續走 CDN
  }

  // 3) 最後手動插入 CDN 腳本（僅限瀏覽器環境）
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    await new Promise((resolve, reject) => {
      const existed = document.querySelector('script[data-xlsx-cdn]')
      if (existed) {
        existed.addEventListener('load', () => resolve(null), { once: true })
        existed.addEventListener('error', () => reject(new Error('XLSX_CDN_FAIL')), { once: true })
        return
      }
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
      s.async = true
      s.defer = true
      s.setAttribute('data-xlsx-cdn', '1')
      s.onload = () => resolve(null)
      s.onerror = () => reject(new Error('XLSX_CDN_FAIL'))
      document.head.appendChild(s)
    })
    if (window.XLSX && window.XLSX.utils && window.XLSX.read) return window.XLSX
  }

  throw new Error('XLSX_MODULE_INVALID_OR_NOT_FOUND')
}

function stripBOM(s = '') { return s.replace(/^\uFEFF/, '') }

function decodeText(buf) {
  try {
    // 先嘗試 UTF-8
    let s = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    // 若前兩碼是 UTF-16LE BOM（0xFF 0xFE），再用 UTF-16LE 重新解
    if (s.length >= 2 && s.charCodeAt(0) === 0xFEFF) s = stripBOM(s)
    // 粗判：如果第一行幾乎都是 \0，代表可能用錯編碼，再試 UTF-16LE
    const zeroRatio = (s.slice(0, 64).match(/\x00/g) || []).length / Math.max(1, Math.min(64, s.length))
    if (zeroRatio > 0.2) throw new Error('maybe-utf16le')
    return stripBOM(s)
  } catch {
    // 再用 UTF-16LE 試一次
    try {
      return stripBOM(new TextDecoder('utf-16le', { fatal: false }).decode(buf))
    } catch {
      // 最後退回把 buffer 當 binary string
      let bin = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      return stripBOM(bin)
    }
  }
}

// 簡易 TSV/CSV 文字解析 → 二維陣列（只特別處理 tab；逗號交給 xlsx）
function parseTSVToRows(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.length > 0)
  if (!lines.length) return []
  // 選分隔符：若 tab 欄位數量明顯多於逗號，採 tab
  const first = lines[0]
  const tabCount = (first.match(/\t/g) || []).length
  const commaCount = (first.match(/,/g) || []).length
  const delim = tabCount > commaCount ? '\t' : null
  if (!delim) return []  // 留給 xlsx 的 CSV 路徑處理
  return lines.map(line => line.split('\t'))
}


// 檔名副檔名（僅用於判斷提示，不影響解析）
function getFileExt(file) {
  const name = typeof file?.name === 'string' ? file.name : ''
  const m = name.match(/\.([^.]+)$/i)
  return m ? m[1].toLowerCase() : ''
}

// 讀取為 ArrayBuffer（給 XLSX.read 使用）
async function fileToArrayBuffer(file) {
  if (file.arrayBuffer) return await file.arrayBuffer()
  // Safari 舊版 fallback
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// 判斷「這一列」是否是你模板中的「第二行中文說明列」（需被忽略）
function isTemplateDescriptionRow(obj) {
  // 只要某些欄位帶有「必填」或括號說明，多半就是說明列
  const vList = Object.values(obj || {}).map(v => (v == null ? '' : String(v)))
  if (!vList.length) return false
  const hit = vList.some(v => /必填|\(|\)|已婚|未婚|離婚|喪偶|TRUE|FALSE/.test(v))
  // 中文說明列通常很多欄位都不是 email/日期/數字，這樣的粗判斷夠用
  return hit
}

// 將 1990/3/2、1990-3-2 這類轉為 1990-03-02；非日期字串原樣回傳
function normalizeDateLike(value) {
  if (value == null || value === '') return ''
  const s = String(value).trim().replace(/\./g, '-').replace(/\//g, '-')
  // 年-月-日（寬鬆）：yyyy-m-d 或 yy-m-d（只接受4碼年做轉換）
  const m = s.match(/^(\d{4})[-](\d{1,2})[-](\d{1,2})$/)
  if (!m) return s
  const yyyy = m[1]
  const mm = String(m[2]).padStart(2, '0')
  const dd = String(m[3]).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// 將 TRUE/FALSE/Yes/No/1/0 等轉 JS boolean 或原字串（預覽可保留原始字樣）
// 這裡回傳字串 'TRUE'/'FALSE' 以符合你目前 CSV 範例；若要轉 boolean 可改為 true/false
function normalizeBoolLike(value) {
  if (value == null || value === '') return ''
  const s = String(value).trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(s)) return 'TRUE'
  if (['false', 'no', 'n', '0'].includes(s)) return 'FALSE'
  return String(value) // 不動
}

// 將逗號分隔字串 -> 陣列（空白會被 trim）
function toCommaArray(value) {
  if (value == null || value === '') return []
  return String(value)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

function sheetToObjects(XLSX, ws) {
  if (!ws) return []
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (!Array.isArray(rows) || rows.length === 0) return []

  // 第1行：英文表頭；第2行：中文說明（丟棄）；第3行起：資料
  const headerRow = (rows[0] || []).map(h => stripBOM(String(h ?? '').trim()))
  const dataRows = rows.slice(2)

  const objects = []
  for (const r of dataRows) {
    if (!Array.isArray(r)) continue
    const empty = r.every(v => String(v ?? '').trim() === '')
    if (empty) continue
    const obj = {}
    for (let i = 0; i < headerRow.length; i++) {
      const key = headerRow[i] || `col_${i}`
      obj[key] = r[i] ?? ''
    }
    objects.push(obj)
  }
  return objects
}

function normalizeHeaderKey(s = '') { return stripBOM(String(s)).trim().toLowerCase() }
function autoFixColumnMappingsFromHeader(headerKeys = []) {
  // 讓 mapping 與實際 CSV 表頭自動對齊（忽略大小寫/空白/BOM）
  const normMap = new Map(headerKeys.map(k => [normalizeHeaderKey(k), k]))
  BULK_IMPORT_FIELD_CONFIGS.forEach(cfg => {
    const want = cfg.header || cfg.key
    const hit = normMap.get(normalizeHeaderKey(want))
    if (hit) bulkImportForm.columnMappings[cfg.key] = hit
  })
}

async function parseFileToRowObjects(file) {
  const XLSX = await loadXLSX()
  const buf = await fileToArrayBuffer(file)

  // 1) 先用 xlsx 二進位路徑
  try {
    const wb = XLSX.read(buf, { type: 'array', codepage: 65001 })
    const name = wb.SheetNames?.[0]
    const ws = name ? wb.Sheets[name] : null
    const objs = sheetToObjects(XLSX, ws)
    if (objs.length) {
      // 自動修正 mapping（避免大小寫/空白差異）
      autoFixColumnMappingsFromHeader(Object.keys(objs[0]))
      return objs
    }
  } catch (e) {
    // 落到文字路徑
  }

  // 2) 文字路徑：處理 UTF-8 / UTF-16LE、tab 分隔
  const text = decodeText(buf)
  // 先嘗試 tab 解析
  const tsvRows = parseTSVToRows(text)
  if (tsvRows.length) {
    const headerRow = (tsvRows[0] || []).map(h => stripBOM(String(h ?? '').trim()))
    const descRow = tsvRows[1] || []
    // 判斷第二列是否中文說明列（含「必填」等）；若是則丟掉
    const isDesc = descRow.some(v => /必填|\(|\)|已婚|未婚|離婚|喪偶|TRUE|FALSE/.test(String(v || '')))
    const dataRows = isDesc ? tsvRows.slice(2) : tsvRows.slice(1)

    // 自動修正 mapping
    autoFixColumnMappingsFromHeader(headerRow)

    // 組物件
    const objects = dataRows.map(row => {
      const obj = {}
      for (let i = 0; i < headerRow.length; i++) obj[headerRow[i] || `col_${i}`] = row[i] ?? ''
      return obj
    }).filter(obj => Object.values(obj).some(v => String(v ?? '').trim() !== ''))

    if (objects.length) return objects
  }

  // 3) 最後再用 xlsx 的字串路徑讀 CSV（UTF-8/UTF-16LE 皆可）
  try {
    const wb2 = XLSX.read(text, { type: 'string' })
    const name2 = wb2.SheetNames?.[0]
    const ws2 = name2 ? wb2.Sheets[name2] : null
    const objs2 = sheetToObjects(XLSX, ws2)
    if (objs2.length) {
      autoFixColumnMappingsFromHeader(Object.keys(objs2[0]))
      return objs2
    }
  } catch (e) {
    // ignore
  }

  // 都失敗就回空陣列（上層會提示）
  return []
}

// 將 keys / pending / options 預先整理成可直接渲染的 sections
const referenceMappingSectionsForUI = computed(() =>
  (referenceMappingKeys.value || []).map(type => ({
    type,
    values: Array.isArray(referenceMappingPending[type]) ? referenceMappingPending[type] : [],
    options: Array.isArray(referenceMappingOptions[type]) ? referenceMappingOptions[type] : []
  }))
)

const hasPendingReferenceMappings = computed(() =>
  referenceMappingSectionsForUI.value.some(section => section.values.length > 0)
)





// 由 mapping（bulkImportForm.columnMappings）將「英文字段」→「系統內鍵名」
// 例：employeeNo <- row[employeeId]、name <- row[name]
function mapRowToFormShape(row, mappings) {
  // 先把所有你在 BULK_IMPORT_FIELD_CONFIGS 宣告的 key 都走一次
  const out = {}
  for (const cfg of BULK_IMPORT_FIELD_CONFIGS) {
    const sysKey = cfg.key                                   // e.g. 'employeeNo'
    const excelHeader = mappings?.[sysKey] || cfg.header     // e.g. 'employeeId'
    const raw = row[excelHeader]

    switch (sysKey) {
      // 日期欄位統一格式
      case 'birthday':
      case 'hireDate':
      case 'appointDate':
      case 'resignDate':
      case 'dismissDate':
      case 'reAppointDate':
      case 'reDismissDate':
        out[sysKey] = normalizeDateLike(raw)
        break

      // 布林/是非欄位
      case 'isPartTime':
      case 'isClocking':
        out[sysKey] = normalizeBoolLike(raw)
        break

      // 多值欄位（逗號分隔）
      case 'languages':
      case 'identityCategory':
      case 'salaryItems':
        out[sysKey] = toCommaArray(raw)
        break

      // 純數字
      case 'laborPensionSelf':
      case 'employeeAdvance':
      case 'probationDays':
      case 'dischargeYear':
        out[sysKey] = (raw === '' || raw == null) ? '' : String(raw).replace(/[^\d.-]/g, '')
        break

      default:
        out[sysKey] = raw ?? ''
        break
    }
  }
  return out
}

// 驗證：檢查必填欄位有無缺漏，回傳錯誤訊息陣列
function validateRequired(mappedRows, { rowOffset = 0 } = {}) {
  const errors = []
  const requiredKeys = BULK_IMPORT_FIELD_CONFIGS.filter(f => f.required).map(f => f.key)

  mappedRows.forEach((obj, idx) => {
    const miss = requiredKeys.filter(k => obj[k] == null || String(obj[k]).trim() === '')
    if (miss.length) {
      const missLabels = miss
        .map(k => {
          const f = BULK_IMPORT_FIELD_CONFIGS.find(x => x.key === k)
          return f?.label || f?.description || f?.header || k
        })
        .join('、')

      // ✅ 真正 Excel 行號：前面有 2 行 header，所以 + 2
      const excelRowNo = idx + 1 + rowOffset
      errors.push(`第 ${excelRowNo} 列缺少必填欄位：${missLabels}`)
    }
  })
  return errors
}


// 產生你畫面需要的「簡易預覽」欄位（表格目前只顯示這些）
function buildPreviewList(mappedRows) {
  return mappedRows.map(o => ({
    employeeNo: o.employeeNo || o.employeeId || '',
    name: o.name || '',
    department: o.department || '',
    role: o.employmentStatus || o.status || '',
    email: o.email || ''
  }))
}

// 主流程：解析上傳檔 → 轉 mapping → 驗證 → 丟到畫面
async function parseAndPreviewBulkImport(file) {
  try {
    const ext = getFileExt(file)
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      ElMessage.warning('請上傳 .xlsx/.xls/.csv 檔案')
      return { ok: false }
    }

    const rowObjects = await parseFileToRowObjects(file) // 英文 header 的列
    if (!rowObjects.length) {
      ElMessage.warning('檔案內容為空，或格式不符（請使用範本）')
      return { ok: false }
    }

    // 依使用者「欄位對應」把每一列轉成系統欄位形狀
    const mappedRows = rowObjects.map(r => mapRowToFormShape(r, bulkImportForm.columnMappings))

    // ✅ 指定 offset：因為第 1、2 列是表頭與說明
    const reqErrors = validateRequired(mappedRows, { rowOffset: 2 })

    // 建立預覽
    const preview = buildPreviewList(mappedRows)

    // 回填到 UI 狀態
    bulkImportPreview.value = preview
    bulkImportErrors.value = reqErrors
    return { ok: true }
  } catch (err) {
    console.error('解析匯入檔失敗：', err)
    ElMessage.error('解析匯入檔失敗，請確認檔案是否符合範本格式')
    return { ok: false, error: err }
  }
}

// ========= 修改：掛上到既有 on-change handler =========
async function handleBulkImportFileChange(uploadFile) {
  const raw = uploadFile?.raw || uploadFile   // ← 保底
  if (!raw) return

  const previousFile = bulkImportFile.value
  const previousUploadList = bulkImportUploadFileList.value.map(file => ({ ...file }))
  const isReplacingExistingFile = Boolean(previousFile) && previousFile !== uploadFile.raw

  if (isReplacingExistingFile && hasBulkImportProgress.value) {
    try {
      await ElMessageBox.confirm(
        '重新選擇檔案將清除目前的預覽資料與參照對應設定，是否繼續？',
        '確認更換匯入檔案',
        {
          type: 'warning',
          confirmButtonText: '重新選擇',
          cancelButtonText: '保留現況'
        }
      )
    } catch (error) {
      bulkImportUploadFileList.value = previousUploadList
      return
    }
  }

  resetBulkImportState({
    resetMappings: false,
    resetResolvedReferences: true,
    referenceKeys: REFERENCE_MAPPING_DEFAULT_KEYS
  })

  bulkImportFile.value = uploadFile.raw
  bulkImportUploadFileList.value = [uploadFile]

  await parseAndPreviewBulkImport(uploadFile.raw)
}

// =========（可選）移除檔案時順便清掉預覽 =========
function handleBulkImportFileRemove() {
  resetBulkImportState({
    resetMappings: false,
    resetResolvedReferences: true,
    referenceKeys: REFERENCE_MAPPING_DEFAULT_KEYS
  })
}


const router = useRouter()

function extractOptionValue(option) {
  if (option === null || option === undefined) return ''
  if (typeof option === 'string') return option
  if (typeof option === 'number' || typeof option === 'boolean') return String(option)
  if (typeof option === 'object') {
    const value =
      option.code ??
      option.value ??
      option.name ??
      option.label ??
      (typeof option.toString === 'function' ? option.toString() : '')
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return ''
  }
  return ''
}

function createOptionListFromStrings(list = []) {
  const array = Array.isArray(list) ? list : [list]
  return array
    .map(item => {
      if (item === null || item === undefined) return null
      if (typeof item === 'object' && !Array.isArray(item)) {
        const label =
          item.name ??
          item.label ??
          item.value ??
          item.code ??
          (typeof item.toString === 'function' ? item.toString() : '')
        let value = item.code ?? item.value ?? ''
        if (!value && label) value = label
        if (!label && !value) return null
        const normalizedValue = typeof value === 'string' ? value : String(value)
        return {
          label: label || normalizedValue,
          value: normalizedValue
        }
      }
      const stringValue = String(item).trim()
      if (!stringValue) return null
      return { label: stringValue, value: stringValue }
    })
    .filter(Boolean)
}

function cloneOptionList(list = []) {
  return (Array.isArray(list) ? list : []).map(option => ({ ...option }))
}

function normalizeDictionaryOptions(options, fallback = []) {
  if (!Array.isArray(options)) return cloneOptionList(fallback)
  const normalized = createOptionListFromStrings(options)
  return normalized.length ? normalized : cloneOptionList(fallback)
}

function toOptionValueArray(value) {
  const list = Array.isArray(value)
    ? value
    : value === null || value === undefined || value === ''
      ? []
      : [value]
  return list
    .map(item => extractOptionValue(item))
    .filter(v => v !== '')
}

function getOptionLabel(optionsRefOrList, value) {
  const normalizedValue = extractOptionValue(value)
  if (!normalizedValue) return ''
  const options = Array.isArray(optionsRefOrList?.value)
    ? optionsRefOrList.value
    : Array.isArray(optionsRefOrList)
      ? optionsRefOrList
      : []
  const match = options.find(
    option => option.value === normalizedValue || option.label === normalizedValue
  )
  return match?.label ?? normalizedValue
}

/* 下拉選單選項：可改由後端「後臺控制 C0x」提供 ------------------------------ */
const ROLE_OPTIONS = [
  { label: '管理員', value: 'admin' },
  { label: '主管', value: 'supervisor' },
  { label: '員工', value: 'employee' },
]
const BULK_IMPORT_FIELD_CONFIGS = Object.freeze([
  {
    key: 'employeeNo',
    header: 'employeeId',
    label: '員工編號',
    description: '員工編號',
    required: true,
    category: '基本資料'
  },
  {
    key: 'name',
    header: 'name',
    label: '姓名',
    description: '姓名',
    required: true,
    category: '基本資料'
  },
  {
    key: 'gender',
    header: 'gender',
    label: '性別',
    description: '性別 (M=男, F=女, O=其他)',
    category: '基本資料'
  },
  {
    key: 'idNumber',
    header: 'idNumber',
    label: '身分證號',
    description: '身分證號',
    category: '基本資料'
  },
  {
    key: 'birthday',
    header: 'birthDate',
    label: '生日',
    description: '生日 (yyyy-mm-dd)',
    category: '基本資料'
  },
  {
    key: 'birthplace',
    header: 'birthPlace',
    label: '出生地',
    description: '出生地',
    category: '基本資料'
  },
  {
    key: 'bloodType',
    header: 'bloodType',
    label: '血型',
    description: '血型 (A/B/O/AB/HR)',
    category: '基本資料'
  },
  {
    key: 'languages',
    header: 'languages',
    label: '語言',
    description: '語言 (多個以逗號分隔)',
    category: '個人特質'
  },
  {
    key: 'disabilityLevel',
    header: 'disabilityLevel',
    label: '失能等級',
    description: '失能等級',
    category: '個人特質'
  },
  {
    key: 'identityCategory',
    header: 'identityCategory',
    label: '身分類別',
    description: '身分類別 (多個以逗號分隔)',
    category: '個人特質'
  },
  {
    key: 'maritalStatus',
    header: 'maritalStatus',
    label: '婚姻狀況',
    description: '婚姻狀況 (已婚/未婚/離婚/喪偶)',
    category: '家庭狀況'
  },
  {
    key: 'dependents',
    header: 'dependents',
    label: '扶養人數',
    description: '扶養人數',
    category: '家庭狀況'
  },
  {
    key: 'email',
    header: 'email',
    label: '電子郵件',
    description: '電子郵件 (必填唯一)',
    required: true,
    category: '聯絡資訊'
  },
  {
    key: 'phone',
    header: 'mobile',
    label: '手機號碼',
    description: '手機號碼',
    category: '聯絡資訊'
  },
  {
    key: 'landline',
    header: 'landline',
    label: '市話',
    description: '市話',
    category: '聯絡資訊'
  },
  {
    key: 'householdAddress',
    header: 'householdAddress',
    label: '戶籍地址',
    description: '戶籍地址',
    category: '聯絡資訊'
  },
  {
    key: 'contactAddress',
    header: 'contactAddress',
    label: '聯絡地址',
    description: '聯絡地址',
    category: '聯絡資訊'
  },
  {
    key: 'lineId',
    header: 'lineId',
    label: 'Line 帳號',
    description: 'Line 帳號',
    category: '聯絡資訊'
  },
  {
    key: 'organization',
    header: 'organization',
    label: '所屬機構',
    description: '所屬機構',
    category: '組織與職務'
  },
  {
    key: 'department',
    header: 'department',
    label: '部門 ID',
    description: '部門 ID',
    category: '組織與職務'
  },
  {
    key: 'subDepartment',
    header: 'subDepartment',
    label: '子部門 ID',
    description: '子部門 ID',
    category: '組織與職務'
  },
  {
    key: 'supervisor',
    header: 'supervisor',
    label: '主管員工 ID',
    description: '主管員工 ID',
    category: '組織與職務'
  },
  {
    key: 'title',
    header: 'title',
    label: '職稱',
    description: '職稱',
    category: '組織與職務'
  },
  {
    key: 'practiceTitle',
    header: 'practiceTitle',
    label: '執業職稱',
    description: '執業職稱',
    category: '組織與職務'
  },
  {
    key: 'employmentStatus',
    header: 'status',
    label: '人員狀態',
    description: '人員狀態 (正職員工/試用期/離職/留職停薪)',
    category: '雇用設定'
  },
  {
    key: 'probationDays',
    header: 'probationDays',
    label: '試用期天數',
    description: '試用期天數',
    category: '雇用設定'
  },
  {
    key: 'isPartTime',
    header: 'partTime',
    label: '是否兼職',
    description: '是否兼職 (TRUE/FALSE)',
    category: '雇用設定'
  },
  {
    key: 'isClocking',
    header: 'needClockIn',
    label: '是否需打卡',
    description: '是否需打卡 (TRUE/FALSE)',
    category: '雇用設定'
  },
  {
    key: 'educationLevel',
    header: 'education_level',
    label: '學歷程度',
    description: '學歷程度',
    category: '學歷資訊'
  },
  {
    key: 'schoolName',
    header: 'education_school',
    label: '畢業學校',
    description: '畢業學校',
    category: '學歷資訊'
  },
  {
    key: 'major',
    header: 'education_major',
    label: '主修科目',
    description: '主修科目',
    category: '學歷資訊'
  },
  {
    key: 'graduationStatus',
    header: 'education_status',
    label: '學歷狀態',
    description: '學歷狀態 (畢業/肄業)',
    category: '學歷資訊'
  },
  {
    key: 'graduationYear',
    header: 'education_graduationYear',
    label: '畢業年份',
    description: '畢業年份',
    category: '學歷資訊'
  },
  {
    key: 'serviceType',
    header: 'militaryService_type',
    label: '役別類型',
    description: '役別類型 (志願役/義務役)',
    category: '兵役資訊'
  },
  {
    key: 'militaryBranch',
    header: 'militaryService_branch',
    label: '軍種',
    description: '軍種',
    category: '兵役資訊'
  },
  {
    key: 'militaryRank',
    header: 'militaryService_rank',
    label: '軍階',
    description: '軍階',
    category: '兵役資訊'
  },
  {
    key: 'dischargeYear',
    header: 'militaryService_dischargeYear',
    label: '退伍年份',
    description: '退伍年份',
    category: '兵役資訊'
  },
  {
    key: 'emergency1.name',
    header: 'emergency1_name',
    label: '緊急聯絡人1 姓名',
    description: '緊急聯絡人1 姓名',
    category: '緊急聯絡人'
  },
  {
    key: 'emergency1.relation',
    header: 'emergency1_relation',
    label: '緊急聯絡人1 關係',
    description: '緊急聯絡人1 關係',
    category: '緊急聯絡人'
  },
  {
    key: 'emergency1.phone1',
    header: 'emergency1_phone1',
    label: '緊急聯絡人1 電話1',
    description: '緊急聯絡人1 電話1',
    category: '緊急聯絡人'
  },
  {
    key: 'emergency1.phone2',
    header: 'emergency1_phone2',
    label: '緊急聯絡人1 電話2',
    description: '緊急聯絡人1 電話2',
    category: '緊急聯絡人'
  },
  {
    key: 'emergency2.name',
    header: 'emergency2_name',
    label: '緊急聯絡人2 姓名',
    description: '緊急聯絡人2 姓名',
    category: '緊急聯絡人'
  },
  {
    key: 'emergency2.relation',
    header: 'emergency2_relation',
    label: '緊急聯絡人2 關係',
    description: '緊急聯絡人2 關係',
    category: '緊急聯絡人'
  },
  {
    key: 'emergency2.phone1',
    header: 'emergency2_phone1',
    label: '緊急聯絡人2 電話1',
    description: '緊急聯絡人2 電話1',
    category: '緊急聯絡人'
  },
  {
    key: 'emergency2.phone2',
    header: 'emergency2_phone2',
    label: '緊急聯絡人2 電話2',
    description: '緊急聯絡人2 電話2',
    category: '緊急聯絡人'
  },
  {
    key: 'hireDate',
    header: 'hireDate',
    label: '到職日期',
    description: '到職日期 (yyyy-mm-dd)',
    category: '任職期間'
  },
  {
    key: 'appointDate',
    header: 'startDate',
    label: '起聘日期',
    description: '起聘日期 (yyyy-mm-dd)',
    category: '任職期間'
  },
  {
    key: 'resignDate',
    header: 'resignationDate',
    label: '離職日期',
    description: '離職日期 (yyyy-mm-dd)',
    category: '任職期間'
  },
  {
    key: 'dismissDate',
    header: 'dismissalDate',
    label: '解聘日期',
    description: '解聘日期 (yyyy-mm-dd)',
    category: '任職期間'
  },
  {
    key: 'reAppointDate',
    header: 'rehireStartDate',
    label: '再任起聘',
    description: '再任起聘 (yyyy-mm-dd)',
    category: '任職期間'
  },
  {
    key: 'reDismissDate',
    header: 'rehireEndDate',
    label: '再任解聘',
    description: '再任解聘 (yyyy-mm-dd)',
    category: '任職期間'
  },
  {
    key: 'employmentNote',
    header: 'appointment_remark',
    label: '任職備註',
    description: '任職備註',
    category: '任職期間'
  },
  {
    key: 'salaryType',
    header: 'salaryType',
    label: '薪資類型',
    description: '薪資類型 (月薪/日薪/時薪)',
    category: '薪資與帳戶'
  },
  {
    key: 'salaryAmount',
    header: 'salaryAmount',
    label: '薪資金額',
    description: '薪資金額',
    category: '薪資與帳戶'
  },
  {
    key: 'laborPensionSelf',
    header: 'laborPensionSelf',
    label: '自提勞退 (%)',
    description: '自提勞退 (%)',
    category: '薪資與帳戶'
  },
  {
    key: 'employeeAdvance',
    header: 'employeeAdvance',
    label: '員工墊付金額',
    description: '員工墊付金額',
    category: '薪資與帳戶'
  },
  {
    key: 'salaryAccountA.bank',
    header: 'salaryAccountA_bank',
    label: '薪資帳戶A 銀行代號',
    description: '薪資帳戶A 銀行代號',
    category: '薪資與帳戶'
  },
  {
    key: 'salaryAccountA.acct',
    header: 'salaryAccountA_acct',
    label: '薪資帳戶A 帳號',
    description: '薪資帳戶A 帳號',
    category: '薪資與帳戶'
  },
  {
    key: 'salaryAccountB.bank',
    header: 'salaryAccountB_bank',
    label: '薪資帳戶B 銀行代號',
    description: '薪資帳戶B 銀行代號',
    category: '薪資與帳戶'
  },
  {
    key: 'salaryAccountB.acct',
    header: 'salaryAccountB_acct',
    label: '薪資帳戶B 帳號',
    description: '薪資帳戶B 帳號',
    category: '薪資與帳戶'
  },
  {
    key: 'salaryItems',
    header: 'salaryItems',
    label: '其他薪資項目',
    description: '其他薪資項目 (多個逗號分隔)',
    category: '薪資與帳戶'
  }
])

function formatBulkImportDescription(config = {}) {
  const base =
    config.description || config.label || config.header || config.key || ''
  if (!config.required) return typeof base === 'string' ? base : String(base)
  const text = typeof base === 'string' ? base : String(base)
  return text.includes('必填') ? text : `${text} (必填)`
}

const BULK_IMPORT_REQUIRED_FIELDS = BULK_IMPORT_FIELD_CONFIGS.filter(item => item.required).map(
  item => item.key
)
const DEFAULT_BULK_IMPORT_COLUMN_MAPPINGS = Object.freeze(
  BULK_IMPORT_FIELD_CONFIGS.reduce((acc, field) => {
    acc[field.key] = field.header
    return acc
  }, {})
)
const BULK_IMPORT_TEMPLATE_SAMPLE_EMPLOYEES = Object.freeze([
  {
    employeeId: 'EMP-0001',
    name: '王曉明',
    gender: 'M',
    birthDate: '1990-03-12',
    email: 'import.hr001@example.com',
    mobile: '0912000001',
    organization: '總公司',
    department: 'HR001',
    title: '人資專員',
    status: '正職員工',
    hireDate: '2020-07-01',
    partTime: 'FALSE',
    needClockIn: 'TRUE',
    lineId: 'hr-king',
    languages: '中文,英文'
  },
  {
    employeeId: 'EMP-0002',
    name: '林語彤',
    gender: 'F',
    birthDate: '1994-08-25',
    email: 'import.hr002@example.com',
    mobile: '0912000002',
    organization: '台北院區',
    department: 'NUR101',
    title: '資深護理師',
    status: '試用期',
    hireDate: '2024-02-15',
    partTime: 'FALSE',
    needClockIn: 'TRUE',
    lineId: 'nurse-ruby',
    languages: '中文,台語'
  },
  {
    employeeId: 'EMP-0003',
    name: '陳建宇',
    gender: 'M',
    birthDate: '1988-11-05',
    email: 'import.hr003@example.com',
    mobile: '0912000003',
    organization: '總公司',
    department: 'IT001',
    title: '系統工程師',
    status: '正職員工',
    hireDate: '2019-11-20',
    partTime: 'FALSE',
    needClockIn: 'FALSE',
    lineId: 'it-jack',
    languages: '中文,英文'
  },
  {
    employeeId: 'EMP-0004',
    name: '吳雅珊',
    gender: 'F',
    birthDate: '1992-01-18',
    email: 'import.hr004@example.com',
    mobile: '0912000004',
    organization: '總公司',
    department: 'FIN201',
    title: '會計專員',
    status: '留職停薪',
    hireDate: '2018-04-09',
    partTime: 'TRUE',
    needClockIn: 'FALSE',
    lineId: 'fin-olivia',
    languages: '中文,英文'
  },
  {
    employeeId: 'EMP-0005',
    name: '張志強',
    gender: 'M',
    birthDate: '1985-06-30',
    email: 'import.hr005@example.com',
    mobile: '0912000005',
    organization: '新北院區',
    department: 'OPS301',
    title: '營運主管',
    status: '離職',
    hireDate: '2016-01-03',
    resignationDate: '2023-12-31',
    partTime: 'FALSE',
    needClockIn: 'TRUE',
    lineId: 'ops-alex',
    languages: '中文,英文'
  }
])
const BULK_IMPORT_TEMPLATE_FILENAME = 'employee-import-template.csv'
const bulkImportFieldConfigs = computed(() =>
  BULK_IMPORT_FIELD_CONFIGS.map(field => ({
    ...field,
    displayDescription: formatBulkImportDescription(field)
  }))
)
const PERMISSION_GRADE_OPTIONS = [
  { level: 'L1', description: '一般使用者 / 基層專員' },
  { level: 'L2', description: '資深專員 / 小組長' },
  { level: 'L3', description: '部門主管 / 課長' },
  { level: 'L4', description: '處室主管 / 協理' },
  { level: 'L5', description: '高階決策者 / 最高主管' }
] // 權限/職等(不可控僅示意)

const titleOptions = ref([])
const practiceTitleOptions = ref([])
const languageOptions = ref([])
const disabilityLevelOptions = ref([])
const identityCategoryOptions = ref([])
const educationLevelOptions = ref([])
const graduationStatusOptions = ref([])
const relationOptions = ref([])
const creditCategoryOptions = ref([])
const salaryItemOptions = ref([])
const defaultBulkImportRole =
  ROLE_OPTIONS.find(option => option.value === 'employee')?.value ?? ROLE_OPTIONS[0]?.value ?? ''
const bulkImportDialogVisible = ref(false)
const bulkImportDialogCloseOptions = ref(null)
const bulkImportLoading = ref(false)
const bulkImportFile = ref(null)
const bulkImportUploadFileList = ref([])
const bulkImportPreview = ref([])
const bulkImportErrors = ref([])
const bulkImportForm = reactive({
  columnMappings: { ...DEFAULT_BULK_IMPORT_COLUMN_MAPPINGS },
  options: {
    defaultRole: defaultBulkImportRole,
    resetPassword: '',
    sendWelcomeEmail: false
  }
})

const REFERENCE_MAPPING_DEFAULT_KEYS = Object.freeze(['organization', 'department', 'subDepartment'])
const REFERENCE_MAPPING_LABELS = Object.freeze({
  organization: '機構',
  department: '部門',
  subDepartment: '子部門'
})
const REFERENCE_MAPPING_KEY_ALIASES = Object.freeze({
  organization: ['organization', 'org', 'organizations'],
  department: ['department', 'dept', 'departments'],
  subDepartment: ['subDepartment', 'subdept', 'sub_department', 'subDepartments']
})
const REFERENCE_MAPPING_ALIAS_LOOKUP = Object.freeze(
  Object.entries(REFERENCE_MAPPING_KEY_ALIASES).reduce((acc, [canonical, aliases]) => {
    const list = Array.isArray(aliases) ? aliases : []
    list.concat(canonical).forEach(alias => {
      if (typeof alias === 'string' && alias.trim()) {
        acc[alias.trim().toLowerCase()] = canonical
      }
    })
    return acc
  }, {})
)

const referenceMappingDialogVisible = ref(false)
const referenceMappingDialogMessage = ref('')
const referenceMappingKeys = ref([...REFERENCE_MAPPING_DEFAULT_KEYS])
const referenceMappingPending = reactive({})
const referenceMappingOptions = reactive({})
const referenceMappingSelections = reactive({})
const resolvedReferenceValueMappings = reactive({})
const resolvedReferenceIgnores = reactive({})
const referenceMappingSubmitting = ref(false)

const hasBulkImportProgress = computed(() => {
  const hasFile = Boolean(bulkImportFile.value)
  const hasUploadList = (bulkImportUploadFileList.value || []).length > 0
  const hasPreview = (bulkImportPreview.value || []).length > 0
  const hasErrors = (bulkImportErrors.value || []).length > 0
  const hasReferenceDialog = referenceMappingDialogVisible.value
  const hasReferenceMessage = Boolean(referenceMappingDialogMessage.value)
  const hasPendingReference = referenceMappingKeys.value.some(
    key => (referenceMappingPending[key] || []).length > 0
  )
  const hasResolvedReference =
    Object.values(resolvedReferenceValueMappings).some(map =>
      Object.keys(map || {}).length > 0
    ) ||
    Object.values(resolvedReferenceIgnores).some(list =>
      Array.isArray(list) && list.length > 0
    )

  const defaultMappingKeys = Object.keys(DEFAULT_BULK_IMPORT_COLUMN_MAPPINGS)
  const mappingKeys = new Set([
    ...defaultMappingKeys,
    ...Object.keys(bulkImportForm.columnMappings)
  ])
  const hasMappingChange = Array.from(mappingKeys).some(key => {
    const current = bulkImportForm.columnMappings[key] ?? ''
    const baseline = DEFAULT_BULK_IMPORT_COLUMN_MAPPINGS[key] ?? ''
    return current !== baseline
  })

  const hasOptionChange =
    bulkImportForm.options.defaultRole !== defaultBulkImportRole ||
    Boolean(bulkImportForm.options.resetPassword) ||
    Boolean(bulkImportForm.options.sendWelcomeEmail)

  return (
    hasFile ||
    hasUploadList ||
    hasPreview ||
    hasErrors ||
    hasReferenceDialog ||
    hasReferenceMessage ||
    hasPendingReference ||
    hasResolvedReference ||
    hasMappingChange ||
    hasOptionChange
  )
})

updateReferenceMappingKeys(REFERENCE_MAPPING_DEFAULT_KEYS, {
  resetPending: true,
  resetOptions: true,
  resetSelections: true,
  resetResolved: true
})

function ensureReferenceMappingContainers(key) {
  if (!Array.isArray(referenceMappingPending[key])) {
    referenceMappingPending[key] = []
  }
  if (!Array.isArray(referenceMappingOptions[key])) {
    referenceMappingOptions[key] = []
  }
  if (!referenceMappingSelections[key] || typeof referenceMappingSelections[key] !== 'object') {
    referenceMappingSelections[key] = {}
  }
  if (!resolvedReferenceValueMappings[key] || typeof resolvedReferenceValueMappings[key] !== 'object') {
    resolvedReferenceValueMappings[key] = {}
  }
  if (!Array.isArray(resolvedReferenceIgnores[key])) {
    resolvedReferenceIgnores[key] = []
  }
}

function updateReferenceMappingKeys(keys = [], {
  resetPending = false,
  resetOptions = false,
  resetSelections = false,
  resetResolved = false
} = {}) {
  const mergedKeys = new Set([
    ...REFERENCE_MAPPING_DEFAULT_KEYS,
    ...(Array.isArray(keys) ? keys : [])
  ])

  referenceMappingKeys.value = Array.from(mergedKeys)

  const containers = [referenceMappingPending, referenceMappingOptions, referenceMappingSelections]
  containers.forEach(container => {
    Object.keys(container).forEach(key => {
      if (!mergedKeys.has(key)) {
        delete container[key]
      }
    })
  })

  const resolvedContainers = [resolvedReferenceValueMappings, resolvedReferenceIgnores]
  resolvedContainers.forEach(container => {
    Object.keys(container).forEach(key => {
      if (!mergedKeys.has(key)) {
        delete container[key]
      }
    })
  })

  referenceMappingKeys.value.forEach(key => {
    ensureReferenceMappingContainers(key)
    if (resetPending) referenceMappingPending[key] = []
    if (resetOptions) referenceMappingOptions[key] = []
    if (resetSelections) referenceMappingSelections[key] = {}
    if (resetResolved) {
      resolvedReferenceValueMappings[key] = {}
      resolvedReferenceIgnores[key] = []
    }
  })
}

function getReferenceMappingLabel(type) {
  if (type && REFERENCE_MAPPING_LABELS[type]) {
    return REFERENCE_MAPPING_LABELS[type]
  }
  const text = typeof type === 'string' ? type : ''
  if (!text.trim()) return '其他參照'
  const spaced = text
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const bulkImportTemplateSections = computed(() => {
  const groups = new Map()
  bulkImportFieldConfigs.value.forEach(field => {
    const group = field.category || '其他欄位'
    if (!groups.has(group)) {
      groups.set(group, [])
    }
    groups.get(group).push(field)
  })
  return Array.from(groups.entries()).map(([title, fields]) => ({ title, fields }))
})

const bulkImportRequiredFieldNames = computed(() =>
  bulkImportFieldConfigs.value
    .filter(field => field.required)
    .map(field => field.label || field.description || field.header)
)

const missingBulkImportRequiredColumns = computed(() =>
  BULK_IMPORT_REQUIRED_FIELDS.filter(key => {
    const value = bulkImportForm.columnMappings[key]
    return typeof value !== 'string' || !value.trim()
  })
)

function escapeCsvValue(value) {
  if (value === null || value === undefined) return '""'
  const text = String(value).replace(/"/g, '""')
  return `"${text}"`
}

function buildBulkImportTemplateCsvContent() {
  const headerRow = bulkImportFieldConfigs.value.map(
    config => config.header || config.key
  )
  const descriptionRow = bulkImportFieldConfigs.value.map(
    config =>
      config.displayDescription ||
      config.description ||
      config.label ||
      config.header ||
      config.key
  )
  const sampleRows = BULK_IMPORT_TEMPLATE_SAMPLE_EMPLOYEES.map(sample =>
    headerRow.map(column => sample[column] ?? '')
  )
  const rows = [headerRow, descriptionRow, ...sampleRows]
  const csvBody = rows.map(row => row.map(escapeCsvValue).join(',')).join('\n')
  return `\ufeff${csvBody}`
}

function downloadBulkImportTemplate() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const csvContent = buildBulkImportTemplateCsvContent()
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const urlFactory =
    (window.URL && typeof window.URL.createObjectURL === 'function' && window.URL) ||
    (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL : null)

  if (!urlFactory) {
    ElMessage.warning('無法產生範本下載，請改用手動建立檔案')
    return
  }

  const url = urlFactory.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', BULK_IMPORT_TEMPLATE_FILENAME)
  document.body.appendChild(link)

  try {
    link.click()
  } finally {
    document.body.removeChild(link)
    if (typeof urlFactory.revokeObjectURL === 'function') {
      urlFactory.revokeObjectURL(url)
    }
  }
}
const isBulkImportReady = computed(
  () => Boolean(bulkImportFile.value) && missingBulkImportRequiredColumns.value.length === 0
)

const FALLBACK_TITLE_OPTIONS = createOptionListFromStrings([
  '護理師',
  '照顧服務員',
  '社工師',
  '物理治療師',
  '職能治療師',
  '行政人員'
]) // C03
const FALLBACK_PRACTICE_TITLE_OPTIONS = createOptionListFromStrings([
  '護理師',
  '社工師',
  '物理治療師',
  '職能治療師',
  '醫師'
]) // C04
const FALLBACK_LANGUAGE_OPTIONS = createOptionListFromStrings([
  '中文',
  '台語',
  '客語',
  '英語',
  '馬來語'
]) // C05
const FALLBACK_DISABILITY_LEVEL_OPTIONS = createOptionListFromStrings([
  '極重度',
  '重度身心障礙',
  '中度身心障礙',
  '輕度身心障礙'
]) // C06
const FALLBACK_IDENTITY_CATEGORY_OPTIONS = createOptionListFromStrings([
  '原住民',
  '新住民',
  '榮民'
]) // C07
const FALLBACK_EDUCATION_LEVEL_OPTIONS = createOptionListFromStrings([
  '博士',
  '碩士',
  '大學',
  '專科',
  '高中職',
  '國中以下'
]) // C08
const FALLBACK_GRADUATION_STATUS_OPTIONS = createOptionListFromStrings(['畢業', '肄業']) // C08-1
const FALLBACK_RELATION_OPTIONS = createOptionListFromStrings([
  '父',
  '母',
  '配偶',
  '子',
  '女',
  '兄',
  '姊',
  '弟',
  '妹',
  '其他'
]) // C09
const FALLBACK_CREDIT_CATEGORY_OPTIONS = createOptionListFromStrings([
  '院內',
  '院外',
  '線上',
  '研討會',
  '自學'
]) // C10
const FALLBACK_SALARY_ITEM_OPTIONS = createOptionListFromStrings([
  '本薪',
  '全勤',
  '加班費',
  '交通津貼',
  '伙食津貼',
  '績效獎金'
]) // C14

const DICTIONARY_OPTION_CONFIGS = [
  { key: 'C03', ref: titleOptions, fallback: FALLBACK_TITLE_OPTIONS, label: '職稱' },
  {
    key: 'C04',
    ref: practiceTitleOptions,
    fallback: FALLBACK_PRACTICE_TITLE_OPTIONS,
    label: '執業職稱'
  },
  { key: 'C05', ref: languageOptions, fallback: FALLBACK_LANGUAGE_OPTIONS, label: '語言能力' },
  {
    key: 'C06',
    ref: disabilityLevelOptions,
    fallback: FALLBACK_DISABILITY_LEVEL_OPTIONS,
    label: '身心障礙等級'
  },
  {
    key: 'C07',
    ref: identityCategoryOptions,
    fallback: FALLBACK_IDENTITY_CATEGORY_OPTIONS,
    label: '身分類別'
  },
  {
    key: 'C08',
    ref: educationLevelOptions,
    fallback: FALLBACK_EDUCATION_LEVEL_OPTIONS,
    label: '教育程度'
  },
  {
    key: 'C08-1',
    ref: graduationStatusOptions,
    fallback: FALLBACK_GRADUATION_STATUS_OPTIONS,
    label: '畢業狀態'
  },
  {
    key: 'C09',
    ref: relationOptions,
    fallback: FALLBACK_RELATION_OPTIONS,
    label: '緊急聯絡人稱謂'
  },
  {
    key: 'C10',
    ref: creditCategoryOptions,
    fallback: FALLBACK_CREDIT_CATEGORY_OPTIONS,
    label: '教育訓練積分類別'
  },
  {
    key: 'C14',
    ref: salaryItemOptions,
    fallback: FALLBACK_SALARY_ITEM_OPTIONS,
    label: '津貼項目'
  }
]

const DICTIONARY_MISSING_WARNING_SKIP_KEYS = new Set(['C08-1'])

function ensureDictionaryFallbacks({ notify = true } = {}) {
  const restored = []
  DICTIONARY_OPTION_CONFIGS.forEach(({ ref, fallback, label }) => {
    if (!Array.isArray(ref.value) || ref.value.length === 0) {
      ref.value = cloneOptionList(fallback)
      restored.push(label)
    }
  })
  if (notify && restored.length) {
    ElMessage.warning(`字典 ${restored.join('、')} 尚未設定，已套用預設選項`)
  }
  return restored
}

const SALARY_TYPES = ['月薪', '日薪', '時薪']
const SIGN_ROLE_OPTIONS = [
  { id: 'R001', label: '填報', description: '提出申請與初始資料填寫' },
  { id: 'R002', label: '覆核', description: '確認申請內容與佐證完整性' },
  { id: 'R003', label: '審核', description: '評估申請是否符合政策與規範' },
  { id: 'R004', label: '核定', description: '做出最終核准或駁回決策' },
  { id: 'R005', label: '知會', description: '接收流程進度並保留紀錄' },
  { id: 'R006', label: '財務覆核', description: '檢視成本預算與財務影響' },
  { id: 'R007', label: '人資覆核', description: '確保人事政策與法規符合' }
] // 簽核角色
const SIGN_LEVEL_OPTIONS = [
  { id: 'U001', label: 'L1', description: '單位承辦或第一層主管' },
  { id: 'U002', label: 'L2', description: '部門主管或組長' },
  { id: 'U003', label: 'L3', description: '處室主管或經理' },
  { id: 'U004', label: 'L4', description: '高階主管或副執行長' },
  { id: 'U005', label: 'L5', description: '執行長 / 院長 / 董事會' }
] // 簽核層級
const DEFAULT_TAGS = ['資深', '新人', '外聘', '志工']
const SERVICE_TYPES = ['義務役', '志願役', '替代役', '免役', '尚未服役']
const ABO_TYPES = ['A', 'B', 'O', 'AB', 'HR']                                                   // 依你的表格式


const SIGN_ROLE_ID_SET = new Set(SIGN_ROLE_OPTIONS.map(option => option.id))
const SIGN_ROLE_LABEL_TO_ID = new Map(SIGN_ROLE_OPTIONS.map(option => [option.label, option.id]))
  ;['填報人員', '覆核人員', '審核人員', '核定人員', '知會人員', '財務覆核人員', '人資覆核人員'].forEach((alias, index) => {
    const option = SIGN_ROLE_OPTIONS[index]
    if (option) SIGN_ROLE_LABEL_TO_ID.set(alias, option.id)
  })

const SIGN_LEVEL_ID_SET = new Set(SIGN_LEVEL_OPTIONS.map(level => level.id))
const SIGN_LEVEL_LABEL_TO_ID = new Map(SIGN_LEVEL_OPTIONS.map(level => [level.label, level.id]))

const PERMISSION_GRADE_LEVEL_SET = new Set(PERMISSION_GRADE_OPTIONS.map(option => option.level))
const PERMISSION_GRADE_LABEL_TO_LEVEL = new Map([
  ['一級', 'L1'],
  ['二級', 'L2'],
  ['三級', 'L3'],
  ['四級', 'L4'],
  ['五級', 'L5'],
  ['一般職等', 'L1'],
  ['資深職等', 'L2'],
  ['主管職等', 'L3'],
])

function normalizeSignRole(value) {
  if (!value && value !== 0) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (SIGN_ROLE_ID_SET.has(trimmed)) return trimmed
    const mapped = SIGN_ROLE_LABEL_TO_ID.get(trimmed)
    return mapped ?? trimmed
  }
  return value
}

function normalizeSignLevel(value) {
  if (!value && value !== 0) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (SIGN_LEVEL_ID_SET.has(trimmed)) return trimmed
    const mapped = SIGN_LEVEL_LABEL_TO_ID.get(trimmed)
    return mapped ?? trimmed
  }
  return value
}

function normalizePermissionGrade(value) {
  if (!value && value !== 0) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (PERMISSION_GRADE_LEVEL_SET.has(trimmed)) return trimmed
    const mapped = PERMISSION_GRADE_LABEL_TO_LEVEL.get(trimmed)
    return mapped ?? trimmed
  }
  return value
}

function formatPermissionGradeLabel(option) {
  if (!option) return ''
  return `${option.level}｜${option.description}`
}

function formatSignLevelLabel(option) {
  if (!option) return ''
  return `${option.id}｜${option.label}`
}

/* 狀態 --------------------------------------------------------------------- */
const employeeDialogTab = ref('account')
const employeeList = ref([])
const departmentList = ref([])
const subDepartmentList = ref([])
const orgList = ref([])
const employeeDialogVisible = ref(false)
const photoUploading = ref(false)
let editEmployeeIndex = null
let editEmployeeId = ''

function departmentLabel(id) {
  const dept = departmentList.value.find(d => d._id === id)
  return dept ? `${dept.name}(${dept.code})` : id
}

function subDepartmentLabel(id) {
  const sd = subDepartmentList.value.find(s => s._id === id)
  return sd ? sd.name : id
}

function resolveSubDepartmentId(item = {}) {
  return (
    item?._id ??
    item?.id ??
    item?.value ??
    item?.code ??
    (typeof item === 'string' ? item : '')
  )
}

function handle401(res) {
  if (res.status === 401) {
    ElMessage.error('登入逾時，請重新登入')
    router.push('/manager/login')
    return true
  }
  return false
}

/* 照片上傳處理 -------------------------------------------------------------- */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('READ_ERROR'))
    reader.readAsDataURL(file)
  })
}

function normalizePhotoUploadList(uploadFiles = []) {
  const normalized = uploadFiles
    .slice(-1)
    .map(file => {
      const response = file.response
      const responseUrl =
        (typeof response === 'object' && response !== null && 'url' in response && response.url) ||
        (typeof response === 'object' && response !== null && 'data' in response && response.data?.url) ||
        (typeof response === 'string' ? response : '')

      return {
        ...file,
        // Prefer responseUrl (base64 data URL) over file.url (blob URL)
        url: responseUrl || file.url || '',
        status: 'success',
        percentage: file.percentage ?? 100
      }
    })

  employeeForm.value.photoList = normalized
  employeeForm.value.photo = normalized.length ? normalized[0].url || '' : ''
}

async function handlePhotoRequest({ file, onSuccess, onError }) {
  photoUploading.value = true
  try {
    // 創建 Object URL 用於預覽，並保存原始檔案物件供後續上傳
    // Object URL 用於在界面顯示，原始檔案用於實際上傳
    onSuccess?.({ url: URL.createObjectURL(file), raw: file })
  } catch (err) {
    onError?.(err)
    ElMessage.error('照片載入失敗，請重新選擇檔案')
  } finally {
    photoUploading.value = false
  }
}

function handlePhotoSuccess(response, uploadFile, uploadFiles) {
  // 保存原始檔案引用和預覽 URL
  if (typeof response === 'string') {
    uploadFile.url = response
  } else if (response && typeof response === 'object') {
    uploadFile.url = response.url || response?.data?.url || ''
    // 保存原始檔案物件供後續上傳使用
    if (response.raw) {
      uploadFile.raw = response.raw
    }
  }
  normalizePhotoUploadList(uploadFiles)
}

function handlePhotoRemove(_file, uploadFiles) {
  normalizePhotoUploadList(uploadFiles)
}

function handlePhotoExceed() {
  ElMessage.warning('僅能上傳一張照片')
}

function buildPhotoUploadFile(url, name = '') {
  if (!url) return null
  return {
    name: name ? `${name} 照片` : '員工照片',
    url,
    status: 'success',
    percentage: 100
  }
}

function extractUploadUrls(files = []) {
  return (Array.isArray(files) ? files : [files])
    .map(file => {
      if (!file) return ''
      if (typeof file === 'string') return file
      if (file.url) return file.url
      const response = file.response
      if (typeof response === 'string') return response
      if (typeof response === 'object' && response !== null) {
        if ('url' in response && response.url) return response.url
        if ('data' in response && response.data?.url) return response.data.url
      }
      return ''
    })
    .filter(url => typeof url === 'string' && url)
}

function extractPhotoUrls(files = []) {
  return extractUploadUrls(files)
}

function normalizeAttachmentList(uploadFiles = [], namePrefix = '附件') {
  return (Array.isArray(uploadFiles) ? uploadFiles : [uploadFiles])
    .map((file, index) => {
      if (!file) return null
      if (typeof file === 'string') {
        return {
          name: `${namePrefix}${index + 1}`,
          url: file,
          status: 'success',
          percentage: 100,
          uid: `${namePrefix}-${index}`
        }
      }

      if (typeof file === 'object') {
        let url = file.url
        if (!url) {
          const response = file.response
          if (typeof response === 'string') url = response
          else if (response && typeof response === 'object') {
            url = response.url || response?.data?.url || ''
          }
        }
        if (!url) return null
        const normalized = {
          ...file,
          name: file.name || `${namePrefix}${index + 1}`,
          url,
          status: 'success',
          percentage: file.percentage ?? 100
        }
        if (!normalized.uid) normalized.uid = `${namePrefix}-${index}`
        return normalized
      }
      return null
    })
    .filter(file => file && typeof file.url === 'string' && file.url)
}

function buildAttachmentFileList(source, namePrefix = '附件') {
  if (!source) return []
  const list = Array.isArray(source) ? source : [source]
  return normalizeAttachmentList(list, namePrefix)
}

function ensureArrayValue(value) {
  if (Array.isArray(value)) return value.filter(v => v !== '' && v !== null && v !== undefined)
  if (value === '' || value === null || value === undefined) return []
  return [value]
}

function toNormalizedOptionValue(value) {
  if (value === '' || value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

function getSalaryItemValueSet() {
  const source = Array.isArray(salaryItemOptions.value) ? salaryItemOptions.value : []
  return new Set(
    source
      .map(option => {
        if (option && typeof option === 'object') {
          const rawValue =
            option.value ??
            option.code ??
            option.name ??
            option.label ??
            (typeof option.toString === 'function' ? option.toString() : '')
          return toNormalizedOptionValue(rawValue)
        }
        return toNormalizedOptionValue(option)
      })
      .filter(Boolean)
  )
}

function filterValidSalaryItems(values) {
  const valueSet = getSalaryItemValueSet()
  return ensureArrayValue(values)
    .map(toNormalizedOptionValue)
    .filter(value => valueSet.has(value))
}

function areArraysShallowEqual(a = [], b = []) {
  if (a.length !== b.length) return false
  return a.every((item, index) => item === b[index])
}

function getAttachmentPrefix(type, index) {
  return type === 'licenses' ? `證照${index + 1}-附件` : `教育訓練${index + 1}-附件`
}

function updateAttachmentList(type, index, uploadFiles) {
  const target = type === 'licenses' ? employeeForm.value.licenses : employeeForm.value.trainings
  if (!Array.isArray(target) || !target[index]) return
  const prefix = getAttachmentPrefix(type, index)
  target[index].fileList = normalizeAttachmentList(uploadFiles, prefix)
}

async function handleAttachmentRequest({ file, onSuccess, onError }) {
  try {
    const dataUrl = await readFileAsDataUrl(file)
    onSuccess?.({ url: dataUrl })
  } catch (err) {
    onError?.(err)
    ElMessage.error('檔案載入失敗，請重新選擇')
  }
}

function handleAttachmentSuccess(type, index, response, uploadFile, uploadFiles) {
  if (!uploadFile.url) {
    if (typeof response === 'string') uploadFile.url = response
    else if (response && typeof response === 'object') {
      uploadFile.url = response.url || response?.data?.url || uploadFile.url || ''
    }
  }
  updateAttachmentList(type, index, uploadFiles)
}

function handleAttachmentRemove(type, index, _file, uploadFiles) {
  updateAttachmentList(type, index, uploadFiles)
}

function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function normalizeSalaryItemAmounts(source = {}, selected = []) {
  const selectedValues = ensureArrayValue(selected).map(toNormalizedOptionValue).filter(Boolean)
  const amounts = source && typeof source === 'object' ? source : {}
  return selectedValues.reduce((acc, value) => {
    const num = toNumberOrNull(amounts[value])
    acc[value] = num ?? 0
    return acc
  }, {})
}

function areObjectsShallowEqual(a = {}, b = {}) {
  const aKeys = Object.keys(a || {})
  const bKeys = Object.keys(b || {})
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(key => a[key] === b[key])
}

function normalizeMonthlySalaryAdjustments(source = {}) {
  const adj = source && typeof source === 'object' ? source : {}
  const toNum = (v) => toNumberOrNull(v) ?? 0
  return {
    healthInsuranceFee: toNum(adj.healthInsuranceFee),
    debtGarnishment: toNum(adj.debtGarnishment),
    otherDeductions: toNum(adj.otherDeductions),
    performanceBonus: toNum(adj.performanceBonus),
    otherBonuses: toNum(adj.otherBonuses),
    notes: toStringOrEmpty(adj.notes)
  }
}

function toStringOrEmpty(value) {
  if (value === undefined || value === null) return ''
  return String(value)
}

function toDateOrEmpty(value) {
  if (value === undefined || value === null || value === '') return ''
  return value
}

function formatLicensesForForm(list = []) {
  if (!Array.isArray(list)) return []
  return list.map((item = {}, index) => ({
    name: item?.name ?? '',
    number: item?.number ?? '',
    startDate: item?.startDate ?? item?.issueDate ?? '',
    endDate: item?.endDate ?? item?.expiryDate ?? '',
    fileList: buildAttachmentFileList(
      item?.fileList ?? item?.files ?? (item?.file ? [item.file] : []),
      `證照${index + 1}-附件`
    )
  }))
}

function formatTrainingsForForm(list = []) {
  if (!Array.isArray(list)) return []
  return list.map((item = {}, index) => ({
    course: item?.course ?? item?.name ?? '',
    courseNo: item?.courseNo ?? item?.code ?? '',
    date: item?.date ?? '',
    category: toOptionValueArray(item?.category ?? item?.categories),
    score: toNumberOrNull(item?.score),
    fileList: buildAttachmentFileList(
      item?.fileList ?? item?.files ?? (item?.file ? [item.file] : []),
      `教育訓練${index + 1}-附件`
    )
  }))
}

/* 取資料 ------------------------------------------------------------------- */
async function loadItemSettings() {
  try {
    const res = await apiFetch('/api/other-control-settings/item-settings')
    if (handle401(res)) return
    if (!res.ok) throw new Error(`ITEM_SETTINGS_FETCH_FAILED_${res.status}`)
    const payload = await res.json()
    const dictionaryData =
      payload?.itemSettings && typeof payload.itemSettings === 'object'
        ? payload.itemSettings
        : payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload
          : {}
    const missingLabels = []
    DICTIONARY_OPTION_CONFIGS.forEach(({ key, ref, fallback, label }) => {
      const source = dictionaryData?.[key]
      if (
        (!Array.isArray(source) || !source.length) &&
        !DICTIONARY_MISSING_WARNING_SKIP_KEYS.has(key)
      ) {
        missingLabels.push(label)
      }
      ref.value = normalizeDictionaryOptions(source, fallback)
    })
    const uniqueMissing = [...new Set(missingLabels)].filter(Boolean)
    if (uniqueMissing.length) {
      ElMessage.warning(`字典 ${uniqueMissing.join('、')} 尚未設定，已套用預設選項`)
    }
  } catch (error) {
    console.warn('載入字典項目失敗：', error)
    ensureDictionaryFallbacks()
  }
}

async function fetchDepartments() {
  const res = await apiFetch('/api/departments')
  if (handle401(res)) return
  if (res.ok) departmentList.value = await res.json()
}
async function fetchSubDepartments(dept = '') {
  const url = dept ? `/api/sub-departments?department=${dept}` : '/api/sub-departments'
  const res = await apiFetch(url)
  if (handle401(res)) return
  if (res.ok) subDepartmentList.value = await res.json()
}
async function fetchOrganizations() {
  const res = await apiFetch('/api/organizations')
  if (handle401(res)) return
  if (res.ok) orgList.value = await res.json()
}
async function fetchEmployees() {
  const res = await apiFetch('/api/employees')
  if (handle401(res)) return
  if (res.ok) {
    const list = await res.json()
    employeeList.value = list.map(e => {
      const appointment = e?.appointment ?? {}
      const monthlyAdjustments = normalizeMonthlySalaryAdjustments(
        e?.monthlySalaryAdjustments
      )
      const filteredSalaryItems = filterValidSalaryItems(e?.salaryItems)
      return {
        ...e,
        title: extractOptionValue(e?.title),
        practiceTitle: extractOptionValue(e?.practiceTitle),
        languages: toOptionValueArray(e?.languages),
        disabilityLevel: extractOptionValue(e?.disabilityLevel),
        identityCategory: toOptionValueArray(e?.identityCategory),
        permissionGrade: normalizePermissionGrade(e?.permissionGrade),
        signRole: normalizeSignRole(e?.signRole),
        signLevel: normalizeSignLevel(e?.signLevel),
        organization: e.organization?._id || e.organization || '',
        department: e.department?._id || e.department || '',
        subDepartment: e.subDepartment?._id || e.subDepartment || '',
        laborPensionSelf: toNumberOrNull(e?.laborPensionSelf) ?? 0,
        employeeAdvance: toNumberOrNull(e?.employeeAdvance) ?? 0,
        salaryItems: filteredSalaryItems,
        salaryItemAmounts: normalizeSalaryItemAmounts(e?.salaryItemAmounts, filteredSalaryItems),
        height: toNumberOrNull(e?.medicalCheck?.height ?? e?.height),
        weight: toNumberOrNull(e?.medicalCheck?.weight ?? e?.weight),
        medicalBloodType: e?.medicalCheck?.bloodType ?? e?.medicalBloodType ?? '',
        educationLevel: extractOptionValue(e?.education?.level ?? e?.educationLevel),
        schoolName: e?.education?.school ?? e?.schoolName ?? '',
        major: e?.education?.major ?? e?.major ?? '',
        graduationStatus: extractOptionValue(e?.education?.status ?? e?.graduationStatus),
        graduationYear: toStringOrEmpty(
          e?.education?.graduationYear ?? e?.graduationYear ?? ''
        ),
        serviceType: e?.militaryService?.serviceType ?? e?.serviceType ?? '',
        militaryBranch: e?.militaryService?.branch ?? e?.militaryBranch ?? '',
        militaryRank: e?.militaryService?.rank ?? e?.militaryRank ?? '',
        dischargeYear: toNumberOrNull(
          e?.militaryService?.dischargeYear ?? e?.dischargeYear
        ),
        hireDate: toDateOrEmpty(appointment?.hireDate ?? e?.hireDate),
        appointDate: toDateOrEmpty(
          appointment?.appointDate ?? appointment?.startDate ?? e?.appointDate
        ),
        resignDate: toDateOrEmpty(
          appointment?.resignationDate ?? e?.resignDate
        ),
        dismissDate: toDateOrEmpty(
          appointment?.dismissalDate ?? e?.dismissDate
        ),
        reAppointDate: toDateOrEmpty(
          appointment?.reAppointDate ??
          appointment?.rehireStartDate ??
          e?.reAppointDate
        ),
        reDismissDate: toDateOrEmpty(
          appointment?.reDismissDate ??
          appointment?.rehireEndDate ??
          e?.reDismissDate
        ),
        employmentNote: toStringOrEmpty(
          appointment?.remark ?? e?.employmentNote ?? ''
        ),
        monthlySalaryAdjustments: monthlyAdjustments
      }
    })
  }
}
onMounted(() => {
  ensureDictionaryFallbacks({ notify: false })
  loadItemSettings()
  fetchDepartments()
  fetchEmployees()
  fetchOrganizations()
  fetchSubDepartments()
})

/* 表單模型（完整補齊） ------------------------------------------------------ */
const emptyEmployee = {
  username: '',
  password: '',
  role: 'employee',

  // 帳號/權限
  permissionGrade: '',

  // 簽核設定
  signRole: '',
  signTags: [],
  signLevel: '',

  // 基本資料
  employeeNo: '',
  name: '',
  gender: '',
  birthday: '',
  idNumber: '',
  birthplace: '',
  bloodType: '',
  languages: [],
  disabilityLevel: '',
  identityCategory: [],   // 改為多選陣列
  maritalStatus: '',
  dependents: 0,
  email: '',
  phone: '',
  landline: '',
  householdAddress: '',
  contactAddress: '',
  lineId: '',
  photo: '',
  photoList: [],

  // 部門/機構
  organization: '',
  department: '',
  supervisor: null,
  subDepartment: '',

  // 職業別
  title: '',
  practiceTitle: '',      // C04
  isPartTime: false,
  isClocking: false,

  // 人員狀態
  employmentStatus: '',
  probationDays: '',

  // 體檢
  height: null,
  weight: null,
  medicalBloodType: '',

  // 學歷
  educationLevel: '',
  schoolName: '',
  major: '',
  graduationStatus: '',
  graduationYear: '',

  // 役別
  serviceType: '',
  militaryBranch: '',
  militaryRank: '',
  dischargeYear: null,

  // 緊急聯絡人
  emergency1: { name: '', relation: '', phone1: '', phone2: '' },
  emergency2: { name: '', relation: '', phone1: '', phone2: '' },

  // 關鍵字
  keywords: '',

  // 經歷/證照/訓練
  experiences: [],
  licenses: [],
  trainings: [],

  // 聘任日期
  hireDate: '',
  appointDate: '',
  resignDate: '',
  dismissDate: '',
  reAppointDate: '',
  reDismissDate: '',
  employmentNote: '',

  // 薪資
  salaryType: '',
  salaryAmount: 0,
  laborPensionSelf: 0,
  employeeAdvance: 0,
  salaryAccountA: { bank: '', acct: '' },
  salaryAccountB: { bank: '', acct: '' },
  salaryItems: [],
  salaryItemAmounts: {},
  
  // 每月薪資調整項目
  monthlySalaryAdjustments: {
    healthInsuranceFee: 0,
    debtGarnishment: 0,
    otherDeductions: 0,
    performanceBonus: 0,
    otherBonuses: 0,
    notes: ''
  },

  // 特休管理
  annualLeave: {
    totalDays: 0,
    usedDays: 0,
    year: CURRENT_YEAR
  }
}
const employeeForm = ref({ ...emptyEmployee })
const formRef = ref()
const createNonNegativeRule = label => ({
  validator: (_rule, value) => {
    if (value === '' || value === null || value === undefined) return Promise.resolve()
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return Promise.reject(new Error(`請輸入正確的${label}`))
    }
    return Promise.resolve()
  },
  trigger: ['blur', 'change']
})
const rules = {
  username: [{ required: true, message: '請輸入登入帳號', trigger: 'blur' }],
  password: [{ required: true, message: '請輸入登入密碼', trigger: 'blur' }],
  role: [{ required: true, message: '請選擇系統權限', trigger: 'change' }],
  organization: [{ required: true, message: '請選擇所屬機構', trigger: 'change' }],
  department: [{ required: true, message: '請選擇所屬部門', trigger: 'change' }],
  gender: [{ required: true, message: '請選擇性別', trigger: 'change' }],
  name: [{ required: true, message: '請輸入員工姓名', trigger: 'blur' }],
  email: [
    {
      required: true,
      message: '請輸入有效 Email',
      type: 'email',
      trigger: ['blur', 'change']
    }
  ],
  laborPensionSelf: [createNonNegativeRule('勞退自提')],
  employeeAdvance: [createNonNegativeRule('員工預支')],
  salaryItems: [
    {
      validator: (_rule, value) => {
        if (value === '' || value === null || value === undefined) return Promise.resolve()
        if (!Array.isArray(value)) {
          return Promise.reject(new Error('請選擇有效的薪資項目'))
        }
        const valueSet = getSalaryItemValueSet()
        const normalized = ensureArrayValue(value).map(toNormalizedOptionValue)
        const invalid = normalized.some(item => !valueSet.has(item))
        return invalid
          ? Promise.reject(new Error('請選擇有效的薪資項目'))
          : Promise.resolve()
      },
      trigger: 'change'
    }
  ]
}

/* 派生 --------------------------------------------------------------------- */
const filteredDepartments = computed(() =>
  employeeForm.value.organization
    ? departmentList.value.filter(d => d.organization === employeeForm.value.organization)
    : []
)
const filteredSubDepartments = computed(() =>
  employeeForm.value.department
    ? subDepartmentList.value.filter(sd => sd.department === employeeForm.value.department)
    : []
)
const supervisorList = computed(() =>
  employeeForm.value.organization && employeeForm.value.department
    ? employeeList.value.filter(
      e =>
        e.role === 'supervisor' &&
        e.organization === employeeForm.value.organization &&
        e.department === employeeForm.value.department
    )
    : []
)

const salaryItemOptionMap = computed(() => {
  const map = {}
  const source = Array.isArray(salaryItemOptions.value) ? salaryItemOptions.value : []
  source.forEach(option => {
    const value = toNormalizedOptionValue(
      option?.value ??
      option?.code ??
      option?.name ??
      option?.label ??
      (typeof option?.toString === 'function' ? option.toString() : '')
    )
    if (value) map[value] = option?.label ?? option?.name ?? value
  })
  return map
})

const selectedSalaryItemsForUI = computed(() =>
  ensureArrayValue(employeeForm.value.salaryItems)
    .map(value => {
      const normalized = toNormalizedOptionValue(value)
      if (!normalized) return null
      return {
        value: normalized,
        label: salaryItemOptionMap.value[normalized] || normalized
      }
    })
    .filter(Boolean)
)

function syncSalaryItemAmounts(selected = employeeForm.value.salaryItems) {
  const normalized = normalizeSalaryItemAmounts(employeeForm.value.salaryItemAmounts, selected)
  if (!areObjectsShallowEqual(employeeForm.value.salaryItemAmounts, normalized)) {
    employeeForm.value.salaryItemAmounts = normalized
  }
}

watch(bulkImportDialogVisible, visible => {
  if (!visible) {
    if (bulkImportDialogCloseOptions.value) {
      resetBulkImportState(bulkImportDialogCloseOptions.value)
      bulkImportDialogCloseOptions.value = null
    }
  } else {
    bulkImportDialogCloseOptions.value = null
  }
})

watch(
  () => employeeForm.value.department,
  async (dept, prevDept) => {
    const previousSubDepartment = employeeForm.value.subDepartment

    if (!dept) {
      subDepartmentList.value = []
      if (employeeForm.value.subDepartment) {
        employeeForm.value.subDepartment = ''
      }
      return
    }

    await fetchSubDepartments(dept)

    if (employeeForm.value.department !== dept) return

    const isSelectionUnchanged = employeeForm.value.subDepartment === previousSubDepartment
    const hasPreviousSelection = Boolean(previousSubDepartment)
    const isValidInNewDepartment =
      hasPreviousSelection &&
      subDepartmentList.value.some(
        sub => resolveSubDepartmentId(sub) === previousSubDepartment
      )

    if (!isValidInNewDepartment && dept !== prevDept && isSelectionUnchanged) {
      employeeForm.value.subDepartment = ''
    }
  }
)

watch(
  () => employeeForm.value.salaryItems,
  value => {
    const rawArray = ensureArrayValue(value)
    const current = rawArray.map(toNormalizedOptionValue)
    const filtered = filterValidSalaryItems(current)
    if (!areArraysShallowEqual(filtered, current)) {
      employeeForm.value.salaryItems = filtered
      syncSalaryItemAmounts(filtered)
    } else if (!areArraysShallowEqual(current, rawArray)) {
      employeeForm.value.salaryItems = current
      syncSalaryItemAmounts(current)
    } else {
      syncSalaryItemAmounts(filtered)
    }
  },
  { deep: true }
)

watch(
  () => salaryItemOptions.value,
  () => {
    const rawArray = ensureArrayValue(employeeForm.value.salaryItems)
    const current = rawArray.map(toNormalizedOptionValue)
    const filtered = filterValidSalaryItems(current)
    if (!areArraysShallowEqual(filtered, current)) {
      employeeForm.value.salaryItems = filtered
      syncSalaryItemAmounts(filtered)
    } else if (!areArraysShallowEqual(current, rawArray)) {
      employeeForm.value.salaryItems = current
      syncSalaryItemAmounts(current)
    } else {
      syncSalaryItemAmounts(filtered)
    }
  },
  { deep: true }
)

/* 事件 --------------------------------------------------------------------- */
function onGraduationStatusClear() {
  employeeForm.value.graduationStatus = ''
}

function openBulkImportDialog() {
  bulkImportDialogVisible.value = true
}

async function requestBulkImportDialogClose({ resetMappings = true, done } = {}) {
  if (hasBulkImportProgress.value) {
    try {
      await ElMessageBox.confirm(
        '關閉後將清除目前的匯入檔案、預覽與對應設定，確定要離開？',
        '確認關閉匯入',
        {
          type: 'warning',
          confirmButtonText: '確認關閉',
          cancelButtonText: '繼續編輯'
        }
      )
    } catch (error) {
      return false
    }
  }

  bulkImportDialogCloseOptions.value = {
    resetMappings,
    resetReferenceData: true,
    resetResolvedReferences: true
  }

  if (typeof done === 'function') {
    done()
  } else {
    bulkImportDialogVisible.value = false
  }

  return true
}

async function handleBulkImportDialogCancel() {
  await requestBulkImportDialogClose()
}

async function handleBulkImportDialogBeforeClose(done) {
  await requestBulkImportDialogClose({ done })
}

function resetBulkImportState({
  resetMappings = true,
  resetFile = true,
  resetPreview = true,
  resetErrors = true,
  resetUploadList = true,
  resetReferenceDialogs = true,
  resetReferenceData = true,
  resetResolvedReferences = resetMappings,
  resetOptions = resetMappings,
  referenceKeys
} = {}) {
  bulkImportLoading.value = false

  if (resetFile) {
    bulkImportFile.value = null
  }
  if (resetUploadList) {
    bulkImportUploadFileList.value = []
  }
  if (resetPreview) {
    bulkImportPreview.value = []
  }
  if (resetErrors) {
    bulkImportErrors.value = []
  }
  if (resetReferenceDialogs) {
    referenceMappingDialogVisible.value = false
    referenceMappingDialogMessage.value = ''
    referenceMappingSubmitting.value = false
  }

  if (resetReferenceData) {
    const targetKeys = Array.isArray(referenceKeys)
      ? referenceKeys
      : resetMappings
        ? REFERENCE_MAPPING_DEFAULT_KEYS
        : referenceMappingKeys.value
    updateReferenceMappingKeys(targetKeys, {
      resetPending: true,
      resetOptions: true,
      resetSelections: true,
      resetResolved: resetResolvedReferences
    })
  }

  if (resetMappings) {
    Object.keys(bulkImportForm.columnMappings).forEach(key => {
      if (!(key in DEFAULT_BULK_IMPORT_COLUMN_MAPPINGS)) {
        delete bulkImportForm.columnMappings[key]
      }
    })
    Object.entries(DEFAULT_BULK_IMPORT_COLUMN_MAPPINGS).forEach(([key, header]) => {
      bulkImportForm.columnMappings[key] = header
    })
  }

  if (resetOptions) {
    bulkImportForm.options.defaultRole = defaultBulkImportRole
    bulkImportForm.options.resetPassword = ''
    bulkImportForm.options.sendWelcomeEmail = false
  }
}



function normalizeReferenceKeyClient(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim().toLowerCase()
  if (typeof value === 'number') return String(value).trim().toLowerCase()
  return String(value).trim().toLowerCase()
}

function ensureNormalizedList(list = []) {
  const seen = new Set()
  const result = []
  list.forEach(item => {
    const normalized = normalizeReferenceKeyClient(item)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    result.push(normalized)
  })
  return result
}

function buildReferenceSubmissionPayload() {
  const valueMappingsPayload = {}
  const ignorePayload = {}
  const keySet = new Set([
    ...referenceMappingKeys.value,
    ...Object.keys(resolvedReferenceValueMappings),
    ...Object.keys(resolvedReferenceIgnores)
  ])
  keySet.forEach(key => {
    ensureReferenceMappingContainers(key)
    valueMappingsPayload[key] = {}
    Object.entries(resolvedReferenceValueMappings[key] || {}).forEach(([normalized, target]) => {
      if (typeof target === 'string' && target.trim()) {
        valueMappingsPayload[key][normalized] = target
      }
    })
    ignorePayload[key] = ensureNormalizedList(resolvedReferenceIgnores[key])
  })
  return { valueMappingsPayload, ignorePayload }
}

function getReferenceEntryKey(entry) {
  if (!entry) return ''
  if (entry.normalizedValue) return entry.normalizedValue
  return normalizeReferenceKeyClient(entry.value)
}

function isObjectIdLike(text = '') {
  const normalized = String(text).trim()
  return /^[a-fA-F0-9]{24}$/.test(normalized) || /^object_[a-fA-F0-9]{24}$/.test(normalized)
}

function buildReferenceOptionLabel(type, option) {
  if (!option || typeof option !== 'object') return ''
  if (type === 'organization') {
    const parts = [option.name, option.unitName, option.orgCode, option.systemCode].filter(Boolean)
    if (parts.length) return parts.join(' / ')
  }
  if (type === 'department') {
    const orgParts = [option.organizationName, option.organizationCode, option.organizationUnitName]
      .map(text => (text == null ? '' : String(text).trim()))
      .filter(Boolean)
    const deptParts = [option.name, option.code].filter(Boolean)
    const segments = []
    if (orgParts.length) segments.push(orgParts.join('｜'))
    if (deptParts.length) segments.push(deptParts.join('｜'))
    if (!segments.length && option.organization) segments.push(String(option.organization))
    if (segments.length) return segments.join(' / ')
  }
  if (type === 'subDepartment') {
    const orgParts = [option.organizationName, option.organizationCode, option.organizationUnitName]
      .map(text => (text == null ? '' : String(text).trim()))
      .filter(Boolean)
    const deptParts = [option.departmentName, option.departmentCode]
      .map(text => (text == null ? '' : String(text).trim()))
      .filter(Boolean)
    const subParts = [option.name, option.code].filter(Boolean)
    const segments = []
    if (orgParts.length) segments.push(orgParts.join('｜'))
    if (deptParts.length) segments.push(deptParts.join('｜'))
    if (subParts.length) segments.push(subParts.join('｜'))
    if (!segments.length && option.department) segments.push(String(option.department))
    if (segments.length) return segments.join(' / ')
  }
  const candidates = [option.label, option.name, option.title, option.code, option.value, option.id]
    .map(x => (x == null ? '' : String(x).trim()))
    .filter(Boolean)
  const fallback = candidates.find(t => t) || ''
  if (!fallback) return ''
  if (isObjectIdLike(fallback)) {
    const hasMeaningfulLabel = [option.label, option.name, option.title, option.code, option.value]
      .map(x => (x == null ? '' : String(x).trim()))
      .some(text => text && !isObjectIdLike(text))
    if (!hasMeaningfulLabel) return '（缺少可辨識的標籤）'
  }
  return fallback
}


function _normKey(s = '') {
  return String(s).normalize('NFKC').replace(/^\uFEFF/, '').trim().toLowerCase()
}
function _candidateKeys(option, fields) {
  const out = new Set()
  fields.forEach(f => {
    const v = option?.[f]
    if (v != null && String(v).trim() !== '') out.add(_normKey(v))
  })
  return out
}

// 建立 options 索引（name / code / id / unitName 等都試）
function _buildIndex(list = [], fields = ['name', 'code', 'id', 'orgCode', 'unitName', 'systemCode']) {
  const idx = new Map()
    ; (list || []).forEach(opt => {
      _candidateKeys(opt, fields).forEach(k => {
        if (k && !idx.has(k)) idx.set(k, opt)
      })
    })
  return idx
}

// 取得現有資料清單做為 options（若後端缺 options）
function _getFallbackOptions(key) {
  const orgMap = new Map((orgList.value || []).map(o => {
    const id = o?._id ?? o?.id
    const key = id == null ? '' : String(id)
    return [key, o]
  }))
  const deptMap = new Map((departmentList.value || []).map(d => {
    const id = d?._id ?? d?.id
    const key = id == null ? '' : String(id)
    return [key, { ...d, organization: d?.organization ?? '' }]
  }))
  if (key === 'organization') {
    return (orgList.value || []).map(o => ({
      id: o._id ?? o.id ?? '',
      name: o.name ?? '',
      orgCode: o.orgCode ?? o.code ?? '',
      unitName: o.unitName ?? ''
    }))
  }
  if (key === 'department') {
    return (departmentList.value || []).map(d => ({
      id: d._id ?? d.id ?? '',
      name: d.name ?? '',
      code: d.code ?? '',
      organization: d.organization ?? '',
      organizationName: orgMap.get(String(d.organization ?? ''))?.name ?? '',
      organizationUnitName: orgMap.get(String(d.organization ?? ''))?.unitName ?? '',
      organizationCode: orgMap.get(String(d.organization ?? ''))?.orgCode ?? ''
    }))
  }
  if (key === 'subDepartment') {
    return (subDepartmentList.value || []).map(s => ({
      id: s._id ?? s.id ?? '',
      name: s.name ?? '',
      code: s.code ?? '',
      department: s.department ?? '',
      departmentName: deptMap.get(String(s.department ?? ''))?.name ?? '',
      departmentCode: deptMap.get(String(s.department ?? ''))?.code ?? '',
      organization: deptMap.get(String(s.department ?? ''))?.organization ?? s.organization ?? '',
      organizationName: (() => {
        const dept = deptMap.get(String(s.department ?? ''))
        const orgId = dept?.organization ?? s.organization ?? ''
        return orgMap.get(String(orgId))?.name ?? ''
      })(),
      organizationUnitName: (() => {
        const dept = deptMap.get(String(s.department ?? ''))
        const orgId = dept?.organization ?? s.organization ?? ''
        return orgMap.get(String(orgId))?.unitName ?? ''
      })(),
      organizationCode: (() => {
        const dept = deptMap.get(String(s.department ?? ''))
        const orgId = dept?.organization ?? s.organization ?? ''
        return orgMap.get(String(orgId))?.orgCode ?? ''
      })()
    }))
  }
  return []
}

/**
 * 自動匹配 missingReferences：
 * - organization：用 name / orgCode / id 對「總公司」「台北院區」等
 * - department：用 code / name / id 對「HR001」等
 * - subDepartment：用 code / name / id
 * 成功的會直接寫進 resolvedReferenceValueMappings，失敗的留給互動視窗。
 * 回傳 { unresolved, keysUsed }
 */
function autoResolveMissingReferences(missingRefs = {}) {
  const keys = Object.keys(missingRefs || {})
  const unresolved = {}

  keys.forEach(key => {
    const block = missingRefs[key] || {}
    const values = Array.isArray(block.values) ? block.values : []
    const options = (Array.isArray(block.options) && block.options.length)
      ? block.options
      : _getFallbackOptions(key)

    // 依不同類型設計索引欄位優先順序
    let fields = ['id', 'code', 'name']
    if (key === 'organization') fields = ['id', 'orgCode', 'name', 'unitName', 'systemCode']
    const idx = _buildIndex(options, fields)

    values.forEach(entry => {
      const raw = entry?.value ?? ''
      const norm = entry?.normalizedValue || _normKey(raw)
      if (!norm) return
      const hit = idx.get(norm)
        || idx.get(_normKey(String(raw))) // 再試一次
      if (hit?.id) {
        // 直接記到 resolved
        ensureReferenceMappingContainers(key)
        if (!resolvedReferenceValueMappings[key]) resolvedReferenceValueMappings[key] = {}
        resolvedReferenceValueMappings[key][norm] = String(hit.id)
        // 同時確保 ignore 清掉
        resolvedReferenceIgnores[key] = (resolvedReferenceIgnores[key] || []).filter(v => v !== norm)
      } else {
        // 留待互動
        if (!unresolved[key]) unresolved[key] = { values: [], options }
        unresolved[key].values.push(entry)
      }
    })
    // 若該 key 都解完，unresolved 無需保留
    if (unresolved[key] && unresolved[key].values.length === 0) delete unresolved[key]
  })

  return { unresolved, keysUsed: keys }
}


// 把後端回傳的 missingReferences 任意鍵名整理並保留未知類型
function normalizeMissingRefPayload(raw = {}) {
  const normalized = {}
  const keySet = new Set(REFERENCE_MAPPING_DEFAULT_KEYS)

  function normalizeBlock(block = {}) {
    const valueSource = Array.isArray(block?.values)
      ? block.values
      : Array.isArray(block) ? block : []
    const normValues = valueSource
      .map((item) => {
        if (item && typeof item === 'object') {
          const baseValue =
            item.value ?? item.name ?? item.label ?? item.code ?? item.id ?? item
          const rows = Array.isArray(item.rows) ? item.rows : []
          const normalizedValue = normalizeReferenceKeyClient(baseValue)
          return {
            ...item,
            value: baseValue,
            rows,
            normalizedValue
          }
        }
        const baseValue = item ?? ''
        return {
          value: baseValue,
          rows: [],
          normalizedValue: normalizeReferenceKeyClient(baseValue)
        }
      })
      .filter(entry => entry.value != null && String(entry.value).trim() !== '')

    const optionSource = Array.isArray(block?.options) ? block.options : []
    const normOptions = optionSource
      .map((option, index) => {
        // 物件型 options：優先用 _id / id / value / code / key / name / label
        if (option && typeof option === 'object') {
          const candidate =
            option._id ??
            option.id ??
            option.value ??
            option.code ??
            option.key ??
            option.name ??
            option.label ??
            ''
          const id = String(candidate || `option-${index}`)
          const hasMeaningfulLabel = ['label', 'name', 'title', 'code']
            .map(field => (option?.[field] == null ? '' : String(option?.[field]).trim()))
            .some(text => text)
          const idText = id.trim()
          const label = hasMeaningfulLabel
            ? (option.label ?? option.name ?? option.title ?? option.code ?? '')
            : isObjectIdLike(idText)
              ? '（缺少可辨識的標籤）'
              : (option.label ?? '')

          return {
            ...option,
            id,
            label: label || idText || `option-${index}`,
            name: option.name ?? label ?? idText ?? `option-${index}`
          }
        }

        // 字串型 options：直接當成文字 & id
        const text = option == null ? '' : String(option)
        const id = text.trim() ? text : `option-${index}`
        return {
          id,
          label: text.trim() || id,
          name: text.trim() || id
        }
      })
      .filter(option => {
        const hasLabel = ['label', 'name', 'title', 'code']
          .map(field => (option?.[field] == null ? '' : String(option?.[field]).trim()))
          .some(text => text)
        if (hasLabel) return true
        const idText = option?.id == null ? '' : String(option.id).trim()
        return Boolean(idText)
      })

    return { values: normValues, options: normOptions }
  }

  Object.entries(raw || {}).forEach(([rawKey, block]) => {
    if (rawKey == null) return
    const keyText = String(rawKey).trim()
    if (!keyText) return
    const canonical = REFERENCE_MAPPING_ALIAS_LOOKUP[keyText.toLowerCase()] || keyText
    keySet.add(canonical)
    normalized[canonical] = normalizeBlock(block)
  })

  keySet.forEach(key => {
    if (!normalized[key]) {
      normalized[key] = { values: [], options: [] }
    }
  })

  return { normalized, keys: Array.from(keySet) }
}


// 從目前待匯入的「映射後列」掃描未知的 org/department/subDepartment
function buildClientMissingRefs(mappedRows = []) {
  const knownOrg = new Set((orgList.value || []).map(o => (o._id ?? o.id ?? o.name ?? o).toString().trim().toLowerCase()))
  const knownDept = new Set((departmentList.value || []).map(d => (d.code ?? d._id ?? d.id ?? d.name ?? d).toString().trim().toLowerCase()))
  const knownSub = new Set((subDepartmentList.value || []).map(s => (s.code ?? s._id ?? s.id ?? s.name ?? s).toString().trim().toLowerCase()))

  const miss = {
    organization: new Map(),   // normalizedValue -> { value, rows:Set }
    department: new Map(),
    subDepartment: new Map()
  }

  mappedRows.forEach((row, idx) => {
    const rowNo = idx + 3; // 你的 CSV 是第3列開始才是資料
    const orgVal = row.organization ?? ''
    const deptVal = row.department ?? ''
    const subVal = row.subDepartment ?? ''

    if (orgVal) {
      const norm = normalizeReferenceKeyClient(orgVal)
      if (norm && !knownOrg.has(norm)) {
        if (!miss.organization.has(norm)) miss.organization.set(norm, { value: orgVal, rows: new Set() })
        miss.organization.get(norm).rows.add(rowNo)
      }
    }
    if (deptVal) {
      const norm = normalizeReferenceKeyClient(deptVal)
      if (norm && !knownDept.has(norm)) {
        if (!miss.department.has(norm)) miss.department.set(norm, { value: deptVal, rows: new Set() })
        miss.department.get(norm).rows.add(rowNo)
      }
    }
    if (subVal) {
      const norm = normalizeReferenceKeyClient(subVal)
      if (norm && !knownSub.has(norm)) {
        if (!miss.subDepartment.has(norm)) miss.subDepartment.set(norm, { value: subVal, rows: new Set() })
        miss.subDepartment.get(norm).rows.add(rowNo)
      }
    }
  })

  const toValueArray = (m) => Array.from(m.values()).map(v => ({
    value: v.value,
    rows: Array.from(v.rows),
    normalizedValue: normalizeReferenceKeyClient(v.value)
  }))

  // 用現有列表做 options
  const orgOptions = (orgList.value || []).map(o => ({
    id: o._id ?? o.id ?? '',
    name: o.name ?? '',
    orgCode: o.orgCode ?? o.code ?? '',
    unitName: o.unitName ?? ''
  }))
  const deptOptions = (departmentList.value || []).map(d => ({
    id: d._id ?? d.id ?? '',
    name: d.name ?? '',
    code: d.code ?? '',
    organization: d.organization ?? ''
  }))
  const subOptions = (subDepartmentList.value || []).map(s => ({
    id: s._id ?? s.id ?? '',
    name: s.name ?? '',
    code: s.code ?? '',
    department: s.department ?? ''
  }))

  return {
    organization: { values: toValueArray(miss.organization), options: orgOptions },
    department: { values: toValueArray(miss.department), options: deptOptions },
    subDepartment: { values: toValueArray(miss.subDepartment), options: subOptions }
  }
}

function getRefSel(type, k) {
  ensureReferenceMappingContainers(type)
  if (!referenceMappingSelections[type][k]) {
    // 預設是「指定既有資料」，但 target 先留空
    referenceMappingSelections[type][k] = { mode: 'map', targetId: '' }
  }
  return referenceMappingSelections[type][k]
}





function openReferenceMappingDialog(missingReferences = {}, message = '', keys = []) {
  referenceMappingDialogMessage.value = message || '部分欄位需要對應既有的組織/部門資料'
  referenceMappingSubmitting.value = false

  // 來源 keys：優先用呼叫端傳入；否則用物件的實際鍵；最後回到預設三鍵
  const dynamicKeys = (Array.isArray(keys) && keys.length ? keys : Object.keys(missingReferences || {}))
    .filter(k => typeof k === 'string' && k.trim() !== '')
  const finalKeys = dynamicKeys.length ? dynamicKeys : [...REFERENCE_MAPPING_DEFAULT_KEYS]

  // 先建立容器，再填資料；避免在對話框初次 render 前出現未初始化的取值
  updateReferenceMappingKeys(finalKeys, {
    resetPending: true,
    resetOptions: true,
    resetSelections: true
  })

  // 保底選項（後端沒給 options 時使用）
  const fallbackOptions = {
    organization: _getFallbackOptions('organization'),
    department: _getFallbackOptions('department'),
    subDepartment: _getFallbackOptions('subDepartment')
  }

  // ✅ 永遠先取 block，再讀 values/options
  referenceMappingKeys.value.forEach((key) => {
    const block = (missingReferences && typeof missingReferences === 'object') ? missingReferences[key] : undefined
    const values = Array.isArray(block?.values) ? block.values : []
    const optionsRaw = Array.isArray(block?.options) ? block.options : []
    const options = optionsRaw.length ? optionsRaw : (fallbackOptions[key] || [])

    ensureReferenceMappingContainers(key)
    referenceMappingPending[key] = values.map(item => ({ ...item }))   // copy
    referenceMappingOptions[key] = options.map(item => ({ ...item }))   // copy
    referenceMappingSelections[key] = {}

    values.forEach(entry => {
      const nk = getReferenceEntryKey(entry)
      const sel = getRefSel(key, nk) // 保證 selection 物件存在
      const existingTarget = resolvedReferenceValueMappings[key]?.[nk] || ''
      const existingIgnore = resolvedReferenceIgnores[key]?.includes(nk)
      if (existingIgnore) {
        sel.mode = 'ignore'
        sel.targetId = ''
      } else if (existingTarget) {
        sel.mode = 'map'
        sel.targetId = existingTarget
      } else {
        sel.mode = 'map'
        sel.targetId = ''
      }
    })
  })

  // 最後才打開對話框（避免初次 render 碰到未就緒資料）
  referenceMappingDialogVisible.value = true
}



// 當彈窗打開時，再輸出目前 sections 概況（多一道保險）
watch(referenceMappingDialogVisible, (v) => {
  if (v) {
    console.log('[ref-mapping] dialog opened; sections snapshot =',
      (referenceMappingKeys.value || []).map(k => ({
        k,
        values: referenceMappingPending[k]?.length || 0,
        options: referenceMappingOptions[k]?.length || 0
      })))
  }
})



async function submitBulkImport({ triggeredByMapping = false } = {}) {
  if (!bulkImportFile.value) {
    const tip = triggeredByMapping
      ? '原始檔案已重置，請重新選擇匯入檔案後再試'
      : '請先選擇要匯入的檔案'
    ElMessage.warning(tip)
    return
  }
  if (!isBulkImportReady.value) {
    ElMessage.warning('請確認必要欄位對應是否完整')
    return
  }
  bulkImportLoading.value = true
  try {
    const formData = new FormData()
    formData.append('file', bulkImportFile.value)
    formData.append('mappings', JSON.stringify(bulkImportForm.columnMappings))
    formData.append('options', JSON.stringify(bulkImportForm.options))
    const { valueMappingsPayload, ignorePayload } = buildReferenceSubmissionPayload()
    formData.append('valueMappings', JSON.stringify(valueMappingsPayload))
    formData.append('ignore', JSON.stringify(ignorePayload))

    const res = await importEmployeesBulk(formData)
    let payload = {}
    try {
      payload = await res.json()
    } catch (error) {
      payload = {}
    }

    if (res.status === 409) {

      // 1) 正規化後端 payload
      const { normalized, keys: normalizedKeys } = normalizeMissingRefPayload(payload?.missingReferences || {})
      let finalRefs = normalized
      let finalKeys = normalizedKeys.length ? normalizedKeys : [...REFERENCE_MAPPING_DEFAULT_KEYS]

      // 2) 若後端沒給 values，就用檔案自行掃描未知值
      const allEmpty = finalKeys.every(key => !finalRefs[key]?.values?.length)
      if (allEmpty) {
        try {
          const rowObjects = await parseFileToRowObjects(bulkImportFile.value)
          const mappedRows = rowObjects.map(r => mapRowToFormShape(r, bulkImportForm.columnMappings))
          finalRefs = buildClientMissingRefs(mappedRows)
          finalKeys = Array.from(new Set([...finalKeys, ...Object.keys(finalRefs || {})]))
        } catch (e) {
          console.warn('client-side missing refs build failed:', e)
        }
      }

      // 3) 自動匹配可解決的
      const { unresolved, keysUsed } = autoResolveMissingReferences(finalRefs)
      const keysForDialog = (keysUsed && keysUsed.length) ? keysUsed : finalKeys

      // 若都解完 → 自動重送；否則開對應視窗處理剩下的
      const stillMissing = Object.values(unresolved).some(b => (b?.values?.length || 0) > 0)
      bulkImportErrors.value = Array.isArray(payload?.errors) ? payload.errors : []

      if (!stillMissing) {
        // 全部解決：直接重送（不彈窗）
        await submitBulkImport({ triggeredByMapping: true })
      } else {
        openReferenceMappingDialog(unresolved, payload?.message, keysForDialog)
        ElMessage.warning(payload?.message || '匯入資料存在未對應的組織或部門資訊，請完成對應後重新提交')
      }
      return
    }




    if (!res.ok) {
      bulkImportErrors.value = Array.isArray(payload?.errors) ? payload.errors : []
      const rowInfo = typeof payload?.rowNumber === 'number'
        ? `（停在第 ${payload.rowNumber} 列）`
        : ''
      const baseMessage = payload?.message || payload?.error || '批量匯入失敗，請稍後再試'
      const message = rowInfo && !baseMessage.includes(rowInfo)
        ? `${baseMessage}${rowInfo}`
        : baseMessage
      throw new Error(message)
    }

    const serverPreview = Array.isArray(payload?.preview) ? payload.preview : null
    if (Array.isArray(serverPreview) && serverPreview.length) {
      bulkImportPreview.value = serverPreview
    }
    bulkImportErrors.value = Array.isArray(payload?.errors) ? payload.errors : []

    if (bulkImportErrors.value.length) {
      ElMessage.warning('匯入完成，但有部分資料需要檢查')
    } else {
      ElMessage.success('匯入成功')
    }

    await fetchEmployees()
    if (!bulkImportErrors.value.length) {
      referenceMappingDialogVisible.value = false
      referenceMappingDialogMessage.value = ''
    }
  } catch (error) {
    const message = error?.message || '批量匯入失敗，請稍後再試'
    ElMessage.error(message)
  } finally {
    bulkImportLoading.value = false
  }
}

async function confirmReferenceMappings() {
  if (!bulkImportFile.value) {
    ElMessage.warning('原始檔案已重置，請重新選擇匯入檔案後再試')
    referenceMappingDialogVisible.value = false
    return
  }

  const keys = Array.from(new Set([
    ...referenceMappingKeys.value,
    ...Object.keys(referenceMappingPending)
  ]))
  const unresolved = []
  keys.forEach(key => {
    referenceMappingPending[key].forEach(entry => {
      const normalized = getReferenceEntryKey(entry)
      const selection = referenceMappingSelections[key][normalized]
      if (!selection || (selection.mode === 'map' && !selection.targetId)) {
        unresolved.push(entry.value || normalized)
      }
    })
  })

  if (unresolved.length) {
    ElMessage.warning('請為所有未對應的項目選擇既有資料或設定忽略')
    return
  }

  keys.forEach(key => {
    referenceMappingPending[key].forEach(entry => {
      const normalized = getReferenceEntryKey(entry)
      const selection = referenceMappingSelections[key][normalized]
      if (!selection) return
      if (selection.mode === 'ignore') {
        delete resolvedReferenceValueMappings[key][normalized]
        resolvedReferenceIgnores[key] = ensureNormalizedList([
          ...resolvedReferenceIgnores[key],
          normalized
        ])
      } else if (selection.mode === 'map' && selection.targetId) {
        resolvedReferenceValueMappings[key][normalized] = selection.targetId
        resolvedReferenceIgnores[key] = resolvedReferenceIgnores[key].filter(item => item !== normalized)
      }
    })
  })

  referenceMappingSubmitting.value = true
  try {
    await submitBulkImport({ triggeredByMapping: true })
  } finally {
    referenceMappingSubmitting.value = false
  }
}

async function openEmployeeDialog(index = null) {
  ensureDictionaryFallbacks()
  if (index !== null) {
    editEmployeeIndex = index
    const emp = employeeList.value[index]
    editEmployeeId = emp._id || ''
    // 以 emptyEmployee 為基底，可避免漏欄位
    employeeForm.value = { ...structuredClone(emptyEmployee), ...emp, password: '', photoList: [] }
    employeeForm.value.title = extractOptionValue(employeeForm.value.title)
    employeeForm.value.practiceTitle = extractOptionValue(employeeForm.value.practiceTitle)
    employeeForm.value.languages = toOptionValueArray(employeeForm.value.languages)
    employeeForm.value.disabilityLevel = extractOptionValue(employeeForm.value.disabilityLevel)
    employeeForm.value.permissionGrade = normalizePermissionGrade(employeeForm.value.permissionGrade)
    employeeForm.value.signRole = normalizeSignRole(employeeForm.value.signRole)
    employeeForm.value.signLevel = normalizeSignLevel(employeeForm.value.signLevel)
    employeeForm.value.photo = employeeForm.value.photo || ''
    const existingPhotoFile = buildPhotoUploadFile(employeeForm.value.photo, employeeForm.value.name)
    employeeForm.value.photoList = existingPhotoFile ? [existingPhotoFile] : []
    employeeForm.value.licenses = formatLicensesForForm(emp.licenses ?? [])
    employeeForm.value.trainings = formatTrainingsForForm(emp.trainings ?? [])
    employeeForm.value.laborPensionSelf =
      toNumberOrNull(employeeForm.value.laborPensionSelf) ?? 0
    employeeForm.value.employeeAdvance =
      toNumberOrNull(employeeForm.value.employeeAdvance) ?? 0
    employeeForm.value.salaryItems = filterValidSalaryItems(employeeForm.value.salaryItems)
    employeeForm.value.salaryItemAmounts = normalizeSalaryItemAmounts(
      emp.salaryItemAmounts ?? employeeForm.value.salaryItemAmounts,
      employeeForm.value.salaryItems
    )
    employeeForm.value.monthlySalaryAdjustments = normalizeMonthlySalaryAdjustments(
      emp.monthlySalaryAdjustments ?? employeeForm.value.monthlySalaryAdjustments
    )
    const education = emp.education ?? {}
    if (!employeeForm.value.educationLevel && education.level) {
      employeeForm.value.educationLevel = education.level
    }
    if (!employeeForm.value.schoolName && education.school) {
      employeeForm.value.schoolName = education.school
    }
    if (!employeeForm.value.major && education.major) {
      employeeForm.value.major = education.major
    }
    if (!employeeForm.value.graduationStatus && education.status) {
      employeeForm.value.graduationStatus = education.status
    }
    employeeForm.value.graduationYear = toStringOrEmpty(
      employeeForm.value.graduationYear || education.graduationYear || ''
    )
    employeeForm.value.identityCategory = toOptionValueArray(employeeForm.value.identityCategory)
    employeeForm.value.height = toNumberOrNull(emp.height ?? emp.medicalCheck?.height)
    employeeForm.value.weight = toNumberOrNull(emp.weight ?? emp.medicalCheck?.weight)
    employeeForm.value.medicalBloodType =
      emp.medicalBloodType ?? emp.medicalCheck?.bloodType ?? ''
    const service = emp.militaryService ?? {}
    employeeForm.value.serviceType =
      employeeForm.value.serviceType || service.serviceType || ''
    employeeForm.value.militaryBranch =
      employeeForm.value.militaryBranch || service.branch || ''
    employeeForm.value.militaryRank =
      employeeForm.value.militaryRank || service.rank || ''
    const dischargeYearSource =
      employeeForm.value.dischargeYear === '' ||
        employeeForm.value.dischargeYear === null ||
        employeeForm.value.dischargeYear === undefined
        ? service.dischargeYear
        : employeeForm.value.dischargeYear
    employeeForm.value.dischargeYear = toNumberOrNull(dischargeYearSource)
    employeeForm.value.department = emp.department?._id || emp.department || ''
    employeeForm.value.subDepartment = emp.subDepartment?._id || emp.subDepartment || ''
    employeeForm.value.educationLevel = extractOptionValue(employeeForm.value.educationLevel)
    employeeForm.value.graduationStatus = extractOptionValue(employeeForm.value.graduationStatus)
  } else {
    editEmployeeIndex = null
    editEmployeeId = ''
    employeeDialogTab.value = 'account'
    employeeForm.value = { ...structuredClone(emptyEmployee) }
    employeeForm.value.licenses = []
    employeeForm.value.trainings = []
  }

  await fetchDepartments()
  if (
    employeeForm.value.department &&
    !/^[0-9a-fA-F]{24}$/.test(employeeForm.value.department)
  ) {
    const dept = departmentList.value.find(
      d => d.name === employeeForm.value.department
    )
    if (dept) employeeForm.value.department = dept._id
  }
  await fetchSubDepartments(employeeForm.value.department)
  employeeDialogVisible.value = true
}

async function saveEmployee() {
  let errors
  try {
    await formRef.value?.validate()
  } catch (err) {
    errors = err
  }
  if (errors) {
    const fields = Object.values(errors)
      .flat()
      .map(e => e.message.replace(/^請(?:輸入|選擇)(?:有效)?\s*/, ''))
    ElMessageBox.alert(`請補齊：${fields.join('、')}`)
    return
  }

  const form = employeeForm.value
  const payload = { ...form }
  payload.title = extractOptionValue(form.title)
  payload.practiceTitle = extractOptionValue(form.practiceTitle)
  
  // 檢查是否有新上傳的照片檔案
  let photoFile = null
  const normalizedPhotoList = extractPhotoUrls(form.photoList)
  if (form.photoList && form.photoList.length > 0) {
    const firstPhoto = form.photoList[0]
    // 如果有原始檔案物件（新上傳的照片），使用 multipart/form-data
    if (firstPhoto.raw && firstPhoto.raw instanceof File) {
      photoFile = firstPhoto.raw
    } else if (normalizedPhotoList.length) {
      // 否則使用現有的照片 URL（編輯時未更改照片）
      payload.photoList = normalizedPhotoList
      payload.photo = normalizedPhotoList[0]
    }
  } else if (editEmployeeIndex !== null) {
    payload.photoList = []
    payload.photo = ''
  } else {
    delete payload.photoList
    if (!form.photo) delete payload.photo
  }

  payload.languages = toOptionValueArray(form.languages)
  payload.identityCategory = toOptionValueArray(form.identityCategory)
  payload.disabilityLevel = extractOptionValue(form.disabilityLevel)
  payload.educationLevel = extractOptionValue(form.educationLevel)
  payload.graduationStatus = extractOptionValue(form.graduationStatus)
  payload.laborPensionSelf = toNumberOrNull(form.laborPensionSelf) ?? 0
  payload.employeeAdvance = toNumberOrNull(form.employeeAdvance) ?? 0
  payload.salaryItems = filterValidSalaryItems(form.salaryItems)
  payload.salaryItemAmounts = normalizeSalaryItemAmounts(
    form.salaryItemAmounts,
    payload.salaryItems
  )
  payload.monthlySalaryAdjustments = normalizeMonthlySalaryAdjustments(
    form.monthlySalaryAdjustments
  )
  payload.dischargeYear = toNumberOrNull(form.dischargeYear)
  if (payload.supervisor === '' || payload.supervisor === null) delete payload.supervisor

  const normalizedLicenses = (Array.isArray(form.licenses) ? form.licenses : [])
    .map(license => {
      const fileList = extractUploadUrls(license?.fileList ?? [])
      const name = typeof license?.name === 'string' ? license.name.trim() : license?.name ?? ''
      const number = typeof license?.number === 'string' ? license.number.trim() : license?.number ?? ''
      const startDate = license?.startDate || ''
      const endDate = license?.endDate || ''
      return {
        name,
        number,
        startDate,
        endDate,
        fileList
      }
    })
    .filter(license =>
      license.name ||
      license.number ||
      license.startDate ||
      license.endDate ||
      (Array.isArray(license.fileList) && license.fileList.length)
    )
  payload.licenses = normalizedLicenses

  const normalizedTrainings = (Array.isArray(form.trainings) ? form.trainings : [])
    .map(training => {
      const fileList = extractUploadUrls(training?.fileList ?? [])
      const categories = toOptionValueArray(training?.category ?? training?.categories)
      const course = typeof training?.course === 'string' ? training.course.trim() : training?.course ?? ''
      const courseNo = typeof training?.courseNo === 'string' ? training.courseNo.trim() : training?.courseNo ?? ''
      const date = training?.date || ''
      const scoreValue = toNumberOrNull(training?.score)
      const normalized = {
        course,
        courseNo,
        date,
        category: categories,
        fileList
      }
      if (scoreValue !== null) normalized.score = scoreValue
      return normalized
    })
    .filter(training =>
      training.course ||
      training.courseNo ||
      training.date ||
      (Array.isArray(training.category) && training.category.length) ||
      (Array.isArray(training.fileList) && training.fileList.length) ||
      training.score !== undefined
    )
  payload.trainings = normalizedTrainings

  let res
  
  // 如果有新上傳的照片檔案，使用 multipart/form-data
  if (photoFile) {
    const formData = new FormData()
    formData.append('photo', photoFile)
    
    // 將所有其他欄位也添加到 FormData
    // 當使用 multipart/form-data 時，所有資料都必須通過 FormData 發送
    Object.keys(payload).forEach(key => {
      if (key !== 'photo' && key !== 'photoList') {
        const value = payload[key]
        if (value !== undefined && value !== null) {
          if (typeof value === 'object') {
            formData.append(key, JSON.stringify(value))
          } else {
            formData.append(key, value)
          }
        }
      }
    })
    
    if (editEmployeeIndex === null) {
      res = await apiFetch('/api/employees', {
        method: 'POST',
        body: formData
        // 不設置 Content-Type，讓瀏覽器自動設置 multipart/form-data 和 boundary
      })
    } else {
      res = await apiFetch(`/api/employees/${editEmployeeId}`, {
        method: 'PUT',
        body: formData
      })
    }
  } else {
    // 沒有新照片，使用原來的 JSON 方式
    if (editEmployeeIndex === null) {
      res = await apiFetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    } else {
      res = await apiFetch(`/api/employees/${editEmployeeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    }
  }
  
  if (res && res.ok) {
    await fetchEmployees()
    employeeDialogVisible.value = false
    ElMessage.success('儲存成功')
  } else {
    ElMessage.error('儲存失敗')
  }
}

async function deleteEmployee(index) {
  const emp = employeeList.value[index]
  
  // Prevent deleting admin accounts
  if (emp.role === 'admin') {
    ElMessage.warning('管理員帳戶不可刪除')
    return
  }
  
  const res = await apiFetch(`/api/employees/${emp._id}`, {
    method: 'DELETE'
  })
  
  if (res.ok) {
    employeeList.value.splice(index, 1)
    ElMessage.success('刪除成功')
  } else {
    const data = await res.json().catch(() => ({}))
    ElMessage.error(data.error || '刪除失敗')
  }
}

function addExperience() {
  employeeForm.value.experiences.push({ unit: '', title: '', start: '', end: '' })
}
function removeExperience(i) {
  employeeForm.value.experiences.splice(i, 1)
}
function addLicense() {
  employeeForm.value.licenses.push({ name: '', number: '', startDate: '', endDate: '', fileList: [] })
}
function removeLicense(i) {
  employeeForm.value.licenses.splice(i, 1)
}
function addTraining() {
  employeeForm.value.trainings.push({
    course: '',
    courseNo: '',
    date: '',
    fileList: [],
    category: [],
    score: null
  })
}
function removeTraining(i) {
  employeeForm.value.trainings.splice(i, 1)
}

const activeEmployees = computed(() => {
  return employeeList.value.filter(emp =>
    emp.employmentStatus === '正職員工' || emp.employmentStatus === '試用期員工'
  ).length
})

function getRoleTagType(role) {
  const typeMap = {
    'admin': 'danger',
    'supervisor': 'warning',
    'employee': 'success'
  }
  return typeMap[role] || 'info'
}

function getRoleLabel(role) {
  const labelMap = {
    'admin': '管理員',
    'supervisor': '主管',
    'employee': '員工'
  }
  return labelMap[role] || role
}

function getRoleDescription(role) {
  const descMap = {
    'admin': '',
    'supervisor': '',
    'employee': ''
  }
  return descMap[role] || ''
}

function getStatusTagType(status) {
  const typeMap = {
    '正職員工': 'success',
    '試用期員工': 'warning',
    '離職員工': 'danger',
    '留職停薪': 'info'
  }
  return typeMap[status] || 'default'
}
</script>

<style scoped>
.employee-management {
  padding: 0;
}

.code-select {
  width: 100%;
}

.option-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.option-title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.option-desc {
  font-size: 12px;
  color: #64748b;
}

.sign-role-group {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

:deep(.el-radio.sign-role-radio) {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  height: auto !important;
  line-height: 1.5;
  white-space: normal;
}

:deep(.el-radio.sign-role-radio.is-checked) {
  border-color: #0284c7;
  box-shadow: 0 6px 18px rgba(2, 132, 199, 0.18);
  background: linear-gradient(135deg, rgba(14, 116, 144, 0.08), rgba(14, 116, 144, 0.02));
}

:deep(.el-radio.sign-role-radio:hover) {
  border-color: #38bdf8;
  box-shadow: 0 6px 16px rgba(14, 116, 144, 0.12);
}

:deep(.el-radio.sign-role-radio .el-radio__input) {
  margin-top: 4px;
}

:deep(.el-radio.sign-role-radio .el-radio__label) {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  white-space: normal;
}

/* 頁面標題區域 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
  color: white;
  padding: 32px;
  border-radius: 16px;
  margin-bottom: 32px;
  box-shadow: 0 4px 20px rgba(22, 78, 99, 0.3);
}

.header-content h1.page-title {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px 0;
  letter-spacing: 0.5px;
}

.page-description {
  font-size: 16px;
  opacity: 0.9;
  margin: 0;
}

.header-stats {
  display: flex;
  gap: 32px;
}

.stat-item {
  text-align: center;
}

.stat-number {
  font-size: 32px;
  font-weight: 700;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 14px;
  opacity: 0.8;
}

/* 內容標題 */
.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.content-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
  padding-left: 16px;
  border-left: 4px solid #10b981;
}

.search-input {
  flex-shrink: 0;
  width: 280px;
  margin-right: 12px;
}

.search-input :deep(.el-input__wrapper) {
  border-radius: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
}

.search-input :deep(.el-input__wrapper:hover) {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
}

.search-input :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 2px 12px rgba(16, 185, 129, 0.3);
}

.dept-filter-select {
  min-width: 200px;
  margin-right: 12px;
  flex-shrink: 0;
}

.import-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  font-weight: 600;
}

.bulk-import-dialog :deep(.el-dialog__body) {
  padding-top: 10px;
}

.bulk-import-header {
  margin-bottom: 20px;
}

.template-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 14px;
}

.template-link :deep(.el-button) {
  color: #0ea5e9;
  padding: 0;
}

.bulk-import-upload {
  margin-bottom: 24px;
}

.bulk-import-form {
  background: #f8fafc;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 24px;
}

.bulk-import-subtitle {
  font-size: 16px;
  font-weight: 600;
  margin: 16px 0 12px 0;
  color: #1f2937;
}

.bulk-import-subtitle:first-of-type {
  margin-top: 0;
}

.bulk-import-description {
  margin: 0 0 12px 0;
  color: #475569;
  font-size: 14px;
}

.bulk-import-required-alert {
  margin-bottom: 16px;
}

.bulk-import-section {
  margin-bottom: 20px;
}

.bulk-import-section:last-of-type {
  margin-bottom: 0;
}

.bulk-import-section-title {
  margin: 20px 0 8px 0;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
}

.bulk-import-section:first-of-type .bulk-import-section-title {
  margin-top: 0;
}

.bulk-import-table {
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}

.bulk-import-header-code {
  display: inline-block;
  padding: 2px 6px;
  background: #e2e8f0;
  border-radius: 4px;
  font-family: 'Fira Code', Consolas, 'Courier New', monospace;
  font-size: 13px;
  color: #1e293b;
}

.bulk-import-optional-text {
  color: #6b7280;
  font-size: 13px;
}

.bulk-import-options-title {
  margin-top: 28px;
}

.bulk-import-result {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bulk-import-error {
  background: #fff7ed;
  border-radius: 8px;
  padding: 12px 16px;
}

.error-list {
  margin: 12px 0 0 0;
  padding-left: 20px;
  color: #b45309;
}

.bulk-import-preview h4 {
  margin: 0 0 12px 0;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
}

.reference-mapping-dialog :deep(.el-dialog__body) {
  padding: 16px 20px 8px;
  background: #f8fafc;
}

.reference-mapping-tip {
  margin-bottom: 12px;
  color: #475569;
  font-size: 13px;
}

.reference-mapping-section {
  margin-bottom: 16px;
  padding: 12px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
}

.reference-mapping-title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 8px;
}

.reference-mapping-item {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  background: #fdfdfd;
  margin-bottom: 12px;
}

.reference-mapping-info {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.reference-mapping-value {
  font-weight: 600;
  color: #0f172a;
}

.reference-mapping-rows {
  font-size: 12px;
  color: #64748b;
}

.reference-mapping-mode {
  margin-bottom: 8px;
}

.reference-mapping-select {
  width: 100%;
}

.reference-mapping-empty {
  text-align: center;
  padding: 12px 0;
  color: #64748b;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
}

/* 表格樣式 */
.table-container {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.employee-table {
  width: 100%;
}

.employee-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.employee-avatar {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  font-weight: 600;
  flex-shrink: 0;
}

.employee-details {
  flex: 1;
}

.employee-name {
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 2px;
}

.employee-id {
  font-size: 12px;
  color: #64748b;
}

.department-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dept-icon {
  color: #10b981;
}

.title-tag,
.role-tag,
.status-tag {
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 4px;
}

.contact-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.contact-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #64748b;
}

.no-data {
  color: #94a3b8;
  font-style: italic;
  font-size: 12px;
}

.action-buttons {
  display: flex;
  gap: 8px;
}

.edit-btn,
.delete-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 6px;
  font-size: 12px;
}

/* 對話框樣式 */
.employee-dialog .el-dialog__body {
  padding: 0;
}

.employee-tabs {
  min-height: 600px;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.tab-content {
  padding: 32px;
  max-height: 70vh;
  overflow-y: auto;
}

/* 表單樣式 */
.form-section {
  max-width: 100%;
}

.form-group {
  background: #f8fafc;
  padding: 24px;
  border-radius: 12px;
  margin-bottom: 24px;
}

.form-group-title {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 20px 0;
  padding-left: 12px;
  border-left: 3px solid #10b981;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.full-width-item {
  grid-column: span 2;
}

.photo-upload-item {
  margin-bottom: 12px;
}

.employee-photo-upload {
  display: inline-flex;
}

.employee-photo-upload:deep(.el-upload--picture-card) {
  width: 148px;
  height: 148px;
  border-radius: 12px;
  border-color: #cbd5f5;
}

.employee-photo-upload:deep(.el-upload--picture-card:hover) {
  border-color: #10b981;
}

.employee-photo-upload:deep(.el-upload-list__item) {
  border-radius: 12px;
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 14px;
  gap: 6px;
}

.upload-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #64748b;
}

.upload-placeholder i {
  font-size: 24px;
  color: #10b981;
}

.role-radio-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.role-radio {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  margin: 0;
  transition: all 0.3s ease;
}

.role-radio:hover {
  border-color: #10b981;
  background: #f0fdf4;
}

.role-radio.is-checked {
  border-color: #10b981;
  background: #f0fdf4;
}

.role-option {
  margin-left: 8px;
}

.role-name {
  font-weight: 600;
  color: #1e293b;
}

.role-desc {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
}

.tag-select {
  width: 100%;
}

/* 緊急聯絡人 */
.emergency-contact {
  background: white;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 16px;
  border: 1px solid #e2e8f0;
}

.contact-subtitle,
.account-subtitle {
  font-size: 14px;
  font-weight: 600;
  color: #475569;
  margin: 0 0 16px 0;
  padding-left: 8px;
  border-left: 2px solid #10b981;
}

/* 經歷管理 */
.experience-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.experience-item {
  background: white;
  padding: 20px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.experience-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.experience-title {
  font-size: 14px;
  font-weight: 600;
  color: #475569;
  margin: 0;
}

.remove-btn {
  display: flex;
  align-items: center;
  gap: 4px;
}

.add-item-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

/* 銀行帳戶 */
.account-section {
  background: white;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 16px;
  border: 1px solid #e2e8f0;
}

/* 對話框底部 */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 24px 32px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}

.cancel-btn {
  padding: 10px 20px;
  border-radius: 8px;
}

.save-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 24px;
  border-radius: 8px;
  font-weight: 500;
}

/* 響應式設計 */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    text-align: center;
    gap: 20px;
  }

  .header-stats {
    gap: 20px;
  }

  .content-header {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }

  .form-row {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .tab-content {
    padding: 16px;
  }

  .employee-dialog {
    width: 95% !important;
  }
}

@media (max-width: 480px) {
  .action-buttons {
    flex-direction: column;
    gap: 4px;
  }

  .stat-number {
    font-size: 24px;
  }

  .role-radio-group {
    gap: 12px;
  }

  .role-radio {
    padding: 12px;
  }
}
</style>
