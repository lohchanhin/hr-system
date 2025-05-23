<!-- src/components/backComponents/OrgDepartmentSetting.vue -->
<template>
  <div class="org-dept-setting">
    <h2>機構與部門設定</h2>
    <el-tabs v-model="activeTab" type="card">
      <!-- 機構 -->
      <el-tab-pane label="機構" name="org">
        <div class="tab-content">
          <el-button type="primary" @click="openDialog('org')">新增機構</el-button>
          <el-table :data="orgList" style="margin-top: 20px;">
            <el-table-column prop="name" label="名稱" width="150" />
            <el-table-column prop="systemCode" label="系統代碼" width="120" />
            <el-table-column label="操作" width="180">
              <template #default="{ $index }">
                <el-button type="primary" @click="openDialog('org', $index)">編輯</el-button>
                <el-button type="danger" @click="deleteItem('org', $index)">刪除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
      <!-- 部門 -->
      <el-tab-pane label="部門" name="dept">
        <div class="tab-content">
          <el-button type="primary" @click="openDialog('dept')">新增部門</el-button>
          <el-table :data="deptList" style="margin-top: 20px;">
            <el-table-column prop="name" label="名稱" width="150" />
            <el-table-column prop="code" label="部門代碼" width="120" />
            <el-table-column label="操作" width="180">
              <template #default="{ $index }">
                <el-button type="primary" @click="openDialog('dept', $index)">編輯</el-button>
                <el-button type="danger" @click="deleteItem('dept', $index)">刪除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
      <!-- 小單位 -->
      <el-tab-pane label="小單位" name="sub">
        <div class="tab-content">
          <el-button type="primary" @click="openDialog('sub')">新增小單位</el-button>
          <el-table :data="subList" style="margin-top: 20px;">
            <el-table-column prop="name" label="名稱" width="150" />
            <el-table-column prop="code" label="代碼" width="120" />
            <el-table-column label="操作" width="180">
              <template #default="{ $index }">
                <el-button type="primary" @click="openDialog('sub', $index)">編輯</el-button>
                <el-button type="danger" @click="deleteItem('sub', $index)">刪除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="400px">
      <el-form :model="form" label-width="100px">
        <template v-if="currentType === 'org'">
          <el-form-item label="機構名稱">
            <el-input v-model="form.name" />
          </el-form-item>
          <el-form-item label="系統代碼">
            <el-input v-model="form.systemCode" />
          </el-form-item>
          <el-form-item label="單位名稱">
            <el-input v-model="form.unitName" />
          </el-form-item>
          <el-form-item label="機構代碼">
            <el-input v-model="form.orgCode" />
          </el-form-item>
          <el-form-item label="統一編號">
            <el-input v-model="form.taxIdNumber" />
          </el-form-item>
          <el-form-item label="勞保編號">
            <el-input v-model="form.laborInsuranceNo" />
          </el-form-item>
          <el-form-item label="健保編號">
            <el-input v-model="form.healthInsuranceNo" />
          </el-form-item>
          <el-form-item label="稅籍編號">
            <el-input v-model="form.taxCode" />
          </el-form-item>
          <el-form-item label="位置">
            <el-input v-model="form.address" />
          </el-form-item>
          <el-form-item label="連絡電話">
            <el-input v-model="form.phone" />
          </el-form-item>
          <el-form-item label="負責人">
            <el-input v-model="form.principal" />
          </el-form-item>
        </template>
        <template v-else-if="currentType === 'dept'">
          <el-form-item label="部門名稱">
            <el-input v-model="form.name" />
          </el-form-item>
          <el-form-item label="部門代碼">
            <el-input v-model="form.code" />
          </el-form-item>
          <el-form-item label="單位名稱">
            <el-input v-model="form.unitName" />
          </el-form-item>
          <el-form-item label="位置">
            <el-input v-model="form.location" />
          </el-form-item>
          <el-form-item label="連絡電話">
            <el-input v-model="form.phone" />
          </el-form-item>
          <el-form-item label="部門主管">
            <el-input v-model="form.manager" />
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="小單位名稱">
            <el-input v-model="form.name" />
          </el-form-item>
          <el-form-item label="代碼">
            <el-input v-model="form.code" />
          </el-form-item>
          <el-form-item label="單位名稱">
            <el-input v-model="form.unitName" />
          </el-form-item>
          <el-form-item label="位置">
            <el-input v-model="form.location" />
          </el-form-item>
          <el-form-item label="連絡電話">
            <el-input v-model="form.phone" />
          </el-form-item>
          <el-form-item label="部門主管">
            <el-input v-model="form.manager" />
          </el-form-item>
          <el-form-item label="人力需求數">
            <el-input v-model="form.headcount" />
          </el-form-item>
          <el-form-item label="班表拉選">
            <el-input v-model="form.scheduleSetting" />
          </el-form-item>
        </template>
      </el-form>
      <span slot="footer" class="dialog-footer">
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveItem">儲存</el-button>
      </span>
    </el-dialog>

  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { apiFetch } from '../../api'

