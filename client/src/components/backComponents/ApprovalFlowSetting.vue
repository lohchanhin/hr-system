<!-- src/Components/backComponents/ApprovalFlowSetting.vue -->
<template>
  <div ref="rootEl" class="approval-flow-setting">
    <PageHeader title="簽核流程設定" subtitle="每張表單有自己的欄位與簽核關卡；先選一張表單，再設定它的關卡與欄位">
      <template #stats>
        <span class="hr-stat"><span class="hr-stat__label">表單</span><strong class="hr-stat__value">{{ forms.length }}</strong></span>
        <span class="hr-stat"><span class="hr-stat__label">啟用中</span><strong class="hr-stat__value">{{ activeFormCount }}</strong></span>
      </template>
      <template #actions>
        <el-button type="primary" data-test="add-form" @click="openFormDialog()">新增表單</el-button>
      </template>
    </PageHeader>

    <el-tabs v-model="mainTab" class="flow-tabs">
      <!-- 1) 表單：清單 → 選一張進去設定它的關卡與欄位 -->
      <el-tab-pane label="表單" name="forms">
        <!-- 表單清單 -->
        <div v-if="!selectedFormId" class="form-list" data-test="form-list">
          <div class="hr-toolbar">
            <el-input v-model="formKeyword" placeholder="搜尋表單名稱" clearable class="form-search" data-test="form-search" />
            <span class="hr-toolbar__spacer" />
            <el-button :loading="restoringDefaults" data-test="restore-defaults" @click="restoreDefaults">補齊預設表單</el-button>
          </div>

          <!-- 補齊預設表單之後的檢查報告：預設表單需要哪些標籤、現在有幾位在職員工持有 -->
          <div v-if="restoreReport" class="restore-report" data-test="restore-report">
            <el-alert
              :title="restoreReport.title"
              :type="restoreReport.warnings.length ? 'warning' : 'success'"
              show-icon
              @close="restoreReport = null"
            >
              <template v-if="restoreReport.warnings.length">
                <p class="restore-report-lead" data-test="restore-report-lead">{{ restoreReport.lead }}</p>
                <ul class="restore-report-list">
                  <li v-for="(warning, index) in restoreReport.warnings" :key="`${warning.formId}-${warning.step}-${index}`">{{ warning.message }}</li>
                </ul>
              </template>
              <p v-else class="restore-report-lead">所有預設表單需要的簽核標籤都已有在職員工持有。</p>
            </el-alert>
            <div v-if="restoreReport.templates.length" class="restore-report-tags">
              <div v-for="item in restoreReport.templates" :key="item.key" class="restore-report-row">
                <span class="restore-report-name">{{ item.name }}</span>
                <span v-if="!item.requiredTags.length" class="restore-report-muted">不需要簽核標籤</span>
                <el-tag
                  v-for="tag in item.requiredTags"
                  :key="`${item.key}-${tag.step}-${tag.tag}`"
                  size="small"
                  :type="tag.holders === 0 && tag.required ? 'warning' : 'info'"
                  class="restore-report-tag"
                >{{ tag.tag }}（{{ tag.holders === null ? '人數未知' : `${tag.holders} 人` }}）</el-tag>
              </div>
            </div>
          </div>

          <el-table :data="filteredForms" class="form-table" row-key="_id" data-test="form-table" @row-click="handleFormRowClick">
            <el-table-column label="表單名稱" min-width="180">
              <template #default="{ row }">
                <span class="form-name">{{ row.name }}</span>
                <div v-if="row.description" class="hr-hint form-desc">{{ row.description }}</div>
              </template>
            </el-table-column>
            <el-table-column label="分類" width="110">
              <template #default="{ row }">
                {{ categoryNameMap[row.category] || (row.category || '未分類') }}
              </template>
            </el-table-column>
            <el-table-column label="狀態" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.is_active !== false ? 'success' : 'info'">{{ row.is_active !== false ? '啟用' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="簽核流程" min-width="260">
              <template #default="{ row }">
                <span :class="['flow-summary', { 'flow-summary--warn': flowSummary(row).warn }]" data-test="form-flow-summary">{{ flowSummary(row).text }}</span>
              </template>
            </el-table-column>
            <el-table-column label="欄位" width="90">
              <template #default="{ row }">
                <span data-test="form-field-count">{{ fieldCountText(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="240" :fixed="isMobile ? false : 'right'">
              <template #default="{ row }">
                <!-- 列上的操作全站都用文字按鈕（和員工管理、機構與部門設定相同） -->
                <el-button link type="primary" data-test="form-open-steps" @click.stop="openFormEditor(row)">設定關卡</el-button>
                <el-button link type="primary" data-test="form-open-fields" @click.stop="openFormEditor(row, 'fields')">設定欄位</el-button>
                <el-dropdown trigger="click" class="form-more" @command="(command) => handleFormCommand(command, row)">
                  <el-button link type="primary" data-test="form-more" @click.stop>更多</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="edit">編輯名稱與分類</el-dropdown-item>
                      <el-dropdown-item command="trial">流程試算</el-dropdown-item>
                      <el-dropdown-item command="toggle">{{ row.is_active !== false ? '停用' : '啟用' }}</el-dropdown-item>
                      <el-dropdown-item command="delete" divided>刪除</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
            </el-table-column>
            <template #empty>
              <span class="hr-empty" data-test="form-list-empty">{{ formListEmptyText }}</span>
            </template>
          </el-table>
        </div>

        <!-- 一張表單的設定：簽核關卡、欄位 -->
        <div v-else class="form-editor" data-test="form-editor">
          <div class="editor-head">
            <el-button link type="primary" class="editor-back" data-test="back-to-list" @click="closeEditor">← 返回表單清單</el-button>
            <div class="editor-title">
              <h2 class="editor-name" data-test="editor-form-name">{{ selectedForm?.name || '表單' }}</h2>
              <el-tag v-if="selectedForm" size="small" type="info">{{ categoryNameMap[selectedForm.category] || selectedForm.category || '未分類' }}</el-tag>
              <el-tag v-if="selectedForm" size="small" :type="selectedForm.is_active !== false ? 'success' : 'info'">{{ selectedForm.is_active !== false ? '啟用' : '停用' }}</el-tag>
              <el-tag v-if="selectedFormIsLeave" size="small" type="warning">請假表單</el-tag>
            </div>
            <span class="hr-toolbar__spacer" />
            <el-button data-test="editor-trial" @click="openTrialFor(selectedForm)">流程試算</el-button>
            <el-button data-test="editor-edit-form" @click="openFormDialog('edit')">編輯</el-button>
            <el-button type="danger" plain data-test="editor-delete-form" @click="removeForm()">刪除</el-button>
          </div>

          <el-tabs v-model="editorTab" class="editor-tabs">
            <el-tab-pane :label="stepTabLabel" name="approvalLevels">
              <div class="steps-pane" data-test="steps-pane">
                <div v-if="!workflowLoaded" class="hr-empty" data-test="steps-not-loaded">
                  <span>{{ workflowLoading ? '載入關卡中…' : '簽核關卡沒有成功載入，為避免覆蓋已儲存的設定，目前不能編輯。' }}</span>
                  <el-button v-if="!workflowLoading" size="small" class="reload-button" data-test="steps-reload" @click="reloadWorkflow(true)">重新載入</el-button>
                </div>
                <template v-else>
                  <p v-if="!workflowSteps.length" class="hr-empty" data-test="steps-empty">這張表單還沒有簽核關卡，員工無法送出申請；請按下方的「新增關卡」</p>
                  <ol class="step-list">
                    <li
                      v-for="(row, index) in workflowSteps"
                      :key="index"
                      :class="['step-card', { 'step-card--error': stepErrorText(index) }]"
                      data-test="step-card"
                    >
                      <div class="step-head">
                        <span class="step-no">第 {{ index + 1 }} 關</span>
                        <span class="hr-toolbar__spacer" />
                        <el-button size="small" :disabled="index === 0" data-test="step-up" @click="moveStep(index, -1)">上移</el-button>
                        <el-button size="small" :disabled="index === workflowSteps.length - 1" data-test="step-down" @click="moveStep(index, 1)">下移</el-button>
                        <el-button size="small" type="danger" plain data-test="step-remove" @click="removeStep(index)">刪除</el-button>
                      </div>

                      <!-- 誰來簽：一句話讀得懂；不適用於這種簽核類型的設定不顯示 -->
                      <div class="step-line">
                        <span class="step-word">由</span>
                        <el-select
                          v-model="row.approver_type"
                          placeholder="選擇類型"
                          class="step-type"
                          data-test="step-type"
                          @change="handleApproverTypeChange(row)"
                        >
                          <el-option v-for="t in APPROVER_TYPES" :key="t.value" :label="t.optionLabel" :value="t.value" />
                        </el-select>

                        <template v-if="row.approver_type === 'user'">
                          <el-select
                            v-model="row.approver_value"
                            placeholder="輸入姓名搜尋員工"
                            multiple
                            filterable
                            class="step-value step-value--wide"
                            :filter-method="(text) => setOptionQuery(`step-${index}`, text)"
                            @visible-change="(open) => handleOptionVisible(`step-${index}`, open)"
                          >
                            <el-option
                              v-for="e in userOptionsFor(row, `step-${index}`)"
                              :key="e.value"
                              :label="e.label"
                              :value="e.value"
                              :disabled="e.disabled"
                            />
                          </el-select>
                          <span class="step-word">簽核</span>
                        </template>
                        <template v-else-if="row.approver_type === 'manager'">
                          <el-select
                            v-model="row.approver_value"
                            placeholder="選擇主管"
                            filterable
                            class="step-value"
                            :filter-method="(text) => setOptionQuery(`step-${index}`, text)"
                            @visible-change="(open) => handleOptionVisible(`step-${index}`, open)"
                          >
                            <el-option
                              v-for="m in managerOptionsFor(row, `step-${index}`)"
                              :key="m.value"
                              :label="m.label"
                              :value="m.value"
                              :disabled="m.disabled"
                            />
                          </el-select>
                          <span class="step-word">簽核</span>
                        </template>
                        <!-- 主管鏈：從直屬主管一路往上，簽到持有標籤的主管為止（不選＝到最上層），最多幾級 -->
                        <div v-else-if="row.approver_type === 'manager_chain' && row.approver_value && typeof row.approver_value === 'object'" class="chain-config" data-test="chain-config">
                          <span class="step-word">從直屬主管往上，簽到持有</span>
                          <el-select
                            v-model="row.approver_value.stopAtTag"
                            placeholder="不選＝簽到最上層"
                            filterable
                            allow-create
                            default-first-option
                            clearable
                            class="step-value"
                            data-test="chain-stop-tag"
                            @change="handleChainChange(row)"
                          >
                            <el-option v-for="tag in tagOptions" :key="tag.value" :label="tag.label" :value="tag.value" />
                          </el-select>
                          <span class="step-word">標籤的主管為止，最多</span>
                          <el-input-number
                            v-model="row.approver_value.maxLevels"
                            :min="1"
                            :max="MANAGER_CHAIN_MAX_LEVELS"
                            size="small"
                            class="step-number"
                            data-test="chain-max-levels"
                            @change="handleChainChange(row)"
                          />
                          <span class="step-word">級主管</span>
                        </div>
                        <template v-else-if="row.approver_type === 'tag'">
                          <span class="step-word">持有</span>
                          <el-select
                            v-model="row.approver_value"
                            placeholder="選擇或輸入標籤"
                            filterable
                            allow-create
                            default-first-option
                            clearable
                            class="step-value"
                            @change="handleTagChange(row)"
                          >
                            <el-option v-for="tag in tagOptions" :key="tag.value" :label="tag.label" :value="tag.value" />
                          </el-select>
                          <span class="step-word">標籤的人簽核</span>
                        </template>
                        <template v-else-if="row.approver_type === 'role'">
                          <el-select
                            v-model="row.approver_value"
                            placeholder="選擇角色"
                            filterable
                            clearable
                            class="step-value"
                          >
                            <el-option
                              v-for="r in roleOptionsFor(row)"
                              :key="r.value"
                              :label="r.label"
                              :value="r.value"
                              :disabled="r.disabled"
                            />
                          </el-select>
                          <span class="step-word">的人簽核</span>
                        </template>
                        <template v-else-if="row.approver_type === 'level'">
                          <el-select
                            v-model="row.approver_value"
                            placeholder="選擇層級"
                            clearable
                            class="step-value"
                          >
                            <el-option
                              v-for="lvl in levelOptionsFor(row)"
                              :key="lvl.value"
                              :label="lvl.label"
                              :value="lvl.value"
                              :disabled="lvl.disabled"
                            />
                          </el-select>
                          <span class="step-word">的人簽核</span>
                        </template>
                        <template v-else-if="row.approver_type === 'department'">
                          <el-select
                            v-model="row.approver_value"
                            placeholder="選擇部門"
                            filterable
                            clearable
                            class="step-value"
                          >
                            <el-option
                              v-for="dept in departmentOptionsFor(row)"
                              :key="dept.value"
                              :label="dept.label"
                              :value="dept.value"
                              :disabled="dept.disabled"
                            />
                          </el-select>
                          <span class="step-word">的員工簽核</span>
                        </template>
                        <template v-else-if="row.approver_type === 'org'">
                          <el-select
                            v-model="row.approver_value"
                            placeholder="選擇機構"
                            filterable
                            clearable
                            class="step-value"
                          >
                            <el-option
                              v-for="org in organizationOptionsFor(row)"
                              :key="org.value"
                              :label="org.label"
                              :value="org.value"
                              :disabled="org.disabled"
                            />
                          </el-select>
                          <span class="step-word">的員工簽核</span>
                        </template>
                        <template v-else-if="row.approver_type === 'group'">
                          <el-select
                            v-model="row.approver_value"
                            placeholder="選擇小單位"
                            multiple
                            filterable
                            collapse-tags
                            collapse-tags-tooltip
                            clearable
                            class="step-value step-value--wide"
                          >
                            <el-option
                              v-for="group in groupOptionsFor(row)"
                              :key="group.value"
                              :label="group.label"
                              :value="group.value"
                              :disabled="group.disabled"
                            />
                          </el-select>
                          <span class="step-word">的員工簽核</span>
                        </template>
                        <el-input v-else v-model="row.approver_value" placeholder="請輸入簽核對象" class="step-value" />

                        <!-- 範圍只適用於標籤 / 角色 / 層級 / 群組 -->
                        <template v-if="scopeApplies(row.approver_type)">
                          <span class="step-word">，範圍</span>
                          <el-select v-model="row.scope_type" placeholder="選擇範圍" class="step-scope" data-test="step-scope">
                            <el-option
                              v-for="opt in scopeOptionsFor(row)"
                              :key="opt.value"
                              :label="opt.label"
                              :value="opt.value"
                              :disabled="opt.disabled"
                            />
                          </el-select>
                        </template>
                      </div>

                      <div class="step-notices">
                        <div class="step-hint">{{ approverTypeHint(row.approver_type) }}</div>
                        <el-tag
                          v-for="notice in stepNotices(row)"
                          :key="notice.text"
                          :type="notice.type"
                          size="small"
                          class="step-notice"
                        >{{ notice.text }}</el-tag>
                      </div>

                      <!-- 這一關的規則 -->
                      <div class="step-line step-rules">
                        <label class="step-rule" data-test="step-required">
                          <el-switch v-model="row.is_required" size="small" />
                          <span>{{ row.is_required ? '必簽' : '選填（找不到簽核人時略過這一關）' }}</span>
                        </label>
                        <label v-if="multiApproverApplies(row)" class="step-rule" data-test="step-all-must">
                          <span>有多位簽核人時</span>
                          <el-select v-model="row.all_must_approve" class="step-mode">
                            <el-option label="全部都要簽" :value="true" />
                            <el-option label="任一人簽即可" :value="false" />
                          </el-select>
                        </label>
                        <label class="step-rule" data-test="step-can-return">
                          <el-switch v-model="row.can_return" size="small" />
                          <span>{{ row.can_return ? '可退回' : '不可退回' }}</span>
                        </label>
                      </div>

                      <!-- 只有表單性質＝請假的表單：請假長度「大於或等於」設定值才需要這一關 -->
                      <div v-if="selectedFormIsLeave && row.condition" class="step-line condition-config" data-test="step-condition">
                        <span class="step-word">適用條件</span>
                        <el-select
                          v-model="row.condition.kind"
                          placeholder="每張都要"
                          clearable
                          class="step-condition-kind"
                          data-test="step-condition-kind"
                          @change="handleConditionKindChange(row)"
                        >
                          <el-option v-for="opt in CONDITION_KIND_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                        <template v-if="row.condition.kind">
                          <span class="step-word">滿</span>
                          <el-input-number
                            v-model="row.condition.value"
                            :min="conditionLimits(row).min"
                            :max="conditionLimits(row).max"
                            :step="conditionLimits(row).step"
                            :precision="row.condition.kind === 'leave_hours_gte' ? 1 : 0"
                            size="small"
                            class="step-number"
                            data-test="step-condition-value"
                          />
                          <span class="step-word">{{ conditionUnit(row) }}才需要這一關</span>
                        </template>
                        <span v-else class="step-hint">每張申請都要過這一關</span>
                      </div>

                      <div class="step-line">
                        <span class="step-word">關卡說明</span>
                        <el-input v-model="row.name" placeholder="選填，例如：直屬主管" maxlength="50" class="step-name" />
                      </div>

                      <p v-if="stepErrorText(index)" class="step-error" data-test="step-error">{{ stepErrorText(index) }}</p>
                    </li>
                  </ol>

                  <!-- 這張表單的流程規則：會生效；主管鏈關卡不論開關一律略過重複的主管 -->
                  <div class="skip-repeated-row" data-test="skip-repeated">
                    <el-switch
                      v-model="skipRepeatedApprovers"
                      :disabled="!policyLoaded || skipRepeatedSaving"
                      :loading="skipRepeatedSaving"
                      data-test="skip-repeated-switch"
                      @change="saveSkipRepeated"
                    />
                    <div class="skip-repeated-text">
                      <span class="skip-repeated-title">略過重複的簽核人</span>
                      <div class="hr-hint">開啟後，已在前面關卡簽過的人，後面的關卡不用再簽一次（「主管鏈」關卡一律會略過，不受這個開關影響）。切換後立即儲存。</div>
                    </div>
                  </div>

                  <div class="steps-actions">
                    <el-button data-test="add-step" @click="addStep">新增關卡</el-button>
                    <span class="hr-hint">關卡依序進行，最多 {{ MAX_WORKFLOW_STEPS }} 關</span>
                    <span class="hr-toolbar__spacer" />
                    <span v-if="stepsDirty" class="unsaved-mark" data-test="steps-dirty">有尚未儲存的變更</span>
                    <el-button v-if="stepsDirty" data-test="discard-steps" @click="reloadWorkflow()">放棄變更</el-button>
                    <el-button type="primary" :loading="workflowSaving" :disabled="!workflowLoaded" data-test="save-workflow" @click="saveWorkflow">儲存關卡</el-button>
                  </div>
                </template>
              </div>
            </el-tab-pane>

            <el-tab-pane :label="fieldTabLabel" name="fields">
              <div class="fields-pane" data-test="fields-pane">
                <div class="hr-toolbar">
                  <span class="hr-hint">員工填寫申請時看到的欄位，由上到下依序顯示；每次變更都會立即儲存。</span>
                  <span class="hr-toolbar__spacer" />
                  <el-button type="primary" data-test="add-field" @click="openFieldDialog()">新增欄位</el-button>
                </div>

                <el-table :data="fields" border :row-class-name="fieldRowClass" data-test="field-table">
                  <el-table-column type="index" label="#" width="50" />
                  <el-table-column label="欄位名稱" min-width="200">
                    <template #default="{ row }">
                      <span>{{ row.label }}</span>
                      <el-tag
                        v-if="systemFieldRole(row)"
                        size="small"
                        type="warning"
                        class="field-system-tag"
                        :title="`${systemFieldRole(row).name}：${systemFieldRole(row).reason}`"
                        data-test="field-system-tag"
                      >系統欄位</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="型別" width="100">
                    <template #default="{ row }">{{ fieldTypeLabel(row.type_1) }}</template>
                  </el-table-column>
                  <el-table-column label="選項" min-width="150">
                    <template #default="{ row }">
                      <el-tag
                        v-if="fieldSourceTag(row)"
                        size="small"
                        class="field-source-tag"
                        :type="fieldSourceTag(row).type"
                      >{{ fieldSourceTag(row).text }}</el-tag>
                      <span v-if="fieldOptionsPreview(row)" class="field-options-preview">{{ fieldOptionsPreview(row) }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="必填" width="80">
                    <template #default="{ row }">
                      <el-switch :model-value="Boolean(row.required)" data-test="field-required-switch" @change="(value) => setFieldRequired(row, value)" />
                    </template>
                  </el-table-column>
                  <el-table-column label="啟用" width="100">
                    <template #default="{ row }">
                      <el-switch
                        :model-value="row.is_active !== false"
                        data-test="field-active-switch"
                        @change="(value) => setFieldActive(row, value)"
                      />
                      <el-tag v-if="row.is_active === false" size="small" type="info" class="field-inactive-tag">已停用</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="排序" width="140">
                    <template #default="{ $index }">
                      <el-button size="small" :disabled="$index === 0 || fieldOrderSaving" @click="moveField($index, -1)">上移</el-button>
                      <el-button size="small" :disabled="$index === fields.length - 1 || fieldOrderSaving" @click="moveField($index, 1)">下移</el-button>
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="150" :fixed="isMobile ? false : 'right'">
                    <template #default="{ row }">
                      <el-button size="small" @click="openFieldDialog('edit', row)">編輯</el-button>
                      <el-button size="small" type="danger" plain @click="removeField(row)">刪除</el-button>
                    </template>
                  </el-table-column>
                  <template #empty>
                    <span class="hr-empty">這張表單還沒有欄位，請按右上角「新增欄位」</span>
                  </template>
                </el-table>
              </div>
            </el-tab-pane>
          </el-tabs>
        </div>
      </el-tab-pane>

      <!-- 2) 共用規則：全部表單共用 -->
      <el-tab-pane label="共用規則" name="commonRule">
        <!-- 主管關卡找不到可簽核的主管時（沒設定主管、主管就是申請人本人、主管已離職）改送的人 -->
        <div class="hr-section top-level-card" data-test="top-level-approvers">
          <h3 class="hr-section__title">無上級主管時的簽核人（全部表單共用）</h3>
          <p class="field-hint">
            必簽的主管關卡找不到可簽核的主管時（申請人沒有設定直屬主管、主管就是申請人本人、主管已離職或停用），改送這裡選的人，任一位核准即可；
            申請人本人一律不會是自己的簽核人。沒有選人（或選的人都不能簽）時改送所有在職的系統管理員。
          </p>
          <div class="top-level-row">
            <el-select
              v-model="topLevel.ids"
              multiple
              filterable
              clearable
              :disabled="!topLevel.loaded"
              placeholder="不選 = 改送系統管理員"
              class="top-level-select"
              data-test="top-level-approvers-select"
              :filter-method="(text) => setOptionQuery('top-level', text)"
              @visible-change="(open) => handleOptionVisible('top-level', open)"
            >
              <el-option
                v-for="emp in topLevelVisibleOptions"
                :key="emp.id"
                :label="emp.label"
                :value="emp.id"
                :disabled="emp.disabled"
              />
            </el-select>
            <el-button
              type="primary"
              :loading="topLevel.saving"
              :disabled="!topLevel.loaded"
              data-test="top-level-approvers-save"
              @click="saveTopLevelApprovers"
            >
              儲存
            </el-button>
          </div>
          <p v-if="topLevel.loaded" class="field-hint" data-test="top-level-approvers-summary">{{ topLevelSummary }}</p>
          <p v-for="line in topLevelWarnings" :key="line" class="field-hint top-level-warning" data-test="top-level-approvers-warning">{{ line }}</p>
          <p v-if="topLevel.error" class="field-hint top-level-warning" data-test="top-level-approvers-error">{{ topLevel.error }}</p>
        </div>
      </el-tab-pane>

      <!-- 3) 流程試算：用實際送出時同一套規則，算出某位員工送出這張表單會得到哪些關卡、誰簽核（不建立單據） -->
      <el-tab-pane label="流程試算" name="trial">
        <div class="tab-content trial-panel" data-test="workflow-trial">
          <p class="field-hint">選一張表單與一位員工，看他送出時實際會經過哪些關卡、由誰簽核。只是試算，不會建立任何單據。</p>
          <p v-if="trialUsesUnsavedSteps" class="field-hint top-level-warning" data-test="trial-unsaved-hint">這張表單的關卡有尚未儲存的變更；試算用的是已儲存的關卡。</p>
          <el-form label-width="110px" class="trial-form">
            <el-form-item label="表單">
              <el-select v-model="trial.formId" placeholder="選擇要試算的表單" filterable class="trial-select" data-test="trial-form">
                <el-option v-for="f in forms" :key="f._id" :label="f.is_active !== false ? f.name : `${f.name}（已停用）`" :value="f._id" />
              </el-select>
            </el-form-item>
            <el-form-item label="員工">
              <el-select
                v-model="trial.employeeId"
                placeholder="輸入姓名搜尋"
                filterable
                clearable
                class="trial-select"
                data-test="trial-employee"
                :filter-method="(text) => setOptionQuery('trial', text)"
                @visible-change="(open) => handleOptionVisible('trial', open)"
              >
                <el-option v-for="emp in trialVisibleEmployeeOptions" :key="emp.value" :label="emp.label" :value="emp.value" :disabled="emp.disabled" />
              </el-select>
            </el-form-item>
            <template v-if="trialFormIsLeave">
              <el-form-item label="請假日期">
                <el-date-picker
                  v-model="trial.start"
                  type="date"
                  value-format="YYYY-MM-DD"
                  format="YYYY/MM/DD"
                  placeholder="開始日期"
                  data-test="trial-start"
                />
                <span class="trial-range-sep">至</span>
                <el-date-picker
                  v-model="trial.end"
                  type="date"
                  value-format="YYYY-MM-DD"
                  format="YYYY/MM/DD"
                  placeholder="結束日期（同一天可不填）"
                  data-test="trial-end"
                />
              </el-form-item>
              <el-form-item label="請假時數">
                <el-input-number v-model="trial.hours" :min="0.5" :max="2928" :step="0.5" :precision="1" data-test="trial-hours" />
                <span class="field-hint trial-inline-hint">不填＝依日期每天 8 小時（和送出時一樣）</span>
              </el-form-item>
            </template>
            <el-form-item>
              <el-button type="primary" :loading="trial.loading" :disabled="!trial.formId || !trial.employeeId" data-test="trial-run" @click="runTrial">試算</el-button>
            </el-form-item>
          </el-form>

          <el-alert v-if="trial.error" type="error" :closable="false" show-icon :title="trial.error" data-test="trial-request-error" />
          <div v-if="trial.result" class="trial-result" data-test="trial-result">
            <el-alert
              v-for="line in trial.result.warnings"
              :key="line"
              type="warning"
              :closable="false"
              show-icon
              class="trial-alert"
              :title="line"
            />
            <el-alert
              v-if="trial.result.error"
              type="error"
              :closable="false"
              show-icon
              class="trial-alert"
              :title="`實際送出會失敗：${trial.result.error.message}`"
              data-test="trial-build-error"
            />
            <p class="trial-summary" data-test="trial-summary">{{ trialSummary }}</p>
            <el-table v-if="trial.result.steps.length" :data="trial.result.steps" border size="small" data-test="trial-steps">
              <el-table-column label="關卡" width="150">
                <template #default="{ row }">第 {{ row.step_order }} 關{{ row.name ? `・${row.name}` : '' }}</template>
              </el-table-column>
              <el-table-column label="簽核人" min-width="220">
                <template #default="{ row }">{{ row.approvers.map(trialPersonLabel).join('、') }}</template>
              </el-table-column>
              <el-table-column label="來自設定" width="120">
                <template #default="{ row }">{{ row.source_position ? `第 ${row.source_position} 關` : '' }}</template>
              </el-table-column>
              <el-table-column label="必簽" width="70">
                <template #default="{ row }">{{ row.is_required ? '是' : '否' }}</template>
              </el-table-column>
              <el-table-column label="說明" min-width="260">
                <template #default="{ row }">{{ [row.fallback_text, row.note].filter(Boolean).join('；') }}</template>
              </el-table-column>
            </el-table>
            <h4 class="trial-subtitle">每一關的判斷</h4>
            <ul class="trial-trace" data-test="trial-trace">
              <li v-for="line in trialTraceLines" :key="line">{{ line }}</li>
            </ul>
            <template v-if="trial.result.logs.length">
              <h4 class="trial-subtitle">送出時會寫進簽核紀錄</h4>
              <ul class="trial-trace" data-test="trial-logs">
                <li v-for="line in trial.result.logs" :key="line">{{ line }}</li>
              </ul>
            </template>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 新增 / 編輯表單 -->
    <el-dialog
      v-model="formDialogVisible"
      :title="formDialogMode==='edit' ? '編輯表單' : '新增表單'"
      width="520px"
      :append-to-body="false"
      :teleported="false"
    >
      <el-form :model="formDialog" label-width="100px" @submit.prevent>
        <el-form-item label="表單名稱" required><el-input v-model="formDialog.name" maxlength="100" /></el-form-item>
        <el-form-item label="分類">
          <el-select v-model="formDialog.category" placeholder="選擇分類" :disabled="!formCategoryOptions.length">
            <el-option
              v-for="c in formCategoryOptions"
              :key="c.value"
              :label="c.label"
              :value="c.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="表單性質">
          <el-select
            v-model="formDialog.semanticType"
            placeholder="選擇表單性質"
            data-test="form-semantic-type"
            @change="handleSemanticTypeChange"
          >
            <el-option
              v-for="opt in semanticTypeOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <div class="field-hint">請假 / 加班性質的表單才會套用請假、加班相關功能（排班請假顯示、特休扣抵、假期餘額等）</div>
        </el-form-item>
        <el-form-item label="啟用">
          <el-switch v-model="formDialog.is_active" />
          <div class="field-hint">停用後員工不會再看到這張表單；已送出的申請單仍可繼續簽核與查看。</div>
        </el-form-item>
        <el-form-item label="說明"><el-input v-model="formDialog.description" type="textarea" :rows="3"/></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formDialogVisible=false">取消</el-button>
        <el-button type="primary" :loading="formSaving" data-test="save-form" @click="saveFormTemplate">儲存</el-button>
      </template>
    </el-dialog>

    <!-- 新增 / 編輯欄位 -->
    <el-dialog v-model="fieldDialogVisible" :title="fieldDialogMode==='edit' ? '編輯欄位' : '新增欄位'" width="520px">
      <el-form :model="fieldDialog" label-width="110px" @submit.prevent>
        <el-alert
          v-if="fieldDialogSystemRole"
          type="warning"
          :closable="false"
          show-icon
          class="field-system-alert"
          :title="`系統欄位：${fieldDialogSystemRole.name}`"
          :description="fieldDialogSystemRole.reason"
          data-test="field-system-alert"
        />
        <el-form-item v-if="customFieldOptions.length && !fieldDialogSystemRole" label="套用自訂欄位">
          <el-select
            v-model="selectedCustomFieldKey"
            placeholder="選擇自訂欄位"
            clearable
            @change="handleCustomFieldSelect"
          >
            <el-option v-for="opt in customFieldOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="欄位名稱" required><el-input v-model="fieldDialog.label" data-test="field-label" /></el-form-item>
        <el-form-item label="型別">
          <el-select v-model="fieldDialog.type_1" placeholder="選擇型別" data-test="field-type">
            <el-option v-for="t in fieldTypeChoices" :key="t" :label="fieldTypeLabel(t)" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="必填"><el-switch v-model="fieldDialog.required" :disabled="fieldDialogRequiredLocked" /></el-form-item>
        <el-form-item v-if="fieldDialogHasOptions" label="選項">
          <el-input
            v-model="fieldDialog.optionsStr"
            type="textarea"
            :rows="4"
            placeholder="每行一個選項"
            :disabled="fieldDialogLinked"
            data-test="field-options"
          />
          <div v-if="fieldDialogLinked" class="field-hint" data-test="dictionary-hint">
            選項即時使用字典「{{ fieldDialog.dictionaryLabel || fieldDialog.field_key }}」，修改字典後立即生效
            <el-button link type="primary" size="small" data-test="unlink-dictionary" @click="unlinkDictionaryField">解除連結，改手動輸入</el-button>
          </div>
        </el-form-item>
        <el-form-item label="提示文字"><el-input v-model="fieldDialog.placeholder" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fieldDialogVisible=false">取消</el-button>
        <el-button type="primary" :loading="fieldSaving" data-test="save-field" @click="saveField">儲存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed, h, inject, nextTick } from 'vue'
import { routerKey } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'  // 你專案現有封裝
import PageHeader from '../PageHeader.vue'
import { pickLeaveFormFields } from '../../utils/leaveHours'
import { windowOptions } from '../../utils/optionWindow'
import { useIsMobile } from '../../utils/useIsMobile'
import {
  dictionaryItemNames,
  getFieldDictionaryKey,
  isDictionaryCustomField,
  isDictionaryLinkableType,
  normalizeCustomFieldOptions,
  normalizeItemSettings,
  parseCustomFieldOptionsInput,
  stringifyCustomFieldOptions
} from '../../utils/fieldOptions'

const API = {
  forms: '/api/approvals/forms',
  workflow: (formId) => `/api/approvals/forms/${formId}/workflow`,
  fields: (formId) => `/api/approvals/forms/${formId}/fields`,
  field: (formId, fieldId) => `/api/approvals/forms/${formId}/fields/${fieldId}`,
  employees: '/api/employees/options',
  organizations: '/api/organizations',
  departments: '/api/departments',
  signRoles: '/api/approvals/sign-roles',
  signLevels: '/api/approvals/sign-levels',
  signTags: '/api/employees/sign-tags',
  otherControlSettings: '/api/other-control-settings',
  itemSettings: '/api/other-control-settings/item-settings',
  subDepartments: '/api/sub-departments',
  formCategories: '/api/other-control-settings/form-categories',
  restoreDefaults: '/api/approvals/restore-defaults',
  topLevelApprovers: '/api/approvals/top-level-approvers',
  trial: (formId) => `/api/approvals/forms/${formId}/workflow/trial`
}

// label：訊息裡的簡稱（「第1關（主管）」，與伺服器相同）；optionLabel：選單上讓人一眼看懂的說法
const APPROVER_TYPES = [
  { value: 'manager', label: '主管', optionLabel: '主管' },
  { value: 'manager_chain', label: '主管鏈', optionLabel: '主管鏈（逐級往上）' },
  { value: 'tag', label: '標籤', optionLabel: '簽核標籤' },
  { value: 'user', label: '員工', optionLabel: '指定員工' },
  { value: 'role', label: '角色', optionLabel: '角色' },
  { value: 'level', label: '層級', optionLabel: '簽核層級' },
  { value: 'department', label: '部門', optionLabel: '部門' },
  { value: 'org', label: '機構', optionLabel: '機構' },
  { value: 'group', label: '群組', optionLabel: '小單位（群組）' },
]
// 「全部都要簽／任一人簽即可」只在一關可能有多位簽核人時才有意義：主管、主管鏈每一關只有一位，不顯示（已存的值不動）
const MULTI_APPROVER_TYPES = ['tag', 'user', 'role', 'level', 'department', 'org', 'group']
// 範圍用來篩選「標籤 / 角色 / 層級 / 群組」成員所屬的部門或機構（伺服器解析簽核人時也會套用群組關卡的範圍，
// 所以保留並可編輯；主管 / 員工 / 部門 / 機構關卡沒有範圍）。「群組」不是一種範圍，舊資料裡的 group 範圍視為已失效
const SCOPE_OPTIONS = [
  { value: 'none', label: '不限' },
  { value: 'dept', label: '同部門' },
  { value: 'org', label: '同機構' },
]
const SCOPE_APPLIES_TO = ['tag', 'role', 'level', 'group']
const MAX_WORKFLOW_STEPS = 20
// 與伺服器 INACTIVE_EMPLOYMENT_STATUSES（K1 可簽核人員）相同：離職、留職停薪的人不能簽核
const INACTIVE_EMPLOYMENT_STATUSES = ['離職員工', '留職停薪']
const SYSTEM_ROLE_OPTIONS = [
  { value: 'admin', label: '系統權限：管理員' },
  { value: 'supervisor', label: '系統權限：主管' },
  { value: 'employee', label: '系統權限：一般員工' },
]
// 主管鏈（manager_chain）：approver_value = { stopAtTag, maxLevels }，與伺服器 normalizeManagerChainValue 相同的預設
const MANAGER_CHAIN_DEFAULT_LEVELS = 5
const MANAGER_CHAIN_MAX_LEVELS = 10
// 關卡的適用條件（只有請假表單）：請假長度「大於或等於」設定值才需要這一關；與伺服器 STEP_CONDITION_LIMITS 相同
const CONDITION_KIND_OPTIONS = [
  { value: 'leave_hours_gte', label: '請假時數', unit: '小時', min: 0.5, max: 2928, step: 0.5, defaultValue: 56 },
  { value: 'leave_calendar_days_gte', label: '請假日數（日曆日）', unit: '日', min: 1, max: 366, step: 1, defaultValue: 7 },
  { value: 'leave_scheduled_days_gte', label: '請假日數（排班日）', unit: '個排班日', min: 1, max: 366, step: 1, defaultValue: 7 },
]
const APPROVER_TYPE_HINTS = {
  manager: '「申請者的主管」會送給申請人自己的直屬主管；也可以指定某一位主管。',
  manager_chain: '每一級主管各簽一關（第1級主管、第2級主管…）；已在前面關卡簽過、已離職或留職停薪的主管自動略過並往上找。',
  user: '只有在職且帳號啟用的人能簽核。',
  tag: '送給持有此簽核標籤的在職員工；標籤在「員工管理」設定，可以先在這裡選好標籤，再為負責的人加上。',
  role: '系統權限（管理員／主管／一般員工），或員工管理裡設定的簽核角色（R001–R007）。',
  level: '簽核層級（U001–U005）在員工管理設定。',
  department: '送給這個部門的在職員工。',
  org: '送給這個機構的在職員工。',
  group: '送給所選小單位的在職員工；「範圍」可以限定與申請者同部門或同機構。',
}

/* Tabs / 基本狀態
   activeTab：approvalLevels（表單清單，或一張表單的「簽核關卡」）、fields（一張表單的「欄位」）、commonRule（共用規則）、trial（流程試算）。
   selectedFormId 是正在設定的那張表單；空白＝顯示表單清單 */
const activeTab = ref('approvalLevels')
const forms = ref([])
const selectedFormId = ref('')
const fields = ref([])
const rootEl = ref(null)
// 手機寬度時表格的操作欄不固定在右側（固定欄會蓋掉大半張表）
const isMobile = useIsMobile()

// 上層分頁（表單／共用規則／流程試算）與表單設定裡的分頁（簽核關卡／欄位）都由 activeTab 決定
let lastEditorTab = 'approvalLevels'
const mainTab = computed({
  get: () => (activeTab.value === 'commonRule' || activeTab.value === 'trial' ? activeTab.value : 'forms'),
  set: (value) => { activeTab.value = value === 'forms' ? lastEditorTab : value },
})
const editorTab = computed({
  get: () => (activeTab.value === 'fields' ? 'fields' : 'approvalLevels'),
  set: (value) => { activeTab.value = value === 'fields' ? 'fields' : 'approvalLevels' },
})

/* 表單清單 */
const formsLoaded = ref(false)
const formKeyword = ref('')
const selectedForm = computed(() => forms.value.find((item) => item._id === selectedFormId.value) || null)
const activeFormCount = computed(() => forms.value.filter((item) => item.is_active !== false).length)
// 清單固定排序（啟用中的在前，再依名稱）：伺服器依最後修改時間排，每改一張表單清單順序就會跳動
const filteredForms = computed(() => {
  const keyword = formKeyword.value.trim().toLowerCase()
  const list = keyword
    ? forms.value.filter((item) => String(item.name ?? '').toLowerCase().includes(keyword))
    : [...forms.value]
  return list.sort((a, b) => (
    (Number(b.is_active !== false) - Number(a.is_active !== false))
    || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-Hant')
  ))
})
const formListEmptyText = computed(() => {
  if (!formsLoaded.value) return '載入中…'
  if (forms.value.length) return '找不到符合的表單'
  return '尚未建立表單，請按右上角「新增表單」，或按「補齊預設表單」建立系統預設的表單'
})
// 每張表單的摘要（清單上的「簽核流程」「欄位」）：{ [formId]: { steps: 關卡陣列或 null（讀不到）, fieldCount: 啟用中的欄位數或 null } }
const formSummaries = ref({})

/* 下拉選單的搜尋文字：同一時間只有一個選單是打開的，記下是哪一個選單與輸入的文字（員工很多時只畫出一部分選項） */
const optionQuery = ref({ key: '', text: '' })
function setOptionQuery(key, text) {
  optionQuery.value = { key, text: typeof text === 'string' ? text : '' }
}
function handleOptionVisible(key, open) {
  if (!open && optionQuery.value.key === key) optionQuery.value = { key: '', text: '' }
}
const optionQueryFor = (key) => (optionQuery.value.key === key ? optionQuery.value.text : '')
const EMPLOYEE_MORE_LABEL = (hidden) => `還有 ${hidden} 位沒有列出，請輸入姓名搜尋`
const categoryOptions = ref([])
const categoryNameMap = computed(() => {
  const map = {}
  categoryOptions.value.forEach((option) => {
    if (option?.value) {
      map[option.value] = option.label || option.value
    }
  })
  return map
})
const firstCategoryValue = computed(() => categoryOptions.value[0]?.value || '')

// 補齊預設值之後的檢查報告：{ title, warnings, templates }
const restoreReport = ref(null)

/* 這張表單的流程規則（workflow.policy）。
   畫面上只有會生效的「略過重複的簽核人」（policy.skipRepeatedApprovers），切換後只送這一個欄位。
   最大簽核關卡數、代理簽核、逾時提醒與逾時處理（maxApprovalLevel / allowDelegate / overdueDays / overdueAction）
   伺服器只儲存、沒有任何功能讀取，2026/11 起不再顯示；資料與 API 都保留，這裡不讀也不送，所以不會被改掉 */
const skipRepeatedApprovers = ref(false)
const skipRepeatedSaving = ref(false)
// 這張表單的規則成功讀回來（或確定還沒有流程）之後才允許儲存：讀取失敗時不能把預設值當成它的規則存回去
const policyLoaded = ref(false)
// 序號：快速切換表單時，慢回來的舊回應不能蓋掉現在這張表單的規則 / 關卡
let policyLoadSeq = 0
let workflowDialogSeq = 0
// 畫面上的規則目前對應（或正在讀取）的是哪一張表單；換表單時用它判斷要不要重新讀規則，
// 儲存規則時也用它確認畫面上的規則真的是這張表單的
let policyFormId = ''

/* 樣板 Dialog */
const formDialogVisible = ref(false)
const formDialogMode = ref('create') // 'create'|'edit'
const formSaving = ref(false)
const formDialog = ref({ _id: '', name: '', category: firstCategoryValue.value || '', semanticType: 'general', is_active: true, description: '' })
// 分類選單：表單原本的分類不在分類清單裡（被刪除，或預設表單用的舊分類）時仍列出來並標明，
// 不然選單會只顯示一串代碼，也看不出它和清單上的分類不同
const formCategoryOptions = computed(() => {
  const current = formDialog.value.category
  if (current && !categoryOptions.value.some((option) => option.value === current)) {
    // 分類清單沒讀到時無法判斷，只顯示原本的值
    return [...categoryOptions.value, { value: current, label: categoryOptions.value.length ? `${current}（不在分類清單裡）` : current }]
  }
  return categoryOptions.value
})

/* 表單性質（semanticType）：決定請假 / 加班相關功能是否套用到此樣板 */
const SEMANTIC_TYPE_OPTIONS = [
  { value: 'general', label: '一般' },
  { value: 'leave', label: '請假' },
  { value: 'overtime', label: '加班' },
]
const EXTRA_SEMANTIC_TYPE_LABELS = { shift_change: '調班', business_trip: '出差' }
const OVERTIME_NAME_PATTERN = /加班|overtime/i
const LEAVE_NAME_PATTERN = /請假|休假|事假|病假|特休|公假|假單|假別|leave/i
// 名稱雖含假別字眼，但不是「請假申請」本身（例如特休保留、各種證明、銷假、出差），不能被當成請假單
const NOT_LEAVE_REQUEST_NAME_PATTERN = /保留|證明|結算|銷假|出差/

// 與伺服器 inferSemanticType（approvalTemplateController.js）相同的名稱推斷規則
function inferFormSemanticType(name) {
  const text = String(name ?? '')
  if (OVERTIME_NAME_PATTERN.test(text)) return 'overtime'
  if (LEAVE_NAME_PATTERN.test(text) && !NOT_LEAVE_REQUEST_NAME_PATTERN.test(text)) return 'leave'
  return 'general'
}

// 管理者手動選過表單性質後，就不再跟著表單名稱自動推斷
const formSemanticTouched = ref(false)
const semanticTypeOptions = computed(() => {
  const current = formDialog.value.semanticType
  // 已存在的樣板可能是其他性質（調班、出差…），保留原值避免儲存時被覆蓋
  if (current && !SEMANTIC_TYPE_OPTIONS.some((opt) => opt.value === current)) {
    return [...SEMANTIC_TYPE_OPTIONS, { value: current, label: EXTRA_SEMANTIC_TYPE_LABELS[current] || current }]
  }
  return SEMANTIC_TYPE_OPTIONS
})

watch(() => formDialog.value.name, (name) => {
  if (!formSemanticTouched.value) {
    formDialog.value.semanticType = inferFormSemanticType(name)
  }
})

function handleSemanticTypeChange() {
  formSemanticTouched.value = true
}

/* 簽核關卡編輯（workflowDialogVisible：這張表單的關卡編輯已開啟；名稱沿用以前的對話框） */
const workflowDialogVisible = ref(false)
const workflowSteps = ref([])
// 關卡成功讀回來之後才允許儲存：讀取失敗時不能拿空的關卡清單去覆蓋伺服器上的流程
const workflowLoaded = ref(false)
const workflowLoading = ref(false)
const workflowSaving = ref(false)
// 上次讀回來／儲存成功時的關卡內容，用來判斷有沒有尚未儲存的變更
const savedStepsSnapshot = ref('[]')
// 儲存時哪一關有問題：{ [第幾關的索引]: { text, snapshot } }；那一關改過之後（內容和當時不同）就不再顯示
const stepErrors = ref({})
const employeeOptions = ref([])
const organizationNameMap = ref({})
const departmentRecords = ref([])
const signRoleOptions = ref([])
const signLevelOptions = ref([])
const groupOptions = ref([])
// GET /api/employees/sign-tags：{ tags: [{ name, count, requiredByWorkflows }] }；失敗時視為沒有額外標籤
const signTagInfo = ref([])
const signTagsLoaded = ref(false)

const NETWORK_FAILURE_MESSAGE = '儲存失敗，請檢查網路後再試'
const LOAD_FAILURE_MESSAGE = '載入失敗，請檢查網路後再試'

// 伺服器仍可能回傳的幾個英文代碼：保留原文並補上中文說明
const KNOWN_ENGLISH_ERRORS = {
  'invalid field_key': '欄位代碼格式不正確',
  'invalid semanticType': '表單性質不正確',
}

// 讀取伺服器回傳的錯誤文字（{ error } 或 { message }）；沒有就只顯示預設訊息
async function describeFailure(res, fallback) {
  return (await readFailure(res, fallback)).message
}

// 同上，另外回傳伺服器的回應內容（例如儲存關卡失敗時的 step：第幾關有問題）與不含前綴的原因
async function readFailure(res, fallback) {
  let data = null
  let detail = ''
  try {
    data = await res.json()
    detail = [data?.error, data?.message].find((text) => typeof text === 'string' && text.trim()) || ''
  } catch (error) {
    data = null
    detail = ''
  }
  detail = detail.trim()
  if (detail && KNOWN_ENGLISH_ERRORS[detail]) detail = `${detail}（${KNOWN_ENGLISH_ERRORS[detail]}）`
  return { message: detail ? `${fallback}：${detail}` : `${fallback}，請稍後再試`, detail, data }
}

// 讀取類請求：網路中斷（fetch 被拒絕）時回傳 null，由呼叫端決定要不要提示
async function readApi(...args) {
  try {
    return await apiFetch(...args)
  } catch (error) {
    return null
  }
}

// 寫入類請求：網路中斷或伺服器回傳錯誤都會顯示訊息，成功才回傳 Response（失敗回傳 null）
// onFailure（選用）：伺服器拒絕時收到 { message, detail, data }，用來把錯誤標在對應的位置
async function sendWrite(path, options, failureTitle, onFailure) {
  let res
  try {
    res = await apiFetch(path, options)
  } catch (error) {
    ElMessage.error(NETWORK_FAILURE_MESSAGE)
    return null
  }
  if (!res?.ok) {
    const failure = await readFailure(res, failureTitle)
    ElMessage.error(failure.message)
    if (typeof onFailure === 'function') onFailure(failure)
    return null
  }
  return res
}

async function readJson(res) {
  try {
    return await res.json()
  } catch (error) {
    return null
  }
}

/* 簽核標籤：與伺服器 normalizeSignTag 相同（NFKC、去頭尾空白、內部空白壓成一個） */
function normalizeTagText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function employeeIneligibleReason(emp) {
  if (emp?.accountEnabled === false) return '帳號已停用'
  if (INACTIVE_EMPLOYMENT_STATUSES.includes(emp?.status)) return emp.status === '離職員工' ? '已離職' : '留職停薪'
  return ''
}

const employeeById = computed(() => new Map(employeeOptions.value.map((emp) => [emp.id, emp])))

/* 無上級主管時的簽核人（全部表單共用；GET / PUT /api/approvals/top-level-approvers，只有管理員）：
   伺服器回 { ids, approvers: [{ id, name, employeeId, eligible, ineligibleReason }], admins: [{ id, name, employeeId }] }；
   ids 空白 = 改送所有在職的系統管理員 */
const topLevel = ref({ ids: [], approvers: [], admins: [], loaded: false, saving: false, error: '' })

const personLabel = (person) => (person?.employeeId ? `${person.name || '（未命名）'}（${person.employeeId}）` : (person?.name || '（未命名）'))

const topLevelOptions = computed(() => {
  const chosen = new Set(topLevel.value.ids)
  const options = employeeOptions.value.map((emp) => ({
    id: emp.id,
    label: emp.ineligibleReason ? `${emp.displayName}（${emp.ineligibleReason}）` : emp.displayName,
    // 離職、停用、留職停薪的人不能選；已經存進設定的仍顯示，方便移除
    disabled: Boolean(emp.ineligibleReason) && !chosen.has(emp.id),
  }))
  const known = new Set(options.map((option) => option.id))
  for (const person of topLevel.value.approvers) {
    if (known.has(person.id)) continue
    options.push({ id: person.id, label: `${personLabel(person)}${person.ineligibleReason ? `（${person.ineligibleReason}）` : ''}`, disabled: false })
  }
  return options
})

// 員工很多時選單只畫出一部分（已選的一定在），輸入姓名搜尋全部
const topLevelVisibleOptions = computed(() => windowOptions(
  topLevelOptions.value.map((option) => ({ ...option, value: option.id })),
  { query: optionQueryFor('top-level'), selected: topLevel.value.ids, moreLabel: EMPLOYEE_MORE_LABEL }
).map((option) => ({ ...option, id: option.value })))

const topLevelSummary = computed(() => {
  const saved = topLevel.value.approvers
  if (saved.length) return `目前指定：${saved.map(personLabel).join('、')}`
  const admins = topLevel.value.admins.map(personLabel)
  return admins.length
    ? `目前沒有指定：改送系統管理員（${admins.join('、')}）`
    : '目前沒有指定，也沒有在職的系統管理員：無上級主管的申請會無法送出，請指定簽核人'
})

// 已存的人之後離職、停用了：簽核時會略過，提醒管理員換人
const topLevelWarnings = computed(() => topLevel.value.approvers
  .filter((person) => !person.eligible)
  .map((person) => `「${personLabel(person)}」${person.ineligibleReason || '不能簽核'}，簽核時會略過，請移除或改選其他人`))

function applyTopLevelSetting(body) {
  const list = (value) => (Array.isArray(value) ? value.filter((item) => item && item.id) : [])
  topLevel.value = {
    ...topLevel.value,
    ids: Array.isArray(body?.ids) ? body.ids.map(String) : [],
    approvers: list(body?.approvers),
    admins: list(body?.admins),
    loaded: true,
    error: '',
  }
}

// 讀取失敗只在區塊內提示（不跳出訊息），也不能讓人把空白存回去
async function loadTopLevelApprovers() {
  const res = await readApi(API.topLevelApprovers)
  const body = res?.ok ? await readJson(res) : null
  if (!body || typeof body !== 'object') {
    topLevel.value = { ...topLevel.value, loaded: false, error: '無法讀取無上級主管時的簽核人設定，請重新整理頁面' }
    return
  }
  applyTopLevelSetting(body)
}

async function saveTopLevelApprovers() {
  if (!topLevel.value.loaded || topLevel.value.saving) return
  topLevel.value.saving = true
  try {
    const res = await sendWrite(API.topLevelApprovers, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: topLevel.value.ids }),
    }, '儲存無上級主管時的簽核人失敗')
    if (!res) return
    const body = await readJson(res)
    if (body) applyTopLevelSetting(body)
    ElMessage.success(topLevel.value.ids.length ? '已儲存無上級主管時的簽核人' : '已改回預設：改送系統管理員')
  } finally {
    topLevel.value.saving = false
  }
}

