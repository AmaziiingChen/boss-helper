<script setup lang="ts">
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'
import Textarea from 'primevue/textarea'
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'

import { useHelper } from '@/composables/useHelper'
import type { JobData } from '@/composables/useHelper'
import { counter } from '@/message'
import {
  defaultGreetingStyle,
  greetingHash,
  greetingPromptVersion,
  greetingSystemPrompt,
  isGreetingDraft,
  parseGreetingOutput,
} from '@/services/greeting'
import type { GreetingDraft } from '@/services/greeting'
import type { GreetingSendRecord } from '@/services/greetingSend'
import { hasResumeContent } from '@/utils/workbenchState'

const props = defineProps<{ job: JobData; busy: boolean }>()
const helper = useHelper()
const draft = ref<GreetingDraft | null>(null)
const style = ref(defaultGreetingStyle)
const loading = ref(true)
const generating = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const reviewVisible = ref(false)
const review = ref<{ company: string; job: string; recruiter: string; text: string } | null>(null)
const defaultGreetingDisabled = ref(false)
const submitting = ref(false)
const submissionRequested = ref(false)
const sendError = ref('')
const sendRecord = computed(
  () => helper.jobMaps.get(props.job.key)?.state.greetingSend as GreetingSendRecord | undefined,
)
const sendPending = computed(
  () => submitting.value || ['preparing', 'sending'].includes(sendRecord.value?.status ?? ''),
)
const sendBlocked = computed(() => !!sendRecord.value && sendRecord.value.status !== 'failed')
const hash = ref('')
let alive = true
let revision = 0
let storageKey = ''
onBeforeUnmount(() => {
  alive = false
  revision++
})
const resume = computed(() => helper.conf.formData.resumeMarkdown)
const model = computed(() =>
  helper.models.modelData.value.find((item) => item.key === helper.conf.formData.aiFiltering.model),
)
const source = computed(() =>
  JSON.stringify({
    jobKey: props.job.key,
    link: props.job.link,
    title: props.job.jobName,
    company: props.job.brand.name,
    jd: props.job.jobDescription,
    resume: resume.value.content,
    candidateProfile: helper.conf.formData.candidateProfile?.content ?? '',
    fileName: resume.value.fileName,
    style: style.value,
    promptVersion: greetingPromptVersion,
    model: model.value?.data?.model,
    provider: model.value?.data?.base_url,
  }),
)
watch(
  source,
  async (value) => {
    const version = ++revision
    hash.value = ''
    const result = await greetingHash(value)
    if (alive && version === revision) hash.value = result
  },
  { immediate: true, flush: 'sync' },
)
const stale = computed(() => !!draft.value && draft.value.inputHash !== hash.value)
// A review belongs to one exact draft and recipient, never the next selected job.
watch(
  () => [source.value, draft.value?.text, props.job.boss?.name, props.job.boss?.title],
  () => {
    reviewVisible.value = false
    review.value = null
    defaultGreetingDisabled.value = false
    submissionRequested.value = false
    sendError.value = ''
  },
  { flush: 'sync' },
)
function reviewGreeting() {
  if (
    !draft.value ||
    loading.value ||
    generating.value ||
    saving.value ||
    props.busy ||
    stale.value ||
    !draft.value.text.trim() ||
    Array.from(draft.value.text).length > 500
  )
    return
  review.value = {
    company: props.job.brand.name,
    job: props.job.jobName || props.job.positionName,
    recruiter:
      [props.job.boss?.name, props.job.boss?.title].filter(Boolean).join(' · ') || '待核实',
    text: draft.value.text,
  }
  reviewVisible.value = true
  defaultGreetingDisabled.value = false
  submissionRequested.value = false
  sendError.value = ''
}
async function confirmSend() {
  if (
    !review.value ||
    !reviewVisible.value ||
    !defaultGreetingDisabled.value ||
    props.busy ||
    sendPending.value ||
    sendBlocked.value ||
    stale.value ||
    review.value.text !== draft.value?.text
  )
    return
  submitting.value = true
  submissionRequested.value = true
  sendError.value = ''
  try {
    await helper.sendGreeting(props.job.key, {
      text: review.value.text,
      jobName: review.value.job,
      company: review.value.company,
      recruiter: props.job.boss.name,
      confirmed: true,
      defaultGreetingDisabled: true,
    })
  } catch (error) {
    sendError.value = error instanceof Error ? error.message : '未能启动发送，请核对页面连接'
  } finally {
    submitting.value = false
  }
}
const blocked = computed(() =>
  !props.job.jobDescription?.trim()
    ? '请先获取完整岗位详情。'
    : !hasResumeContent(resume.value.content)
      ? '请先导入并保存真实简历。'
      : !model.value?.data?.api_key?.trim() ||
          !model.value?.data?.base_url?.trim() ||
          !model.value?.data?.model?.trim()
        ? '请先在 AI 设置中选择并保存完整模型配置。'
        : '',
)
onMounted(async () => {
  try {
    const feishu = helper.conf.formData.feishu
    storageKey = `local:greeting:${await greetingHash(JSON.stringify([feishu.appToken, feishu.tableId, props.job.link, props.job.key]))}`
    const saved = await counter.storageGet<unknown>(storageKey)
    if (!alive) return
    if (saved != null && !isGreetingDraft(saved)) throw new Error('invalid draft')
    if (isGreetingDraft(saved)) {
      draft.value = saved
      style.value = saved.style
    }
  } catch {
    if (alive) error.value = '本地草稿读取失败，未覆盖已有记录。'
  } finally {
    if (alive) loading.value = false
  }
})
async function generate() {
  if (loading.value || generating.value || saving.value || props.busy || blocked.value) return
  generating.value = true
  error.value = ''
  notice.value = ''
  const input = source.value
  const capturedResume = { ...resume.value }
  try {
    if (
      !helper.chatModel.createAgent(
        {
          enable: true,
          model: model.value?.key,
          prompt: [
            { role: 'system', content: greetingSystemPrompt },
            { role: 'user', content: '{{ greetingInput }}' },
          ],
        },
        'greeting',
        { json: true },
      )
    )
      throw new Error('model unavailable')
    const response = await helper.chatModel.chat('greeting', { greetingInput: input } as any)
    const text = parseGreetingOutput(await response.text)
    const inputHash = await greetingHash(input)
    const resumeVersion = await greetingHash(capturedResume.content)
    if (!alive) return
    if (source.value !== input) {
      error.value = '生成期间资料发生变化，请重新生成；旧草稿已保留。'
      return
    }
    draft.value = {
      text,
      inputHash,
      resumeVersion,
      resumeFileName: capturedResume.fileName,
      promptVersion: greetingPromptVersion,
      style: style.value,
      generatedAt: Date.now(),
    }
    notice.value = '已生成，尚未保存或发送。请审核内容后保存本地草稿。'
  } catch {
    if (alive) error.value = '生成未成功，请检查模型与资料后重试；旧草稿已保留，不会改发默认话术。'
  } finally {
    if (alive) generating.value = false
  }
}
async function saveDraft() {
  if (
    !draft.value ||
    !storageKey ||
    loading.value ||
    generating.value ||
    saving.value ||
    stale.value ||
    !draft.value.text.trim()
  )
    return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    await counter.storageSet(storageKey, JSON.parse(JSON.stringify(draft.value)))
    if (alive) notice.value = '已保存到本机扩展，未同步飞书、未发送。'
  } catch {
    if (alive) error.value = '本地保存失败，编辑内容仍在，请重试。'
  } finally {
    if (alive) saving.value = false
  }
}
</script>

