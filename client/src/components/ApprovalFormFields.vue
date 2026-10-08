<!-- src/components/ApprovalFormFields.vue：簽核申請表單的動態欄位（申請頁與「修改並重新送出」共用） -->
<template>
  <div class="form-fields">
    <template v-for="fld in activeFields" :key="fld._id">
      <el-form-item
        :label="fld.label"
        :required="!!fld.required"
        class="form-field"
      >
        <!-- text -->
        <el-input
          v-if="fld.type_1==='text'"
          :model-value="modelValue[fld._id]"
          :placeholder="fld.placeholder || ''"
          class="field-input"
          @update:model-value="setValue(fld._id, $event)"
        />

        <!-- textarea -->
        <el-input
          v-else-if="fld.type_1==='textarea'"
          type="textarea"
          :rows="4"
          :model-value="modelValue[fld._id]"
          :placeholder="fld.placeholder || ''"
          class="field-textarea"
          @update:model-value="setValue(fld._id, $event)"
        />

        <!-- number：未填時保持空白（null），必填檢核才會生效 -->
        <el-input-number
          v-else-if="fld.type_1==='number'"
          :model-value="modelValue[fld._id]"
          :min="0"
          :step="1"
          :value-on-clear="null"
          :placeholder="fld.placeholder || '請輸入數字'"
          @update:model-value="setValue(fld._id, $event)"
        />

        <!-- select -->
        <el-select
          v-else-if="fld.type_1==='select'"
          :model-value="modelValue[fld._id]"
          filterable
          :placeholder="fld.placeholder || '請選擇'"
          style="width: 320px"
          @update:model-value="setValue(fld._id, $event)"
        >
          <el-option
            v-for="opt in optionsOf(fld)"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>

        <!-- checkbox：有選項是複選群組，沒有選項是單一勾選（是 / 否） -->
        <el-checkbox-group
          v-else-if="fld.type_1==='checkbox' && optionsOf(fld).length"
          :model-value="Array.isArray(modelValue[fld._id]) ? modelValue[fld._id] : []"
          @update:model-value="setValue(fld._id, $event)"
        >
          <el-checkbox v-for="opt in optionsOf(fld)" :key="opt.value" :value="opt.value">{{ opt.label }}</el-checkbox>
        </el-checkbox-group>
        <el-checkbox
          v-else-if="fld.type_1==='checkbox'"
          :model-value="!!modelValue[fld._id]"
          @update:model-value="setValue(fld._id, !!$event)"
        >{{ fld.placeholder || '是' }}</el-checkbox>

        <!-- date / time / datetime -->
        <el-date-picker
          v-else-if="fld.type_1==='date'"
          :model-value="modelValue[fld._id]"
          type="date"
          placeholder="選擇日期"
          style="width: 220px"
          @update:model-value="setValue(fld._id, $event)"
        />
        <el-time-picker
          v-else-if="fld.type_1==='time'"
          :model-value="modelValue[fld._id]"
          placeholder="選擇時間"
          style="width: 220px"
          @update:model-value="setValue(fld._id, $event)"
        />
        <el-date-picker
          v-else-if="fld.type_1==='datetime'"
          :model-value="modelValue[fld._id]"
          type="datetime"
          placeholder="選擇日期時間"
          style="width: 260px"
          @update:model-value="setValue(fld._id, $event)"
        />

        <div v-else-if="fld.type_1==='file'" class="file-field">
          <el-upload
            :auto-upload="false"
            :file-list="files[fld._id]"
            list-type="text"
            multiple
            :limit="5"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp"
            @update:file-list="setFiles(fld._id, $event)"
          >
            <el-button>選擇檔案</el-button>
            <template #tip>
              <div class="file-tip">最多 5 個檔案，每個 10 MB 以內（PDF、Word、Excel、圖片）</div>
            </template>
          </el-upload>
          <div v-if="keptFor(fld).length" class="kept-attachments">
            目前附件（未選擇新檔案時會保留）：{{ keptFor(fld).map(item => item.name || '附件').join('、') }}
          </div>
        </div>

        <!-- user / department / org -->
        <el-select
          v-else-if="fld.type_1==='user'"
          :model-value="modelValue[fld._id]"
          filterable
          style="width: 320px"
          placeholder="選擇員工"
          @update:model-value="setValue(fld._id, $event)"
        >
          <el-option v-for="u in userOptions" :key="u.value" :label="u.label" :value="u.value" />
        </el-select>

        <el-select
          v-else-if="fld.type_1==='department'"
          :model-value="modelValue[fld._id]"
          filterable
          style="width: 320px"
          placeholder="選擇部門"
          @update:model-value="setValue(fld._id, $event)"
        >
          <el-option v-for="d in deptOptions" :key="d.value" :label="d.label" :value="d.value" />
        </el-select>

        <el-select
          v-else-if="fld.type_1==='org'"
          :model-value="modelValue[fld._id]"
          filterable
          style="width: 320px"
          placeholder="選擇機構"
          @update:model-value="setValue(fld._id, $event)"
        >
          <el-option v-for="o in orgOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>

        <!-- fallback -->
        <el-input
          v-else
          :model-value="modelValue[fld._id]"
          :placeholder="fld.placeholder || ''"
          @update:model-value="setValue(fld._id, $event)"
        />
      </el-form-item>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { normalizeFieldOptions } from '../utils/approvalDisplay'
import { isActiveField } from '../utils/approvalForm'

const props = defineProps({
  fields: { type: Array, default: () => [] },
  modelValue: { type: Object, default: () => ({}) },
  files: { type: Object, default: () => ({}) },
  // 重新送出時，原本已上傳的附件（{ [fieldId]: [{ name, url }] }）
  keptAttachments: { type: Object, default: () => ({}) },
  userOptions: { type: Array, default: () => [] },
  deptOptions: { type: Array, default: () => [] },
  orgOptions: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'update:files'])

const activeFields = computed(() => props.fields.filter(isActiveField))
const optionsOf = (field) => normalizeFieldOptions(field)
const keptFor = (field) => {
  const kept = props.keptAttachments?.[field._id]
  return Array.isArray(kept) ? kept : []
}

function setValue(fieldId, value) {
  emit('update:modelValue', { ...props.modelValue, [fieldId]: value })
}
function setFiles(fieldId, list) {
  emit('update:files', { ...props.files, [fieldId]: list })
}
</script>

<style scoped>
.form-field {
  margin-bottom: 20px;
}

.field-input,
.field-textarea {
  border-radius: 8px;
}

.file-tip,
.kept-attachments {
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}
</style>
