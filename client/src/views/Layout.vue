<!-- src/views/Layout.vue (示例) -->
<template>
  <div class="layout-container">
    <el-aside class="layout-aside">
      <el-menu default-active="Settings" class="el-menu-vertical-demo">
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
  </div>
</template>

<script setup>
import { useRouter } from "vue-router";
import { onMounted } from "vue";
import { useMenuStore } from "../stores/menu";
import { storeToRefs } from "pinia";
const router = useRouter();
const menuStore = useMenuStore();
const { items: menuItems } = storeToRefs(menuStore);

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
}
.layout-aside {
  border-right: 1px solid #ebeef5;
  flex: 0 0 25%;
  width: 25%;
}
.layout-main {
  flex: 0 0 75%;
  width: 75%;
}
</style>
