<!-- src/views/Layout.vue (示例) -->
<template>
  <div class="layout-container">
    <el-aside
      class="layout-aside"
      :class="{ collapsed: isSidebarCollapsed }"
      :style="sidebarStyle"
    >
      <button class="collapse-button" type="button" @click="toggleSidebar">
        {{ isSidebarCollapsed ? "展開選單" : "收合選單" }}
      </button>
      <el-menu
        default-active="Settings"
        class="el-menu-vertical-demo layout-menu"
        :class="{ collapsed: isSidebarCollapsed }"
        :collapse="isSidebarCollapsed"
      >
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
    <el-main
      class="layout-main"
      :class="{ collapsed: isSidebarCollapsed }"
      :style="mainStyle"
    >
      <router-view />
    </el-main>
  </div>
</template>

<script setup>
import { useRouter } from "vue-router";
import { computed, onMounted, ref } from "vue";
import { useMenuStore } from "../stores/menu";
import { storeToRefs } from "pinia";
const router = useRouter();
const menuStore = useMenuStore();
const { items: menuItems } = storeToRefs(menuStore);

const isSidebarCollapsed = ref(false);

const toggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
};

const sidebarStyle = computed(() => {
  const width = isSidebarCollapsed.value ? "80px" : "25%";
  return {
    width,
    flex: `0 0 ${width}`,
  };
});

const mainStyle = computed(() => {
  const width = isSidebarCollapsed.value ? "calc(100% - 80px)" : "75%";
  return {
    flex: "1",
    width,
  };
});

onMounted(async () => {
  if (menuItems.value.length === 0) {
    await menuStore.fetchMenu();
  }
});

const gotoPage = (name) => {
  router.push({ name });
};

</script>

<style scoped>
.layout-container {
  display: flex;
  height: 100vh;
  background-color: #f7f8fa;
}

.layout-aside {
  border-right: 1px solid #ebeef5;
  background-color: #fff;
  flex: 0 0 25%;
  width: 25%;
  padding: 16px 12px;
  box-sizing: border-box;
  transition: width 0.3s ease, flex-basis 0.3s ease;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.layout-aside.collapsed {
  width: 80px;
  flex: 0 0 80px;
  align-items: center;
  padding: 16px 8px;
}

.layout-menu {
  flex: 1;
  transition: width 0.3s ease;
  overflow-y: auto;
}

.layout-menu.collapsed {
  width: 100%;
}

.collapse-button {
  appearance: none;
  border: 1px solid #cfd3dc;
  background-color: #ffffff;
  color: #409eff;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 14px;
  cursor: pointer;
  width: 100%;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.collapse-button:hover,
.collapse-button:focus {
  background-color: #ecf5ff;
  outline: none;
}

.layout-aside.collapsed .collapse-button {
  width: auto;
  padding: 6px 8px;
}

.layout-main {
  flex: 1;
  width: 75%;
  padding: 24px;
  transition: width 0.3s ease;
}

.layout-main.collapsed {
  width: calc(100% - 80px);
}

.layout-main h1,
.layout-main h2,
.layout-main h3,
.layout-main h4,
.layout-main h5,
.layout-main h6 {
  color: var(--hr-text-primary);
}
</style>
