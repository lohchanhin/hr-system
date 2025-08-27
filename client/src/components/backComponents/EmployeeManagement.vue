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
        <el-button type="primary" @click="openEmployeeDialog()" class="add-btn">
          <i class="el-icon-plus"></i>
          新增員工
        </el-button>
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
                {{ row.title }}
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
              <el-form :model="employeeForm" label-width="140px" class="form-section">
                <div class="form-group">
                  <h3 class="form-group-title">登入資訊</h3>
                  <el-form-item label="登入帳號" required>
                    <el-input v-model="employeeForm.username" placeholder="請輸入登入帳號" />
                  </el-form-item>
                  <el-form-item label="登入密碼" required>
                    <el-input v-model="employeeForm.password" type="password" placeholder="請輸入密碼" show-password />
                  </el-form-item>
                </div>
                
                <div class="form-group">
                  <h3 class="form-group-title">權限設定</h3>
                  <el-form-item label="系統權限" required>
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
                    <el-select v-model="employeeForm.permissionGrade" placeholder="選擇職等">
                      <el-option v-for="g in PERMISSION_GRADE_OPTIONS" :key="g" :label="g" :value="g" />
                    </el-select>
                  </el-form-item>
                </div>
              </el-form>
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
              <el-form :model="employeeForm" label-width="140px" class="form-section">
                <div class="form-group">
                  <h3 class="form-group-title">簽核權限</h3>
                  <el-form-item label="簽核角色">
                    <el-select v-model="employeeForm.signRole" placeholder="選擇簽核角色">
                      <el-option v-for="o in SIGN_ROLES" :key="o" :label="o" :value="o" />
                    </el-select>
                  </el-form-item>
                  
                  <el-form-item label="簽核層級">
                    <el-select v-model="employeeForm.signLevel" placeholder="選擇層級">
                      <el-option v-for="l in SIGN_LEVELS" :key="l" :label="l" :value="l" />
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
              </el-form>
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
              <el-form :model="employeeForm" label-width="140px" class="form-section">
                <div class="form-group">
                  <h3 class="form-group-title">基本資料</h3>
                  <div class="form-row">
                    <el-form-item label="員工編號">
                      <el-input v-model="employeeForm.employeeNo" placeholder="請輸入員工編號" />
                    </el-form-item>
                    <el-form-item label="員工姓名" required>
                      <el-input v-model="employeeForm.name" placeholder="請輸入員工姓名" />
                    </el-form-item>
                  </div>
                  
                  <div class="form-row">
                    <el-form-item label="性別">
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
                    <el-select v-model="employeeForm.languages" multiple filterable placeholder="選擇語言">
                      <el-option v-for="lan in LANGUAGE_OPTIONS" :key="lan" :label="lan" :value="lan" />
                    </el-select>
                  </el-form-item>
                  
                  <el-form-item label="扶養人數">
                    <el-input-number v-model="employeeForm.dependents" :min="0" />
                  </el-form-item>
                </div>

                <div class="form-group">
                  <h3 class="form-group-title">聯絡資訊</h3>
                  <div class="form-row">
                    <el-form-item label="Email">
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
              </el-form>
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
              <el-form :model="employeeForm" label-width="140px" class="form-section">
                <div class="form-group">
                  <h3 class="form-group-title">組織架構</h3>
                  <div class="form-row">
                    <el-form-item label="所屬機構" required>
                      <el-select v-model="employeeForm.organization" placeholder="選擇機構">
                        <el-option v-for="org in orgList" :key="org._id" :label="org.name" :value="org._id" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="所屬部門" required>
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
                      <el-select v-model="employeeForm.title" placeholder="選擇職稱">
                        <el-option v-for="t in TITLE_OPTIONS" :key="t" :label="t" :value="t" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="執業職稱">
                      <el-select v-model="employeeForm.practiceTitle" placeholder="選擇執業職稱">
                        <el-option v-for="t in PRACTICE_TITLE_OPTIONS" :key="t" :label="t" :value="t" />
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
                    <el-form-item label="離職日期">
                      <el-date-picker v-model="employeeForm.resignDate" type="date" placeholder="選擇離職日期" />
                    </el-form-item>
                  </div>
                </div>
              </el-form>
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
              <el-form :model="employeeForm" label-width="140px" class="form-section">
                <!-- 學歷資訊 -->
                <div class="form-group">
                  <h3 class="form-group-title">學歷資訊</h3>
                  <div class="form-row">
                    <el-form-item label="教育程度">
                      <el-select v-model="employeeForm.educationLevel" placeholder="選擇教育程度">
                        <el-option v-for="e in EDUCATION_LEVELS" :key="e" :label="e" :value="e" />
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
                    <el-form-item label="畢業年度">
                      <el-input v-model="employeeForm.graduationYear" placeholder="請輸入畢業年度" />
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
                          <el-option v-for="r in RELATION_OPTIONS" :key="'r1-'+r" :label="r" :value="r" />
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
                          <el-option v-for="r in RELATION_OPTIONS" :key="'r2-'+r" :label="r" :value="r" />
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
              </el-form>
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
              <el-form :model="employeeForm" label-width="160px" class="form-section">
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
                        :formatter="value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                        :parser="value => value.replace(/\$\s?|(,*)/g, '')"
                      />
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
              </el-form>
            </div>
          </el-tab-pane>
        </el-tabs>

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
    </div>
  </el-tab-pane>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { apiFetch } from '../../api'

