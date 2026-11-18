import { z } from 'zod'

const profileSchema = z
  .object({
    schemaVersion: z.literal(1),
    updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    content: z.string().trim().min(1).max(60000),
  })
  .strict()

/** Private profile files are imported into local extension storage, never bundled. */
export function readCandidateProfile(value: string): string {
  if (value.length > 150000) throw new Error('个人资料文件过大，请精简后导入。')
  try {
    return profileSchema.parse(JSON.parse(value)).content
  } catch {
    throw new Error('个人资料格式无效，请导入本地导出的 matching-profile.json。')
  }
}

export function candidateContext(content = '', date = new Date().toISOString().slice(0, 10)) {
  return `当前日期：${date}\n个人背景与职业偏好（简历的补充资料；偏好不代表经历）：\n${content.trim() || '未导入个人资料；依据简历判断，不擅自补全偏好。'}`
}
