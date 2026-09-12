import type { TaskResult } from '@/composables/useApplying/type'
import type { HelperContext } from '@/composables/useHelper'
import type { JobData, Log } from '@/composables/useHelper/type'
import type { BossWorkflowState } from '@/entrypoints/boss/delivery'

export const workflowChannel = 'boss-helper-workflow'
export const workflowCommands = ['snapshot', 'start', 'stop', 'reset', 'retry', 'deliver'] as const
export type WorkflowCommand = (typeof workflowCommands)[number]
export interface WorkflowSnapshot {
  jobs: JobData[]
  records: Array<{ jobData: JobData; state: BossWorkflowState }>
  states: Array<[string, BossWorkflowState]>
  results: Array<[string, TaskResult]>
  currentJob: string | null
  status: 'pending' | 'running' | 'stop' | 'error'
  current: number
  error: string | null
  logs: Log[]
  actionRunning: boolean
  summary: HelperContext<any, any, any>['collectionSummary']['value']
}

export function snapshotWorkflow(ctx: HelperContext<any, any, any>): WorkflowSnapshot {
  // Never transport raw page objects, configuration or provider credentials.
  return JSON.parse(
    JSON.stringify({
      jobs: ctx.jobList.value,
      records: [...ctx.jobMaps.values()].map(({ jobData, state }) => ({ jobData, state })),
      states: [...ctx.jobMaps].map(([key, data]) => [key, data.state]),
      results: [...ctx.jobResultMaps],
      currentJob: ctx.currentJob.value,
      status: ctx.workflow?.status.value ?? 'pending',
      current: ctx.workflow?.current.value ?? 0,
      error: ctx.workflow?.errorMessage.value ?? null,
      logs: ctx.logs.value.slice(-20),
      actionRunning: ctx.actionRunning.value,
      summary: ctx.collectionSummary.value,
    }),
  )
}

export function providePageWorkflow(script: HTMLScriptElement, ctx: HelperContext<any, any, any>) {
  let starting = false
  let startVersion = 0
  script.addEventListener(`${workflowChannel}:request`, (event) => {
    const { id, command, key, confirmed } = JSON.parse((event as CustomEvent<string>).detail)
    if (!workflowCommands.includes(command)) return
    void (async () => {
      try {
        if (command === 'deliver' && confirmed !== true)
          throw new Error('投递需要针对该岗位明确确认')
        if (
          (command === 'retry' || command === 'deliver') &&
          (typeof key !== 'string' || !ctx.jobMaps.has(key))
        ) {
          throw new Error('请指定当前会话中已采集的岗位')
        }
        if (
          ['start', 'retry', 'deliver'].includes(command) &&
          (starting || ctx.workflowRunning.value)
        ) {
          throw new Error('已有任务运行，请先暂停或等待结束')
        }
        if (['start', 'retry', 'deliver'].includes(command)) {
          starting = true
          const version = ++startVersion
          try {
            await ctx.conf.confInit()
            await ctx.models.initModel()
            if (version !== startVersion) {
              starting = false
              throw new Error('启动已取消')
            }
            const operation =
              command === 'retry'
                ? ctx.retryJob(key)
                : command === 'deliver'
                  ? ctx.deliverJob(key)
                  : ctx.start()
            void operation
              .catch((error) => {
                if (ctx.workflow) {
                  ctx.workflow.status.value = 'error'
                  ctx.workflow.errorMessage.value = String(error)
                }
              })
              .finally(() => {
                starting = false
              })
          } catch (error) {
            starting = false
            throw error
          }
        } else if (command === 'stop') {
          startVersion++
          ctx.stop()
        } else if (command === 'reset') {
          if (starting || ctx.workflowRunning.value) throw new Error('请先暂停任务再重置')
          ctx.reset()
        }
        script.dispatchEvent(
          new CustomEvent(`${workflowChannel}:response`, {
            detail: JSON.stringify({ id, snapshot: snapshotWorkflow(ctx) }),
          }),
        )
      } catch (error) {
        script.dispatchEvent(
          new CustomEvent(`${workflowChannel}:response`, {
            detail: JSON.stringify({ id, error: String(error) }),
          }),
        )
      }
    })()
  })
}
