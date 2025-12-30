<template>
  <div class="help-button-wrapper">
    <el-button
      type="info"
      plain
      size="small"
      data-testid="global-help-button"
      @click="visible = true"
    >
      說明
    </el-button>

    <el-dialog v-model="visible" :title="resolvedHelp.title" width="520px">
      <p class="help-description" data-testid="help-description">
        {{ resolvedHelp.description }}
      </p>
      <ul v-if="resolvedHelp.tips.length" class="help-list" data-testid="help-tips">
        <li v-for="tip in resolvedHelp.tips" :key="tip">{{ tip }}</li>
      </ul>
      <template #footer>
        <el-button @click="visible = false">關閉</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  help: {
    type: Object,
    default: () => ({})
  }
})

const visible = ref(false)

const resolvedHelp = computed(() => {
  const title = props.help?.title || '操作說明'
  const description =
    props.help?.description ||
    '使用「說明」按鈕檢視此頁的操作步驟與注意事項，無需另外修改設定。'
  const tips = Array.isArray(props.help?.tips) ? props.help.tips.filter(Boolean) : []
  return { title, description, tips }
})
</script>

<style scoped>
.help-description {
  margin-bottom: 8px;
  color: #606266;
  line-height: 1.6;
}

.help-list {
  padding-left: 18px;
  margin: 0;
  line-height: 1.6;
}
</style>