/* 流程試算（GET /api/approvals/forms/:id/workflow/trial，只有管理員）：
   和實際送出同一套規則算出某位員工會得到的關卡與簽核人（含姓名）；不建立單據。分頁打開前不讀任何資料 */
const trial = ref({ formId: '', employeeId: '', start: '', end: '', hours: undefined, loading: false, error: '', result: null })
const trialFormIsLeave = computed(() => isLeaveFormRecord(forms.value.find((item) => item._id === trial.value.formId)))
const trialEmployeeOptions = computed(() => employeeOptions.value.map((emp) => {
  const dept = emp.department?.name ? `・${emp.department.name}` : ''
  return { value: emp.id, label: `${emp.displayName || emp.name}${dept}${emp.ineligibleReason ? `（${emp.ineligibleReason}）` : ''}` }
}))
const trialVisibleEmployeeOptions = computed(() => windowOptions(trialEmployeeOptions.value, {
  query: optionQueryFor('trial'),
  selected: trial.value.employeeId,
  moreLabel: EMPLOYEE_MORE_LABEL,
}))
// 正在設定的表單有尚未儲存的關卡時提醒：試算用的是伺服器上已儲存的關卡
const trialUsesUnsavedSteps = computed(() => stepsDirty.value && Boolean(trial.value.formId) && trial.value.formId === selectedFormId.value)

