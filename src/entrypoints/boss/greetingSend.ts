import type { JobData } from '@/composables/useHelper'
import { counter } from '@/message'
import { greetingHash } from '@/services/greeting'
import { executeGreetingSend } from '@/services/greetingSend'
import type { GreetingSendRecord, GreetingSendRequest } from '@/services/greetingSend'

import { sendBossText } from './chat'
import { sendPublishReq } from './requests'
import type { BossZpJobItemData } from './types'

/** Upstream getBossData contract; fail closed if the returned peer/job differs. */
export function validateGreetingRecipient(value: any, job: BossZpJobItemData) {
  const peer = value?.zpData?.data
  if (
    value?.code !== 0 ||
    !peer ||
    peer.encryptBossId !== job.encryptBossId ||
    peer.encryptJobId !== job.encryptJobId ||
    !Number.isSafeInteger(peer.bossId) ||
    peer.bossId <= 0 ||
    !Number.isInteger(peer.bossSource) ||
    peer.bossSource < 0
  ) {
    throw new Error('招聘人信息未能匹配当前岗位，未发送文字')
  }
  return { recipientId: String(peer.bossId), source: peer.bossSource }
}

export async function sendGreetingForJob(
  job: BossZpJobItemData,
  display: JobData,
  request: GreetingSendRequest,
  changed: (record: GreetingSendRecord) => void,
) {
  if (
    request.jobName !== (display.jobName || display.positionName) ||
    request.company !== display.brand.name ||
    request.recruiter !== display.boss.name
  )
    throw new Error('岗位或招聘人已变化，请重新打开确认窗口')
  const page = window._PAGE as any
  const account = String(page?.encryptUserId ?? '')
  const userId = page?.uid ?? page?.userId
  if (
    !account ||
    !userId ||
    !page?.token ||
    !job.encryptBossId ||
    !job.encryptJobId ||
    !job.securityId
  )
    throw new Error('登录或岗位数据不完整，请刷新 BOSS 后重新采集')
  if (!navigator.locks) throw new Error('浏览器不支持安全发送锁，未发送')
  const ledgerKey = `local:greeting-send:${await greetingHash(JSON.stringify([account, job.encryptBossId]))}`
  return navigator.locks.request(ledgerKey, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('另一页面正在联系该招聘人，请稍后核实结果')
    let wt = ''
    const token = page.token as string
    const bst = window.Cookie.get('bst')
    return executeGreetingSend(request, {
      existing: job.contact === true,
      read: () => counter.storageGet<GreetingSendRecord>(ledgerKey),
      write: async (record) => {
        if (!(await counter.storageSet(ledgerKey, record))) throw new Error('发送记录保存失败')
      },
      changed,
      async prepare() {
        if (!bst) throw new Error('登录失效')
        const result = await fetch('https://www.zhipin.com/wapi/zppassport/get/wt', {
          signal: AbortSignal.timeout(10000),
        }).then((response) => response.json())
        if (result.code !== 0 || typeof result.zpData?.wt2 !== 'string' || !result.zpData.wt2)
          throw new Error('无法初始化聊天连接')
        wt = result.zpData.wt2
      },
      async establish() {
        // Exactly one attempt: creating a relationship may have external side effects.
        await sendPublishReq(
          { securityId: job.securityId, encryptJobId: job.encryptJobId },
          undefined,
          1,
        )
        job.contact = true
      },
      async send(clientMid) {
        const body = new FormData()
        body.append('bossId', job.encryptBossId)
        body.append('securityId', job.securityId)
        body.append('bossSrc', '0')
        const response = await fetch('https://www.zhipin.com/wapi/zpchat/geek/getBossData', {
          method: 'POST',
          body,
          headers: { Zp_token: bst },
          signal: AbortSignal.timeout(10000),
        }).then((result) => result.json())
        const peer = validateGreetingRecipient(response, job)
        if (peer.recipientId === String(userId)) throw new Error('收件人与当前账号相同')
        return sendBossText({ userId, token, wt, ...peer, text: request.text, clientMid })
      },
    })
  })
}
