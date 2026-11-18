import type { BossHelperCtx } from '@/entrypoints/boss'
import { useAppToast } from '@/services/appToast'
import type { GreetingSendRequest } from '@/services/greetingSend'

import { workflowChannel } from './workflowBridge'
import type { WorkflowCommand, WorkflowSnapshot } from './workflowBridge'

/** The page owns execution; the panel only sends commands and displays snapshots. */
export function connectSidepanelWorkflow(ctx: BossHelperCtx, api: any) {
  let tabId: number | undefined
  let disposed = false
  let polling = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let failureSince: number | undefined
  let emptySince: number | undefined
  let connected = false
  ctx.pageConnection.value = 'connecting'

  function apply(snapshot: WorkflowSnapshot) {
    connected = true
    failureSince = undefined
    if (snapshot.jobs.length) {
      emptySince = undefined
      ctx.pageConnection.value = 'ready'
    } else {
      emptySince ??= Date.now()
      ctx.pageConnection.value = Date.now() - emptySince < 20000 ? 'reading' : 'empty'
    }
    ctx.jobList.value = snapshot.jobs
    ctx.jobMaps.clear()
    const states = new Map(snapshot.states)
    for (const record of snapshot.records ??
      snapshot.jobs.map((jobData) => ({ jobData, state: states.get(jobData.key) ?? {} }))) {
      const job = record.jobData
      // Remote views never execute with this data or access raw BOSS page objects.
      ctx.jobMaps.set(job.key, {
        jobData: job,
        rawData: {} as never,
        state: record.state,
      })
    }
    ctx.jobResultMaps.clear()
    snapshot.results.forEach(([key, result]) => ctx.jobResultMaps.set(key, result))
    ctx.currentJob.value = snapshot.currentJob
    ctx._logs.value = snapshot.logs
    ctx.actionRunning.value = snapshot.actionRunning ?? false
    if (ctx.workflow) {
      ctx.workflow.status.value = snapshot.status
      ctx.workflow.current.value = snapshot.current
      ctx.workflow.errorMessage.value = snapshot.error
    }
  }

  async function request(
    command: WorkflowCommand,
    key?: string,
    confirmed?: boolean,
    greeting?: GreetingSendRequest,
  ) {
    // Pin to the connected tab: switching tabs must not redirect stop/start.
    if (tabId === undefined) {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !/^https?:\/\/([^/]+\.)?zhipin\.com\//.test(tab.url ?? '')) {
        ctx.pageConnection.value = 'unavailable'
        throw new Error('请先打开 BOSS 岗位列表页')
      }
      tabId = tab.id
      if (ctx.pageConnection.value === 'unavailable') ctx.pageConnection.value = 'connecting'
    }
    const result = await api.tabs.sendMessage(tabId, {
      channel: workflowChannel,
      command,
      key,
      confirmed,
      greeting,
    })
    if (result?.error) throw new Error(result.error)
    if (!result?.snapshot) throw new Error('未收到页面采集状态')
    if (!disposed) apply(result.snapshot)
  }

  function failed(error: unknown, notify: boolean) {
    if (disposed) return
    const message = error instanceof Error ? error.message : String(error)
    if (ctx.workflow) {
      ctx.workflow.status.value = 'error'
      ctx.workflow.errorMessage.value = message
    }
    if (notify) useAppToast().add({ title: message, color: 'error' })
  }
  ctx.start = async () => {
    try {
      await request('start')
    } catch (error) {
      failed(error, true)
    }
  }
  ctx.stop = () => {
    void request('stop').catch((error) => failed(error, true))
  }
  ctx.reset = () => {
    void request('reset').catch((error) => failed(error, true))
  }
  ctx.retryJob = async (key) => {
    try {
      await request('retry', key)
    } catch (error) {
      failed(error, true)
    }
  }
  ctx.refreshProgress = async (key) => {
    try {
      await request('refreshProgress', key)
    } catch (error) {
      failed(error, true)
      throw error
    }
  }
  ctx.deliverJob = async (key) => {
    try {
      await request('deliver', key, true)
    } catch (error) {
      failed(error, true)
    }
  }
  ctx.sendGreeting = async (key, greeting) => {
    try {
      await request('sendGreeting', key, true, greeting)
    } catch (error) {
      failed(error, true)
      throw error
    }
  }

  async function poll() {
    if (disposed || polling) return
    polling = true
    try {
      await request('snapshot')
    } catch {
      if (!disposed && ctx.pageConnection.value !== 'unavailable') {
        failureSince ??= Date.now()
        ctx.pageConnection.value =
          Date.now() - failureSince < 12000 ? (connected ? 'reconnecting' : 'connecting') : 'error'
      }
    } finally {
      polling = false
      if (!disposed) timer = setTimeout(() => void poll(), 1000)
    }
  }
  void poll()
  return () => {
    disposed = true
    clearTimeout(timer)
  }
}