function trialPersonLabel(person) {
  const name = person?.name || '（未命名）'
  return person?.employeeId ? `${name}（${person.employeeId}）` : name
}

function normalizeTrialResult(body) {
  const list = (value) => (Array.isArray(value) ? value : [])
  return {
    ...body,
    warnings: list(body?.warnings).filter((line) => typeof line === 'string' && line),
    steps: list(body?.steps).map((step) => ({ ...step, approvers: list(step?.approvers) })),
    workflow: list(body?.workflow),
    logs: list(body?.logs).filter((line) => typeof line === 'string' && line),
  }
}

const trialSummary = computed(() => {
  const result = trial.value.result
  if (!result) return ''
  const parts = []
  const applicant = result.applicant
  if (applicant) {
    const supervisor = applicant.supervisor ? `直屬主管：${trialPersonLabel(applicant.supervisor)}` : '沒有設定直屬主管'
    parts.push(`${trialPersonLabel(applicant)}（${supervisor}）`)
  }
  const leave = result.leave
  if (leave) {
    const scheduled = leave.scheduledDays !== null && leave.scheduledDays !== undefined
      ? `、${leave.scheduledDays} 個排班日${leave.scheduledNote ? `（${leave.scheduledNote}）` : ''}`
      : ''
    parts.push(`請假 ${leave.hours ?? '-'} 小時、${leave.calendarDays ?? '-'} 個日曆日${scheduled}`)
  }
  parts.push(result.ok ? `送出後共 ${result.steps.length} 關` : '實際送出會失敗（見上方說明）')
  return parts.join('；')
})

