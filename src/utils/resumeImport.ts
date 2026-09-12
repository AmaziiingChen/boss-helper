import MarkdownIt from 'markdown-it'

// Raw HTML is treated as text. MarkdownIt's URL validator rejects script/data links.
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false })
// A resume import must not load images from a third-party URL.
markdown.renderer.rules.image = (tokens, index) =>
  markdown.utils.escapeHtml(tokens[index]?.content ?? '')

export function resumeFileToHtml(content: string, fileName: string): string {
  if (/\.(md|markdown)$/i.test(fileName)) return markdown.render(content)
  if (!/\.txt$/i.test(fileName)) throw new Error('请选择 Markdown（.md、.markdown）或 TXT 文件。')
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return ''
  return normalized
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${markdown.utils.escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('\n')
}

export function hasNonEmptyResume(html: string | null | undefined): boolean {
  return Boolean(
    html
      ?.replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#160;/g, ' ')
      .trim(),
  )
}
