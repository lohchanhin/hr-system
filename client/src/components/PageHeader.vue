<template>
  <!--
    全站共用的精簡頁首：標題、一行說明、統計數字、主要動作（規範見 docs/ui-guidelines.md）。
    選項（都是樣式，預設關閉）：
      compact      標題區少留寬度：標題很短、要和統計或篩選排在同一列時用（排班管理、出勤打卡）
      stats-below  統計數字固定排在標題與動作的下一列（薪資管理）
      sticky       頁首固定在內容區頂端：設定很長、只有一個「儲存」在頁首時用（出勤設定）
  -->
  <header
    class="hr-page-header"
    :class="{
      'hr-page-header--compact': compact,
      'hr-page-header--stats-below': statsBelow,
      'hr-sticky-bar': sticky
    }"
    data-test="page-header"
  >
    <div class="hr-page-header__text">
      <h1 class="hr-page-header__title">{{ title }}</h1>
      <p v-if="subtitle || $slots.subtitle" class="hr-page-header__subtitle">
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>
    </div>
    <div v-if="$slots.stats" class="hr-page-header__stats">
      <slot name="stats" />
    </div>
    <div v-if="$slots.actions" class="hr-page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  statsBelow: { type: Boolean, default: false },
  sticky: { type: Boolean, default: false },
})
</script>
