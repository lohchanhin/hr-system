<!-- src/components/backComponents/DepartmentManagement.vue -->
<template>
        <el-tab-pane label="部門組織管理" name="deptOrg">
          <div class="tab-content">
            <el-button type="primary" @click="openDeptDialog()">新增部門/單位</el-button>
            <el-table :data="departmentList" style="margin-top: 20px;">
              <el-table-column prop="label" label="部門名稱" width="150" />
              <el-table-column prop="value" label="代碼" width="100" />
              <el-table-column label="操作" width="180">
                <template #default="{ row, $index }">
                  <el-button type="primary" @click="openDeptDialog($index)">編輯</el-button>
                  <el-button type="danger" @click="deleteDept($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>
  
            <!-- 新增/編輯 部門/單位 Dialog -->
            <el-dialog v-model="deptDialogVisible" title="部門管理" width="400px">
              <el-form :model="deptForm" label-width="100px">
                <el-form-item label="名稱">
                  <el-input v-model="deptForm.label" />
                </el-form-item>
                <el-form-item label="代碼">
                  <el-input v-model="deptForm.value" />
                </el-form-item>
              </el-form>
              <span slot="footer" class="dialog-footer">
                <el-button @click="deptDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveDept">儲存</el-button>
              </span>
            </el-dialog>
          </div>
        </el-tab-pane>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { apiFetch } from '../../api'

const departmentList = ref([])
const deptDialogVisible = ref(false)
let editDeptIndex = null
const deptForm = ref({
  label: \x27\x27,
  value: \x27\x27
})

async function fetchDepartments() {
  const token = localStorage.getItem(\x27token\x27) || \x27\x27
  const res = await apiFetch(\x27/api/departments\x27, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    departmentList.value = await res.json()
  }
}

  function openDeptDialog(index = null) {
    if (index !== null) {
      editDeptIndex = index
      deptForm.value = { ...departmentList.value[index] }
    } else {
      editDeptIndex = null
      deptForm.value = { label: '', value: '' }
    }
    deptDialogVisible.value = true
  }
  
  async function saveDept() {
    const token = localStorage.getItem('token') || ''
    let res
    if (editDeptIndex === null) {
      res = await apiFetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(deptForm.value)
      })
    } else {
      const id = departmentList.value[editDeptIndex]._id
      res = await apiFetch(`/api/departments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(deptForm.value)
      })
    }
    if (res && res.ok) {
      await fetchDepartments()
      deptDialogVisible.value = false
    }
  }

  function deleteDept(index) {
    const token = localStorage.getItem('token') || ''
    const id = departmentList.value[index]._id
    apiFetch(`/api/departments/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => {
      if (res.ok) {
        departmentList.value.splice(index, 1)
      }
    })
  }
onMounted(fetchDepartments)
</script>
