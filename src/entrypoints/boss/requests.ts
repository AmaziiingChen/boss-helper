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
      signal: AbortSignal.timeout(15000),
    }).then((r) => r.json())

    res.code !== 0 && logger.error('沟通请求失败', { code: res.code })

    if (res.code === 1) {
      const content = String(
        res?.zpData?.bizData?.chatRemindDialog?.content || res.message || '未知错误',
      )
      if (
        content.includes('您今天已与120位BOSS沟通') ||
        content.includes('您今天已与150位BOSS沟通')
      ) {
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
