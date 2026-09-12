import type { ContextLogger } from 'devlog-ui'
import { computed, shallowRef, ref } from 'vue'

import type { HelperContext } from '../useHelper'
import { DependencyMissingError } from './handles'
import type {
  Handler,
  Task,
  TaskContext,
  TaskPipeline,
  TaskResult,
  TaskStatus,
  WorkflowData,
} from './type'
import { jobStatusList } from './type'

export type DeliveryWorkflow<C extends HelperContext<C, T, S>, T, S> = Awaited<
  ReturnType<typeof useDeliveryWorkflow<C, T, S>>
>

function meginResults(res: void | TaskResult | Array<TaskResult | void>): TaskResult | void {
  if (!res) return
  if (Array.isArray(res)) {
    if (res.length === 0) return
    return res.reduce((acc: TaskResult, r) => {
      if (!r) return acc
      let mergedStatus = acc.status
      if (r.status) {
        const accStatusIndex = jobStatusList.indexOf(acc.status as any) ?? -1
        const rStatusIndex = jobStatusList.indexOf(r.status)
        if (rStatusIndex > accStatusIndex) {
          mergedStatus = r.status
        }
      }
      return {
        id: acc.id || r.id,
        isSkip: acc.isSkip || r.isSkip,
        reason: [acc.reason, r.reason].filter(Boolean).join('\n') || undefined,
        status: mergedStatus,
        msg: [acc.msg, r.msg].filter(Boolean).join('\n') || undefined,
        isCache: acc.isCache || r.isCache,
      }
    }, res[0] ?? {})
  }
  return res
}

