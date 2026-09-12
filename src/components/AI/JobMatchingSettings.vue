<script lang="ts" setup>
import Button from 'primevue/button'
import Editor from 'primevue/editor'
import FileUpload from 'primevue/fileupload'
import type { FileUploadSelectEvent } from 'primevue/fileupload'
import { onMounted } from 'vue'

import { useConf } from '@/composables/conf'

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

const conf = useConf()
onMounted(() => {
  if (!conf.formData.resumeMarkdown.content.trim()) {
    conf.formData.resumeMarkdown.content = resumeTemplate
  }
})

async function selectResume(event: FileUploadSelectEvent) {
  const file = event.files[0]
  if (!file) return
  const content = await file.text()
  conf.formData.resumeMarkdown.content = `<pre>${escapeHtml(content)}</pre>`
  conf.formData.resumeMarkdown.fileName = file.name
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
</script>

<template>
  <div class="prime-settings-stack resume-settings">
    <section class="settings-toolbar">
      <h2>简历</h2>
      <div class="settings-toolbar-actions">
        <FileUpload
          mode="basic"
          name="resume"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          choose-label="选择"
          choose-icon="pi pi-plus"
          custom-upload
          :choose-button-props="{ severity: 'secondary', text: true }"
          @select="selectResume"
        />
        <Button label="保存" icon="pi pi-save" @click="conf.confSaving" />
      </div>
    </section>

    <Editor v-model="conf.formData.resumeMarkdown.content" />
  </div>
</template>
