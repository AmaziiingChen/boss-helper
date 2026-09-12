import { ref, toRaw } from 'vue'

import { counter } from '@/message'
import { useAppToast } from '@/services/appToast'
import { logger } from '@/utils/logger'

import type { OpenaiLLMConf } from './openai'
import { openai } from './openai'

export * from './chatModel'

const toast = useAppToast()
export const confModelKey = 'conf-model'
export const llms = [openai.info]

export type ModelConfData = OpenaiLLMConf

export interface ModelConf {
  key: string
  name: string
  color?: string
  data?: ModelConfData
  // vip?: {
  //   description: string
  //   price: {
  //     input: string
  //     output: string
  //   }
  // }
}

const modelData = ref<ModelConf[]>([])

export const useModel = () => {
  async function init() {
    const data = await counter.storageGet<ModelConf[]>(confModelKey, [])
    logger.debug('ai模型配置已加载', { count: data.length })
    modelData.value = data
  }

  async function persist() {
    await counter.storageSet(confModelKey, toRaw(modelData.value))
  }

  async function save() {
    await persist()
    toast.add({
      title: '保存成功',
      color: 'success',
    })
  }

  return {
    initModel: init,
    modelData,
    saveModel: save,
    saveModelSilently: persist,
  }
}
