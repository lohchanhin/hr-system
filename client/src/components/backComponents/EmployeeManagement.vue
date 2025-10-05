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
          <el-button type="primary" @click="openEmployeeDialog()" class="add-btn">
            <i class="el-icon-plus"></i>
            新增員工
          </el-button>
          <el-button
            type="success"
            plain
            class="import-btn"
            data-test="bulk-import-button"
            @click="openBulkImportDialog"
          >
            <i class="el-icon-upload2"></i>
            批量匯入
          </el-button>
        </div>
      </div>

      <!-- 美化員工列表表格 -->
      <div class="table-container">
        <el-table 
          :data="employeeList" 
          class="employee-table"
          :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
          :row-style="{ height: '64px' }"
        >
          <el-table-column prop="name" label="員工資訊" min-width="200">
            <template #default="{ row }">
              <div class="employee-info">
                <el-avatar :size="40" class="employee-avatar">
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
          
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row, $index }">
              <div class="action-buttons">
                <el-button type="primary" size="small" @click="openEmployeeDialog($index)" class="edit-btn">
                  <i class="el-icon-edit"></i>
                  編輯
                </el-button>
                <el-button type="danger" size="small" @click="deleteEmployee($index)" class="delete-btn">
                  <i class="el-icon-delete"></i>
                  刪除
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 美化員工資料對話框 -->
      <el-dialog
        v-model="employeeDialogVisible"
        title="員工資料管理"
        width="1200px"
        class="employee-dialog"
      :close-on-click-modal="false"
      >
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
                    <el-select
                      v-model="employeeForm.permissionGrade"
                      placeholder="選擇職等"
                      class="code-select"
                    >
                      <el-option
                        v-for="g in PERMISSION_GRADE_OPTIONS"
                        :key="g.level"
                        :label="formatPermissionGradeLabel(g)"
                        :value="g.level"
                      >
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
                      <el-radio
                        v-for="option in SIGN_ROLE_OPTIONS"
                        :key="option.id"
                        :label="option.id"
                        class="sign-role-radio"
                      >
                        <div class="option-wrapper">
                          <div class="option-title">{{ option.id }}｜{{ option.label }}</div>
                          <div class="option-desc">{{ option.description }}</div>
                        </div>
                      </el-radio>
                    </el-radio-group>
                  </el-form-item>

                  <el-form-item label="簽核層級">
                    <el-select
                      v-model="employeeForm.signLevel"
                      placeholder="選擇層級"
                      class="code-select"
                    >
                      <el-option
                        v-for="level in SIGN_LEVEL_OPTIONS"
                        :key="level.id"
                        :label="formatSignLevelLabel(level)"
                        :value="level.id"
                      >
                        <div class="option-wrapper">
                          <div class="option-title">{{ level.id }}｜{{ level.label }}</div>
                          <div class="option-desc">{{ level.description }}</div>
                        </div>
                      </el-option>
                    </el-select>
                  </el-form-item>
                  
                  <el-form-item label="員工標籤">
                    <el-select
                      v-model="employeeForm.signTags"
                      multiple
                      filterable
                      allow-create
                      default-first-option
                      placeholder="選擇或新增標籤"
                      class="tag-select"
                    >
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
                    <el-upload
                      class="employee-photo-upload"
                      v-model:file-list="employeeForm.photoList"
                      :http-request="handlePhotoRequest"
                      :on-success="handlePhotoSuccess"
                      :on-remove="handlePhotoRemove"
                      :on-exceed="handlePhotoExceed"
                      list-type="picture-card"
                      :limit="1"
                      accept="image/*"
                      :disabled="photoUploading"
                    >
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
                    <el-select
                      v-model="employeeForm.languages"
                      multiple
                      filterable
                      placeholder="選擇語言"
                      :disabled="!languageOptions.length"
                    >
                      <el-option
                        v-for="option in languageOptions"
                        :key="option.value"
                        :label="option.label"
                        :value="option.value"
                      />
                    </el-select>
                  </el-form-item>

                  <div class="form-row">
                    <el-form-item label="身心障礙等級">
                      <el-select
                        v-model="employeeForm.disabilityLevel"
                        placeholder="選擇等級"
                        clearable
                        :disabled="!disabilityLevelOptions.length"
                      >
                        <el-option
                          v-for="option in disabilityLevelOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="身分註記">
                      <el-select
                        v-model="employeeForm.identityCategory"
                        multiple
                        filterable
                        collapse-tags
                        placeholder="選擇身份別"
                        :disabled="!identityCategoryOptions.length"
                      >
                        <el-option
                          v-for="option in identityCategoryOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
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
                        <el-option
                          v-for="dept in filteredDepartments"
                          :key="dept._id"
                          :label="dept.name"
                          :value="dept._id"
                        />
                      </el-select>
                    </el-form-item>
                  </div>
                  
                  <div class="form-row">
                    <el-form-item label="小單位">
                      <el-select v-model="employeeForm.subDepartment" placeholder="選擇小單位">
                        <el-option
                          v-for="sd in filteredSubDepartments"
                          :key="sd._id"
                          :label="sd.name"
                          :value="sd._id"
                        />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="直屬主管">
                      <el-select v-model="employeeForm.supervisor" placeholder="選擇主管">
                        <el-option
                          v-for="sup in supervisorList"
                          :key="sup._id"
                          :label="sup.name"
                          :value="sup._id"
                        />
                      </el-select>
                    </el-form-item>
                  </div>
                </div>

                <div class="form-group">
                  <h3 class="form-group-title">職務資訊</h3>
                  <div class="form-row">
                    <el-form-item label="職稱">
                      <el-select
                        v-model="employeeForm.title"
                        placeholder="選擇職稱"
                        :disabled="!titleOptions.length"
                      >
                        <el-option
                          v-for="option in titleOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="執業職稱">
                      <el-select
                        v-model="employeeForm.practiceTitle"
                        placeholder="選擇執業職稱"
                        :disabled="!practiceTitleOptions.length"
                      >
                        <el-option
                          v-for="option in practiceTitleOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
                      </el-select>
                    </el-form-item>
                  </div>
                  
                  <div class="form-row">
                    <el-form-item label="兼職人員">
                      <el-switch 
                        v-model="employeeForm.isPartTime" 
                        active-text="是" 
                        inactive-text="否"
                        active-color="#10b981"
                      />
                    </el-form-item>
                    <el-form-item label="需要打卡">
                      <el-switch 
                        v-model="employeeForm.isClocking" 
                        active-text="是" 
                        inactive-text="否"
                        active-color="#10b981"
                      />
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
                      <el-input
                        v-model="employeeForm.employmentNote"
                        type="textarea"
                        :rows="2"
                        placeholder="請輸入聘任備註"
                      />
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
                      <el-input-number
                        v-model="employeeForm.height"
                        :min="0"
                        :max="250"
                        :step="0.1"
                        :precision="1"
                        :value-on-clear="null"
                        controls-position="right"
                        placeholder="請輸入身高"
                      />
                    </el-form-item>
                    <el-form-item label="體重 (kg)">
                      <el-input-number
                        v-model="employeeForm.weight"
                        :min="0"
                        :max="300"
                        :step="0.1"
                        :precision="1"
                        :value-on-clear="null"
                        controls-position="right"
                        placeholder="請輸入體重"
                      />
                    </el-form-item>
                  </div>
                  <div class="form-row">
                    <el-form-item label="體檢血型">
                      <el-select v-model="employeeForm.medicalBloodType" placeholder="選擇血型" clearable>
                        <el-option
                          v-for="blood in ABO_TYPES"
                          :key="`medical-${blood}`"
                          :label="blood"
                          :value="blood"
                        />
                      </el-select>
                    </el-form-item>
                  </div>
                </div>

                <!-- 學歷資訊 -->
                <div class="form-group">
                  <h3 class="form-group-title">學歷資訊</h3>
                  <div class="form-row">
                    <el-form-item label="教育程度">
                      <el-select
                        v-model="employeeForm.educationLevel"
                        placeholder="選擇教育程度"
                        :disabled="!educationLevelOptions.length"
                      >
                        <el-option
                          v-for="option in educationLevelOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
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
                      <el-select
                        v-model="employeeForm.graduationStatus"
                        placeholder="選擇畢業狀態"
                        clearable
                        @clear="onGraduationStatusClear"
                        :disabled="!graduationStatusOptions.length"
                      >
                        <el-option
                          v-for="option in graduationStatusOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
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
                      <el-select
                        v-model="employeeForm.serviceType"
                        placeholder="選擇或輸入役別類型"
                        filterable
                        allow-create
                        default-first-option
                        clearable
                      >
                        <el-option
                          v-for="type in SERVICE_TYPES"
                          :key="type"
                          :label="type"
                          :value="type"
                        />
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
                      <el-input-number
                        v-model="employeeForm.dischargeYear"
                        :min="1900"
                        :max="CURRENT_YEAR + 10"
                        :step="1"
                        :value-on-clear="null"
                        controls-position="right"
                        placeholder="請輸入退伍年"
                      />
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
                        <el-option
                          v-for="option in relationOptions"
                          :key="`r1-${option.value}`"
                          :label="option.label"
                          :value="option.value"
                        />
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
                        <el-option
                          v-for="option in relationOptions"
                          :key="`r2-${option.value}`"
                          :label="option.label"
                          :value="option.value"
                        />
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
                    <div
                      v-for="(exp, i) in employeeForm.experiences"
                      :key="i"
                      class="experience-item"
                    >
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
                    <div
                      v-for="(license, i) in employeeForm.licenses"
                      :key="`license-${i}`"
                      class="experience-item"
                    >
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
                          <el-upload
                            v-model:file-list="license.fileList"
                            action="#"
                            multiple
                            list-type="text"
                            :http-request="handleAttachmentRequest"
                            :on-success="(res, file, fileList) => handleAttachmentSuccess('licenses', i, res, file, fileList)"
                            :on-remove="(file, fileList) => handleAttachmentRemove('licenses', i, file, fileList)"
                          >
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
                    <div
                      v-for="(training, i) in employeeForm.trainings"
                      :key="`training-${i}`"
                      class="experience-item"
                    >
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
                          <el-select
                            v-model="training.category"
                            multiple
                            collapse-tags
                            placeholder="選擇積分類別"
                          >
                            <el-option
                              v-for="option in creditCategoryOptions"
                              :key="option.value"
                              :label="option.label"
                              :value="option.value"
                            />
                          </el-select>
                        </el-form-item>
                      </div>
                      <div class="form-row">
                        <el-form-item label="積分">
                          <el-input-number
                            v-model="training.score"
                            :min="0"
                            :step="0.5"
                            :value-on-clear="null"
                          />
                        </el-form-item>
                        <el-form-item label="訓練檔案" class="full-width-item">
                          <el-upload
                            v-model:file-list="training.fileList"
                            action="#"
                            multiple
                            list-type="text"
                            :http-request="handleAttachmentRequest"
                            :on-success="(res, file, fileList) => handleAttachmentSuccess('trainings', i, res, file, fileList)"
                            :on-remove="(file, fileList) => handleAttachmentRemove('trainings', i, file, fileList)"
                          >
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
                      <el-input-number
                        v-model="employeeForm.salaryAmount"
                        :min="0"
                        :step="1000"
                        :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                        :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')"
                      />
                    </el-form-item>
                    <el-form-item label="勞退自提" prop="laborPensionSelf">
                      <el-input-number
                        v-model="employeeForm.laborPensionSelf"
                        :min="0"
                        :step="100"
                        :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                        :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')"
                      />
                    </el-form-item>
                    <el-form-item label="員工預支" prop="employeeAdvance">
                      <el-input-number
                        v-model="employeeForm.employeeAdvance"
                        :min="0"
                        :step="100"
                        :formatter="value => `$ ${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                        :parser="value => (value ? value.replace(/\$\s?|(,*)/g, '') : '')"
                      />
                    </el-form-item>
                    <el-form-item class="full-width-item" label="薪資項目" prop="salaryItems">
                      <el-select
                        v-model="employeeForm.salaryItems"
                        multiple
                        collapse-tags
                        collapse-tags-tooltip
                        placeholder="選擇薪資項目"
                      >
                        <el-option
                          v-for="item in salaryItemOptions"
                          :key="item.value"
                          :label="item.label"
                          :value="item.value"
                        />
                      </el-select>
                    </el-form-item>
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

      <el-dialog
        v-model="bulkImportDialogVisible"
        title="批量匯入員工"
        width="720px"
        class="bulk-import-dialog"
        :close-on-click-modal="false"
      >
        <div class="bulk-import-header">
          <el-alert type="info" show-icon :closable="false">
            <template #title>
              下載範本後依欄位填寫資料，再上傳 Excel 以進行匯入。
            </template>
            <div class="template-link">
              <i class="el-icon-document"></i>
              <el-button
                type="primary"
                link
                data-test="bulk-import-template-download"
                @click="downloadBulkImportTemplate"
              >
                下載匯入範本
              </el-button>
            </div>
          </el-alert>
        </div>

        <div class="bulk-import-upload">
          <el-upload
            drag
            action=""
            :auto-upload="false"
            accept=".xlsx,.xls,.csv"
            :file-list="bulkImportUploadFileList"
            :limit="1"
            :on-change="handleBulkImportFileChange"
            :on-remove="handleBulkImportFileRemove"
          >
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

          <section
            v-for="section in bulkImportTemplateSections"
            :key="section.title"
            class="bulk-import-section"
          >
            <h4 class="bulk-import-section-title">{{ section.title }}</h4>
            <el-table :data="section.fields" border size="small" class="bulk-import-table">
              <el-table-column prop="header" label="Excel 欄位 (英文)" width="220">
                <template #default="{ row }">
                  <code class="bulk-import-header-code">{{ row.header }}</code>
                </template>
              </el-table-column>
              <el-table-column prop="description" label="欄位說明" min-width="300" />
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
                <el-option
                  v-for="role in ROLE_OPTIONS"
                  :key="role.value"
                  :label="role.label"
                  :value="role.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="預設登入密碼">
              <el-input
                v-model="bulkImportForm.options.resetPassword"
                type="password"
                show-password
                placeholder="未設定則由後端自動產生"
              />
            </el-form-item>
            <el-form-item label="寄發通知信">
              <el-switch v-model="bulkImportForm.options.sendWelcomeEmail" />
            </el-form-item>
          </el-form>
        </div>

        <div class="bulk-import-result" v-if="bulkImportPreview.length || bulkImportErrors.length">
          <el-alert
            v-if="bulkImportErrors.length"
            type="warning"
            :closable="false"
            show-icon
            class="bulk-import-error"
          >
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
          <el-button @click="bulkImportDialogVisible = false">取消</el-button>
          <el-button
            type="primary"
            :loading="bulkImportLoading"
            :disabled="!isBulkImportReady || bulkImportLoading"
            @click="submitBulkImport"
          >
            開始匯入
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
const BULK_IMPORT_REQUIRED_FIELDS = BULK_IMPORT_FIELD_CONFIGS.filter(item => item.required).map(
  item => item.key
)
const DEFAULT_BULK_IMPORT_COLUMN_MAPPINGS = Object.freeze(
  BULK_IMPORT_FIELD_CONFIGS.reduce((acc, field) => {
    acc[field.key] = field.header
    return acc
  }, {})
)
const bulkImportFieldConfigs = BULK_IMPORT_FIELD_CONFIGS
const BULK_IMPORT_TEMPLATE_FILENAME = 'employee-import-template.csv'
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

