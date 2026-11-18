import { Buffer } from 'buffer'

import mqtt from 'mqtt'

import { decodeProtocol, encodeText } from './protocol'

export interface BossTextInput {
  userId: string | number
  token: string
  wt: string
  recipientId: string | number
  source: number
  text: string
  clientMid: string | number
}

type Listener = (...args: any[]) => void
export interface ChatClient {
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
  publish(
    topic: string,
    message: Buffer,
    options: { qos: 0; retain: false },
    callback: (error?: Error) => void,
  ): unknown
  end(force: boolean): unknown
}

export interface ChatTransportDependencies {
  connect: (url: string, options: Parameters<typeof mqtt.connect>[1]) => ChatClient
  timeoutMs?: number
}

export class BossTextSendError extends Error {
  readonly status = 'unknown'
  constructor(message: string) {
    super(message)
    this.name = 'BossTextSendError'
  }
}

function numericId(value: string | number): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error('聊天 ID 必须为精确整数')
  const id = String(value)
  if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) throw new Error('聊天 ID 无效')
  return id
}

/** One confirmed text, one connection, one publish; only a matching business ACK succeeds. */
export async function sendBossText(
  input: BossTextInput,
  dependencies: ChatTransportDependencies = {
    connect: (url, options) => mqtt.connect(url, options),
  },
): Promise<{ serverMid: string }> {
  const userId = numericId(input.userId)
  const recipientId = numericId(input.recipientId)
  const clientMid = numericId(input.clientMid)
  if (!input.token || !input.wt || !input.text.trim()) throw new Error('聊天凭据或文字内容缺失')
  if (!Number.isInteger(input.source) || input.source < 0 || input.source > 2147483647)
    throw new Error('聊天来源无效')
  const payload = encodeText({
    userId,
    recipientId,
    clientMid,
    source: input.source,
    text: input.text,
  })
  let client: ChatClient
  try {
    client = dependencies.connect('wss://ws6.zhipin.com/chatws', {
      clientId: `ws-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
      username: `${input.token}|0`,
      password: input.wt,
      keepalive: 25,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: Math.min(dependencies.timeoutMs ?? 15000, 10000),
      protocolVersion: 4,
      resubscribe: false,
      queueQoSZero: false,
      createWebsocket: (url: string) => new WebSocket(url, [input.wt]),
    })
  } catch {
    throw new BossTextSendError('聊天连接失败，未确认发送结果')
  }
  const listeners: Array<[string, Listener]> = []
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<{ serverMid: string }>((resolve, reject) => {
      let settled = false
      let published = false
      const finish = (error?: BossTextSendError, serverMid?: string) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (error) reject(error)
        else resolve({ serverMid: serverMid! })
      }
      const listen = (event: string, listener: Listener) => {
        listeners.push([event, listener])
        client.on(event, listener)
      }
      listen('message', (_topic: string, bytes: Uint8Array) => {
        if (!published || settled) return
        try {
          const decoded = decodeProtocol(bytes)
          if (decoded.type !== 5 || !Array.isArray(decoded.messageSync)) return
          for (const ack of decoded.messageSync) {
            if (ack.clientMid !== clientMid) continue
            const serverMid = numericId(ack.serverMid ?? '')
            finish(undefined, serverMid)
            return
          }
        } catch {
          // Malformed or unrelated traffic is never treated as a successful ACK.
        }
      })
      listen('error', () =>
        finish(new BossTextSendError('聊天连接错误，发送结果未确认，请先在 BOSS 核实')),
      )
      listen('close', () =>
        finish(new BossTextSendError('聊天连接已断开，发送结果未确认，请先在 BOSS 核实')),
      )
      listen('offline', () =>
        finish(new BossTextSendError('聊天连接离线，发送结果未确认，请先在 BOSS 核实')),
      )
      listen('disconnect', () =>
        finish(new BossTextSendError('服务端断开聊天连接，发送结果未确认，请先在 BOSS 核实')),
      )
      listen('connect', () => {
        if (published || settled) return
        published = true
        try {
          client.publish('chat', Buffer.from(payload), { qos: 0, retain: false }, (error) => {
            if (error)
              finish(new BossTextSendError('文字发送发生错误，结果未确认，请先在 BOSS 核实'))
            // MQTT publish completion is not the application's delivery receipt.
          })
        } catch {
          finish(new BossTextSendError('文字发送发生错误，结果未确认，请先在 BOSS 核实'))
        }
      })
      timer = setTimeout(
        () => finish(new BossTextSendError('等待服务端文字回执超时，结果未确认，请先在 BOSS 核实')),
        dependencies.timeoutMs ?? 15000,
      )
    })
  } finally {
    if (timer) clearTimeout(timer)
    for (const [event, listener] of listeners) client.removeListener(event, listener)
    // Avoid surfacing credentials from late socket errors during forced teardown.
    client.on('error', () => {})
    try {
      client.end(true)
    } catch {
      /* Teardown cannot change the ACK result. */
    }
  }
}