// 每一關怎麼判斷的：條件適不適用、主管鏈走到誰、略過了誰、改送給誰
const trialTraceLines = computed(() => {
  const result = trial.value.result
  if (!result) return []
  return result.workflow.map((item) => {
    const head = `第${item.position}關（${item.label}${item.name ? `・${item.name}` : ''}）`
    const parts = []
    if (item.condition_text) {
      parts.push(item.included
        ? `${item.condition_text}：適用（${item.condition_detail || '請假長度未知'}）`
        : `${item.condition_text}：不適用（${item.condition_detail}），這一關不送`)
    }
    if (item.included) {
      if (item.chain && item.chain.levels?.length) {
        const levels = item.chain.levels.map((level) => `${level.label} ${trialPersonLabel(level.approver)}${level.repeated ? '（已是前面關卡的簽核人，略過）' : ''}`)
        parts.push(`${levels.join(' → ')}；${item.chain.end_text}`)
      } else if (item.approvers?.length) {
        parts.push(item.approvers.map(trialPersonLabel).join('、'))
      }
      ;(item.chain?.levels || []).forEach((level) => (level.notes || []).forEach((note) => parts.push(note)))
      ;(item.chain?.notes || []).forEach((note) => parts.push(note))
      if (item.fallback_text) parts.push(item.fallback_text)
      else if (item.unresolved_reason) parts.push(`找不到簽核人：${item.unresolved_reason}${item.is_required ? '' : '（選填，送出時自動略過）'}`)
      if (!item.chain && item.repeated?.length) parts.push(`略過已是前面關卡簽核人的${item.repeated.map(trialPersonLabel).join('、')}`)
      if (item.skipped_as_repeat) parts.push('整關的簽核人都已在前面簽過，這一關略過')
    }
    return `${head}：${parts.join('；') || '沒有簽核人'}`
  })
})

// 打開「流程試算」時先帶入正在設定的表單
watch(activeTab, (tab) => {
  if (tab === 'fields' || tab === 'approvalLevels') lastEditorTab = tab
  if (tab === 'trial' && !trial.value.formId && selectedFormId.value) trial.value.formId = selectedFormId.value
})

// 換了表單或員工的當下：上一次的試算結果不是這個組合的，不留在畫面上讓人誤讀
// （同步執行：不會晚一拍才清，把緊接著那一次試算的結果或提示清掉）
watch(() => `${trial.value.formId}|${trial.value.employeeId}`, () => {
  // 直接改欄位，不換掉整個物件（正在逐一指定欄位的程式手上還是原本那個物件）
  if (trial.value.result) trial.value.result = null
  if (trial.value.error) trial.value.error = ''
}, { flush: 'sync' })

// 從表單清單或表單設定按「流程試算」：直接帶入那張表單
function openTrialFor(form) {
  if (!form?._id) return
  trial.value = { ...trial.value, formId: form._id, result: null, error: '' }
  activeTab.value = 'trial'
}

async function runTrial() {
  if (!trial.value.formId || !trial.value.employeeId || trial.value.loading) return
  const params = new URLSearchParams({ employee: trial.value.employeeId })
  if (trialFormIsLeave.value) {
    // 只選了結束日期：伺服器只看開始日期，先請管理員補上，免得試算結果和想看的期間不同
    if (!trial.value.start && trial.value.end) {
      trial.value.result = null
      trial.value.error = '請先選開始日期（同一天的請假可以只選開始日期）'
      return
    }
    if (trial.value.start) params.set('start', trial.value.start)
    if (trial.value.end) params.set('end', trial.value.end)
    if (Number(trial.value.hours) > 0) params.set('hours', String(trial.value.hours))
  }
  trial.value.loading = true
  trial.value.error = ''
  try {
    const res = await readApi(`${API.trial(trial.value.formId)}?${params.toString()}`)
    if (!res) {
      trial.value.result = null
      trial.value.error = LOAD_FAILURE_MESSAGE
      return
    }
    if (!res.ok) {
      trial.value.result = null
      trial.value.error = await describeFailure(res, '試算失敗')
      return
    }
    const body = await readJson(res)
    trial.value.result = body && typeof body === 'object' ? normalizeTrialResult(body) : null
    if (!trial.value.result) trial.value.error = '試算失敗，請稍後再試'
  } finally {
    trial.value.loading = false
  }
}

function employeeOptionFor(emp) {
  const label = emp.displayName || emp.name
  // 已離職 / 留職停薪 / 帳號停用的人不能簽核：灰掉不能新選，但已儲存的值仍看得到原因
  return emp.ineligibleReason
    ? { value: emp.id, label: `${label}（${emp.ineligibleReason}）`, disabled: true }
    : { value: emp.id, label }
}

const userApproverOptions = computed(() => employeeOptions.value.map(employeeOptionFor))

const APPLICANT_SUPERVISOR_VALUE = 'APPLICANT_SUPERVISOR'
const APPLICANT_SUPERVISOR_OPTION = Object.freeze({
  value: APPLICANT_SUPERVISOR_VALUE,
  label: '申請者的主管',
})

const managerApproverOptions = computed(() => {
  const seen = new Set([APPLICANT_SUPERVISOR_OPTION.value])
  const supervisors = employeeOptions.value
    .filter((emp) => emp.role === 'supervisor')
    .map(employeeOptionFor)
    .filter((opt) => {
      if (!opt.value || seen.has(opt.value)) return false
      seen.add(opt.value)
      return true
    })
  return [APPLICANT_SUPERVISOR_OPTION, ...supervisors]
})

// 員工身上的標籤，依可簽核（在職、帳號啟用）的人統計人數
const employeeTagCounts = computed(() => {
  const counts = new Map()
  employeeOptions.value.forEach((emp) => {
    if (emp.ineligibleReason) return
    const seen = new Set()
    ;(Array.isArray(emp.signTags) ? emp.signTags : []).forEach((raw) => {
      const tag = normalizeTagText(raw)
      if (!tag || seen.has(tag)) return
      seen.add(tag)
      counts.set(tag, (counts.get(tag) || 0) + 1)
    })
  })
  return counts
})
const serverTagMap = computed(() => new Map(signTagInfo.value.map((item) => [item.name, item])))

// 目前有幾位可簽核的員工持有此標籤；無法判斷（兩邊資料都沒讀到）時回傳 null
function holdersOf(tag) {
  const key = normalizeTagText(tag)
  if (!key) return null
  const fromServer = serverTagMap.value.get(key)
  if (fromServer && Number.isFinite(fromServer.count)) return fromServer.count
  if (signTagsLoaded.value || employeeOptions.value.length > 0) return employeeTagCounts.value.get(key) || 0
  return null
}

// 標籤選項 = 伺服器標籤詞彙表 ∪ 員工身上的標籤 ∪ 目前關卡已使用的標籤（已儲存的標籤不會因為沒人持有而消失）
const tagOptions = computed(() => {
  const names = new Set()
  signTagInfo.value.forEach((item) => names.add(item.name))
  employeeOptions.value.forEach((emp) => {
    ;(Array.isArray(emp.signTags) ? emp.signTags : []).forEach((raw) => {
      const tag = normalizeTagText(raw)
      if (tag) names.add(tag)
    })
  })
  workflowSteps.value.forEach((step) => {
    // 主管鏈的「簽到持有此標籤的主管為止」也算用到的標籤
    const raw = step?.approver_type === 'tag'
      ? step.approver_value
      : (step?.approver_type === 'manager_chain' ? step.approver_value?.stopAtTag : '')
    const tag = normalizeTagText(raw)
    if (tag) names.add(tag)
  })
  return Array.from(names)
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    .map((tag) => {
      const count = holdersOf(tag)
      const label = count === null ? tag : count === 0 ? `${tag}（0 人，目前沒有人持有）` : `${tag}（${count} 人）`
      return { value: tag, label, count }
    })
})

const departmentOptions = computed(() => {
  const map = new Map()
  departmentRecords.value.forEach((dept) => {
    if (dept?.id) map.set(dept.id, { value: dept.id, label: dept.name || dept.id })
  })
  employeeOptions.value.forEach((emp) => {
    const dept = emp.department
    if (dept?.id) {
      const label = dept.name || dept.id
      if (!map.has(dept.id) || (map.get(dept.id)?.label || '') === dept.id) map.set(dept.id, { value: dept.id, label })
    }
  })
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
})

