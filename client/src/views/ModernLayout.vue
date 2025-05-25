<template>
  <el-container class="modern-layout">
    <el-header class="layout-header">
      <el-button link @click="toggleCollapse" class="collapse-btn">
        <el-icon><i :class="isCollapse ? 'el-icon-menu' : 'el-icon-close'" /></el-icon>
      </el-button>
      <el-button type="danger" @click="logout" class="logout-btn">登出</el-button>
    </el-header>
    <el-container>
      <el-aside class="layout-aside">
        <el-menu :default-active="active" :collapse="isCollapse">
          <el-menu-item
            v-for="item in menuItems"
            :key="item.name"
            :index="item.name"
            @click="gotoPage(item.name)"
          >
            <i :class="item.icon"></i>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </el-menu>
      </el-aside>
      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMenuStore } from '../stores/menu'
import { clearToken } from '../utils/tokenService'
import { storeToRefs } from 'pinia'

const router = useRouter()
const menuStore = useMenuStore()
const { items: menuItems } = storeToRefs(menuStore)

onMounted(async () => {
  if (menuItems.value.length === 0) {
    await menuStore.fetchMenu()
  }
})

const active = ref('')
const isCollapse = ref(false)

function gotoPage(name) {
  active.value = name
  router.push({ name })
}
function toggleCollapse() {
  isCollapse.value = !isCollapse.value
}

function logout() {
  clearToken()
  localStorage.removeItem('role')
  localStorage.removeItem('employeeId')
  router.push('/')
}
</script>

<style scoped>
.modern-layout {
  height: 100vh;
}
.layout-header {
  display: flex;
  align-items: center;
  height: 50px;
  background: #f5f5f5;
  border-bottom: 1px solid #ddd;
}
.collapse-btn {
  margin-left: 10px;
}
.logout-btn {
  margin-left: auto;
  margin-right: 10px;
}
.layout-aside {
  overflow: auto;
  border-right: 1px solid #ebeef5;
  flex: 0 0 25%;
  width: 25%;
}
.layout-main {
  padding: 20px;
  overflow: auto;
  flex: 0 0 75%;
  width: 75%;
}
@media (max-width: 768px) {
  .layout-aside {
    position: absolute;
    z-index: 1000;
    height: 100%;
    background: #fff;
  }
}
</style>