export async function useDeliveryWorkflow<C extends HelperContext<C, T, S>, T, S>(
  items: Array<Task<C, T, S> | TaskPipeline<C, T, S> | (() => Task<C, T, S>)>,
  helper: C,
  options?: { mode?: 'collection' | 'delivery' },
) {
  const mode = options?.mode ?? 'delivery'
  const status = ref<'pending' | 'running' | 'stop' | 'error'>('pending')
  const current = ref(0)
  const total = computed(() => helper.jobList.value.length)
  const errorMessage = ref<string | null>(null)
  const pipeline = shallowRef<Task<C, T, S>[]>([])
  const nodes = shallowRef<
    Array<{
      id: string
      label: string
      status: TaskStatus
      deps: string[]
      error?: any
    }>
  >([])
  const stateMaps = ref(new Map<string, any>())
  const resolvedHandlers = new Map<string, Handler<C, T, S>>()
  let stopVersion = 0

  const rebuild = async () => {
    const _ctx: TaskContext<C, T, S> = {
      helper,
      now: new Date(),
      index: 0,
      log: logger.withContext({ id: 'workflow-rebuild' }),
    }
    const taskMap = new Map<string, Task<C, T, S>>()
    const _resolvedHandlers = new Map<string, any>()
    const errors = new Map<string, any>()

    const rawTasks = items
      .flatMap((i) => (typeof i === 'function' ? i() : i))
      .map((task) => ({ ...task, before: [...task.before], after: [...task.after] }))
    const requiredIds = new Set<string>()
    for (const task of rawTasks) {
      try {
        taskMap.set(task.id, task)
        const result = await task.task(_ctx)
        if (!result) continue

        requiredIds.add(task.id)
        task.deps.forEach((d) => requiredIds.add(d))

        if (typeof result === 'function') {
          _resolvedHandlers.set(task.id, result)
        } else {
          _resolvedHandlers.set(task.id, result.fn)
          if (result.before) task.before.push(...result.before)
          if (result.after) task.after.push(...result.after)
        }
      } catch (e) {
        requiredIds.add(task.id)
        task.deps.forEach((d) => requiredIds.add(d))
        errors.set(`${task.id}::${task.label}`, e)
        _resolvedHandlers.set(task.id, async () => {
          throw e
        })
      }
    }

    const _pipeline: Task<C, T, S>[] = []
    const visited = new Set<string>()
    const stack = new Set<string>()
    const sort = (id: string) => {
      if (stack.has(id)) throw new Error(`Cycle: ${id}`)
      if (visited.has(id)) return
      const t = taskMap.get(id)
      if (!t || !requiredIds.has(id)) return
      stack.add(id)
      t.deps.forEach(sort)
      stack.delete(id)
      visited.add(id)
      _pipeline.push(t)
    }
    Array.from(requiredIds).forEach(sort)

    pipeline.value = _pipeline
    resolvedHandlers.clear()
    _resolvedHandlers.forEach((v, k) => resolvedHandlers.set(k, v))

    nodes.value = rawTasks.map((t) => {
      const isLastDefinition = taskMap.get(t.id)?.task === t.task
      const isResolved = _resolvedHandlers.has(t.id)
      const error = errors.get(`${t.id}::${t.label}`)
      let nStatus: TaskStatus = 'disabled'
      if (!isLastDefinition) nStatus = 'shadowed'
      else if (error) nStatus = 'failed'
      else if (isResolved) nStatus = 'active'
      else if (requiredIds.has(t.id)) nStatus = 'dependency_only'

      return {
        id: t.id,
        label: t.label || t.id,
        status: nStatus,
        deps: t.deps,
        error,
      }
    })
    const errMsg = nodes.value
      .map((i) => {
        if (i.status === 'failed') {
          return `${i.label}: ${i.error instanceof Error ? i.error.message : JSON.stringify(i.error)}`
        }
      })
      .filter(Boolean)
      .join('\n')
    errorMessage.value = errMsg || null
    if (errMsg) {
      logger.error('工作流构建错误, 请检查配置:', errMsg)
      alert(`工作流构建错误, 请检查配置:\n${errMsg}`)
    } else {
      logger.debug('Pipeline rebuilt', jsonClone(pipeline.value))
    }
    return !errMsg
  }

  const executeTask = async (
    task: Task<C, T, S>,
    data: WorkflowData<T, S>,
    index: number,
    log: ContextLogger,
  ) => {
    let res: TaskResult | void = undefined
    const isStop = () => status.value === 'stop'
    const handler = resolvedHandlers.get(task.id)
    if (!handler || isStop()) return

    const fns = [...task.before, handler, ...task.after]
    log = log.withContext({ task_id: task.id })

    for (const fn of fns) {
      try {
        res = meginResults(
          await fn(
            {
              helper,
              now: new Date(),
              index,
              log,
            },
            data,
          ),
        )
        if (res?.isSkip || isStop()) break
      } catch (e) {
        if (e instanceof DependencyMissingError) {
          const dep = resolvedHandlers.get(e.taskId)
          if (dep) {
            await dep(
              {
                helper,
                now: new Date(),
                index,
                log,
              },
              data,
            )
            if (isStop()) break
            res = meginResults(
              await fn(
                {
                  helper,
                  now: new Date(),
                  index,
                  log,
                },
                data,
              ),
            )
            if (res?.isSkip || isStop()) break
            continue
          }
        }
        throw e
      }
    }
    return res
  }

  const execute = async (data: WorkflowData<T, S>, index = 0) => {
    if (nodes.value.some((node) => node.status === 'failed')) {
      status.value = 'error'
      return
    }
    const isStop = () => status.value === 'stop'
    if (mode === 'delivery') helper.statistics.todayData.value.total++
    const log = logger.withContext({
      id: 'workflow-execute',
      job_key: data.jobData.key,
      job_name: data.jobData.jobName,
    })
    try {
      let skipPipeline = false
      let errorLog = false
      for (const t of pipeline.value) {
        let res: void | TaskResult = undefined
        try {
          if (isStop()) break
          helper.jobResultMaps.set(data.jobData.key, {
            status: t.state || 'running',
            msg: t.stateMsg || '运行中',
          })
          res = await executeTask(t, data, index, log)
          if (res != null) {
            res.msg ??= t.label ?? t.id
            res.status ??= res.isSkip ? 'warn' : undefined
            if (res.isSkip) {
              skipPipeline = true
              break
            }
          }
          if (isStop()) break
        } catch (e) {
          res = {
            isSkip: true,
            status: 'error',
            reason: `任务${t.label ?? t.id}执行失败: ${e instanceof Error ? e.message : JSON.stringify(e)}`,
            msg: `报错/${t.label ?? t.id}`,
          }
          log.error(`任务${t.label ?? t.id}执行失败`, e)
          skipPipeline = true
          errorLog = true
          break
        } finally {
          if (res != null) {
            helper.jobResultMaps.set(data.jobData.key, {
              ...(helper.jobResultMaps.get(data.jobData.key) ?? {}),
              ...res,
            })
            if (res.status) {
              helper.statistics.todayData.value.tasks[t.id] ??= {}
              helper.statistics.todayData.value.tasks[t.id]![res.status] ??= 0
              helper.statistics.todayData.value.tasks[t.id]![res.status]! += 1
            }
          }
        }
      }
      if (!skipPipeline && isStop()) {
        helper.jobResultMaps.set(data.jobData.key, {
          status: 'wait',
          msg: '已暂停，等待继续',
        })
      } else if (!skipPipeline) {
        helper.jobResultMaps.set(data.jobData.key, {
          status: 'success',
          msg: mode === 'collection' ? '采集处理完成' : '投递成功',
        })
        if (mode === 'delivery') helper.statistics.todayData.value.success++
      } else if (!errorLog) {
        const r = helper.jobResultMaps.get(data.jobData.key)
        log.warn(`投递过滤: ${data.jobData.jobName}`, r?.msg, r?.reason)
      }
    } catch (e) {
      status.value = 'error'
      throw e
    }
  }

  const executeAll = async (rawDataMap: Map<string, T>) => {
    const version = stopVersion
    const ready = await rebuild()
    if (version !== stopVersion) return
    if (!ready) {
      status.value = 'error'
      return
    }

    let stepMsg = ''
    errorMessage.value = null
    status.value = 'running'
    const isStop = () => status.value === 'stop'

    try {
      while (status.value === 'running') {
        if (helper.jobList.value.length === 0) {
          stepMsg = mode === 'collection' ? '当前页面没有可采集的岗位' : '没有职位可投递'
          break
        }
        helper.jobList.value.forEach((job) => {
          const v = helper.jobResultMaps.get(job.key)
          if (!v) {
            helper.jobResultMaps.set(job.key, { status: 'wait', msg: '等待中' })
            return
          } else if (v.status === 'success' || v.status === 'warn') {
            return
          }
          v.status = 'wait'
          v.msg = '等待中'
          helper.jobResultMaps.set(job.key, v)
        })

        await delay(helper.conf.formData.delayDeliveryStarts, isStop)

        for (const [index, jobData] of helper.jobList.value.entries()) {
          current.value = index + 1
          if (isStop()) break
          const jobStatus = helper.jobResultMaps.get(jobData.key)?.status
          if (jobStatus === 'success' || jobStatus === 'warn') {
            continue
          }
          const data = {
            jobData,
            rawData: rawDataMap.get(jobData.key)!,
            state: stateMaps.value.get(jobData.key) ?? helper.jobMaps.get(jobData.key)?.state ?? {},
          }
          stateMaps.value.set(jobData.key, data.state)
          helper.jobMaps.set(jobData.key, data)
          helper.currentJob.value = jobData.key
          await execute(data, index)
          if (
            mode === 'delivery' &&
            helper.statistics.todayData.value.success >= helper.conf.formData.deliveryLimit.value
          ) {
            stepMsg = `投递达到数量限制`
            status.value = 'stop'
            break
          }
          await delay(helper.conf.formData.delayDeliveryInterval, isStop)
        }
        if (isStop()) break
        const hasMore = await helper.loadMoreJob(
          delay(helper.conf.formData.delayDeliveryPageNext, isStop),
        )
        if (!hasMore) {
          status.value = 'stop'
          stepMsg =
            mode === 'collection'
              ? '采集结束，未发现可继续读取的下一页'
              : '投递结束, 无法继续下一页'
          break
        }
      }
    } catch (e) {
      logger.error(mode === 'collection' ? '采集未知错误' : '投递未知错误', e)
      stepMsg = `未知错误: ${e instanceof Error ? e.message : JSON.stringify(e)}`
    } finally {
      if (!stepMsg) {
        stepMsg = mode === 'collection' ? '采集已暂停或结束' : '投递结束'
        status.value = 'pending'
      } else if (status.value !== 'stop') {
        status.value = 'error'
        errorMessage.value = stepMsg
      }
      const summary = mode === 'collection' ? helper.collectionSummary?.value : undefined
      if (summary) {
        stepMsg += `；发现 ${summary.total}，详情成功 ${summary.stages.detail.succeeded}，分析成功 ${summary.stages.analysis.succeeded}，入库成功 ${summary.stages.storage.succeeded}`
      }
      void helper.notification(stepMsg)

      const now = new Date()
      for (const t of pipeline.value) {
        try {
          await t.onEnd?.({
            now,
            helper,
            index: 0,
            log: logger.withContext({ id: 'workflow-end' }),
          })
        } catch (e) {
          logger.error('onEnd error', t.id, e)
        }
      }
    }
  }

  const stop = () => {
    stopVersion++
    status.value = 'stop'
  }
  const reset = () => {
    stopVersion++
    status.value = 'pending'
    helper.jobList.value.forEach((job) => {
      const v = helper.jobResultMaps.get(job.key)
      if (!v || v.status === 'success') {
        return
      }
      v.msg = '等待中'
      v.status = 'wait'
    })
  }

  return {
    mode,
    items,
    status,
    current,
    total,
    errorMessage,
    pipeline,
    nodes,
    ctx: helper,
    stateMaps,
    rebuild,
    execute,
    executeAll,
    stop,
    reset,
  }
}