const activeTab = ref('org')
const orgList = ref([])
const deptList = ref([])
const subList = ref([])

const dialogVisible = ref(false)
const form = ref(defaultForm('org'))
const currentType = ref('org')
const editIndex = ref(null)

const dialogTitle = computed(() => {
  const typeLabel = currentType.value === 'org'
    ? '機構'
    : currentType.value === 'dept'
      ? '部門'
      : '小單位'
  return `${editIndex.value === null ? '新增' : '編輯'}${typeLabel}`
})

function urlOf(type) {
  return type === 'org'
    ? '/api/organizations'
    : type === 'dept'
      ? '/api/departments'
      : '/api/sub-departments'
}

async function fetchList(type) {
  const token = localStorage.getItem('token') || ''
  const res = await apiFetch(urlOf(type), {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    const data = await res.json()
    if (type === 'org') orgList.value = data
    else if (type === 'dept') deptList.value = data
    else subList.value = data
  }
}

async function fetchAll() {
  await Promise.all([
    fetchList('org'),
    fetchList('dept'),
    fetchList('sub')
  ])
}

function defaultForm(type) {
  if (type === 'org') {
    return {
      name: '',
      systemCode: '',
      unitName: '',
      orgCode: '',
      taxIdNumber: '',
      laborInsuranceNo: '',
      healthInsuranceNo: '',
      taxCode: '',
      address: '',
      phone: '',
      principal: ''
    }
  } else if (type === 'dept') {
    return {
      name: '',
      code: '',
      unitName: '',
      location: '',
      phone: '',
      manager: ''
    }
  } else {
    return {
      name: '',
      code: '',
      unitName: '',
      location: '',
      phone: '',
      manager: '',
      headcount: 0,
      scheduleSetting: ''
    }
  }
}

function openDialog(type, index = null) {
  currentType.value = type
  if (index !== null) {
    editIndex.value = index
    const item =
      type === 'org'
        ? orgList.value[index]
        : type === 'dept'
          ? deptList.value[index]
          : subList.value[index]
    form.value = { ...item }
  } else {
    editIndex.value = null
    form.value = defaultForm(type)
  }
  dialogVisible.value = true
}

async function saveItem() {
  const token = localStorage.getItem('token') || ''
  const url = urlOf(currentType.value)
  const list =
    currentType.value === 'org'
      ? orgList
      : currentType.value === 'dept'
        ? deptList
        : subList
  let res
  if (editIndex.value === null) {
    res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(form.value)
    })
  } else {
    const id = list.value[editIndex.value]._id
    res = await apiFetch(`${url}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(form.value)
    })
  }
  if (res && res.ok) {
    await fetchAll()
    dialogVisible.value = false
  }
}

function deleteItem(type, index) {
  const token = localStorage.getItem('token') || ''
  const list = type === 'org' ? orgList : type === 'dept' ? deptList : subList
  const id = list.value[index]._id
  apiFetch(`${urlOf(type)}/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  }).then(res => {
    if (res.ok) {
      list.value.splice(index, 1)
    }
  })
}

onMounted(fetchAll)
</script>

<style scoped>
.org-dept-setting {
  padding: 20px;
}
.tab-content {
  margin-top: 20px;
}
</style>


