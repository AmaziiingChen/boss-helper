import assert from 'node:assert/strict'
import test from 'node:test'

import { hasNonEmptyResume, resumeFileToHtml } from '../src/utils/resumeImport.ts'

void test('Markdown import preserves headings, emphasis, and lists as rich text', () => {
  const html = resumeFileToHtml('# 简历\n\n## 经历\n\n- **产品设计**\n- 测试', 'resume.MD')
  assert.match(html, /<h1>简历<\/h1>/)
  assert.match(html, /<h2>经历<\/h2>/)
  assert.match(html, /<li><strong>产品设计<\/strong><\/li>/)
  assert.doesNotMatch(html, /<pre>/)
})

void test('Markdown import escapes HTML and rejects executable links without loading images', () => {
  const html = resumeFileToHtml(
    '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert%281%29)\n\n![头像](https://example.test/tracker.png)',
    'resume.markdown',
  )
  assert.doesNotMatch(html, /<script|<img|href="javascript:/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /头像/)
  assert.doesNotMatch(html, /tracker\.png/)
})

void test('TXT import creates normal paragraphs, keeps line breaks, and escapes HTML', () => {
  const html = resumeFileToHtml('姓名\r\n联系方式\r\n\r\n<script>内容</script>', 'resume.txt')
  assert.equal(html, '<p>姓名<br>联系方式</p>\n<p>&lt;script&gt;内容&lt;/script&gt;</p>')
})

void test('Empty editor markup is empty and unsupported file types are rejected', () => {
  for (const html of ['', '<p><br></p>', '<p>&nbsp;</p>', undefined, null]) {
    assert.equal(hasNonEmptyResume(html), false)
  }
  assert.equal(hasNonEmptyResume('<p>经历</p>'), true)
  assert.equal(resumeFileToHtml('  \n ', 'resume.txt'), '')
  assert.throws(() => resumeFileToHtml('text', 'resume.html'), /Markdown/)
})