<template>
  <section class="greeting-draft" aria-labelledby="greeting-title">
    <h3 id="greeting-title">首次招呼语</h3>
    <p>根据当前岗位和已保存简历生成。审核后可单独确认发送；采集和生成不会自动联系 HR。</p>
    <label for="greeting-style">表达偏好</label>
    <Textarea
      id="greeting-style"
      v-model="style"
      fluid
      rows="3"
      :disabled="loading || generating || saving"
    />
    <p v-if="blocked">{{ blocked }}</p>
    <Button
      label="生成招呼语"
      icon="pi pi-sparkles"
      severity="secondary"
      outlined
      :loading="generating"
      :disabled="loading || saving || busy || !!blocked"
      @click="generate"
    />
    <Message v-if="error" severity="error" :closable="false" aria-live="polite">{{
      error
    }}</Message>
    <Message v-if="stale" severity="warn" :closable="false"
      >岗位、简历、模型或表达偏好已变化；以下为旧草稿，请重新生成。</Message
    >
    <template v-if="draft">
      <label for="greeting-text">招呼语草稿（可编辑）</label>
      <Textarea
        id="greeting-text"
        v-model="draft.text"
        fluid
        rows="5"
        maxlength="500"
        :disabled="generating || saving"
        @update:model-value="notice = ''"
      />
      <p>
        {{ [...draft.text].length }}/500 字 · 简历：{{ draft.resumeFileName || '手动填写' }} · 版本
        {{ draft.resumeVersion.slice(0, 8) }}
      </p>
      <Button
        label="保存本地草稿"
        severity="secondary"
        :loading="saving"
        :disabled="generating || stale || !draft.text.trim()"
        @click="saveDraft"
      />
      <Button
        label="审核并发送…"
        icon="pi pi-comment"
        severity="secondary"
        outlined
        :disabled="loading || generating || saving || busy || stale || !draft.text.trim()"
        @click="reviewGreeting"
      />
    </template>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p>
      生成会将简历、已导入个人资料和岗位发送给已配置的模型；草稿只保存在本机，不改变飞书求职进度。
    </p>
    <Dialog
      v-model:visible="reviewVisible"
      modal
      header="确认发送招呼语"
      :closable="!sendPending"
      :close-on-escape="!sendPending"
      :style="{ width: '32rem', maxWidth: 'calc(100vw - 2rem)' }"
    >
      <div v-if="review" class="greeting-review">
        <p>{{ review.company }} · {{ review.job }}</p>
        <p>招聘人：{{ review.recruiter }}</p>
        <label for="greeting-review-text">本次招呼语原文</label>
        <Textarea id="greeting-review-text" :model-value="review.text" readonly fluid rows="7" />
        <Message severity="warn" :closable="false">
          点击确认后会向上述招聘人发送这段原文；尚未沟通时会先建立沟通关系。不发送附件简历，不自动回复后续消息。
        </Message>
        <div class="greeting-consent">
          <Checkbox
            v-model="defaultGreetingDisabled"
            input-id="greeting-disabled"
            binary
            :disabled="sendPending || sendBlocked"
          />
          <label for="greeting-disabled"
            >我已核对收件人和原文，并确认 BOSS「启用招呼语」已关闭</label
          >
        </div>
      </div>
      <template #footer>
        <div class="greeting-send-footer">
          <Message
            v-if="sendRecord"
            :severity="
              sendRecord.status === 'sent'
                ? 'success'
                : sendRecord.status === 'failed' || sendRecord.status === 'unknown'
                  ? 'warn'
                  : 'info'
            "
            :closable="false"
            aria-live="polite"
          >
            {{ sendRecord.message }}
            <span v-if="sendRecord.relationship === 'confirmed'">（沟通关系已建立）</span>
          </Message>
          <Message
            v-if="
              sendError ||
              (submissionRequested && !sendRecord && helper.workflow?.errorMessage.value)
            "
            severity="error"
            :closable="false"
          >
            {{ sendError || helper.workflow?.errorMessage.value }}
          </Message>
          <div class="greeting-send-actions">
            <Button
              label="关闭"
              severity="secondary"
              :disabled="sendPending"
              @click="reviewVisible = false"
            />
            <Button
              label="确认发送这一条"
              icon="pi pi-send"
              :loading="sendPending"
              :disabled="!defaultGreetingDisabled || busy || sendBlocked || stale"
              @click="confirmSend"
            />
          </div>
        </div>
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.greeting-draft {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
  margin-top: 1rem;
}
.greeting-review {
  display: grid;
  gap: 0.75rem;
  overflow-wrap: anywhere;
}
.greeting-review p {
  margin: 0;
}
.greeting-consent {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}
.greeting-send-footer {
  display: grid;
  gap: 0.75rem;
  width: 100%;
}
.greeting-send-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}
.greeting-draft > .p-button {
  justify-self: start;
}
.greeting-draft p {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 0.875rem;
}
</style>
