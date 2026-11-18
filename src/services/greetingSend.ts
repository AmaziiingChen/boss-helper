import { greetingHash } from './greeting'

export interface GreetingSendRequest {
  text: string
  jobName: string
  company: string
  recruiter: string
  confirmed: boolean
  defaultGreetingDisabled: boolean
}
export interface GreetingSendRecord {
  status: 'preparing' | 'sending' | 'sent' | 'failed' | 'unknown'
  relationship: 'existing' | 'confirmed' | 'unknown' | 'not_started'
  textHash: string
  clientMid: string
  serverMid?: string
  updatedAt: number
  message: string
}
export interface GreetingSendDependencies {
  read(): Promise<GreetingSendRecord | null | undefined>
  write(record: GreetingSendRecord): Promise<void>
  changed(record: GreetingSendRecord): void
  prepare(): Promise<void>
  establish(): Promise<void>
  send(clientMid: string): Promise<{ serverMid: string }>
  existing: boolean
}

/** Persist intent before any external mutation. An uncertain attempt must never auto-retry. */
export async function executeGreetingSend(
  request: GreetingSendRequest,
  deps: GreetingSendDependencies,
) {
  if (request.confirmed !== true || request.defaultGreetingDisabled !== true)
    throw new Error('请确认本次收件人、原文以及 BOSS 默认招呼语已关闭')
  if (
    typeof request.text !== 'string' ||
    !request.text.trim() ||
    Array.from(request.text).length > 500
  )
    throw new Error('招呼语应为 1—500 字')
  const previous = await deps.read()
  if (previous && previous.status !== 'failed') {
    deps.changed(previous)
    throw new Error(
      previous.status === 'sent'
        ? '该招聘人已有发送记录，不重复发送'
        : '上次操作结果待核实，禁止自动重发',
    )
  }
  let record: GreetingSendRecord = {
    status: 'preparing',
    relationship: deps.existing ? 'existing' : 'not_started',
    textHash: await greetingHash(request.text),
    clientMid: String(Date.now() * 1000 + (crypto.getRandomValues(new Uint16Array(1))[0]! % 1000)),
    updatedAt: Date.now(),
    message: '检查聊天连接与收件人',
  }
  let mutationStarted = false
  const update = async (patch: Partial<GreetingSendRecord>) => {
    record = { ...record, ...patch, updatedAt: Date.now() }
    await deps.write({ ...record })
    deps.changed({ ...record })
  }
  try {
    await update({})
    await deps.prepare()
    if (!deps.existing) {
      await update({ relationship: 'unknown', message: '正在建立沟通关系，尚未发送文字' })
      mutationStarted = true
      await deps.establish()
      await update({ relationship: 'confirmed' })
    }
    await update({ status: 'sending', message: '正在发送原文，等待 BOSS 回执' })
    mutationStarted = true
    const receipt = await deps.send(record.clientMid)
    if (!receipt.serverMid) throw new Error('missing receipt')
    await update({
      status: 'sent',
      serverMid: receipt.serverMid,
      message: 'BOSS 已确认文字发送成功（不代表招聘人已读）',
    })
    return record
  } catch {
    record = {
      ...record,
      status: mutationStarted ? 'unknown' : 'failed',
      updatedAt: Date.now(),
      message: mutationStarted
        ? '操作结果待核实，请在 BOSS 查看；不会自动重发'
        : '发送前检查失败，未建立新沟通、未发送文字；请核对登录与岗位信息',
    }
    deps.changed({ ...record })
    try {
      await deps.write({ ...record })
    } catch {
      /* Existing durable intent still blocks retry. */
    }
    return record
  }
}
