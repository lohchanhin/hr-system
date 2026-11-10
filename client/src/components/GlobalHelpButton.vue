<template>
  <div class="help-button-wrapper">
    <!-- 放在後台標題列的小「？」按鈕：按下才顯示本頁的操作說明，不佔內容區的空間 -->
    <button
      type="button"
      class="help-icon-button"
      data-testid="global-help-button"
      aria-label="本頁操作說明"
      title="本頁操作說明"
      @click="visible = true"
    >
      <el-icon :size="20"><QuestionFilled /></el-icon>
    </button>

    <el-dialog
      v-model="visible"
      :title="resolvedHelp.title"
      width="520px"
      append-to-body
    >
      <p class="help-description" data-testid="help-description">
        {{ resolvedHelp.description }}
      </p>
      <div v-if="resolvedHelp.scenarios.length" class="help-section">
        <h4 class="help-section-title">適用情境</h4>
        <ul class="help-list" data-testid="help-scenarios">
          <li v-for="scenario in resolvedHelp.scenarios" :key="scenario">{{ scenario }}</li>
        </ul>
      </div>
      <div v-if="resolvedHelp.tips.length" class="help-section">
        <h4 class="help-section-title">操作提示</h4>
        <ul class="help-list" data-testid="help-tips">
          <li v-for="tip in resolvedHelp.tips" :key="tip">{{ tip }}</li>
        </ul>
      </div>
      <div v-if="resolvedHelp.steps.length" class="help-section">
        <h4 class="help-section-title">建議操作流程</h4>
        <ol class="help-ordered-list" data-testid="help-steps">
          <li v-for="step in resolvedHelp.steps" :key="step">{{ step }}</li>
        </ol>
      </div>
      <template #footer>
        <el-button @click="visible = false">關閉</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'

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
  const tips = Array.isArray(props.help?.tips)
    ? props.help.tips.filter(tip => typeof tip === 'string' && tip.trim())
    : []
  const scenarios = Array.isArray(props.help?.scenarios)
    ? props.help.scenarios.filter(item => typeof item === 'string' && item.trim())
    : []
  const steps = Array.isArray(props.help?.steps)
    ? props.help.steps.filter(item => typeof item === 'string' && item.trim())
    : []
  return { title, description, tips, scenarios, steps }
})
</script>

<style scoped>
.help-button-wrapper {
  display: inline-flex;
}

.help-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.help-icon-button:hover {
  background: rgba(255, 255, 255, 0.12);
}

.help-description {
  margin-bottom: 8px;
  color: #606266;
  line-height: 1.6;
}

.help-section {
  margin: 12px 0;
}

.help-section-title {
  margin: 0 0 6px;
  font-size: 14px;
  color: #303133;
  font-weight: 600;
}

.help-list {
  padding-left: 18px;
  margin: 0;
  line-height: 1.6;
}

.help-ordered-list {
  padding-left: 20px;
  margin: 0;
  line-height: 1.6;
}
</style>
