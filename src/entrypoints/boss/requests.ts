// import axios from 'axios'

import {
  BossHelperError,
  LimitError,
  PublishError,
  RateLimitError,
} from '@/composables/useApplying/deliverError'
import { useAppToast } from '@/services/appToast'
import { logger } from '@/utils/logger'

// const { userInfo } = useStore()
const toast = useAppToast()
export const sameCompanyKey = 'local:sameCompany'
export const sameHrKey = 'local:sameHr'

export async function sendPublishReq(
  data: { securityId: string; encryptJobId: string },
  errorMsg?: string,
  retries = 3,
  _params = {},
) {
  if (retries === 0) {
    throw new PublishError(errorMsg ?? '重试多次失败')
  }
  const url = new URL('https://www.zhipin.com/wapi/zpgeek/friend/add.json')
  Object.entries({
    securityId: data.securityId,
    jobId: data.encryptJobId,
    ..._params,
  }).forEach(([key, value]) => url.searchParams.append(key, String(value)))

  const token = window?.Cookie.get('bst')
  if (!token) {
    toast.add({
      title: '没有获取到token,请刷新重试',
      color: 'error',
    })
    throw new PublishError('没有获取到token')
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Zp_token: token },
    }).then((r) => r.json())

    res.code !== 0 && logger.error(`投递失败`, res)

    if (res.code === 1) {
      const content = String(
        res?.zpData?.bizData?.chatRemindDialog?.content || res.message || '未知错误',
      )
      // 命中限额弹窗 → 立刻发送确认请求
      if (content.includes('您今天已与120位BOSS沟通')) {
        try {
          const url = new URL('https://www.zhipin.com/wapi/zpCommon/actionLog/geek/chatremind.json')
          url.searchParams.set('ba', res.zpData.bizData.chatRemindDialog.ba)
          url.searchParams.set('action', 'addf-limit-popup-c')
          await fetch(url, {
            method: 'POST',
            headers: { Zp_token: token },
          })

          return sendPublishReq(data, undefined, retries, { cid: 1 })
        } catch (e) {
          logger.error('尝试确认投递限制失败', e)
          throw new PublishError(`投递限制确认失败]${content}`)
        }
      } else if (content.includes('您今天已与150位BOSS沟通')) {
        throw new LimitError(content)
      } else if (content.includes('操作过于频繁')) {
        throw new RateLimitError(content)
      }

      throw new PublishError(content)
    } else if (res.code !== 0) {
      throw new PublishError(`未知错误状态:${res.message}`)
    }
    return res
  } catch (e: any) {
    if (e instanceof BossHelperError) {
      throw e
    }
    return sendPublishReq(data, e?.message as string, retries - 1)
  }
}
