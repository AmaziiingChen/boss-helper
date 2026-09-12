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
  />
</template>