const organizationOptions = computed(() => {
  const optionsMap = new Map()
  const nameMap = organizationNameMap.value || {}

  Object.keys(nameMap || {}).forEach((id) => {
    if (!id) return
    const label = resolveOrganizationLabel(id, nameMap[id])
    optionsMap.set(id, { value: id, label })
  })

  employeeOptions.value.forEach((emp) => {
    const org = emp.organization || {}
    const id = toValueString(org.id)
    if (!id) return
    const label = resolveOrganizationLabel(id, org.name)
    if (!optionsMap.has(id) || (optionsMap.get(id)?.label || '') === id) {
      optionsMap.set(id, { value: id, label })
    }
  })

  return Array.from(optionsMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
})

const customFieldOptions = ref([])
const selectedCustomFieldKey = ref('')

const fieldDialogVisible = ref(false)
const fieldDialogMode = ref('create')
// explicitUnlink：管理者在這個視窗明確解除了字典連結（新增 / 編輯都要送出空的 field_key，伺服器才不會再依標籤代碼自動連結）
const fieldDialog = ref({ _id: '', field_key: '', label: '', type_1: 'text', type_2: '', required: false, optionsStr: '', placeholder: '', order: 0, dictionaryLinked: false, dictionaryLabel: '', explicitUnlink: false })
const FIELD_TYPES = ['text','textarea','number','select','checkbox','date','time','datetime','file','user','department','org']
const FIELD_TYPE_LABELS = {
  text: '單行文字', textarea: '多行文字', number: '數字', select: '下拉選單', checkbox: '複選',
  date: '日期', time: '時間', datetime: '日期時間', file: '附件', user: '員工', department: '部門', org: '機構',
}
const fieldTypeLabel = (type) => FIELD_TYPE_LABELS[type] || type || ''
// 其他控制設定「自訂欄位」另外有的型別（套用自訂欄位的選單上顯示用）
const CUSTOM_FIELD_TYPE_LABELS = { composite: '複合加選', timeRange: '時間區間', boolean: '是／否' }
const CUSTOM_TO_FORM_FIELD_TYPE = { composite: 'checkbox', boolean: 'checkbox', timeRange: 'text' }
const fieldSaving = ref(false)
const fieldOrderSaving = ref(false)
// 型別選單：已存的型別不在清單裡（例如從自訂欄位帶入的其他型別）時仍列出來，選單才不會是空白
const fieldTypeChoices = computed(() => {
  const current = fieldDialog.value.type_1
  return current && !FIELD_TYPES.includes(current) ? [...FIELD_TYPES, current] : FIELD_TYPES
})
// 只有下拉 / 複選欄位有選項
const fieldDialogHasOptions = computed(() => isDictionaryLinkableType(fieldDialog.value.type_1))

/* 請假表單的系統欄位（假別、開始、結束、時數）：系統依欄位名稱找到它們來計算請假期間與時數、扣假別額度、顯示在班表上
  （規則與伺服器 utils/leaveFieldLabels 相同）。刪除、停用、改名或改型別會讓請假單算不出來，所以在這裡擋下並說明原因；
   同一個用途另有啟用中的欄位時（例如把「假別」換成連結字典的「假別類別 (C12)」）就不擋 */
const SYSTEM_FIELD_ROLES = [
  { key: 'typeField', name: '假別', types: ['select'], requiredLocked: true, reason: '請假單用這個欄位決定假別、扣哪一種假的額度。可以修改選項與提示文字；不能刪除、停用、取消必填，名稱要以「假別」開頭，型別要是下拉選單。' },
  { key: 'startField', name: '開始時間', types: ['date', 'datetime'], requiredLocked: true, reason: '請假單用這個欄位計算請假期間。可以修改提示文字；不能刪除、停用、取消必填，名稱要維持「開始時間」或「開始日期」，型別要是日期或日期時間。' },
  { key: 'endField', name: '結束時間', types: ['date', 'datetime'], requiredLocked: true, reason: '請假單用這個欄位計算請假期間。可以修改提示文字；不能刪除、停用、取消必填，名稱要維持「結束時間」或「結束日期」，型別要是日期或日期時間。' },
  { key: 'hoursField', name: '請假時數', types: ['number'], requiredLocked: false, reason: '請假單用這個欄位記錄請假時數（扣假別額度、薪資與簽核條件都用它）。可以修改提示文字與必填；不能刪除、停用，名稱要維持「時數」或「請假時數」，型別要是數字。' },
]

// 這一組欄位（預設是畫面上的欄位）裡，各個系統用途目前由哪個欄位負責：{ [欄位 _id]: role }
function systemFieldMap(list = fields.value) {
  const map = new Map()
  if (!selectedFormIsLeave.value) return map
  const picked = pickLeaveFormFields(list.filter((field) => field?.is_active !== false))
  SYSTEM_FIELD_ROLES.forEach((role) => {
    const field = picked[role.key]
    if (field?._id) map.set(String(field._id), role)
  })
  return map
}
const systemFields = computed(() => systemFieldMap())
function systemFieldRole(row) {
  return row?._id ? systemFields.value.get(String(row._id)) || null : null
}
// 把某個欄位換成 next（或拿掉：next 為 null）之後，它原本負責的用途是不是就沒有欄位了；是的話回傳那個用途
function brokenSystemRole(row, next) {
  const role = systemFieldRole(row)
  if (!role) return null
  const list = fields.value
    .map((field) => (String(field._id) === String(row._id) ? next : field))
    .filter(Boolean)
  const after = systemFieldMap(list)
  return Array.from(after.values()).includes(role) ? null : role
}
function refuseSystemFieldChange(role, action) {
  ElMessage.error(`「${role.name}」是請假單的系統欄位，不能${action}：${role.reason}`)
}
const fieldDialogSystemRole = computed(() => (
  fieldDialogMode.value === 'edit' && fieldDialog.value._id ? systemFieldRole(fieldDialog.value) : null
))
const fieldDialogRequiredLocked = computed(() => Boolean(fieldDialogSystemRole.value?.requiredLocked && fieldDialog.value.required))
// 與伺服器 normalizeFieldKeyInput 相同的 field_key 格式：英數字、底線、連字號，最長 40 字
const FIELD_KEY_PATTERN = /^[A-Za-z0-9_-]{1,40}$/

/* 字典項目：{ C12: [{ name, code }] }，連結字典的欄位用它顯示唯讀預覽 */
const dictionaryItems = ref({})

// 編輯中的欄位是否連結字典（只有下拉 / 複選欄位可連結）
const fieldDialogLinked = computed(() =>
  Boolean(
    fieldDialog.value.dictionaryLinked &&
    fieldDialog.value.field_key &&
    isDictionaryLinkableType(fieldDialog.value.type_1)
  )
)

watch([activeTab, selectedFormId], () => {
  if (activeTab.value === 'fields' && selectedFormId.value) loadFields()
})

// 這張表單的規則跟著 selectedFormId，不管是從哪裡換掉它：
// 否則上一張表單的規則還留在畫面上，切換開關會把它寫到這一張表單。
// 程式自己換表單、而且已經讀過規則的（openWorkflowDialog / loadWorkflow）不會重複讀
watch(selectedFormId, (formId) => {
  if (!formId) {
    policyFormId = ''
    return
  }
  if (formId !== policyFormId) loadWorkflow()
})

// 換了表單（或回到清單）的當下：上一張表單的欄位不留在畫面上，還沒回來的欄位回應也作廢
// （不然慢回來的舊回應會把別張表單的欄位顯示在這一張底下，接著的排序、必填開關就會改到別張表單的欄位）
// 關卡也一樣：不是這張表單的關卡不能留在畫面上被儲存到這張表單（openWorkflowDialog 換表單後會自己重新讀）
watch(selectedFormId, () => {
  fieldsLoadSeq += 1
  fields.value = []
  workflowSteps.value = []
  workflowLoaded.value = false
  savedStepsSnapshot.value = '[]'
  stepErrors.value = {}
}, { flush: 'sync' })

watch(firstCategoryValue, (value) => {
  if (!formDialog.value.category && value) {
    formDialog.value.category = value
  }
})

let fieldsLoadSeq = 0
async function loadFields() {
  if (!selectedFormId.value) return
  const formId = selectedFormId.value
  const seq = ++fieldsLoadSeq
  const isStale = () => seq !== fieldsLoadSeq || selectedFormId.value !== formId
  const res = await readApi(API.fields(formId), undefined)
  if (isStale()) return
  if (!res) {
    ElMessage.error(LOAD_FAILURE_MESSAGE)
    return
  }
  if (res.ok) {
    const arr = await readJson(res)
    if (isStale()) return
    fields.value = Array.isArray(arr) ? arr.sort((a,b)=> (a.order??0)-(b.order??0)) : []
    // 清單上的欄位數跟著更新（只算啟用中的）
    setFormSummary(formId, { fieldCount: fields.value.filter((field) => field?.is_active !== false).length })
  } else {
    const message = await describeFailure(res, '載入欄位失敗')
    if (!isStale()) ElMessage.error(message)
  }
}

async function loadCategories() {
  const res = await readApi(API.formCategories)
  if (!res?.ok) {
    categoryOptions.value = []
    return
  }
  const list = await readJson(res)
  if (!Array.isArray(list)) {
    categoryOptions.value = []
    return
  }
  const seen = new Set()
  categoryOptions.value = list
    .map((item) => {
      const rawCode = typeof item?.code === 'string' ? item.code.trim() : ''
      const rawName = typeof item?.name === 'string' ? item.name.trim() : ''
      const value = rawCode || rawName || (typeof item?.id === 'string' ? item.id : '')
      if (!value) return null
      const label = rawName || value
      return {
        value,
        label,
        id: item?.id || value,
        description: typeof item?.description === 'string' ? item.description : '',
        builtin: Boolean(item?.builtin)
      }
    })
    .filter((option) => {
      if (!option || seen.has(option.value)) return false
      seen.add(option.value)
      return true
    })
}

async function loadDictionaryItems() {
  try {
    const res = await apiFetch(API.itemSettings)
    if (!res?.ok) return false
    dictionaryItems.value = normalizeItemSettings(await res.json())
    return true
  } catch (error) {
    console.warn('載入字典項目失敗：', error)
    return false
  }
}

// 字典的顯示名稱（取字典類自訂欄位的標籤，例如「假別類別 (C12)」）
function dictionaryLabelFor(key) {
  const matched = customFieldOptions.value.find((opt) => opt.value === key && isDictionaryCustomField(opt.field))
  return matched?.field?.label || key
}

// 字典目前的項目名稱；字典沒有項目時退回欄位自己儲存的選項
function resolveDictionaryNames(key, fallbackOptions) {
  const names = dictionaryItemNames(dictionaryItems.value[key])
  if (names.length) return names
  return dictionaryItemNames(normalizeCustomFieldOptions(fallbackOptions))
}

// 表格「選項來源」標籤：只有下拉 / 複選欄位顯示
function fieldSourceTag(row) {
  if (!isDictionaryLinkableType(row?.type_1)) return null
  const key = getFieldDictionaryKey(row)
  return key ? { text: `字典：${dictionaryLabelFor(key)}`, type: 'success' } : { text: '手動', type: 'info' }
}

// 表格「選項」欄的預覽：前幾個選項的名稱，其餘用「等 N 個」帶過（連結字典時是伺服器即時解析的字典項目）
const FIELD_OPTIONS_PREVIEW_COUNT = 4
function fieldOptionsPreview(row) {
  if (!isDictionaryLinkableType(row?.type_1)) return ''
  const names = dictionaryItemNames(normalizeCustomFieldOptions(row.options))
  if (!names.length) return '尚未設定選項'
  const head = names.slice(0, FIELD_OPTIONS_PREVIEW_COUNT).join('、')
  return names.length > FIELD_OPTIONS_PREVIEW_COUNT ? `${head} 等 ${names.length} 個` : head
}

// 新欄位排在最後：用目前最大的排序值加一（欄位被刪過之後排序值不連續，用欄位數會和既有的欄位撞號、插到中間）
function nextFieldOrder() {
  const orders = fields.value.map((field) => Number(field?.order)).filter(Number.isFinite)
  return orders.length ? Math.max(...orders) + 1 : 0
}

// 已停用的欄位（已有申請單的欄位被「刪除」時改成停用）在表格裡灰掉
function fieldRowClass({ row }) {
  return row?.is_active === false ? 'field-row-inactive' : ''
}

// 開啟欄位視窗時重新讀取字典，避免唯讀預覽顯示過期項目
async function refreshDictionaryPreview() {
  const loaded = await loadDictionaryItems()
  if (!loaded || !fieldDialogLinked.value) return
  const names = dictionaryItemNames(dictionaryItems.value[fieldDialog.value.field_key])
  if (names.length) {
    fieldDialog.value = { ...fieldDialog.value, optionsStr: stringifyCustomFieldOptions(names) }
  }
}

function openFieldDialog(mode='create', row=null) {
  fieldDialogMode.value = mode
  if (mode === 'edit' && row) {
    // 伺服器回傳 dictionaryKey（含依標籤代碼自動連結的欄位）時，以連結狀態開啟
    const dictionaryKey = isDictionaryLinkableType(row.type_1) ? getFieldDictionaryKey(row) : ''
    fieldDialog.value = {
      ...row,
      optionsStr: dictionaryKey
        ? stringifyCustomFieldOptions(resolveDictionaryNames(dictionaryKey, row.options))
        : stringifyCustomFieldOptions(row.options),
      field_key: row.field_key || dictionaryKey,
      dictionaryLinked: Boolean(dictionaryKey),
      dictionaryLabel: dictionaryKey ? dictionaryLabelFor(dictionaryKey) : '',
      explicitUnlink: false
    }
    selectedCustomFieldKey.value = dictionaryKey || row.field_key || ''
  } else {
    fieldDialog.value = { _id: '', field_key: '', label: '', type_1: 'text', type_2: '', required: false, optionsStr: '', placeholder: '', order: nextFieldOrder(), dictionaryLinked: false, dictionaryLabel: '', explicitUnlink: false }
    selectedCustomFieldKey.value = ''
  }
  fieldDialogVisible.value = true
  refreshDictionaryPreview()
}

// 編輯請假表單的系統欄位：改完之後系統還找得到這個用途的欄位才放行（改名、改型別、取消必填）
function systemFieldEditBlocked(payload) {
  const original = fields.value.find((field) => String(field._id) === String(fieldDialog.value._id))
  const role = original ? systemFieldRole(original) : null
  if (!role) return false
  if (brokenSystemRole(original, { ...original, label: payload.label })) {
    refuseSystemFieldChange(role, '改成這個名稱')
    return true
  }
  if (payload.type_1 !== original.type_1 && !role.types.includes(payload.type_1)) {
    refuseSystemFieldChange(role, '改成這個型別')
    return true
  }
  if (role.requiredLocked && original.required && !payload.required) {
    refuseSystemFieldChange(role, '取消必填')
    return true
  }
  return false
}

async function saveField() {
  if (!selectedFormId.value || fieldSaving.value) return
  // 連結字典時，儲存字典目前的項目名稱當備援快照（實際選項由伺服器即時解析字典）
  const linkedNames = fieldDialogLinked.value
    ? resolveDictionaryNames(fieldDialog.value.field_key, fieldDialog.value.optionsStr)
    : []
  const payload = {
    label: fieldDialog.value.label,
    type_1: fieldDialog.value.type_1,
    type_2: fieldDialog.value.type_2,
    required: fieldDialog.value.required,
    options: fieldDialogLinked.value
      ? (linkedNames.length ? linkedNames : undefined)
      : parseCustomFieldOptionsInput(fieldDialog.value.optionsStr),
    placeholder: fieldDialog.value.placeholder,
    order: fieldDialog.value.order ?? nextFieldOrder(),
  }
  // field_key 只在連結字典、或符合伺服器格式時才送出（非字典類自訂欄位的代碼伺服器用不到，格式不符還會被 400 擋下）
  const fieldKey = typeof fieldDialog.value.field_key === 'string' ? fieldDialog.value.field_key.trim() : ''
  if (fieldKey && (fieldDialogLinked.value || FIELD_KEY_PATTERN.test(fieldKey))) payload.field_key = fieldKey
  // 解除連結：編輯時清掉已儲存的 field_key；新增時也要明確送出空值，否則伺服器會依標籤尾端的代碼（如 C12）再次自動連結
  else if (fieldDialogMode.value === 'edit' || fieldDialog.value.explicitUnlink) payload.field_key = ''
  const isEdit = fieldDialogMode.value === 'edit' && fieldDialog.value._id
  if (isEdit && systemFieldEditBlocked(payload)) return
  fieldSaving.value = true
  try {
    const res = await sendWrite(
      isEdit ? API.field(selectedFormId.value, fieldDialog.value._id) : API.fields(selectedFormId.value),
      {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      '儲存欄位失敗'
    )
    if (!res) return
    fieldDialogVisible.value = false
    await loadFields()
  } finally {
    fieldSaving.value = false
  }
}

// 必填開關：請假表單的假別、開始、結束欄位不能取消必填
async function setFieldRequired(row, required) {
  const role = systemFieldRole(row)
  if (role?.requiredLocked && !required) {
    refuseSystemFieldChange(role, '取消必填')
    return
  }
  row.required = Boolean(required)
  await updateField(row)
}

async function updateField(row) {
  // 連結字典的欄位，row.options 是伺服器即時解析的結果，不回寫以免覆蓋備援快照
  const linked = isDictionaryLinkableType(row.type_1) && Boolean(getFieldDictionaryKey(row))
  const payload = { label: row.label, type_1: row.type_1, type_2: row.type_2, required: row.required, options: linked ? undefined : row.options, placeholder: row.placeholder, order: row.order }
  if (row.field_key) payload.field_key = row.field_key
  const res = await sendWrite(
    API.field(selectedFormId.value, row._id),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    },
    '更新欄位失敗'
  )
  if (!res) await loadFields() // 還原開關等畫面狀態，與資料庫保持一致
}

// 啟用 / 停用欄位：停用的欄位不會出現在填寫畫面，但舊申請單仍會顯示當時的答案
async function setFieldActive(row, active) {
  if (!active) {
    const role = brokenSystemRole(row, null)
    if (role) {
      refuseSystemFieldChange(role, '停用')
      return
    }
  }
  const res = await sendWrite(
    API.field(selectedFormId.value, row._id),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: Boolean(active) })
    },
    active ? '啟用欄位失敗' : '停用欄位失敗'
  )
  if (res) ElMessage.success(active ? '已啟用欄位' : '已停用欄位')
  await loadFields()
}

function confirmationMessage(lines) {
  return h('div', { class: 'confirm-lines' }, lines.map((line) => h('p', { style: 'margin:0 0 6px' }, line)))
}

async function removeField(row) {
  const role = brokenSystemRole(row, null)
  if (role) {
    refuseSystemFieldChange(role, '刪除')
    return
  }
  try {
    await ElMessageBox.confirm(
      confirmationMessage([
        `確定要刪除欄位「${row.label || ''}」嗎？`,
        '這張表單還沒有任何申請單時，欄位會直接刪除，無法復原。',
        '如果已經有申請單，欄位不會被刪除，而是改為「停用」：新的申請不會再看到它，舊申請單仍會顯示當時填寫的內容。',
      ]),
      '確認刪除欄位',
      { confirmButtonText: '刪除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (error) {
    return // 取消
  }
  const res = await sendWrite(API.field(selectedFormId.value, row._id), { method: 'DELETE' }, '刪除欄位失敗')
  if (res) {
    const body = await readJson(res)
    ElMessage.success(body?.deactivated ? (body.message || '已改為停用欄位（舊申請單仍會顯示當時的內容）') : '已刪除欄位')
  }
  await loadFields()
}

async function moveField(index, offset) {
  const newIndex = index + offset
  if (newIndex < 0 || newIndex >= fields.value.length) return
  // 上一次的排序還在儲存時不接受下一次（連按兩下會讓兩批排序值交錯寫進去）
  if (fieldOrderSaving.value) return
  fieldOrderSaving.value = true
  try {
    const formId = selectedFormId.value
    const arr = fields.value
    const [item] = arr.splice(index, 1)
    arr.splice(newIndex, 0, item)
    for (let i = 0; i < arr.length; i++) {
      // 排序值沒有變的欄位不用再存一次
      if (Number(arr[i].order) === i) continue
      arr[i].order = i
      const res = await sendWrite(
        API.field(formId, arr[i]._id),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: i })
        },
        '調整欄位排序失敗'
      )
      if (!res) {
        await loadFields() // 只有部分欄位存成功時，以資料庫的順序為準
        return
      }
    }
  } finally {
    fieldOrderSaving.value = false
  }
}

/* 讀取樣板列表 */
async function loadForms() {
  const res = await readApi(API.forms)
  if (!res) {
    ElMessage.error(LOAD_FAILURE_MESSAGE)
    return
  }
  if (res.ok) {
    const list = await readJson(res)
    forms.value = Array.isArray(list) ? list : []
    formsLoaded.value = true
    // 試算選的表單已經被刪除：清掉，不然選單會顯示一串編號
    if (trial.value.formId && !forms.value.some((item) => item._id === trial.value.formId)) {
      trial.value = { ...trial.value, formId: '', result: null, error: '' }
    }
  } else {
    ElMessage.error(await describeFailure(res, '載入表單樣板失敗'))
  }
}

/* 表單清單的摘要：每張表單的關卡與欄位數。清單 API 不帶這些資料，所以逐張讀（一次最多 4 個請求）；
   讀不到的只顯示「—」，不影響其他功能 */
function setFormSummary(formId, patch) {
  if (!formId) return
  formSummaries.value = { ...formSummaries.value, [formId]: { steps: null, fieldCount: null, ...formSummaries.value[formId], ...patch } }
}

let summaryLoadSeq = 0
async function loadFormSummary(formId) {
  const [workflowRes, fieldsRes] = await Promise.all([readApi(API.workflow(formId)), readApi(API.fields(formId))])
  let steps = null
  if (workflowRes?.ok) {
    const workflow = await readJson(workflowRes)
    steps = Array.isArray(workflow?.steps) ? workflow.steps : []
  } else if (workflowRes?.status === 404) {
    steps = [] // 還沒有流程文件
  }
  const fieldList = fieldsRes?.ok ? await readJson(fieldsRes) : null
  return {
    steps,
    fieldCount: Array.isArray(fieldList) ? fieldList.filter((field) => field?.is_active !== false).length : null,
  }
}

