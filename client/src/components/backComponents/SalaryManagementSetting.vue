<!-- src/Components/backComponents/SalaryManagementSetting.vue -->

<template>
    <div class="salary-management-setting">
      <h2>薪資管理設定</h2>
  
      <el-tabs v-model="activeTab" type="card">
        <!-- 1) 薪資項目設定 -->
        <el-tab-pane label="薪資項目設定" name="salaryItem">
          <div class="tab-content">
            <el-button type="primary" @click="openItemDialog()">新增薪資項目</el-button>
            <el-table :data="salaryItems" style="margin-top: 20px;">
              <el-table-column prop="itemName" label="項目名稱" width="180" />
              <el-table-column prop="type" label="加項/扣項" width="120" />
              <el-table-column prop="taxable" label="是否計稅" width="100">
                <template #default="{ row }">
                  {{ row.taxable ? '是' : '否' }}
                </template>
              </el-table-column>
              <el-table-column prop="insuranceAffect" label="是否影響投保" width="130">
                <template #default="{ row }">
                  {{ row.insuranceAffect ? '是' : '否' }}
                </template>
              </el-table-column>
              <el-table-column prop="desc" label="說明" />
              <el-table-column label="操作" width="180">
                <template #default="{ row, $index }">
                  <el-button type="primary" @click="openItemDialog($index)">編輯</el-button>
                  <el-button type="danger" @click="deleteItem($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>
  
            <!-- 新增/編輯 薪資項目 Dialog -->
            <el-dialog v-model="itemDialogVisible" title="薪資項目設定" width="500px">
              <el-form :model="itemForm" label-width="100px">
                <el-form-item label="項目名稱">
                  <el-input v-model="itemForm.itemName" placeholder="如：交通津貼、伙食補助、全勤獎金…" />
                </el-form-item>
                <el-form-item label="類型">
                  <el-select v-model="itemForm.type" placeholder="加項 / 扣項">
                    <el-option label="加項" value="加項" />
                    <el-option label="扣項" value="扣項" />
                  </el-select>
                </el-form-item>
                <el-form-item label="計稅">
                  <el-switch v-model="itemForm.taxable" active-text="是" inactive-text="否" />
                </el-form-item>
                <el-form-item label="影響投保">
                  <el-switch v-model="itemForm.insuranceAffect" active-text="是" inactive-text="否" />
                </el-form-item>
                <el-form-item label="說明">
                  <el-input v-model="itemForm.desc" />
                </el-form-item>
              </el-form>
              <span slot="footer" class="dialog-footer">
                <el-button @click="itemDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveItem">儲存</el-button>
              </span>
            </el-dialog>
          </div>
        </el-tab-pane>
  
        <!-- 2) 職等與底薪 -->
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
  
        <!-- 3) 調薪與異動規則 -->
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
  
        <!-- 4) 發放與銀行帳戶 -->
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
  
        <!-- 5) 其他設定 (扶養親屬、法院扣押...) -->
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
      </el-tabs>
    </div>
  </template>
  
<script setup>
import { ref, onMounted } from 'vue'
import { apiFetch } from '../../api'
  
  // 目前所在的Tab
const activeTab = ref('salaryItem')
const token = localStorage.getItem('token') || ''
const settingId = ref(null)
  
  // ============ (1) 薪資項目設定 ============
  const salaryItems = ref([
    {
      itemName: '交通津貼',
      type: '加項',
      taxable: true,
      insuranceAffect: false,
      desc: '員工交通補助'
    },
    {
      itemName: '伙食補助',
      type: '加項',
      taxable: false,
      insuranceAffect: false,
      desc: ''
    },
    {
      itemName: '罰款',
      type: '扣項',
      taxable: false,
      insuranceAffect: false,
      desc: '遲到/早退罰款'
    }
  ])
  const itemDialogVisible = ref(false)
  let editItemIndex = null
  
  const itemForm = ref({
    itemName: '',
    type: '加項',
    taxable: true,
    insuranceAffect: false,
    desc: ''
  })
  
  function openItemDialog(index = null) {
    if (index !== null) {
      // 編輯模式
      editItemIndex = index
      itemForm.value = { ...salaryItems.value[index] }
    } else {
      // 新增模式
      editItemIndex = null
      itemForm.value = {
        itemName: '',
        type: '加項',
        taxable: true,
        insuranceAffect: false,
        desc: ''
      }
    }
    itemDialogVisible.value = true
  }
  
  function saveItem() {
    if (editItemIndex === null) {
      salaryItems.value.push({ ...itemForm.value })
    } else {
      salaryItems.value[editItemIndex] = { ...itemForm.value }
    }
    itemDialogVisible.value = false
    persistSetting()
  }
  
  function deleteItem(index) {
    salaryItems.value.splice(index, 1)
    persistSetting()
  }
  
  // ============ (2) 職等與底薪 ============
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
  
  // ============ (3) 調薪與異動規則 ============
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
  
  // ============ (4) 發放與銀行帳戶 ============
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
  
  // ============ (5) 其他設定 (扶養親屬、法院扣押...) ============
  const otherForm = ref({
    includeDependents: false,
    courtGarnishment: false,
    diffAdjustmentMonths: 3
  })
  
  function saveOtherSetting() {
    console.log('儲存其他薪資設定:', otherForm.value)
    persistSetting()
  }

  async function fetchSetting() {
    const res = await apiFetch('/api/salary-settings', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      const data = await res.json()
      if (data.length) {
        const s = data[0]
        settingId.value = s._id
        salaryItems.value = s.salaryItems || []
        gradeList.value = s.grades || []
        Object.assign(adjustForm.value, s.adjust || {})
        Object.assign(paymentForm.value, s.payment || {})
        Object.assign(otherForm.value, s.other || {})
      }
    }
  }

  async function persistSetting() {
    const payload = {
      salaryItems: salaryItems.value,
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
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })
    if (res.ok) {
      const saved = await res.json()
      settingId.value = saved._id
    }
  }

  onMounted(fetchSetting)
</script>
  
  <style scoped>
  .salary-management-setting {
    padding: 20px;
  }
  
  .tab-content {
    margin-top: 20px;
  }
  </style>
  