const router = useRouter()

/* 下拉選單選項：可改由後端「後臺控制 C0x」提供 ------------------------------ */
const ROLE_OPTIONS = [
  { label: '管理員', value: 'admin' },
  { label: '主管', value: 'supervisor' },
  { label: '員工', value: 'employee' },
]
const PERMISSION_GRADE_OPTIONS = ['一級', '二級', '三級']          // 權限/職等(不可控僅示意)
const TITLE_OPTIONS = ['護理師', '照顧服務員', '社工師', '物理治療師', '職能治療師', '行政人員'] // C03
const PRACTICE_TITLE_OPTIONS = ['護理師', '社工師', '物理治療師', '職能治療師', '醫師']        // C04
const LANGUAGE_OPTIONS = ['中文', '台語', '客語', '英語', '馬來語']                               // C05
const DISABILITY_LEVELS = ['極重度', '重度身心障礙', '中度身心障礙', '輕度身心障礙']             // C06
const IDENTITY_FLAGS = ['原住民', '新住民', '榮民']                                               // C07
const EDUCATION_LEVELS = ['博士', '碩士', '大學', '專科', '高中職', '國中以下']                   // C08
const RELATION_OPTIONS = ['父', '母', '配偶', '子', '女', '兄', '姊', '弟', '妹', '其他']         // C09
const CREDIT_CATEGORIES = ['院內', '院外', '線上', '研討會', '自學']                               // C10
const SALARY_TYPES = ['月薪', '日薪', '時薪']
const SALARY_ITEM_OPTIONS = ['本薪', '全勤', '加班費', '交通津貼', '伙食津貼', '績效獎金']
const SIGN_ROLES = ['填報', '覆核', '審核', '核定']                                              // 簽核角色
const SIGN_LEVELS = ['L1', 'L2', 'L3', 'L4']                                                     // 簽核層級
const DEFAULT_TAGS = ['資深', '新人', '外聘', '志工']
const ABO_TYPES = ['A', 'B', 'O', 'AB', 'HR']                                                   // 依你的表格式

/* 狀態 --------------------------------------------------------------------- */
const employeeDialogTab = ref('account')
const employeeList = ref([])
const departmentList = ref([])
const subDepartmentList = ref([])
const orgList = ref([])
const employeeDialogVisible = ref(false)
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

/* 取資料 ------------------------------------------------------------------- */
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
    employeeList.value = list.map(e => ({
      ...e,
      organization: e.organization?._id || e.organization || '',
      department: e.department?._id || e.department || '',
      subDepartment: e.subDepartment?._id || e.subDepartment || ''
    }))
  }
}
onMounted(() => {
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
  height: '',
  weight: '',
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
  dischargeYear: '',

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

/* 事件 --------------------------------------------------------------------- */
async function openEmployeeDialog(index = null) {
  if (index !== null) {
    editEmployeeIndex = index
    const emp = employeeList.value[index]
    editEmployeeId = emp._id || ''
    // 以 emptyEmployee 為基底，可避免漏欄位
    employeeForm.value = { ...structuredClone(emptyEmployee), ...emp, password: '', photoList: [] }
    employeeForm.value.department = emp.department?._id || emp.department || ''
    employeeForm.value.subDepartment = emp.subDepartment?._id || emp.subDepartment || ''
  } else {
    editEmployeeIndex = null
    editEmployeeId = ''
    employeeDialogTab.value = 'account'
    employeeForm.value = { ...structuredClone(emptyEmployee) }
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
  if (!employeeForm.value.name || !employeeForm.value.username) {
    alert('請填寫姓名與帳號')
    return
  }
  const payload = { ...employeeForm.value }
  if (payload.supervisor === '' || payload.supervisor === null) delete payload.supervisor

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
  employeeForm.value.trainings.push({ course: '', courseNo: '', date: '', fileList: [], category: '', score: '' })
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

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
  padding-left: 16px;
  border-left: 4px solid #10b981;
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