async function loadFormSummaries(formIds = forms.value.map((item) => item._id)) {
  const seq = ++summaryLoadSeq
  const queue = formIds.filter(Boolean)
  const worker = async () => {
    while (queue.length && seq === summaryLoadSeq) {
      const formId = queue.shift()
      const summary = await loadFormSummary(formId)
      // 重新整理清單後，舊的一輪不再寫入
      if (seq === summaryLoadSeq) setFormSummary(formId, summary)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
}

// 一關的簡短說法，用在清單的流程摘要（「主管鏈 → 人資」）
function stepSummaryLabel(step) {
  const values = stepValues(step?.approver_value)
  const named = (list, fallback) => {
    const names = list.filter(Boolean)
    if (!names.length) return fallback
    return names.length > 2 ? `${names.slice(0, 2).join('、')} 等 ${names.length} 位` : names.join('、')
  }
  let label
  switch (step?.approver_type) {
    case 'manager': {
      const id = values[0]
      label = !id || id === APPLICANT_SUPERVISOR_VALUE ? '直屬主管' : (employeeById.value.get(id)?.name || '指定主管')
      break
    }
    case 'manager_chain': {
      const tag = normalizeTagText(step?.approver_value?.stopAtTag)
      label = tag ? `主管鏈（到「${tag}」）` : '主管鏈'
      break
    }
    case 'tag': label = normalizeTagText(values[0]) || '標籤'; break
    case 'user': label = named(values.map((id) => employeeById.value.get(id)?.name), '指定員工'); break
    case 'role': label = roleOptions.value.find((opt) => opt.value === values[0])?.label.replace(/^(系統權限|簽核角色)：/, '') || '角色'; break
    case 'level': label = levelOptions.value.find((opt) => opt.value === values[0])?.label || '層級'; break
    case 'department': label = departmentOptions.value.find((opt) => opt.value === values[0])?.label || '部門'; break
    case 'org': label = organizationOptions.value.find((opt) => opt.value === values[0])?.label || '機構'; break
    case 'group': label = named(values.map((id) => groupOptions.value.find((opt) => opt.value === id)?.label), '小單位'); break
    default: label = approverTypeLabel(step?.approver_type) || '未設定'
  }
  const condition = CONDITION_KIND_OPTIONS.find((opt) => opt.value === step?.condition?.kind)
  return condition ? `${label}（滿 ${step.condition.value} ${condition.unit}）` : label
}

function orderedSteps(steps) {
  return (Array.isArray(steps) ? steps : [])
    .map((step, index) => ({ step, index }))
    .sort((a, b) => ((Number(a.step?.step_order) || a.index + 1) - (Number(b.step?.step_order) || b.index + 1)) || (a.index - b.index))
    .map((item) => item.step)
}

// 清單上的「簽核流程」：{ text, warn }
function flowSummary(form) {
  const summary = formSummaries.value[form?._id]
  if (!summary) return { text: '…', warn: false }
  if (summary.steps === null) return { text: '—', warn: false }
  if (!summary.steps.length) return { text: '尚未設定關卡（員工無法送出）', warn: true }
  return { text: `${summary.steps.length} 關：${orderedSteps(summary.steps).map(stepSummaryLabel).join(' → ')}`, warn: false }
}

function fieldCountText(form) {
  const summary = formSummaries.value[form?._id]
  if (!summary) return '…'
  return summary.fieldCount === null ? '—' : `${summary.fieldCount} 個`
}

const stepTabLabel = computed(() => (workflowLoaded.value ? `簽核關卡（${workflowSteps.value.length}）` : '簽核關卡'))
const fieldTabLabel = computed(() => {
  const count = formSummaries.value[selectedFormId.value]?.fieldCount
  return Number.isFinite(count) ? `欄位（${count}）` : '欄位'
})

async function loadEmployeeOptions() {
  const res = await readApi(API.employees)
  if (!res?.ok) {
    employeeOptions.value = []
    return
  }
  const list = await readJson(res)
  employeeOptions.value = Array.isArray(list)
    ? list
        .filter((item) => item && item.id)
        .map((e) => {
          const dept = e.department && typeof e.department === 'object'
            ? { id: e.department.id || e.department._id || e.department, name: e.department.name || '' }
            : null
          const organization = normalizeOrganizationField(e.organization)
          return {
            id: e.id,
            name: e.name,
            photo: e.photo ?? '',
            username: e.username,
            signRole: e.signRole ?? '',
            signLevel: e.signLevel ?? '',
            signTags: Array.isArray(e.signTags) ? e.signTags : [],
            organization,
            department: dept,
            role: e.role ?? '',
            status: e.status ?? '',
            accountEnabled: e.accountEnabled !== false,
            ineligibleReason: employeeIneligibleReason(e),
            displayName: e.displayName || (e.username ? `${e.name}（${e.username}）` : e.name),
          }
        })
    : []
}

async function loadOrganizationOptions() {
  const res = await readApi(API.organizations)
  if (!res?.ok) {
    organizationNameMap.value = {}
    return
  }
  const list = await readJson(res)
  if (!Array.isArray(list)) {
    organizationNameMap.value = {}
    return
  }
  const map = {}
  list.forEach((item) => {
    const id = toValueString(item?._id ?? item?.id ?? item?.value)
    const normalizedId = typeof id === 'string' ? id.trim() : id
    if (!normalizedId) return
    const name = typeof item?.name === 'string' ? item.name.trim() : ''
    if (!map[normalizedId] || name) {
      map[normalizedId] = name || normalizedId
    }
  })
  organizationNameMap.value = map
}

async function loadDepartmentRecords() {
  const res = await readApi(API.departments)
  const list = res?.ok ? await readJson(res) : null
  departmentRecords.value = Array.isArray(list)
    ? list
        .map((item) => ({ id: toValueString(item?._id ?? item?.id), name: typeof item?.name === 'string' ? item.name.trim() : '' }))
        .filter((item) => item.id)
    : []
}

async function loadSignRoleOptions() {
  const res = await readApi(API.signRoles)
  const list = res?.ok ? await readJson(res) : null
  signRoleOptions.value = Array.isArray(list) ? list : []
}

async function loadSignLevelOptions() {
  const res = await readApi(API.signLevels)
  const list = res?.ok ? await readJson(res) : null
  signLevelOptions.value = Array.isArray(list) ? list : []
}

// 標籤詞彙表與各標籤的持有人數；讀取失敗時視為沒有額外標籤，不影響編輯
async function loadSignTags() {
  const res = await readApi(API.signTags)
  const data = res?.ok ? await readJson(res) : null
  if (!res?.ok || !Array.isArray(data?.tags)) {
    signTagInfo.value = []
    signTagsLoaded.value = false
    return
  }
  signTagInfo.value = data.tags
    .map((item) => ({
      name: normalizeTagText(item?.name),
      count: Number(item?.count),
      requiredByWorkflows: Number(item?.requiredByWorkflows) || 0,
    }))
    .filter((item) => item.name)
  signTagsLoaded.value = true
}

async function loadGroupOptions() {
  const res = await readApi(API.subDepartments)
  if (!res?.ok) {
    groupOptions.value = []
    return
  }
  const list = await readJson(res)
  if (!Array.isArray(list)) {
    groupOptions.value = []
    return
  }
  const seen = new Set()
  groupOptions.value = list
    .map((item) => {
      const id = toValueString(item?._id ?? item?.id ?? item?.value)
      if (!id) return null
      const deptName = typeof item?.department === 'object'
        ? item.department?.name || item.department?.code || toValueString(item.department?._id)
        : toValueString(item?.department)
      const baseLabel = item?.name || item?.code || id
      const label = deptName ? `${baseLabel}（${deptName}）` : baseLabel
      return { value: id, label }
    })
    .filter((opt) => opt && !seen.has(opt.value) && seen.add(opt.value))
}

function toValueString(val) {
  if (val == null) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  if (typeof val === 'object') {
    if (val._id != null) return toValueString(val._id)
    if (val.id != null) return toValueString(val.id)
  }
  return String(val)
}

function resolveOrganizationLabel(id, fallbackName = '') {
  const trimmedId = typeof id === 'string' ? id.trim() : id
  const map = organizationNameMap.value || {}
  if (trimmedId && typeof map[trimmedId] === 'string' && map[trimmedId].trim()) {
    return map[trimmedId].trim()
  }
  const trimmedFallback = typeof fallbackName === 'string' ? fallbackName.trim() : ''
  if (trimmedFallback) return trimmedFallback
  return trimmedId || ''
}

function normalizeOrganizationField(rawOrg) {
  const idValue = rawOrg && typeof rawOrg === 'object'
    ? rawOrg._id ?? rawOrg.id ?? rawOrg.value ?? rawOrg.code
    : rawOrg
  const rawId = toValueString(idValue)
  const id = typeof rawId === 'string' ? rawId.trim() : rawId
  const name = rawOrg && typeof rawOrg === 'object' && typeof rawOrg.name === 'string'
    ? rawOrg.name.trim()
    : ''
  return {
    id: id || '',
    name: resolveOrganizationLabel(id || '', name)
  }
}

/* 關卡編輯：不會悄悄改寫已儲存的值，找不到對應選項的值標示為「已失效」，儲存時再詢問 */
function stepValues(raw) {
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return list.map((val) => toValueString(val)).filter((val) => Boolean(val))
}

function scopeApplies(type) {
  return SCOPE_APPLIES_TO.includes(type)
}

function approverTypeHint(type) {
  return APPROVER_TYPE_HINTS[type] || ''
}

function approverTypeLabel(type) {
  return APPROVER_TYPES.find((opt) => opt.value === type)?.label || type || ''
}

function defaultValueForType(type) {
  if (type === 'user' || type === 'group') return []
  if (type === 'manager') return APPLICANT_SUPERVISOR_VALUE
  if (type === 'manager_chain') return { stopAtTag: '', maxLevels: MANAGER_CHAIN_DEFAULT_LEVELS }
  return ''
}

/* 主管鏈的設定：{ stopAtTag, maxLevels }；格式不對時用預設（不設停止標籤、最多 5 級） */
function normalizeChainValue(raw) {
  const config = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const levels = Number(config.maxLevels)
  return {
    stopAtTag: normalizeTagText(config.stopAtTag),
    maxLevels: Number.isInteger(levels) && levels >= 1 && levels <= MANAGER_CHAIN_MAX_LEVELS ? levels : MANAGER_CHAIN_DEFAULT_LEVELS,
  }
}

/* 關卡的適用條件：畫面上一律是 { kind, value }（kind 空白＝每張都要）；送出時沒有 kind 就不帶 */
function normalizeConditionValue(raw) {
  const option = CONDITION_KIND_OPTIONS.find((opt) => opt.value === raw?.kind)
  if (!option) return { kind: '', value: null }
  const value = Number(raw?.value)
  return { kind: option.value, value: Number.isFinite(value) ? value : option.defaultValue }
}

function conditionOption(row) {
  return CONDITION_KIND_OPTIONS.find((opt) => opt.value === row?.condition?.kind) || null
}

function conditionLimits(row) {
  const option = conditionOption(row)
  return option ? { min: option.min, max: option.max, step: option.step } : { min: 1, max: 366, step: 1 }
}

function conditionUnit(row) {
  return conditionOption(row)?.unit || ''
}

// 換了條件種類：數值改成這種條件的建議值（56 小時或 7 日），避免「7 小時」這種誤設
function handleConditionKindChange(row) {
  const option = conditionOption(row)
  row.condition = option ? { kind: option.value, value: option.defaultValue } : { kind: '', value: null }
}

function handleChainChange(row) {
  row.approver_value = normalizeChainValue(row.approver_value)
  Object.assign(row, normalizeStep(row))
}

// 這張表單是不是請假表單（與伺服器 isLeaveFormTemplate 相同：有表單性質時以它為準，沒有才看名稱）；只有請假表單能設定請假長度條件
function isLeaveFormRecord(form) {
  if (!form) return false
  if (form.semanticType) return form.semanticType === 'leave'
  return /請假|leave/i.test(String(form.name ?? ''))
}
const selectedFormIsLeave = computed(() => isLeaveFormRecord(forms.value.find((item) => item._id === selectedFormId.value)))

const roleOptions = computed(() => [
  ...SYSTEM_ROLE_OPTIONS,
  ...signRoleOptions.value.map((opt) => ({ value: opt.value, label: `簽核角色：${opt.label}（${opt.value}）` })),
])
const levelOptions = computed(() =>
  signLevelOptions.value.map((opt) => ({ value: opt.value, label: `${opt.label}（${opt.value}）` }))
)

// 判斷某個值在目前的選項裡是否找得到；選項還沒載入（空清單）時無法判斷，視為有效
function isKnownValue(type, value) {
  switch (type) {
    case 'role':
      return SYSTEM_ROLE_OPTIONS.some((opt) => opt.value === value)
        || signRoleOptions.value.some((opt) => opt.value === value)
        || (signRoleOptions.value.length === 0 && /^R\d{3}$/.test(value))
    case 'level':
      return signLevelOptions.value.length === 0 || signLevelOptions.value.some((opt) => opt.value === value)
    case 'department':
      return departmentOptions.value.length === 0 || departmentOptions.value.some((opt) => opt.value === value)
    case 'org':
      return organizationOptions.value.length === 0 || organizationOptions.value.some((opt) => opt.value === value)
    case 'group':
      return groupOptions.value.length === 0 || groupOptions.value.some((opt) => opt.value === value)
    default:
      return true
  }
}

/**
 * 分析一關目前的內容：values（選到的值）、stale（找不到對應選項的值）、
 * ineligible（找得到但不能簽核的人）、holders（標籤目前有幾位可簽核的人持有）。
 */
function analyzeStep(step) {
  const type = step?.approver_type
  // 主管鏈的設定是物件，沒有要檢查失效的值；只看停止標籤目前有幾位持有者
  const values = type === 'manager_chain' ? [] : stepValues(step?.approver_value)
  const info = { type, values, stale: [], ineligible: [], holders: null }
  const knowsEmployees = employeeOptions.value.length > 0
  switch (type) {
    case 'manager_chain': {
      const tag = normalizeTagText(step?.approver_value?.stopAtTag)
      info.holders = tag ? holdersOf(tag) : null
      break
    }
    case 'user': {
      if (!knowsEmployees) break
      values.forEach((id) => {
        const emp = employeeById.value.get(id)
        if (!emp) info.stale.push(id)
        else if (emp.ineligibleReason) info.ineligible.push(id)
      })
      break
    }
    case 'manager': {
      const id = values[0]
      if (!knowsEmployees || !id || id === APPLICANT_SUPERVISOR_VALUE) break
      const emp = employeeById.value.get(id)
      if (!emp || emp.role !== 'supervisor') info.stale.push(id)
      else if (emp.ineligibleReason) info.ineligible.push(id)
      break
    }
    case 'tag': {
      const tag = normalizeTagText(values[0])
      info.holders = tag ? holdersOf(tag) : null
      break
    }
    case 'role':
    case 'level':
    case 'department':
    case 'org':
    case 'group':
      values.forEach((value) => {
        if (!isKnownValue(type, value)) info.stale.push(value)
      })
      break
    default:
      break
  }
  return info
}

function hasValidApprover(step, info) {
  if (step?.approver_type === 'manager') return true // 沒指定時就是申請者的主管
  if (step?.approver_type === 'manager_chain') return true // 一定從申請人的直屬主管開始
  const valid = info.values.filter((value) => !info.stale.includes(value))
  if (step?.approver_type === 'tag') return Boolean(normalizeTagText(valid[0]))
  return valid.length > 0
}

function isStaleScope(step) {
  const scope = step?.scope_type
  return Boolean(scope) && !SCOPE_OPTIONS.some((opt) => opt.value === scope)
}

function describeStale(step, info) {
  switch (step?.approver_type) {
    case 'user': return `有 ${info.stale.length} 位員工已找不到（可能已被刪除或沒有登入帳號）`
    case 'manager': return '指定的主管已找不到，或已不是主管角色'
    case 'role': return `角色「${info.stale.join('、')}」已失效`
    case 'level': return `層級「${info.stale.join('、')}」已失效`
    case 'department': return '指定的部門已找不到'
    case 'org': return '指定的機構已找不到'
    case 'group': return `有 ${info.stale.length} 個小單位已找不到`
    default: return '有已失效的對象'
  }
}

// 顯示在簽核對象下方的提醒：已失效、不可簽核、標籤沒人持有
function stepNotices(row) {
  const notices = []
  if (!row || !row.approver_type) return notices
  const info = analyzeStep(row)
  if (info.stale.length) notices.push({ type: 'danger', text: `已失效：${describeStale(row, info)}` })
  if (isStaleScope(row)) notices.push({ type: 'danger', text: `已失效：範圍「${row.scope_type}」已不再支援，請重新選擇` })
  if (info.ineligible.length) {
    const names = info.ineligible
      .map((id) => employeeById.value.get(id))
      .filter(Boolean)
      .map((emp) => `${emp.name}（${emp.ineligibleReason}）`)
    notices.push({ type: 'warning', text: `包含不能簽核的人員：${names.join('、')}` })
  }
  if (row.approver_type === 'tag' && normalizeTagText(row.approver_value)) {
    if (info.holders === 0) notices.push({ type: 'warning', text: '目前沒有人持有此標籤' })
    else if (info.holders > 0) notices.push({ type: 'info', text: `目前 ${info.holders} 人持有此標籤` })
  }
  if (row.approver_type === 'manager_chain') {
    const tag = normalizeTagText(row.approver_value?.stopAtTag)
    if (!tag) notices.push({ type: 'info', text: '沒有選停止標籤：一路簽到最上層（或最多層數）' })
    else if (info.holders === 0) notices.push({ type: 'warning', text: '目前沒有人持有此標籤：主管鏈會一路簽到最上層（或最多層數）' })
    else if (info.holders > 0) notices.push({ type: 'info', text: `目前 ${info.holders} 位主管持有此標籤` })
  }
  return notices
}

// 已失效的值仍顯示在下拉裡（灰色、不可新選），不會因為找不到而被悄悄清掉
function withStaleOptions(options, row, labelOf = (value) => value) {
  const info = analyzeStep(row)
  const known = new Set(options.map((opt) => opt.value))
  const extra = info.stale
    .filter((value) => !known.has(value))
    .map((value) => ({ value, label: `（已失效）${labelOf(value)}`, disabled: true }))
  return [...options, ...extra]
}

// selectKey：畫面上那個選單的代號，員工很多時只畫出一部分（已選的一定在），輸入姓名搜尋全部；不帶就是全部選項
function windowEmployeeOptions(options, row, selectKey) {
  if (!selectKey) return options
  return windowOptions(options, {
    query: optionQueryFor(selectKey),
    selected: stepValues(row?.approver_value),
    moreLabel: EMPLOYEE_MORE_LABEL,
  })
}
function userOptionsFor(row, selectKey) {
  return windowEmployeeOptions(withStaleOptions(userApproverOptions.value, row), row, selectKey)
}
function managerOptionsFor(row, selectKey) {
  return windowEmployeeOptions(withStaleOptions(managerApproverOptions.value, row), row, selectKey)
}
// 「全部都要簽／任一人簽即可」：一關可能有多位簽核人時才顯示（只選了一位員工時也不用問）
function multiApproverApplies(row) {
  if (!MULTI_APPROVER_TYPES.includes(row?.approver_type)) return false
  if (row.approver_type === 'user') return stepValues(row.approver_value).length > 1
  return true
}
function roleOptionsFor(row) {
  return withStaleOptions(roleOptions.value, row)
}
function levelOptionsFor(row) {
  return withStaleOptions(levelOptions.value, row)
}
function departmentOptionsFor(row) {
  return withStaleOptions(departmentOptions.value, row)
}
function organizationOptionsFor(row) {
  return withStaleOptions(organizationOptions.value, row)
}
function groupOptionsFor(row) {
  return withStaleOptions(groupOptions.value, row)
}
function scopeOptionsFor(row) {
  const current = row?.scope_type
  if (current && isStaleScope(row)) {
    return [...SCOPE_OPTIONS, { value: current, label: `（已失效）${current}`, disabled: true }]
  }
  return SCOPE_OPTIONS
}

function normalizeStep(step) {
  const normalized = { ...step }
  normalized.approver_type = step.approver_type || 'user'
  normalized.scope_type = step.scope_type || 'none'
  normalized.is_required = step.is_required ?? true
  normalized.all_must_approve = step.all_must_approve ?? true
  normalized.can_return = step.can_return ?? true
  normalized.name = typeof step.name === 'string' ? step.name : ''

  const values = stepValues(step.approver_value)
  switch (normalized.approver_type) {
    case 'user':
    case 'group':
      // 只整理格式（去空值、去重複），找不到對應選項的值留著，標示為已失效
      normalized.approver_value = values.filter((val, idx) => values.indexOf(val) === idx)
      break
    case 'manager':
      // 沒指定主管時就是「申請者的主管」，伺服器也是這樣解讀
      normalized.approver_value = values[0] || APPLICANT_SUPERVISOR_VALUE
      break
    case 'manager_chain':
      normalized.approver_value = normalizeChainValue(step.approver_value)
      break
    case 'tag':
      normalized.approver_value = normalizeTagText(values[0])
      break
    default:
      normalized.approver_value = values.length ? values[0] : ''
  }
  normalized.condition = normalizeConditionValue(step.condition)

  const info = analyzeStep(normalized)
  normalized.__meta = {
    type: normalized.approver_type,
    requiresApprover: true,
    hasApprover: hasValidApprover(normalized, info),
    staleValues: [...info.stale],
    ineligibleValues: [...info.ineligible],
    staleScope: isStaleScope(normalized),
  }
  return normalized
}

function normalizeWorkflowSteps(steps = []) {
  return steps.map((step, idx) => {
    const normalized = normalizeStep(step)
    normalized.step_order = idx + 1
    if (normalized.__meta) normalized.__meta.stepOrder = normalized.step_order
    return normalized
  })
}

function handleApproverTypeChange(step) {
  // 管理者換了簽核類型：舊類型的值對新類型沒有意義，改回新類型的預設值
  const previousType = step.__meta?.type
  if (previousType && previousType !== step.approver_type) {
    step.approver_value = defaultValueForType(step.approver_type)
    if (!scopeApplies(step.approver_type)) step.scope_type = 'none'
  }
  Object.assign(step, normalizeStep(step))
}

function handleTagChange(step) {
  step.approver_value = normalizeTagText(step.approver_value)
  Object.assign(step, normalizeStep(step))
}

watch([employeeOptions, signRoleOptions, signLevelOptions, groupOptions, signTagInfo, departmentRecords, organizationNameMap], () => {
  workflowSteps.value = normalizeWorkflowSteps(workflowSteps.value)
})

async function loadCustomFieldOptions() {
  const res = await readApi(API.otherControlSettings)
  if (!res?.ok) {
    customFieldOptions.value = []
    return
  }
  const data = await readJson(res)
  const list = Array.isArray(data?.customFields) ? data.customFields : Array.isArray(data) ? data : []
  customFieldOptions.value = list
    .map((rawField) => {
      const fieldKey = rawField?.fieldKey || rawField?.field_key || ''
      return { rawField, fieldKey }
    })
    .filter(({ fieldKey }) => Boolean(fieldKey))
    .map(({ rawField, fieldKey }) => {
      const label = rawField.label || fieldKey
      const rawType = rawField.type || rawField.type_1 || ''
      const typeLabel = CUSTOM_FIELD_TYPE_LABELS[rawType] || fieldTypeLabel(rawType) || '未設定型別'
      const normalizedOptions = normalizeCustomFieldOptions(rawField.options ?? rawField.optionsInput)
      return {
        value: fieldKey,
        label: `${label}（${typeLabel}）`,
        field: {
          ...rawField,
          fieldKey,
          type_1: rawField.type_1 || rawField.type || 'text',
          type_2: rawField.type_2 || '',
          required: rawField.required ?? false,
          placeholder: rawField.placeholder || '',
          options: normalizedOptions,
        }
      }
    })
}

function handleCustomFieldSelect(fieldKey) {
  if (!fieldKey) {
    // 清除套用：原本連結字典時，optionsStr 已是字典項目，保留成可編輯的手動選項
    // 同時記下「明確解除」，新增欄位時才會送出空的 field_key（見 saveField）
    fieldDialog.value = { ...fieldDialog.value, field_key: '', dictionaryLinked: false, dictionaryLabel: '', explicitUnlink: true }
    return
  }
  const option = customFieldOptions.value.find(opt => opt.value === fieldKey)
  if (!option) return
  const { field } = option
  if (isDictionaryCustomField(field)) {
    // 字典類自訂欄位：連結字典（選項即時使用字典），不複製一次性快照
    const names = resolveDictionaryNames(field.fieldKey, field.options)
    fieldDialog.value = {
      ...fieldDialog.value,
      field_key: field.fieldKey,
      label: field.label || field.fieldKey,
      type_1: isDictionaryLinkableType(field.type_1) ? field.type_1 : 'select',
      type_2: field.type_2 || '',
      required: field.required ?? false,
      placeholder: field.placeholder || '',
      optionsStr: stringifyCustomFieldOptions(names),
      dictionaryLinked: true,
      dictionaryLabel: field.label || field.fieldKey,
      explicitUnlink: false,
    }
    return
  }
  const normalizedOptions = normalizeCustomFieldOptions(field.options)
  fieldDialog.value = {
    ...fieldDialog.value,
    field_key: field.fieldKey,
    label: field.label || field.fieldKey,
    // 自訂欄位另外有的型別換成表單填得出來的型別（複合加選→複選、是／否→單一勾選、時間區間→文字）
    type_1: CUSTOM_TO_FORM_FIELD_TYPE[field.type_1] || field.type_1,
    type_2: field.type_2 || '',
    required: field.required ?? false,
    placeholder: field.placeholder || '',
    optionsStr: stringifyCustomFieldOptions(normalizedOptions),
    dictionaryLinked: false,
    dictionaryLabel: '',
    explicitUnlink: false,
  }
}

// 解除字典連結：清掉 field_key，並把目前的字典項目複製成可手動編輯的選項
function unlinkDictionaryField() {
  const names = resolveDictionaryNames(fieldDialog.value.field_key, fieldDialog.value.optionsStr)
  fieldDialog.value = {
    ...fieldDialog.value,
    field_key: '',
    dictionaryLinked: false,
    dictionaryLabel: '',
    optionsStr: stringifyCustomFieldOptions(names),
    explicitUnlink: true,
  }
  selectedCustomFieldKey.value = ''
}

/* 換表單時，同步讀這張表單的流程規則（workflow.policy 的「略過重複的簽核人」） */
async function loadWorkflow() {
  if (!selectedFormId.value) return
  const formId = selectedFormId.value
  const seq = ++policyLoadSeq
  policyFormId = formId
  const isStale = () => seq !== policyLoadSeq || selectedFormId.value !== formId
  // 先回到預設值：沒有流程文件（或讀取失敗）的表單不能沿用上一張表單的規則
  skipRepeatedApprovers.value = false
  policyLoaded.value = false
  const res = await readApi(API.workflow(formId))
  if (isStale()) return
  if (res?.ok) {
    const wf = await readJson(res)
    if (isStale()) return
    skipRepeatedApprovers.value = wf?.policy?.skipRepeatedApprovers === true
    policyLoaded.value = true
  } else if (!res) {
    ElMessage.error(LOAD_FAILURE_MESSAGE)
  } else if (res.status === 404) {
    // 這張表單還沒有流程文件：從預設值開始，可以直接儲存
    policyLoaded.value = true
  } else {
    const message = await describeFailure(res, '載入流程規則失敗')
    if (!isStale()) ElMessage.error(message)
  }
}

// 「略過重複的簽核人」切換後立即儲存，只送這一個欄位：不動其他規則，也不動關卡；失敗時開關回到原本的值
async function saveSkipRepeated() {
  if (!selectedFormId.value || skipRepeatedSaving.value) return
  const value = skipRepeatedApprovers.value === true
  if (!policyLoaded.value || policyFormId !== selectedFormId.value) {
    skipRepeatedApprovers.value = !value
    ElMessage.error('這張表單的流程規則還沒有成功載入，請回到表單清單重新開啟後再試')
    return
  }
  const formId = selectedFormId.value
  skipRepeatedSaving.value = true
  try {
    const res = await sendWrite(
      API.workflow(formId),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: { skipRepeatedApprovers: value } })
      },
      '儲存「略過重複的簽核人」失敗'
    )
    if (!res) {
      if (selectedFormId.value === formId) skipRepeatedApprovers.value = !value
      return
    }
    ElMessage.success(value ? '已開啟：後面的關卡不再重複簽核' : '已關閉：每一關照設定簽核（主管鏈仍會略過重複的主管）')
  } finally {
    skipRepeatedSaving.value = false
  }
}