const bulkImportTemplateSections = computed(() => {
  const groups = new Map()
  bulkImportFieldConfigs.forEach(field => {
    const group = field.category || '其他欄位'
    if (!groups.has(group)) {
      groups.set(group, [])
    }
    groups.get(group).push(field)
  })
  return Array.from(groups.entries()).map(([title, fields]) => ({ title, fields }))
})

const bulkImportRequiredFieldNames = computed(() =>
  bulkImportFieldConfigs
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
  const headerRow = bulkImportFieldConfigs.map(config => config.header || config.key)
  const descriptionRow = bulkImportFieldConfigs.map(
    config => config.description || config.label || config.header || config.key
  )
  const rows = [headerRow, descriptionRow]
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
const CURRENT_YEAR = new Date().getFullYear()

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
        url: file.url || responseUrl || '',
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
    const dataUrl = await readFileAsDataUrl(file)
    onSuccess?.({ url: dataUrl })
  } catch (err) {
    onError?.(err)
    ElMessage.error('照片載入失敗，請重新選擇檔案')
  } finally {
    photoUploading.value = false
  }
}

function handlePhotoSuccess(response, uploadFile, uploadFiles) {
  if (!uploadFile.url) {
    if (typeof response === 'string') uploadFile.url = response
    else if (response && typeof response === 'object') {
      uploadFile.url = response.url || response?.data?.url || uploadFile.url || ''
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
        salaryItems: filterValidSalaryItems(e?.salaryItems),
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
        )
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
  salaryItems: []
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

watch(bulkImportDialogVisible, visible => {
  if (!visible) {
    resetBulkImportState()
  }
})

watch(
  () => employeeForm.value.department,
  async dept => {
    if (dept) {
      await fetchSubDepartments(dept)
    } else {
      subDepartmentList.value = []
    }
    employeeForm.value.subDepartment = ''
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
    } else if (!areArraysShallowEqual(current, rawArray)) {
      employeeForm.value.salaryItems = current
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
    } else if (!areArraysShallowEqual(current, rawArray)) {
      employeeForm.value.salaryItems = current
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

function resetBulkImportState({ resetMappings = true } = {}) {
  bulkImportLoading.value = false
  bulkImportFile.value = null
  bulkImportUploadFileList.value = []
  bulkImportPreview.value = []
  bulkImportErrors.value = []
  if (resetMappings) {
    Object.keys(bulkImportForm.columnMappings).forEach(key => {
      if (!(key in DEFAULT_BULK_IMPORT_COLUMN_MAPPINGS)) {
        delete bulkImportForm.columnMappings[key]
      }
    })
    Object.entries(DEFAULT_BULK_IMPORT_COLUMN_MAPPINGS).forEach(([key, header]) => {
      bulkImportForm.columnMappings[key] = header
    })
    bulkImportForm.options.defaultRole = defaultBulkImportRole
    bulkImportForm.options.resetPassword = ''
    bulkImportForm.options.sendWelcomeEmail = false
  }
}

function handleBulkImportFileChange(uploadFile) {
  if (uploadFile?.raw) {
    bulkImportFile.value = uploadFile.raw
    bulkImportUploadFileList.value = [uploadFile]
    bulkImportPreview.value = []
    bulkImportErrors.value = []
  }
}

function handleBulkImportFileRemove() {
  bulkImportFile.value = null
  bulkImportUploadFileList.value = []
  bulkImportPreview.value = []
  bulkImportErrors.value = []
}

async function submitBulkImport() {
  if (!bulkImportFile.value) {
    ElMessage.warning('請先選擇要匯入的檔案')
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

    const res = await importEmployeesBulk(formData)
    let payload = {}
    try {
      payload = await res.json()
    } catch (error) {
      payload = {}
    }

    if (!res.ok) {
      bulkImportErrors.value = Array.isArray(payload?.errors) ? payload.errors : []
      const message = payload?.message || payload?.error || '批量匯入失敗，請稍後再試'
      throw new Error(message)
    }

    bulkImportPreview.value = Array.isArray(payload?.preview) ? payload.preview : []
    bulkImportErrors.value = Array.isArray(payload?.errors) ? payload.errors : []

    if (bulkImportErrors.value.length) {
      ElMessage.warning('匯入完成，但有部分資料需要檢查')
    } else {
      ElMessage.success('匯入成功')
    }

    await fetchEmployees()
    if (!bulkImportErrors.value.length) {
      bulkImportDialogVisible.value = false
    }
  } catch (error) {
    const message = error?.message || '批量匯入失敗，請稍後再試'
    ElMessage.error(message)
  } finally {
    bulkImportLoading.value = false
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
  const normalizedPhotoList = extractPhotoUrls(form.photoList)
  if (normalizedPhotoList.length) {
    payload.photoList = normalizedPhotoList
    payload.photo = normalizedPhotoList[0]
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
  const res = await apiFetch(`/api/employees/${emp._id}`, {
    method: 'DELETE'
  })
  if (res.ok) employeeList.value.splice(index, 1)
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

.sign-role-radio {
  align-items: flex-start;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.sign-role-radio:hover {
  border-color: #38bdf8;
  box-shadow: 0 6px 16px rgba(14, 116, 144, 0.12);
}

.sign-role-radio :deep(.el-radio__label) {
  width: 100%;
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

.title-tag, .role-tag, .status-tag {
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

.edit-btn, .delete-btn {
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

.contact-subtitle, .account-subtitle {
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
