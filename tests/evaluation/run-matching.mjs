import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createOpenAI } from '@ai-sdk/openai'
import { Output, ToolLoopAgent } from 'ai'

import { readCandidateProfile, candidateContext } from '../../src/services/candidateProfile.ts'
import { matchingPrompt, parseJobMatchResult } from '../../src/services/jobMatching.ts'
import { renderTemplate } from '../../src/utils/ai.ts'

const args = process.argv.slice(2)
const arg = (name) => args[args.indexOf(name) + 1]
const root = resolve(import.meta.dirname, '../../../..')
const cases = JSON.parse(await readFile(new URL('./matching-cases.json', import.meta.url), 'utf8'))
if (!args.includes('--live')) {
  console.log(
    `已准备 ${cases.length} 个评测场景；未调用模型。真实评测需 --live --resume 简历路径，并设置 MATCHING_BASE_URL、MATCHING_API_KEY、MATCHING_MODEL。`,
  )
  process.exit(0)
}
if (!args.includes('--resume') || !arg('--resume') || arg('--resume').startsWith('--'))
  throw new Error('请用 --resume 指定要发送给模型的简历文件。')
const baseURL = process.env.MATCHING_BASE_URL
const apiKey = process.env.MATCHING_API_KEY
const modelName = process.env.MATCHING_MODEL
if (![baseURL, apiKey, modelName].every((value) => value?.trim()))
  throw new Error('缺少 MATCHING_BASE_URL、MATCHING_API_KEY 或 MATCHING_MODEL。')
const resumeMarkdown = await readFile(resolve(arg('--resume')), 'utf8')
const profile = readCandidateProfile(
  await readFile(resolve(root, 'profile/matching-profile.json'), 'utf8'),
)
const model = createOpenAI({ baseURL, apiKey }).chat(modelName)
const agent = new ToolLoopAgent({
  model,
  output: Output.text(),
  temperature: 0,
  allowSystemInMessages: true,
})
const results = []
for (const item of cases) {
  const data = {
    resumeMarkdown,
    jobData: {
      jobName: item.title,
      address: item.city,
      degreeName: item.degree,
      experienceName: item.experience,
      jobDescription: item.jd,
    },
  }
  const messages = matchingPrompt.map((message) => ({
    ...message,
    content: renderTemplate(message.content, data),
  }))
  messages.push({ role: 'user', content: candidateContext(profile) })
  try {
    const output = await agent.generate({ messages, timeout: 60000 })
    const result = parseJobMatchResult(output.text)
    results.push({
      id: item.id,
      expectedDecisions: item.expectedDecisions,
      criteria: item.criteria,
      decisionMatches: item.expectedDecisions.includes(result.decision),
      result,
    })
    console.log(`${item.id}: ${result.decision}`)
  } catch {
    results.push({ id: item.id, error: '模型调用或输出校验失败；详情未记录，避免凭证泄露。' })
    console.log(`${item.id}: 未完成`)
  }
}
const destination = resolve(root, '.local/matching-evaluation')
await mkdir(destination, { recursive: true })
const path = resolve(destination, `${new Date().toISOString().replaceAll(':', '-')}.json`)
await writeFile(
  path,
  JSON.stringify(
    {
      model: modelName,
      evaluatedAt: new Date().toISOString(),
      note: 'decisionMatches 仅检查决策标签；具体理由和招呼语仍需人工审阅。',
      results,
    },
    null,
    2,
  ),
)
console.log(`评测结果：${path}`)
if (results.some((item) => item.error)) process.exitCode = 1
