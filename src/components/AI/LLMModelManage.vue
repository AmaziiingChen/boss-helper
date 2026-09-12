<script lang="ts" setup>
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { ref } from 'vue'

import type { ModelConf } from '@/composables/useModel'
import { useModel } from '@/composables/useModel'
import { useAppToast } from '@/services/appToast'
import deepmerge, { jsonClone } from '@/utils/deepmerge'
import { exportJson, importJson } from '@/utils/jsonImportExport'

import CreateLLM from './LLMModelEdit.vue'

const modelStore = useModel()
const createBoxShow = ref(false)
const toast = useAppToast()
const open = ref(false)

function del(d: ModelConf) {
  modelStore.modelData.value = modelStore.modelData.value.filter((v) => d.key !== v.key)
}

function copy(d: ModelConf) {
  d = jsonClone(d)
  d.key = new Date().getTime().toString()
  d.name = `${d.name} 副本`
  modelStore.modelData.value.push(d)
}

const createModelData = ref()

function edit(d: ModelConf) {
  createModelData.value = d
  createBoxShow.value = true
}

function newllm() {
  createModelData.value = undefined
  createBoxShow.value = true
}

function create(d: ModelConf) {
  if (d.key) {
    const old = modelStore.modelData.value.find((v) => v.key === d.key)
    if (old) {
      deepmerge(old, d, { clone: false })
    } else {
      d.key = new Date().getTime().toString()
      modelStore.modelData.value.push(d)
    }
  } else {
    d.key = new Date().getTime().toString()
    modelStore.modelData.value.push(d)
  }
  createBoxShow.value = false
}
function close() {
  modelStore.initModel()
  open.value = false
}

function exportllm() {
  exportJson(jsonClone(modelStore.modelData.value), 'Ai模型配置')
}

function importllm() {
  importJson<ModelConf[]>().then((data) => {
    modelStore.modelData.value = data
    toast.add({
      title: '导入成功, 请手动保存',
      color: 'success',
    })
  })
}
</script>

<template>
  <span class="model-manager-trigger" @click="open = true"><slot /></span>
  <Dialog
    v-model:visible="open"
    modal
    header="模型连接"
    :closable="false"
    class="model-manager-dialog"
  >
      <div class="model-manager-body">
        <div v-if="modelStore.modelData.value.length" class="model-list">
          <article v-for="item in modelStore.modelData.value" :key="item.key" class="model-row">
            <div class="model-row-copy">
              <strong>{{ item.data?.model || item.name }}</strong>
              <span>{{ item.data?.base_url || '尚未填写服务地址' }}</span>
            </div>
            <div class="model-row-actions">
              <Button
                severity="secondary"
                text
                rounded
                icon="pi pi-copy"
                size="small"
                :aria-label="`复制${item.name}`"
                title="复制"
                @click="copy(item)"
              />
              <Button
                severity="secondary"
                text
                rounded
                icon="pi pi-pencil"
                size="small"
                :aria-label="`编辑${item.name}`"
                title="编辑"
                @click="edit(item)"
              />
              <Button
                severity="danger"
                text
                rounded
                icon="pi pi-trash"
                size="small"
                :aria-label="`删除${item.name}`"
                title="删除"
                @click="del(item)"
              />
            </div>
          </article>
        </div>
        <div v-else class="dialog-empty">
          <p>还没有模型</p>
        </div>
      </div>
      <CreateLLM
        v-if="createBoxShow"
        v-model="createBoxShow"
        :model="createModelData"
        @create="create"
      />
    <template #footer>
      <div class="dialog-actions">
        <div class="dialog-actions-secondary">
          <Button label="导出" severity="secondary" text @click="exportllm" />
          <Button label="导入" severity="secondary" text @click="importllm" />
        </div>
        <div class="dialog-actions-primary">
          <Button label="取消" severity="secondary" outlined @click="close" />
          <Button label="新建" icon="pi pi-plus" severity="secondary" outlined @click="newllm" />
          <Button label="保存" @click="modelStore.saveModel" />
        </div>
      </div>
    </template>
  </Dialog>
</template>
