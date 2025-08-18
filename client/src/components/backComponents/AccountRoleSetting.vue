<!-- src/components/backComponents/AccountRoleSetting.vue -->
<template>
  <el-tab-pane label="帳號與權限" name="accountRole">
    <div class="tab-content">
      <el-button type="primary" @click="openUserDialog()">新增帳號</el-button>
      <el-table :data="userList" style="margin-top: 20px;">
        <el-table-column prop="username" label="帳號" width="150" />
        <el-table-column prop="role" label="角色" width="120" />
        <el-table-column label="所屬部門" width="120">
          <template #default="{ row }">
            {{ departmentLabel(row.department) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row, $index }">
            <el-button type="primary" @click="openUserDialog($index)">編輯</el-button>
            <el-button type="danger" @click="deleteUser($index)">刪除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 新增/編輯使用者帳號 Dialog -->
      <el-dialog v-model="userDialogVisible" title="帳號管理" width="500px">
        <el-form :model="userForm" label-width="100px">
          <el-form-item label="帳號">
            <el-input v-model="userForm.username" placeholder="輸入帳號" />
          </el-form-item>
          <el-form-item label="密碼">
            <el-input v-model="userForm.password" type="password" placeholder="重設或新增密碼" />
          </el-form-item>
          <el-form-item label="角色">
            <el-select v-model="userForm.role" placeholder="選擇角色">
              <el-option label="管理員" value="admin" />
              <el-option label="主管" value="supervisor" />
              <el-option label="員工" value="employee" />
            </el-select>
          </el-form-item>
          <el-form-item label="部門">
            <el-select v-model="userForm.department" placeholder="選擇部門">
              <el-option
                v-for="dept in departmentList"
                :key="dept.value"
                :label="dept.label"
                :value="dept.value"
              />
            </el-select>
          </el-form-item>
        </el-form>
        <span slot="footer" class="dialog-footer">
          <el-button @click="userDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveUser">儲存</el-button>
        </span>
      </el-dialog>
    </div>
  </el-tab-pane>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { apiFetch } from '../../api'

const userList = ref([])
const userDialogVisible = ref(false)
let editUserIndex = null
const userForm = ref({
  username: '',
  password: '',
  role: '',
  department: ''
})
const departmentList = ref([])

function departmentLabel(id) {
  const dept = departmentList.value.find(d => d._id === id)
  return dept ? `${dept.name}(${dept.code})` : id
}

async function fetchUsers() {
  const res = await apiFetch('/api/users')
  if (res.ok) {
    userList.value = await res.json()
  }
}

async function fetchDepartments() {
  const res = await apiFetch('/api/departments')
  if (res.ok) {
    departmentList.value = await res.json()
  }
}

function openUserDialog(index = null) {
  if (index !== null) {
    editUserIndex = index
    userForm.value = { ...userList.value[index], password: '' }
  } else {
    editUserIndex = null
    userForm.value = { username: '', password: '', role: '', department: '' }
  }
  userDialogVisible.value = true
}

async function saveUser() {
  const payload = { ...userForm.value }
  let res
  if (editUserIndex === null) {
    res = await apiFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } else {
    const id = userList.value[editUserIndex]._id
    res = await apiFetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  }
  if (res && res.ok) {
    await fetchUsers()
    userDialogVisible.value = false
  }
}

function deleteUser(index) {
  const id = userList.value[index]._id
  apiFetch(`/api/users/${id}`, {
    method: 'DELETE'
  }).then(res => {
    if (res.ok) {
      userList.value.splice(index, 1)
    }
  })
}

onMounted(() => {
  fetchUsers()
  fetchDepartments()
})
</script>
