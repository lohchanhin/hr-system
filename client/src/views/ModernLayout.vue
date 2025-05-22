<template>
  <el-container class="modern-layout">
    <el-header class="layout-header">
      <el-button link @click="toggleCollapse" class="collapse-btn">
        <el-icon><i :class="isCollapse ? 'el-icon-menu' : 'el-icon-close'" /></el-icon>
      </el-button>
    </el-header>
    <el-container>
      <el-aside :width="isCollapse ? '64px' : '200px'" class="layout-aside">
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
.layout-aside {
  overflow: auto;
  border-right: 1px solid #ebeef5;
}
.layout-main {
  padding: 20px;
  overflow: auto;
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
