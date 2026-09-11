export function formatUrlField(
  rawUrl: string | undefined,
  text: string,
): { link: string; text: string } | undefined {
  const value = rawUrl?.trim()
  if (!value) return undefined

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`岗位链接不是有效 URL：${value}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`岗位链接仅支持 HTTP(S)：${value}`)
  }

  return { link: url.toString(), text: text.trim() || '查看岗位' }
}
