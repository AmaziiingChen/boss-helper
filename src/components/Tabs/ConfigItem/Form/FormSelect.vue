<script lang="ts" setup>
import InputChips from 'primevue/inputchips'

const value = defineModel<string[]>('value', { required: true })
// const options = defineModel<string[]>('options', { required: true })

const delimiter = /,|\s|\||，/
</script>

<template>
  <InputChips
    v-model="value"
    class="filter-rule-input"
    :separator="delimiter"
    add-on-blur
    :allow-duplicate="false"
    placeholder="输入词后按 Enter 添加"
  />
  <small class="integration-help">支持回车、逗号、空格或竖线分隔；点击词条叉号删除。</small>
</template>