/* 新增/編輯樣板 */
function openFormDialog(mode='create', row=null) {
  formDialogMode.value = mode
  if (mode === 'edit' && !row) {
    row = forms.value.find((item) => item._id === selectedFormId.value) || null
  }
  if (mode === 'edit' && row) {
    // 編輯既有樣板：顯示已儲存的表單性質，不再跟著名稱自動推斷
    formSemanticTouched.value = true
    formDialog.value = {
      _id: row._id,
      name: row.name,
      category: row.category || firstCategoryValue.value || '',
      semanticType: row.semanticType || 'general',
      is_active: row.is_active,
      description: row.description || ''
    }
  } else {
    formSemanticTouched.value = false
    formDialog.value = {
      _id: '',
      name: '',
      category: firstCategoryValue.value || '',
      semanticType: inferFormSemanticType(''),
      is_active: true,
      description: ''
    }
  }
  formDialogVisible.value = true
}

async function saveFormTemplate() {
  if (formSaving.value) return
  const payload = { ...formDialog.value }
  if (typeof payload.name === 'string') payload.name = payload.name.trim()
  if (!payload.name) {
    ElMessage.error('請輸入表單名稱')
    return
  }
  if (!payload.category && firstCategoryValue.value) {
    payload.category = firstCategoryValue.value
  }
  if (!payload.semanticType) {
    payload.semanticType = inferFormSemanticType(payload.name)
  }
  const isEdit = formDialogMode.value === 'edit'
  // 新增時沒有 _id（不送空字串）
  if (!isEdit) delete payload._id
  formSaving.value = true
  try {
    const res = await sendWrite(
      isEdit ? `${API.forms}/${payload._id}` : API.forms,
      {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      '儲存樣板失敗'
    )
    if (!res) return
    const saved = await readJson(res)
    formDialogVisible.value = false
    ElMessage.success(isEdit ? '已儲存表單' : '已新增表單，接著設定它的欄位與簽核關卡')
    await loadForms()
    // 新增的表單：直接進去設定它的欄位與關卡（清單上也補上它的摘要）
    const createdId = !isEdit && typeof saved?._id === 'string' ? saved._id : ''
    if (createdId && forms.value.some((item) => item._id === createdId)) {
      setFormSummary(createdId, { steps: [], fieldCount: 0 })
      // 正在設定別張表單、而且關卡有尚未儲存的變更時先問；不放棄就留在原本那張
      if (!selectedFormId.value || (await confirmDiscardSteps())) await openFormEditor({ _id: createdId }, 'fields')
    }
  } finally {
    formSaving.value = false
  }
}

// 清單的「停用／啟用」：只改啟用狀態，其他設定不動
async function toggleFormActive(row) {
  if (!row?._id) return
  const next = row.is_active === false
  if (!next) {
    try {
      await ElMessageBox.confirm(
        `停用後員工不會再看到「${row.name || ''}」，也不能再申請；已送出的申請單仍可繼續簽核與查看。之後可以再啟用。`,
        '停用表單',
        { confirmButtonText: '停用', cancelButtonText: '取消', type: 'warning' }
      )
    } catch (error) {
      return // 取消
    }
  }
  const res = await sendWrite(
    `${API.forms}/${row._id}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: next }) },
    next ? '啟用表單失敗' : '停用表單失敗'
  )
  if (!res) return
  ElMessage.success(next ? '已啟用表單' : '已停用表單')
  await loadForms()
}

async function removeForm(row = null) {
  const target = row && typeof row === 'object' && row._id
    ? row
    : forms.value.find((item) => item._id === selectedFormId.value)
  const id = target?._id || selectedFormId.value
  if (!id) return
  try {
    await ElMessageBox.confirm(
      confirmationMessage([
        `確定要刪除表單「${target?.name || ''}」嗎？`,
        '還沒有任何申請單用過這張表單時，會連同欄位與流程一起刪除，無法復原。',
        '如果已經有申請單（包含簽核中與歷史紀錄），系統不會刪除，而是改為「停用」：員工不能再申請，但舊的申請單與簽核中的單子都能照常查看與處理。',
      ]),
      '確認刪除表單樣板',
      { confirmButtonText: '刪除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (error) {
    return // 取消
  }
  const res = await sendWrite(`${API.forms}/${id}`, { method: 'DELETE' }, '刪除樣板失敗')
  if (!res) return
  const body = await readJson(res)
  if (body?.deactivated) {
    ElMessage.success(body.message || '這張表單已有申請單，已改為停用而沒有刪除')
  } else {
    // 伺服器的說明帶有後續影響（例如已從幾個部門的「使用簽核表單」拿掉這張表單），有就照著顯示
    ElMessage.success(typeof body?.message === 'string' && body.message.trim() ? body.message : '已刪除表單樣板')
    // 正在設定的就是這張表單：回到清單（已經刪除，不用再問未儲存的變更）
    if (selectedFormId.value === id) resetEditor()
  }
  await loadForms()
}

/* 一張表單的設定畫面 */
function snapshotStep(step) {
  if (!step) return ''
  return JSON.stringify([
    step.approver_type, step.approver_value, step.scope_type, step.is_required, step.all_must_approve, step.can_return,
    typeof step.name === 'string' ? step.name.trim() : '', step.condition?.kind || '', step.condition?.kind ? step.condition.value : null,
  ])
}
const snapshotSteps = (steps) => JSON.stringify((steps || []).map(snapshotStep))
const stepsDirty = computed(() => workflowLoaded.value && snapshotSteps(workflowSteps.value) !== savedStepsSnapshot.value)

function stepErrorText(index) {
  const entry = stepErrors.value[index]
  return entry && entry.snapshot === snapshotStep(workflowSteps.value[index]) ? entry.text : ''
}
// 把錯誤標在第 index + 1 關，並捲動到那一關
function markStepError(index, text) {
  if (!Number.isInteger(index) || index < 0 || index >= workflowSteps.value.length) return
  stepErrors.value = { [index]: { text, snapshot: snapshotStep(workflowSteps.value[index]) } }
  nextTick(() => {
    const card = rootEl.value?.querySelector?.('.step-card--error')
    if (typeof card?.scrollIntoView === 'function') card.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

// 離開正在設定的表單前：關卡有尚未儲存的變更就先問
async function confirmDiscardSteps() {
  if (!stepsDirty.value) return true
  try {
    await ElMessageBox.confirm(
      '簽核關卡有尚未儲存的變更，離開後這些變更會消失。',
      '尚未儲存的變更',
      { confirmButtonText: '放棄變更', cancelButtonText: '留在這裡', type: 'warning' }
    )
    return true
  } catch (error) {
    return false
  }
}

// 回到清單的狀態（不詢問）
function resetEditor() {
  workflowDialogSeq += 1
  policyLoadSeq += 1
  selectedFormId.value = ''
  workflowDialogVisible.value = false
  workflowSteps.value = []
  workflowLoaded.value = false
  workflowLoading.value = false
  savedStepsSnapshot.value = '[]'
  stepErrors.value = {}
  skipRepeatedApprovers.value = false
  policyLoaded.value = false
  if (activeTab.value === 'fields') activeTab.value = 'approvalLevels'
}

async function closeEditor() {
  if (!(await confirmDiscardSteps())) return
  resetEditor()
}

// 從清單開一張表單：tab 是 approvalLevels（簽核關卡）或 fields（欄位）
async function openFormEditor(row, tab = 'approvalLevels') {
  if (!row?._id) return
  activeTab.value = tab === 'fields' ? 'fields' : 'approvalLevels'
  await openWorkflowDialog(row)
}

function handleFormRowClick(row, column) {
  // 操作欄的按鈕有自己的動作
  if (column?.label === '操作') return
  openFormEditor(row)
}

function handleFormCommand(command, row) {
  if (command === 'edit') openFormDialog('edit', row)
  else if (command === 'trial') openTrialFor(row)
  else if (command === 'toggle') toggleFormActive(row)
  else if (command === 'delete') removeForm(row)
}

// 重新讀這張表單的關卡（「放棄變更」與讀取失敗後的「重新載入」）
async function reloadWorkflow(skipConfirm = false) {
  if (!selectedFormId.value) return
  if (skipConfirm !== true && stepsDirty.value) {
    try {
      await ElMessageBox.confirm(
        '放棄這次對簽核關卡的變更，回到上次儲存的內容？',
        '放棄變更',
        { confirmButtonText: '放棄變更', cancelButtonText: '繼續編輯', type: 'warning' }
      )
    } catch (error) {
      return
    }
  }
  await openWorkflowDialog({ _id: selectedFormId.value })
}

/* 讀取一張表單的關卡與流程規則，並開啟它的設定畫面 */
async function openWorkflowDialog(row) {
  const formId = row._id
  const seq = ++workflowDialogSeq
  // 再開別張表單時，前一張還沒回來的回應會被丟掉，不會把它的關卡塞進現在的畫面、再被儲存到這張表單
  const isStale = () => seq !== workflowDialogSeq || selectedFormId.value !== formId
  selectedFormId.value = formId
  workflowDialogVisible.value = true
  workflowSteps.value = []
  workflowLoaded.value = false
  workflowLoading.value = true
  savedStepsSnapshot.value = '[]'
  stepErrors.value = {}
  // 流程規則跟著這張表單：先回到預設值，也讓還在等的 loadWorkflow 作廢
  policyLoadSeq += 1
  policyFormId = formId
  skipRepeatedApprovers.value = false
  policyLoaded.value = false
  const res = await readApi(API.workflow(formId))
  if (isStale()) return
  workflowLoading.value = false
  if (!res) {
    ElMessage.error(LOAD_FAILURE_MESSAGE)
    return
  }
  if (res.ok) {
    const wf = await readJson(res)
    if (isStale()) return
    skipRepeatedApprovers.value = wf?.policy?.skipRepeatedApprovers === true
    policyLoaded.value = true
    // 依 step_order 排好（與伺服器儲存 / 執行的順序一致），再依位置重新編號
    workflowSteps.value = normalizeWorkflowSteps(orderedSteps(wf?.steps))
    savedStepsSnapshot.value = snapshotSteps(workflowSteps.value)
    workflowLoaded.value = true
    setFormSummary(formId, { steps: Array.isArray(wf?.steps) ? wf.steps : [] })
  } else if (res.status === 404) {
    // 這張表單還沒有流程：從空白開始設定（流程規則也是預設值）
    workflowSteps.value = []
    savedStepsSnapshot.value = '[]'
    workflowLoaded.value = true
    policyLoaded.value = true
  } else {
    const message = await describeFailure(res, '載入流程關卡失敗')
    if (!isStale()) ElMessage.error(message)
    return
  }
  // 重新讀標籤與持有人數，顯示最新狀態
  await loadSignTags()
}
function addStep() {
  if (workflowSteps.value.length >= MAX_WORKFLOW_STEPS) {
    ElMessage.error(`最多只能設定 ${MAX_WORKFLOW_STEPS} 關`)
    return
  }
  const step = normalizeStep({
    step_order: workflowSteps.value.length + 1,
    approver_type: 'user',
    approver_value: [],
    scope_type: 'none',
    is_required: true,
    all_must_approve: true,
    can_return: true,
  })
  workflowSteps.value.push(step)
}
function removeStep(i) {
  workflowSteps.value.splice(i, 1)
  workflowSteps.value = normalizeWorkflowSteps(workflowSteps.value)
}
function moveStep(index, offset) {
  const target = index + offset
  if (target < 0 || target >= workflowSteps.value.length) return
  const next = [...workflowSteps.value]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  workflowSteps.value = normalizeWorkflowSteps(next)
}

// 儲存前需要管理者確認的事項：失效的對象會被移除（remove）、其他只是提醒（warn）
function collectSaveIssues(steps) {
  const issues = []
  steps.forEach((step, idx) => {
    const info = analyzeStep(step)
    const label = `第${idx + 1}關（${approverTypeLabel(step.approver_type)}）`
    if (info.stale.length) {
      const result = step.approver_type === 'manager' ? '儲存後會改為「申請者的主管」' : '儲存時會移除'
      issues.push({ kind: 'remove', text: `${label}：${describeStale(step, info)}，${result}。` })
    }
    if (isStaleScope(step)) {
      issues.push({ kind: 'remove', text: `${label}：範圍「${step.scope_type}」已不再支援，儲存時會改為「不限」。` })
    }
    if (step.approver_type === 'tag' && step.is_required !== false && info.holders === 0) {
      issues.push({
        kind: 'warn',
        text: `${label}：標籤「${normalizeTagText(step.approver_value)}」目前沒有任何在職員工持有，員工送出申請時會因找不到簽核人而失敗（可以先儲存，再到員工管理為負責的人加上此標籤）。`,
      })
    }
    if ((step.approver_type === 'user' || step.approver_type === 'manager') && step.is_required !== false) {
      const valid = info.values.filter((value) => !info.stale.includes(value))
      if (valid.length && valid.every((value) => info.ineligible.includes(value))) {
        issues.push({ kind: 'warn', text: `${label}：選擇的人員目前都不能簽核（已離職、留職停薪或帳號停用），員工送出申請時會找不到簽核人。` })
      }
    }
    if (step.approver_type === 'manager_chain' && normalizeTagText(step.approver_value?.stopAtTag) && info.holders === 0) {
      issues.push({
        kind: 'warn',
        text: `${label}：標籤「${normalizeTagText(step.approver_value.stopAtTag)}」目前沒有任何在職員工持有，主管鏈會一路簽到最上層（或最多 ${step.approver_value.maxLevels} 級）。`,
      })
    }
    // 表單不是請假表單（例如表單性質改成一般）時，請假長度條件沒有作用，伺服器也不接受
    if (step.condition?.kind && !selectedFormIsLeave.value) {
      issues.push({ kind: 'remove', text: `${label}：這張表單不是請假表單，儲存時會移除這一關的請假長度條件。` })
    }
  })
  if (!steps.length) {
    issues.push({ kind: 'warn', text: '這張表單沒有任何簽核關卡，儲存後員工將無法送出這張表單的申請。' })
  }
  return issues
}

// 送給伺服器的關卡：去掉內部欄位，並移除（或還原預設的）已失效的對象
function toPayloadStep(step, idx) {
  const { __meta, condition, ...clean } = step
  const info = analyzeStep(step)
  const stale = new Set(info.stale)
  // 請假長度條件：只有請假表單、而且有選條件時才送出
  if (condition?.kind && selectedFormIsLeave.value) clean.condition = { kind: condition.kind, value: Number(condition.value) }
  if (clean.approver_type === 'manager_chain') {
    const chain = normalizeChainValue(clean.approver_value)
    clean.approver_value = { ...(chain.stopAtTag ? { stopAtTag: chain.stopAtTag } : {}), maxLevels: chain.maxLevels }
  } else if (Array.isArray(clean.approver_value)) {
    clean.approver_value = clean.approver_value.filter((value) => !stale.has(toValueString(value)))
  } else if (stale.has(toValueString(clean.approver_value))) {
    clean.approver_value = clean.approver_type === 'manager' ? APPLICANT_SUPERVISOR_VALUE : ''
  }
  if (isStaleScope(step) || !scopeApplies(clean.approver_type)) clean.scope_type = 'none'
  const name = typeof clean.name === 'string' ? clean.name.trim() : ''
  if (name) clean.name = name
  else delete clean.name
  return { ...clean, step_order: idx + 1 }
}

async function saveWorkflow() {
  if (!selectedFormId.value || workflowSaving.value) return
  if (!workflowLoaded.value) {
    ElMessage.error('流程關卡還沒有成功載入，請關閉後重新開啟再編輯')
    return
  }
  const formId = selectedFormId.value
  const normalizedSteps = normalizeWorkflowSteps(workflowSteps.value)
  workflowSteps.value = normalizedSteps
  stepErrors.value = {}
  const invalidStepEntry = normalizedSteps
    .map((step, idx) => ({ step, idx }))
    .find(({ step }) => {
      const meta = step.__meta || {}
      if (meta.requiresApprover) return !meta.hasApprover
      if (Array.isArray(step.approver_value)) return step.approver_value.length === 0
      if (typeof step.approver_value === 'string') return step.approver_value.trim() === ''
      return false
    })
  if (invalidStepEntry) {
    const { step, idx } = invalidStepEntry
    const typeLabel = APPROVER_TYPES.find((opt) => opt.value === step.approver_type)?.label || step.approver_type
    const stepLabel = `第${idx + 1}關`
    const staleHint = step.__meta?.staleValues?.length ? '（原本選的對象已失效，請重新選擇）' : ''
    const message = `${stepLabel}${typeLabel ? `（${typeLabel}）` : ''}缺少有效簽核人${staleHint}`
    ElMessage.error(message)
    markStepError(idx, staleHint ? '原本選的簽核對象已失效，請重新選擇' : '請選擇這一關的簽核對象')
    return
  }

  // 請假長度條件：數值要填，而且至少一關沒有條件（不然未達條件的假單沒有人簽核）
  if (selectedFormIsLeave.value) {
    const missingValue = normalizedSteps.findIndex((step) => step.condition?.kind && !(Number(step.condition.value) > 0))
    if (missingValue >= 0) {
      ElMessage.error(`第${missingValue + 1}關：請輸入適用條件的數值（例如 56 小時或 7 日）`)
      markStepError(missingValue, '請輸入適用條件的數值（例如 56 小時或 7 日）')
      return
    }
    if (normalizedSteps.length && normalizedSteps.every((step) => step.condition?.kind)) {
      ElMessage.error('每一關都設定了請假長度條件：至少要有一關沒有條件，不然未達條件的假單會沒有人簽核')
      return
    }
  }

  const issues = collectSaveIssues(normalizedSteps)
  if (issues.length) {
    const hasRemoval = issues.some((issue) => issue.kind === 'remove')
    try {
      await ElMessageBox.confirm(
        h('div', { class: 'confirm-lines' }, [
          h('p', { style: 'margin:0 0 6px' }, '儲存前請確認：'),
          h('ul', { style: 'margin:0;padding-left:18px' }, issues.map((issue) => h('li', { style: 'margin-bottom:4px' }, issue.text))),
        ]),
        '儲存前請確認',
        {
          confirmButtonText: hasRemoval ? '移除失效項目並儲存' : '仍要儲存',
          cancelButtonText: '回去修改',
          type: 'warning',
        }
      )
    } catch (error) {
      return // 回去修改
    }
  }

  // 只送關卡：流程規則（略過重複的簽核人）自己儲存，兩邊互不覆蓋
  const payload = { steps: normalizedSteps.map(toPayloadStep) }
  workflowSaving.value = true
  try {
    const res = await sendWrite(
      API.workflow(formId),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      '儲存流程失敗',
      // 伺服器回的 step 是第幾關有問題：把原因標在那一關
      (failure) => {
        const position = Number(failure.data?.step)
        if (selectedFormId.value === formId && Number.isInteger(position) && position >= 1) {
          // 訊息開頭的「第2關（標籤）：」在那一關底下不用再說一次
          const reason = String(failure.detail || '').replace(/^第\s*\d+\s*關(（[^）]*）)?[：:]\s*/, '')
          markStepError(position - 1, reason || '這一關的設定有問題，請檢查後再儲存')
        }
      }
    )
    if (!res) return
    ElMessage.success('流程已儲存')
    setFormSummary(formId, { steps: payload.steps })
    // 留在這張表單：畫面改成剛剛存進去的內容（已失效的對象已移除），之後才判斷得出有沒有新的變更
    if (selectedFormId.value === formId) {
      workflowSteps.value = normalizeWorkflowSteps(payload.steps)
      savedStepsSnapshot.value = snapshotSteps(workflowSteps.value)
    }
  } finally {
    workflowSaving.value = false
  }
}

// 補齊預設值報告的標題與說明：依 warning.type 分別計算。三種問題要做的事不一樣
// （找不到簽核人 → 加標籤；表單停用 → 重新啟用；沒有關卡 → 設定關卡），不能全部說成「關卡找不到人」
const RESTORE_WARNING_KINDS = [
  {
    type: 'tag_without_holder',
    count: (n) => `${n} 個關卡找不到可簽核的人`,
    lead: '下列關卡目前找不到可簽核的人，員工送出申請時會被擋下，請到「員工管理」為負責的人加上對應的簽核標籤，或到「設定關卡」改成其他簽核對象：',
  },
  {
    type: 'inactive_template',
    count: (n) => `${n} 張表單已停用`,
    lead: '下列表單目前是停用狀態，員工看不到也無法申請；需要使用的話，請到「編輯」重新啟用：',
  },
  {
    type: 'empty_workflow',
    count: (n) => `${n} 張表單沒有任何關卡`,
    lead: '下列表單目前沒有任何簽核關卡，員工無法送出申請，請到「設定關卡」補上：',
  },
]
const RESTORE_OTHER_COUNT = (n) => `${n} 項其他問題`
const RESTORE_MIXED_LEAD = '下列項目需要處理（員工看不到這張表單，或送出申請時會被擋下），請依各項說明處理：'

function describeRestoreWarnings(warnings) {
  const list = Array.isArray(warnings) ? warnings : []
  if (!list.length) {
    return {
      title: '補齊預設值完成，預設表單需要的簽核標籤都有人持有',
      lead: '所有預設表單需要的簽核標籤都已有在職員工持有。',
    }
  }
  const known = new Set(RESTORE_WARNING_KINDS.map((kind) => kind.type))
  const counts = new Map()
  list.forEach((warning) => {
    // 舊版伺服器的警告沒有 type：只有「關卡找不到人」會帶 tag
    const type = known.has(warning?.type) ? warning.type : (!warning?.type && warning?.tag ? 'tag_without_holder' : 'other')
    counts.set(type, (counts.get(type) || 0) + 1)
  })
  const parts = RESTORE_WARNING_KINDS
    .filter((kind) => counts.has(kind.type))
    .map((kind) => kind.count(counts.get(kind.type)))
  if (counts.has('other')) parts.push(RESTORE_OTHER_COUNT(counts.get('other')))
  const onlyKind = counts.size === 1 ? RESTORE_WARNING_KINDS.find((kind) => counts.has(kind.type)) : null
  return {
    title: onlyKind?.type === 'tag_without_holder'
      ? `補齊預設值完成，但有 ${list.length} 個關卡目前找不到可簽核的人`
      : `補齊預設值完成，但有 ${list.length} 項需要處理（${parts.join('、')}）`,
    lead: onlyKind ? onlyKind.lead : RESTORE_MIXED_LEAD,
  }
}

const restoringDefaults = ref(false)
async function restoreDefaults() {
  if (restoringDefaults.value) return
  try {
    await ElMessageBox.confirm(
      '確定要補齊預設表單嗎？系統只會建立缺少的預設表單，現有表單與歷史申請都會保留。',
      '確認補齊預設表單',
      {
        confirmButtonText: '補齊',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    restoringDefaults.value = true

    const res = await apiFetch(API.restoreDefaults, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    if (res.ok) {
      const result = await res.json()
      const created = result.createdCount ?? result.count
      const repaired = Number(result.repairedCount) || 0
      ElMessage.success(
        `已補齊預設值，新增 ${created} 個，保留 ${result.preservedCount ?? 0} 個${repaired ? `，補回 ${repaired} 個表單的關卡` : ''}`
      )
      // 顯示檢查報告：預設表單需要的標籤與持有人數、找不到簽核人的關卡
      const warnings = Array.isArray(result.warnings) ? result.warnings : []
      const templates = Array.isArray(result.templates) ? result.templates : []
      const wording = describeRestoreWarnings(warnings)
      restoreReport.value = {
        title: wording.title,
        lead: wording.lead,
        warnings,
        templates: templates.map((item) => ({
          ...item,
          requiredTags: (Array.isArray(item.requiredTags) ? item.requiredTags : []).map((tag) => ({
            ...tag,
            holders: Number.isFinite(Number(tag.holders)) && tag.holders !== null ? Number(tag.holders) : null,
          })),
        })),
      }
      // 回到表單清單，重新讀表單與每張表單的摘要
      resetEditor()
      await loadForms()
      await Promise.all([loadFormSummaries(), loadSignTags()])
    } else {
      const error = await readJson(res)
      ElMessage.error(`恢復失敗: ${error?.error || '未知錯誤'}`)
    }
  } catch (e) {
    if (e !== 'cancel') {
      console.error('恢復預設值失敗:', e)
      ElMessage.error('恢復失敗，請稍後再試')
    }
  } finally {
    restoringDefaults.value = false
  }
}

/* 離開這一頁（換頁、重新整理、關閉分頁）前：關卡有尚未儲存的變更就先問 */
const router = inject(routerKey, null)
let removeRouteGuard = null
function handleBeforeUnload(event) {
  if (!stepsDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(async () => {
  if (typeof router?.beforeEach === 'function') {
    removeRouteGuard = router.beforeEach(async () => ((await confirmDiscardSteps()) ? true : false))
  }
  window.addEventListener('beforeunload', handleBeforeUnload)
  await Promise.all([loadCategories(), loadCustomFieldOptions(), loadDictionaryItems()])
  await loadForms()
  // 清單的摘要和下面的選項同時讀，不擋住畫面
  const summaries = loadFormSummaries()
  await loadGroupOptions()
  await loadOrganizationOptions()
  await loadEmployeeOptions()
  await Promise.all([loadSignRoleOptions(), loadSignLevelOptions(), loadSignTags(), loadDepartmentRecords(), loadTopLevelApprovers(), summaries])
})

onBeforeUnmount(() => {
  if (typeof removeRouteGuard === 'function') removeRouteGuard()
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<style scoped>
.approval-flow-setting { padding: 0; }
.field-hint { flex: 0 0 100%; margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--hr-gray-500); }

/* 表單清單 */
.form-search { width: 260px; max-width: 100%; }
.form-table :deep(.el-table__row) { cursor: pointer; }
.form-name { font-weight: var(--hr-font-weight-semibold); color: var(--hr-gray-900); }
.form-desc { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flow-summary { font-size: 13px; color: var(--hr-gray-700); }
.flow-summary--warn { color: #b45309; }
.form-more { margin-left: 12px; vertical-align: middle; }
.restore-report { margin-bottom: 16px; max-width: 900px; }
.restore-report-lead { margin: 4px 0; font-size: 13px; line-height: 1.6; }
.restore-report-list { margin: 4px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.7; }
.restore-report-tags { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.restore-report-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; }
.restore-report-name { min-width: 88px; font-weight: 600; color: var(--hr-gray-700); }
.restore-report-muted { color: var(--hr-gray-400); }
.restore-report-tag { margin: 0; }

/* 一張表單的設定 */
.editor-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--hr-space-sm); margin-bottom: var(--hr-space-sm); }
.editor-back { flex: 0 0 100%; justify-content: flex-start; }
.editor-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--hr-space-sm); min-width: 0; }
.editor-name { margin: 0; font-size: var(--hr-font-size-lg); font-weight: var(--hr-font-weight-semibold); color: var(--hr-gray-900); }
.reload-button { margin-left: var(--hr-space-sm); }

/* 關卡：一關一張卡片，讀起來是一句話 */
.step-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--hr-space-sm); }
.step-card { padding: 12px var(--hr-space-md); border: 1px solid var(--hr-gray-200); border-radius: var(--hr-radius-md); background: var(--hr-white); }
.step-card--error { border-color: var(--hr-error); }
.step-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; }
.step-no { font-size: var(--hr-font-size-base); font-weight: var(--hr-font-weight-semibold); color: var(--hr-gray-900); }
.step-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
.step-word { font-size: 14px; color: var(--hr-gray-700); white-space: nowrap; }
.step-type { width: 170px; }
.step-value { width: 240px; max-width: 100%; }
.step-value--wide { width: 420px; }
.step-scope { width: 110px; }
.step-mode { width: 140px; }
.step-number { width: 110px; }
.step-condition-kind { width: 190px; }
.step-name { width: 280px; max-width: 100%; }
.chain-config { display: contents; }
.step-rules { gap: 8px 24px; }
.step-rule { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--hr-gray-700); }
.step-hint { font-size: 12px; line-height: 1.5; color: var(--hr-gray-500); }
.step-notices { margin-top: 6px; }
.step-notice { margin: 4px 6px 0 0; max-width: 100%; height: auto; white-space: normal; line-height: 1.5; }
.step-error { margin: 8px 0 0; font-size: 13px; color: var(--hr-error); }
.skip-repeated-row { display: flex; align-items: flex-start; gap: 12px; margin-top: var(--hr-space-md); padding: 12px var(--hr-space-md); border: 1px solid var(--hr-gray-200); border-radius: var(--hr-radius-md); background: var(--hr-gray-50); }
.skip-repeated-title { font-size: 14px; font-weight: var(--hr-font-weight-semibold); color: var(--hr-gray-900); }
.steps-actions { position: sticky; bottom: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: var(--hr-space-sm); margin-top: var(--hr-space-md); padding: 12px 0; border-top: 1px solid var(--hr-gray-200); background: var(--hr-white); }
.unsaved-mark { font-size: 13px; color: #b45309; }

/* 欄位 */
.field-system-tag { margin-left: 8px; }
.field-source-tag { margin-right: 6px; }
.field-options-preview { font-size: 13px; color: var(--hr-gray-600); }
.field-inactive-tag { margin-left: 6px; }
.field-system-alert { margin-bottom: var(--hr-space-md); }
:deep(.field-row-inactive) { opacity: 0.55; }

/* 共用規則 */
.top-level-card { max-width: 900px; }
.top-level-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0; }
.top-level-select { width: 520px; max-width: 100%; }
.top-level-warning { color: #b45309; }

/* 流程試算 */
.trial-panel { max-width: 1100px; }
.trial-form { margin-top: 12px; max-width: 760px; }
.trial-select { width: 320px; max-width: 100%; }
.trial-range-sep { margin: 0 8px; color: var(--hr-gray-500); }
.trial-inline-hint { flex: 0 0 auto; margin: 0 0 0 10px; }
.trial-result { margin-top: 12px; }
.trial-alert { margin-bottom: 8px; }
.trial-summary { margin: 8px 0; font-size: 14px; color: var(--hr-gray-700); }
.trial-subtitle { margin: 16px 0 6px; font-size: 14px; color: var(--hr-gray-700); }
.trial-trace { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.8; color: var(--hr-gray-600); }

@media (max-width: 767px) {
  .step-type, .step-value, .step-value--wide, .step-condition-kind, .step-name, .form-search { width: 100%; }
  .step-word { white-space: normal; }
  .steps-actions { position: static; }
  .trial-range-sep { display: block; margin: 4px 0; }
  .trial-inline-hint { flex: 0 0 100%; margin: 4px 0 0; }
}
</style>
