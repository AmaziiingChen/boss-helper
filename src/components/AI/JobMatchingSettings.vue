<script lang="ts" setup>
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Editor from 'primevue/editor'
import FileUpload from 'primevue/fileupload'
import type { FileUploadSelectEvent } from 'primevue/fileupload'
import Message from 'primevue/message'
import { computed, ref } from 'vue'

import { useSettingsDraft } from '@/composables/conf/settingsDraft'
import { hasNonEmptyResume, resumeFileToHtml } from '@/utils/resumeImport'

const resumeTemplate = `<h1>姓名</h1>
<p>手机号 · 邮箱 · 所在城市</p>
<h2>求职方向</h2>
<p>目标岗位 / 期望城市</p>
<h2>教育经历</h2>
<p><strong>学校名称｜专业｜学历</strong></p>
<p>起止时间</p>
<h2>项目经历</h2>
<p><strong>项目名称｜个人角色</strong></p>
<ul><li>项目背景与目标</li><li>负责的关键工作</li><li>结果与产出</li></ul>
<h2>技能</h2>
<p>工具、技术与行业能力</p>`

type Resume = { content: string; fileName: string }
const { conf, dirty, saving, save, locked } = useSettingsDraft('resume')
const uploadKey = ref(0)
const importing = ref(false)
const error = ref('')
const saved = ref(false)
const previousResume = ref<Resume | null>(null)
const pendingResume = ref<Resume | null>(null)
const confirmVisible = ref(false)
const status = computed(() =>
  saving.value ? '保存中…' : dirty.value ? '有未保存的修改' : saved.value ? '已保存' : '暂无修改',
)

function applyReplacement(resume: Resume) {
  previousResume.value = { ...conf.formData.resumeMarkdown }
  conf.formData.resumeMarkdown = { ...resume }
  error.value = ''
  saved.value = false
}

function requestReplacement(resume: Resume) {
  if (hasNonEmptyResume(conf.formData.resumeMarkdown.content)) {
    pendingResume.value = resume
    confirmVisible.value = true
  } else {
    applyReplacement(resume)
  }
}

function confirmReplacement() {
  if (pendingResume.value) applyReplacement(pendingResume.value)
  confirmVisible.value = false
  pendingResume.value = null
}

function undoReplacement() {
  if (!previousResume.value) return
  conf.formData.resumeMarkdown = { ...previousResume.value }
  previousResume.value = null
  error.value = ''
  saved.value = false
}

async function selectResume(event: FileUploadSelectEvent) {
  const file: File | undefined = event.files[0]
  if (!file) return
  importing.value = true
  error.value = ''
  try {
    const content = resumeFileToHtml(await file.text(), file.name)
    if (!hasNonEmptyResume(content)) throw new Error('文件内容为空，请选择有正文的简历。')
    requestReplacement({ content, fileName: file.name })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取文件失败，请重试。'
  } finally {
    importing.value = false
    uploadKey.value += 1
  }
}

async function saveResume() {
  error.value = ''
  try {
    await save()
    saved.value = true
  } catch {
    error.value = '保存失败，草稿仍保留，请重试。'
  }
}
</script>

<template>
  <div class="prime-settings-stack resume-settings">
    <section class="settings-toolbar">
      <h2>简历</h2>
      <div class="settings-toolbar-actions">
        <FileUpload
          :key="uploadKey"
          mode="basic"
          name="resume"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          choose-label="导入"
          choose-icon="pi pi-upload"
          custom-upload
          :disabled="saving || importing"
          :choose-button-props="{ severity: 'secondary', text: true }"
          @select="selectResume"
        >
          <template #filelabel><span hidden /></template>
        </FileUpload>
        <Button
          label="使用模板"
          severity="secondary"
          text
          :disabled="saving || importing"
          @click="requestReplacement({ content: resumeTemplate, fileName: '' })"
        />
      </div>
    </section>

    <Editor
      v-model="conf.formData.resumeMarkdown.content"
      :readonly="saving || importing"
      placeholder="在这里填写简历，或导入 Markdown / TXT 文件"
    >
      <template #toolbar>
        <span class="ql-formats">
          <select class="ql-header" aria-label="标题级别">
            <option value="1">标题 1</option>
            <option value="2">标题 2</option>
            <option selected value="">正文</option>
          </select>
        </span>
        <span class="ql-formats">
          <button type="button" class="ql-bold" aria-label="加粗" />
          <button type="button" class="ql-italic" aria-label="斜体" />
          <button type="button" class="ql-list" value="bullet" aria-label="无序列表" />
          <button type="button" class="ql-list" value="ordered" aria-label="有序列表" />
          <button type="button" class="ql-clean" aria-label="清除格式" />
        </span>
      </template>
    </Editor>

    <footer class="prime-savebar">
      <div aria-live="polite">
        <Message v-if="error" severity="error" variant="simple">{{ error }}</Message>
        <span v-else>{{ locked ? '任务运行中，暂停后保存' : importing ? '读取中…' : status }}</span>
      </div>
      <div class="settings-toolbar-actions">
        <Button
          v-if="previousResume"
          label="撤销替换"
          severity="secondary"
          text
          :disabled="saving || importing"
          @click="undoReplacement"
        />
        <Button
          label="保存"
          icon="pi pi-save"
          :loading="saving"
          :disabled="!dirty || saving || importing || locked"
          @click="saveResume"
        />
      </div>
    </footer>

    <Dialog
      v-model:visible="confirmVisible"
      modal
      header="替换当前简历"
      @hide="pendingResume = null"
    >
      <p>这会替换当前编辑内容，尚未保存的修改也会被替换。</p>
      <p>替换后可在本页撤销；点击保存后才会更新已保存的简历。</p>
      <template #footer>
        <Button label="取消" severity="secondary" text @click="confirmVisible = false" />
        <Button label="替换" @click="confirmReplacement" />
      </template>
    </Dialog>
  </div>
</template>
